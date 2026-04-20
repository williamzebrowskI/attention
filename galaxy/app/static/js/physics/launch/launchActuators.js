import { LAUNCH_REALISM_CONFIG } from "./launchRealismConfig.js";
import {
  angleBetweenRadians,
  clamp,
  degrees,
  mixVectors,
  normalize,
  rad,
} from "./launchMath.js";

function linearInterpolate(a, b, t) {
  const tt = clamp(Number(t) || 0, 0, 1);
  return a + ((b - a) * tt);
}

export function createActuatorState(initialDirection = { x: 0, y: 0, z: 1 }) {
  const direction = normalize(initialDirection, { x: 0, y: 0, z: 1 });
  return {
    throttleCommand: 0,
    throttleActual: 0,
    directionCommand: direction,
    directionActual: direction,
    gimbalErrorDeg: 0,
    angularRateRadS: 0,
  };
}

export function createMassModelState() {
  return {
    comNormalized: 0.5,
    inertiaNormalized: 1,
    controlAuthorityScale: 1,
  };
}

function massModelProfile(bodyKind) {
  const cfg = LAUNCH_REALISM_CONFIG.massModel || {};
  if (bodyKind === "stage2") {
    return cfg.stage2 || null;
  }
  if (bodyKind === "booster") {
    return cfg.booster || null;
  }
  return cfg.stage1 || null;
}

function componentPitchInertiaNormalized({
  massKg,
  axialPositionNorm,
  axialExtentNorm = 0,
  radiusNorm = 0,
  comNormalized,
}) {
  const mass = Math.max(0, Number(massKg) || 0);
  if (!(mass > 0)) {
    return 0;
  }
  const axialExtent = Math.max(0, Number(axialExtentNorm) || 0);
  const radius = Math.max(0, Number(radiusNorm) || 0);
  const offset = (Number(axialPositionNorm) || 0) - (Number(comNormalized) || 0);
  const localInertia = ((axialExtent * axialExtent) / 12) + ((radius * radius) / 4);
  return mass * (localInertia + (offset * offset));
}

function tankFillCenterNorm(bottomNorm, topNorm, fillFraction) {
  const bottom = Number(bottomNorm) || 0;
  const top = Number(topNorm) || bottom;
  const clampedFill = clamp(Number(fillFraction) || 0, 0, 1);
  const height = Math.max(1e-6, top - bottom);
  return bottom + ((height * clampedFill) * 0.5);
}

function tankFillExtentNorm(bottomNorm, topNorm, fillFraction) {
  const bottom = Number(bottomNorm) || 0;
  const top = Number(topNorm) || bottom;
  const clampedFill = clamp(Number(fillFraction) || 0, 0, 1);
  return Math.max(1e-6, (top - bottom) * clampedFill);
}

function computeMassProperties({
  bodyKind = "stage1",
  dryMassKg = 0,
  propellantMassKg = 0,
  propellantFraction = 1,
  attachedMassKg = 0,
}) {
  const profile = massModelProfile(bodyKind);
  if (!profile) {
    return {
      comNormalized: 0.5,
      inertiaPitchNormalized: 1,
      referenceInertiaPitchNormalized: 1,
      controlAuthorityScale: 1,
    };
  }
  const dryMass = Math.max(0, Number(dryMassKg) || 0);
  const propMassTotal = Math.max(0, Number(propellantMassKg) || 0);
  const propFrac = clamp(Number(propellantFraction) || 0, 0, 1);
  const remainingPropMass = propMassTotal * propFrac;
  const attachedMass = Math.max(0, Number(attachedMassKg) || 0);

  const components = [];
  const addComponent = (massKg, axialPositionNorm, axialExtentNorm = 0, radiusNorm = 0) => {
    const mass = Math.max(0, Number(massKg) || 0);
    if (!(mass > 0)) {
      return;
    }
    components.push({
      massKg: mass,
      axialPositionNorm: Number(axialPositionNorm) || 0,
      axialExtentNorm: Math.max(0, Number(axialExtentNorm) || 0),
      radiusNorm: Math.max(0, Number(radiusNorm) || 0),
    });
  };

  for (const component of profile.dryComponents || []) {
    addComponent(
      dryMass * Math.max(0, Number(component.massFraction) || 0),
      component.axialPositionNorm,
      component.axialExtentNorm,
      component.radiusNorm,
    );
  }
  for (const component of profile.attachedComponents || []) {
    addComponent(
      attachedMass * Math.max(0, Number(component.massFraction) || 0),
      component.axialPositionNorm,
      component.axialExtentNorm,
      component.radiusNorm,
    );
  }
  for (const tank of profile.propellantTanks || []) {
    const tankMass = remainingPropMass * Math.max(0, Number(tank.propellantFraction) || 0);
    addComponent(
      tankMass,
      tankFillCenterNorm(tank.bottomNorm, tank.topNorm, propFrac),
      tankFillExtentNorm(tank.bottomNorm, tank.topNorm, propFrac),
      tank.radiusNorm,
    );
  }

  const totalMassKg = components.reduce((sum, component) => sum + component.massKg, 0);
  if (!(totalMassKg > 0)) {
    return {
      comNormalized: 0.5,
      inertiaPitchNormalized: 1,
      referenceInertiaPitchNormalized: 1,
      controlAuthorityScale: 1,
    };
  }

  const comNormalized = components.reduce(
    (sum, component) => sum + (component.massKg * component.axialPositionNorm),
    0,
  ) / totalMassKg;

  const inertiaPitchNormalized = components.reduce(
    (sum, component) => (
      sum
      + componentPitchInertiaNormalized({
        massKg: component.massKg,
        axialPositionNorm: component.axialPositionNorm,
        axialExtentNorm: component.axialExtentNorm,
        radiusNorm: component.radiusNorm,
        comNormalized,
      })
    ),
    0,
  );

  const referenceProps = computeMassPropertiesReference({
    profile,
    bodyKind,
    dryMassKg: dryMass,
    propellantMassKg: propMassTotal,
    attachedMassKg: attachedMass,
  });
  const referenceInertiaPitchNormalized = Math.max(1e-6, referenceProps.inertiaPitchNormalized);
  const inertiaNormalized = inertiaPitchNormalized / referenceInertiaPitchNormalized;
  const enginePlaneNorm = Number(profile.enginePlaneNorm);
  const safeEnginePlaneNorm = Number.isFinite(enginePlaneNorm) ? enginePlaneNorm : 0.05;
  const fullLeverArmNorm = Math.max(
    0.04,
    Math.abs(referenceProps.comNormalized - safeEnginePlaneNorm),
  );
  const leverArmNorm = Math.max(
    0.04,
    Math.abs(comNormalized - safeEnginePlaneNorm),
  );
  const leverRatio = leverArmNorm / fullLeverArmNorm;
  const controlAuthorityScale = clamp(
    (0.55 + (0.45 * leverRatio)) / Math.max(inertiaNormalized, 0.28),
    0.5,
    1.8,
  );

  return {
    comNormalized,
    inertiaPitchNormalized,
    referenceInertiaPitchNormalized,
    controlAuthorityScale,
  };
}

function computeMassPropertiesReference({
  profile,
  bodyKind = "stage1",
  dryMassKg = 0,
  propellantMassKg = 0,
  attachedMassKg = 0,
}) {
  void bodyKind;
  const dryMass = Math.max(0, Number(dryMassKg) || 0);
  const propMassTotal = Math.max(0, Number(propellantMassKg) || 0);
  const attachedMass = Math.max(0, Number(attachedMassKg) || 0);
  const components = [];
  const addComponent = (massKg, axialPositionNorm, axialExtentNorm = 0, radiusNorm = 0) => {
    const mass = Math.max(0, Number(massKg) || 0);
    if (!(mass > 0)) {
      return;
    }
    components.push({
      massKg: mass,
      axialPositionNorm: Number(axialPositionNorm) || 0,
      axialExtentNorm: Math.max(0, Number(axialExtentNorm) || 0),
      radiusNorm: Math.max(0, Number(radiusNorm) || 0),
    });
  };
  for (const component of profile.dryComponents || []) {
    addComponent(
      dryMass * Math.max(0, Number(component.massFraction) || 0),
      component.axialPositionNorm,
      component.axialExtentNorm,
      component.radiusNorm,
    );
  }
  for (const component of profile.attachedComponents || []) {
    addComponent(
      attachedMass * Math.max(0, Number(component.massFraction) || 0),
      component.axialPositionNorm,
      component.axialExtentNorm,
      component.radiusNorm,
    );
  }
  for (const tank of profile.propellantTanks || []) {
    addComponent(
      propMassTotal * Math.max(0, Number(tank.propellantFraction) || 0),
      tankFillCenterNorm(tank.bottomNorm, tank.topNorm, 1),
      tankFillExtentNorm(tank.bottomNorm, tank.topNorm, 1),
      tank.radiusNorm,
    );
  }
  const totalMassKg = components.reduce((sum, component) => sum + component.massKg, 0);
  if (!(totalMassKg > 0)) {
    return {
      comNormalized: 0.5,
      inertiaPitchNormalized: 1,
    };
  }
  const comNormalized = components.reduce(
    (sum, component) => sum + (component.massKg * component.axialPositionNorm),
    0,
  ) / totalMassKg;
  const inertiaPitchNormalized = components.reduce(
    (sum, component) => (
      sum
      + componentPitchInertiaNormalized({
        massKg: component.massKg,
        axialPositionNorm: component.axialPositionNorm,
        axialExtentNorm: component.axialExtentNorm,
        radiusNorm: component.radiusNorm,
        comNormalized,
      })
    ),
    0,
  );
  return {
    comNormalized,
    inertiaPitchNormalized,
  };
}

export function updateMassModelState(model, {
  propellantFraction = 1,
  bodyKind = "stage1",
  dtSeconds = 0,
  dryMassKg = 0,
  propellantMassKg = 0,
  attachedMassKg = 0,
}) {
  const state = model || createMassModelState();
  const props = computeMassProperties({
    bodyKind,
    dryMassKg,
    propellantMassKg,
    propellantFraction,
    attachedMassKg,
  });
  const lagTauSec = Math.max(0.08, Number(LAUNCH_REALISM_CONFIG.massModel.lagTauSec) || 0.9);
  const alpha = clamp((Number(dtSeconds) || 0) / lagTauSec, 0, 1);
  state.comNormalized = linearInterpolate(state.comNormalized, props.comNormalized, alpha);
  state.inertiaNormalized = linearInterpolate(
    state.inertiaNormalized,
    props.inertiaPitchNormalized / Math.max(props.referenceInertiaPitchNormalized, 1e-6),
    alpha,
  );
  state.controlAuthorityScale = linearInterpolate(
    state.controlAuthorityScale,
    props.controlAuthorityScale,
    alpha,
  );
  return state;
}

export function applyActuatorModel(actuatorState, {
  requestedThrottle = 0,
  requestedDirection = { x: 0, y: 0, z: 1 },
  dtSeconds = 0,
  config,
  massModel,
  angularAccelerationRadS2 = null,
  angularDampingPerS = null,
}) {
  const state = actuatorState || createActuatorState(requestedDirection);
  const cfg = config || LAUNCH_REALISM_CONFIG.actuator.stage;
  const massState = massModel || createMassModelState();
  const requestedThrottleClamped = clamp(Number(requestedThrottle) || 0, 0, 1);
  const requestedDirNorm = normalize(
    requestedDirection,
    state.directionActual || { x: 0, y: 0, z: 1 },
  );
  const dt = Math.max(0, Number(dtSeconds) || 0);

  const inertiaScale = clamp(
    (
      (0.72 + (0.58 * (Number(massState.inertiaNormalized) || 1)))
      / Math.max(Number(massState.controlAuthorityScale) || 1, 0.25)
    ),
    0.45,
    1.9,
  );
  const riseTau = Math.max(0.06, (Number(cfg.throttleRiseTauSec) || 0.5) * inertiaScale);
  const fallTau = Math.max(0.05, (Number(cfg.throttleFallTauSec) || 0.34) * inertiaScale);
  const throttleTau = requestedThrottleClamped >= state.throttleActual ? riseTau : fallTau;
  const throttleAlpha = clamp(dt / throttleTau, 0, 1);

  state.throttleCommand = requestedThrottleClamped;
  state.directionCommand = requestedDirNorm;
  state.throttleActual = linearInterpolate(state.throttleActual, requestedThrottleClamped, throttleAlpha);

  const gimbalRateDegSBase = Math.max(0.1, Number(cfg.gimbalRateDegS) || 8);
  const gimbalRateDegS = gimbalRateDegSBase * clamp(
    (Number(massState.controlAuthorityScale) || 1)
      / Math.max(Number(massState.inertiaNormalized) || 1, 0.25),
    0.45,
    1.9,
  );
  const currentDir = normalize(state.directionActual, requestedDirNorm);
  const errorRad = angleBetweenRadians(currentDir, requestedDirNorm);
  let maxStepRad = rad(gimbalRateDegS) * dt;
  const aeroAngularAcceleration = Number(angularAccelerationRadS2);
  if (Number.isFinite(aeroAngularAcceleration) && aeroAngularAcceleration > 1e-9) {
    const dampingPerS = Math.max(0, Number(angularDampingPerS) || 0);
    const stoppingRateRadS = Math.sqrt(Math.max(0, 2 * aeroAngularAcceleration * errorRad));
    const rateStepRadS = aeroAngularAcceleration * dt;
    let angularRateRadS = Math.max(0, Number(state.angularRateRadS) || 0);
    if (angularRateRadS < stoppingRateRadS) {
      angularRateRadS = Math.min(stoppingRateRadS, angularRateRadS + rateStepRadS);
    } else {
      angularRateRadS = Math.max(stoppingRateRadS, angularRateRadS - rateStepRadS);
    }
    angularRateRadS *= Math.max(0, 1 - (dampingPerS * dt));
    state.angularRateRadS = angularRateRadS;
    maxStepRad = Math.min(errorRad, angularRateRadS * dt);
  } else {
    state.angularRateRadS = dt > 1e-9 ? Math.max(0, maxStepRad / dt) : 0;
  }
  const blend = errorRad > 1e-12 ? clamp(maxStepRad / errorRad, 0, 1) : 1;
  state.directionActual = normalize(mixVectors(currentDir, requestedDirNorm, blend), requestedDirNorm);
  state.gimbalErrorDeg = degrees(angleBetweenRadians(state.directionActual, requestedDirNorm));
  return state;
}
