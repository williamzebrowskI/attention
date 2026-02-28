const TWO_PI = Math.PI * 2;
const EPSILON = 1e-12;

const DEFAULT_RIGID_BODY_MODELS = Object.freeze({
  earth: Object.freeze({
    // Principal moments normalized by M*R^2 (J2000-era geodesy approximation).
    inertiaFactors: Object.freeze({ x: 0.329620, y: 0.329628, z: 0.330705 }),
    sourceIds: Object.freeze(["sun", "moon"]),
    tidalDamping: 0,
  }),
  moon: Object.freeze({
    // Triaxial approximation to preserve physical libration torque.
    inertiaFactors: Object.freeze({ x: 0.393100, y: 0.393200, z: 0.393350 }),
    sourceIds: Object.freeze(["earth", "sun"]),
    tidalDamping: 0,
  }),
});

function normalizeAngle(angle) {
  let wrapped = angle % TWO_PI;
  if (wrapped < 0) {
    wrapped += TWO_PI;
  }
  return wrapped;
}

function toVector3(THREE, value, fallback = null) {
  if (!value) {
    return fallback;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback;
  }
  return new THREE.Vector3(x, y, z);
}

function initialOrientationQuaternion(THREE, axisScene, spinRadians) {
  const axis = toVector3(THREE, axisScene, new THREE.Vector3(0, 1, 0)).normalize();
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Number(spinRadians) || 0);
  return tilt.multiply(spin).normalize();
}

function initialSpinRadPerSecond(rotationPeriodHours) {
  const hours = Number(rotationPeriodHours);
  if (!Number.isFinite(hours) || Math.abs(hours) < EPSILON) {
    return 0;
  }
  const magnitude = TWO_PI / (Math.abs(hours) * 3600);
  return hours < 0 ? -magnitude : magnitude;
}

function inertiaTensorDiagonalKgKm2(massKg, radiusKm, inertiaFactors) {
  const scale = massKg * radiusKm * radiusKm;
  return {
    x: scale * Number(inertiaFactors?.x || 0),
    y: scale * Number(inertiaFactors?.y || 0),
    z: scale * Number(inertiaFactors?.z || 0),
  };
}

function computeGravityGradientTorqueBody(THREE, state, targetPositionKm, sourceMassKg, sourcePositionKm, G) {
  if (!(sourceMassKg > 0) || !targetPositionKm || !sourcePositionKm) {
    return new THREE.Vector3(0, 0, 0);
  }

  const rx = sourcePositionKm.x - targetPositionKm.x;
  const ry = sourcePositionKm.y - targetPositionKm.y;
  const rz = sourcePositionKm.z - targetPositionKm.z;
  const rSq = (rx * rx) + (ry * ry) + (rz * rz);
  if (!(rSq > 1e-18)) {
    return new THREE.Vector3(0, 0, 0);
  }
  const r = Math.sqrt(rSq);
  const invR = 1 / r;
  const invR3 = invR / rSq;

  const relBody = new THREE.Vector3(rx, ry, rz).applyQuaternion(state.orientation.clone().invert());
  const nBody = relBody.multiplyScalar(invR);
  const iTimesN = new THREE.Vector3(
    state.inertia.x * nBody.x,
    state.inertia.y * nBody.y,
    state.inertia.z * nBody.z,
  );
  return nBody.cross(iTimesN).multiplyScalar(3 * G * sourceMassKg * invR3);
}

function applyBodyStateToVisual(THREE, state, visual) {
  if (!visual?.tiltGroup || !visual?.spinGroup) {
    return;
  }
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);

  const axisWorld = yAxis.clone().applyQuaternion(state.orientation).normalize();
  const tilt = new THREE.Quaternion().setFromUnitVectors(yAxis, axisWorld);
  const spinOnly = tilt.clone().invert().multiply(state.orientation).normalize();

  const rotatedXAxis = xAxis.clone().applyQuaternion(spinOnly);
  const spinRadians = normalizeAngle(Math.atan2(-rotatedXAxis.z, rotatedXAxis.x));

  visual.tiltGroup.quaternion.copy(tilt);
  visual.spinGroup.rotation.set(0, spinRadians, 0);
}

function integrateRigidBodyStep(THREE, state, torqueBody, dtSeconds) {
  const omega = state.omegaBody;
  const iOmega = new THREE.Vector3(
    state.inertia.x * omega.x,
    state.inertia.y * omega.y,
    state.inertia.z * omega.z,
  );
  const omegaCrossIomega = omega.clone().cross(iOmega);
  const rhs = torqueBody.clone().sub(omegaCrossIomega);

  const alpha = new THREE.Vector3(
    rhs.x * state.invInertia.x,
    rhs.y * state.invInertia.y,
    rhs.z * state.invInertia.z,
  );
  omega.addScaledVector(alpha, dtSeconds);

  if (state.tidalDamping > 0) {
    const damping = Math.max(0, 1 - (state.tidalDamping * dtSeconds));
    omega.multiplyScalar(damping);
  }

  const omegaMag = omega.length();
  if (omegaMag < EPSILON) {
    return;
  }
  const delta = new THREE.Quaternion().setFromAxisAngle(
    omega.clone().multiplyScalar(1 / omegaMag),
    omegaMag * dtSeconds,
  );
  state.orientation.multiply(delta).normalize();
}

export function createRigidBodyAttitudeController(options) {
  const THREE = options?.THREE;
  if (!THREE) {
    throw new Error("Rigid body attitude controller requires THREE namespace.");
  }

  const bodyIds = Array.isArray(options.bodyIds) ? [...options.bodyIds] : [];
  const bodyModelById = options.bodyModelById || DEFAULT_RIGID_BODY_MODELS;
  const getBodyVisual = options.getBodyVisual;
  const getBodyMeta = options.getBodyMeta;
  const getCoordinatesKm = options.getCoordinatesKm;
  const getBodyMassKg = options.getBodyMassKg;
  const getInitialAxisVector = options.getInitialAxisVector;
  const getInitialSpinRadians = options.getInitialSpinRadians;
  const getInitialRotationPeriodHours = options.getInitialRotationPeriodHours;
  const gravitationalConstantKm3PerKgS2 = Number(options.gravitationalConstantKm3PerKgS2);
  const maxFrameSeconds = Number.isFinite(options.maxFrameSeconds) ? options.maxFrameSeconds : 20;
  const stepSeconds = Number.isFinite(options.stepSeconds) ? options.stepSeconds : 0.25;
  const timeScale = Number.isFinite(options.timeScale) ? options.timeScale : 1;

  const stateById = new Map();

  function initialize(nowMs = Date.now()) {
    stateById.clear();
    for (const bodyId of bodyIds) {
      const body = getBodyMeta?.(bodyId);
      const visual = getBodyVisual?.(bodyId);
      const massKg = Number(getBodyMassKg?.(bodyId));
      const radiusKm = Number(body?.radius_km);
      const model = bodyModelById?.[bodyId];
      const inertiaFactors = model?.inertiaFactors;
      if (!body || !visual || !(massKg > 0) || !(radiusKm > 0) || !inertiaFactors) {
        continue;
      }

      const inertia = inertiaTensorDiagonalKgKm2(massKg, radiusKm, inertiaFactors);
      if (!(inertia.x > 0) || !(inertia.y > 0) || !(inertia.z > 0)) {
        continue;
      }

      const orientation = initialOrientationQuaternion(
        THREE,
        getInitialAxisVector?.(bodyId, nowMs),
        getInitialSpinRadians?.(bodyId, nowMs),
      );
      const rotationHours = getInitialRotationPeriodHours?.(bodyId);
      const omegaBody = new THREE.Vector3(0, initialSpinRadPerSecond(rotationHours), 0);
      const state = {
        bodyId,
        orientation,
        omegaBody,
        inertia,
        invInertia: {
          x: 1 / inertia.x,
          y: 1 / inertia.y,
          z: 1 / inertia.z,
        },
        sourceIds: Array.isArray(model?.sourceIds) ? [...model.sourceIds] : [],
        tidalDamping: Number(model?.tidalDamping) || 0,
      };
      stateById.set(bodyId, state);
      applyBodyStateToVisual(THREE, state, visual);
    }
  }

  function update(deltaSeconds) {
    if (!(deltaSeconds > 0) || stateById.size === 0) {
      return;
    }
    let remaining = Math.min(deltaSeconds * timeScale, maxFrameSeconds);
    if (!(remaining > 0)) {
      return;
    }

    while (remaining > EPSILON) {
      const dt = Math.min(stepSeconds, remaining);
      const torqueById = new Map();

      for (const [bodyId, state] of stateById.entries()) {
        const targetPos = getCoordinatesKm?.(bodyId);
        if (!targetPos) {
          torqueById.set(bodyId, new THREE.Vector3(0, 0, 0));
          continue;
        }
        const totalTorque = new THREE.Vector3(0, 0, 0);
        for (const sourceId of state.sourceIds) {
          if (!sourceId || sourceId === bodyId) {
            continue;
          }
          const sourcePos = getCoordinatesKm?.(sourceId);
          const sourceMass = Number(getBodyMassKg?.(sourceId));
          const torque = computeGravityGradientTorqueBody(
            THREE,
            state,
            targetPos,
            sourceMass,
            sourcePos,
            gravitationalConstantKm3PerKgS2,
          );
          totalTorque.add(torque);
        }
        torqueById.set(bodyId, totalTorque);
      }

      for (const [bodyId, state] of stateById.entries()) {
        const torque = torqueById.get(bodyId) || new THREE.Vector3(0, 0, 0);
        integrateRigidBodyStep(THREE, state, torque, dt);
      }
      remaining -= dt;
    }

    for (const [bodyId, state] of stateById.entries()) {
      const visual = getBodyVisual?.(bodyId);
      if (!visual) {
        continue;
      }
      applyBodyStateToVisual(THREE, state, visual);
    }
  }

  return {
    initialize,
    update,
    isManagedBody(bodyId) {
      return stateById.has(bodyId);
    },
    reset(nowMs = Date.now()) {
      initialize(nowMs);
    },
  };
}
