const TWO_PI = Math.PI * 2;
const EPSILON = 1e-12;

const DEFAULT_RIGID_BODY_MODELS = Object.freeze({
  sun: Object.freeze({
    // Solar inertia-factor approximation (k ~ 0.07), with slight oblateness.
    inertiaFactors: Object.freeze({ x: 0.07000, y: 0.07000, z: 0.07010 }),
    sourceIds: Object.freeze(["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]),
    tidalDamping: 0,
  }),
  mercury: Object.freeze({
    // Approximate normalized principal moments (M*R^2) for Mercury.
    inertiaFactors: Object.freeze({ x: 0.343000, y: 0.343100, z: 0.346000 }),
    sourceIds: Object.freeze(["sun"]),
    tidalDamping: 0,
  }),
  venus: Object.freeze({
    // Approximate normalized principal moments (M*R^2) for Venus.
    inertiaFactors: Object.freeze({ x: 0.336900, y: 0.336950, z: 0.337200 }),
    sourceIds: Object.freeze(["sun"]),
    tidalDamping: 0,
  }),
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
  mars: Object.freeze({
    // Near-oblate inertia from Mars' normalized moments.
    inertiaFactors: Object.freeze({ x: 0.365900, y: 0.366050, z: 0.366200 }),
    sourceIds: Object.freeze(["sun", "phobos", "deimos"]),
    tidalDamping: 0,
  }),
  phobos: Object.freeze({
    // Triaxial ellipsoid-derived approximation (27x22x18 km class shape).
    inertiaFactors: Object.freeze({ x: 0.318000, y: 0.415000, z: 0.478000 }),
    sourceIds: Object.freeze(["mars", "sun", "deimos"]),
    tidalDamping: 0,
  }),
  deimos: Object.freeze({
    // Triaxial ellipsoid-derived approximation (15x12.2x11 km class shape).
    inertiaFactors: Object.freeze({ x: 0.340000, y: 0.450000, z: 0.486000 }),
    sourceIds: Object.freeze(["mars", "sun", "phobos"]),
    tidalDamping: 0,
  }),
  jupiter: Object.freeze({
    // Gas-giant oblateness reflected in larger polar moment.
    inertiaFactors: Object.freeze({ x: 0.254000, y: 0.254000, z: 0.266000 }),
    sourceIds: Object.freeze(["sun", "saturn", "io", "europa", "ganymede", "callisto"]),
    tidalDamping: 0,
  }),
  io: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.376000, y: 0.377000, z: 0.378000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "europa", "ganymede"]),
    tidalDamping: 0,
  }),
  europa: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.344000, y: 0.345000, z: 0.346000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "io", "ganymede"]),
    tidalDamping: 0,
  }),
  ganymede: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.311000, y: 0.312000, z: 0.313000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "io", "europa", "callisto"]),
    tidalDamping: 0,
  }),
  callisto: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.354000, y: 0.355000, z: 0.356000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "ganymede", "saturn"]),
    tidalDamping: 0,
  }),
  amalthea: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.286000, y: 0.421000, z: 0.493000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "io"]),
    tidalDamping: 0,
  }),
  thebe: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.470000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "io"]),
    tidalDamping: 0,
  }),
  adrastea: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.310000, y: 0.430000, z: 0.490000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "metis", "io"]),
    tidalDamping: 0,
  }),
  metis: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "adrastea", "io"]),
    tidalDamping: 0,
  }),
  himalia: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.370000, y: 0.390000, z: 0.410000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "elara"]),
    tidalDamping: 0,
  }),
  elara: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.340000, y: 0.420000, z: 0.470000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "himalia"]),
    tidalDamping: 0,
  }),
  pasiphae: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.320000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "sinope", "carme", "ananke"]),
    tidalDamping: 0,
  }),
  sinope: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.440000, z: 0.500000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "pasiphae"]),
    tidalDamping: 0,
  }),
  carme: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.310000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "pasiphae", "ananke"]),
    tidalDamping: 0,
  }),
  ananke: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["jupiter", "sun", "pasiphae", "carme"]),
    tidalDamping: 0,
  }),
  saturn: Object.freeze({
    // Strong oblateness for Saturn's rapid rotation.
    inertiaFactors: Object.freeze({ x: 0.215000, y: 0.215000, z: 0.230000 }),
    sourceIds: Object.freeze(["sun", "jupiter", "uranus", "titan", "rhea", "iapetus"]),
    tidalDamping: 0,
  }),
  mimas: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.360000, y: 0.395000, z: 0.445000 }),
    sourceIds: Object.freeze(["saturn", "sun", "enceladus", "tethys"]),
    tidalDamping: 0,
  }),
  enceladus: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.340000, y: 0.360000, z: 0.380000 }),
    sourceIds: Object.freeze(["saturn", "sun", "mimas", "tethys", "dione"]),
    tidalDamping: 0,
  }),
  tethys: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.390000, y: 0.395000, z: 0.400000 }),
    sourceIds: Object.freeze(["saturn", "sun", "enceladus", "dione", "mimas"]),
    tidalDamping: 0,
  }),
  dione: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.360000, y: 0.365000, z: 0.375000 }),
    sourceIds: Object.freeze(["saturn", "sun", "tethys", "rhea", "enceladus"]),
    tidalDamping: 0,
  }),
  rhea: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.355000, y: 0.360000, z: 0.370000 }),
    sourceIds: Object.freeze(["saturn", "sun", "dione", "titan"]),
    tidalDamping: 0,
  }),
  titan: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.340000, y: 0.342000, z: 0.346000 }),
    sourceIds: Object.freeze(["saturn", "sun", "rhea", "iapetus", "hyperion"]),
    tidalDamping: 0,
  }),
  hyperion: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.290000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["saturn", "sun", "titan"]),
    tidalDamping: 0,
  }),
  iapetus: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.345000, y: 0.350000, z: 0.360000 }),
    sourceIds: Object.freeze(["saturn", "sun", "titan", "phoebe"]),
    tidalDamping: 0,
  }),
  phoebe: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.310000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["saturn", "sun", "iapetus"]),
    tidalDamping: 0,
  }),
  janus: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.330000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["saturn", "sun", "epimetheus", "mimas"]),
    tidalDamping: 0,
  }),
  epimetheus: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.310000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["saturn", "sun", "janus", "mimas"]),
    tidalDamping: 0,
  }),
  atlas: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.280000, y: 0.430000, z: 0.510000 }),
    sourceIds: Object.freeze(["saturn", "sun", "prometheus", "pan"]),
    tidalDamping: 0,
  }),
  prometheus: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["saturn", "sun", "pandora", "atlas"]),
    tidalDamping: 0,
  }),
  pandora: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["saturn", "sun", "prometheus", "atlas"]),
    tidalDamping: 0,
  }),
  pan: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.280000, y: 0.430000, z: 0.510000 }),
    sourceIds: Object.freeze(["saturn", "sun", "atlas", "prometheus"]),
    tidalDamping: 0,
  }),
  uranus: Object.freeze({
    // Ice-giant oblateness with moderate equatorial bulge.
    inertiaFactors: Object.freeze({ x: 0.225000, y: 0.225000, z: 0.235000 }),
    sourceIds: Object.freeze(["sun", "saturn", "neptune", "titania", "oberon", "ariel"]),
    tidalDamping: 0,
  }),
  puck: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.320000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "miranda", "portia"]),
    tidalDamping: 0,
  }),
  miranda: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.340000, y: 0.380000, z: 0.430000 }),
    sourceIds: Object.freeze(["uranus", "sun", "ariel", "puck"]),
    tidalDamping: 0,
  }),
  ariel: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.340000, y: 0.350000, z: 0.370000 }),
    sourceIds: Object.freeze(["uranus", "sun", "umbriel", "miranda", "titania"]),
    tidalDamping: 0,
  }),
  umbriel: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.340000, y: 0.350000, z: 0.370000 }),
    sourceIds: Object.freeze(["uranus", "sun", "ariel", "titania"]),
    tidalDamping: 0,
  }),
  titania: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.330000, y: 0.335000, z: 0.345000 }),
    sourceIds: Object.freeze(["uranus", "sun", "oberon", "umbriel", "ariel"]),
    tidalDamping: 0,
  }),
  oberon: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.330000, y: 0.335000, z: 0.345000 }),
    sourceIds: Object.freeze(["uranus", "sun", "titania"]),
    tidalDamping: 0,
  }),
  cordelia: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "ophelia", "bianca"]),
    tidalDamping: 0,
  }),
  ophelia: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "cordelia", "bianca"]),
    tidalDamping: 0,
  }),
  bianca: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.310000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "cressida", "ophelia", "cordelia"]),
    tidalDamping: 0,
  }),
  cressida: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.320000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "juliet", "bianca", "portia"]),
    tidalDamping: 0,
  }),
  juliet: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.320000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "portia", "cressida", "rosalind"]),
    tidalDamping: 0,
  }),
  portia: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.320000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "rosalind", "juliet", "belinda"]),
    tidalDamping: 0,
  }),
  rosalind: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.320000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "portia", "belinda", "puck"]),
    tidalDamping: 0,
  }),
  belinda: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.320000, y: 0.420000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "perdita", "cupid", "rosalind", "puck"]),
    tidalDamping: 0,
  }),
  perdita: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "belinda", "puck"]),
    tidalDamping: 0,
  }),
  cupid: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "belinda", "portia"]),
    tidalDamping: 0,
  }),
  mab: Object.freeze({
    inertiaFactors: Object.freeze({ x: 0.300000, y: 0.430000, z: 0.500000 }),
    sourceIds: Object.freeze(["uranus", "sun", "puck", "belinda"]),
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
