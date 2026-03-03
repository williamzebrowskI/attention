export const LUNAR_MASCON_MODEL_ENABLED = true;

// Signed mass anomalies (fraction of total lunar mass) approximating major
// nearside mascons and compensating farside deficits. Net fraction is ~0.
const LUNAR_MASCON_DEFS = Object.freeze([
  Object.freeze({ name: "imbrium", latDeg: 32.8, lonDeg: -15.6, depthKm: 38, massFraction: +8.0e-6 }),
  Object.freeze({ name: "serenitatis", latDeg: 28.0, lonDeg: 17.0, depthKm: 35, massFraction: +6.0e-6 }),
  Object.freeze({ name: "crisium", latDeg: 17.0, lonDeg: 59.0, depthKm: 34, massFraction: +6.0e-6 }),
  Object.freeze({ name: "nectaris", latDeg: -16.5, lonDeg: 34.0, depthKm: 40, massFraction: +5.0e-6 }),
  Object.freeze({ name: "humorum", latDeg: -24.0, lonDeg: -39.0, depthKm: 42, massFraction: +4.0e-6 }),
  Object.freeze({ name: "orientale", latDeg: -19.0, lonDeg: -95.0, depthKm: 48, massFraction: +3.0e-6 }),
  Object.freeze({ name: "procellarum", latDeg: 8.0, lonDeg: -35.0, depthKm: 45, massFraction: +3.0e-6 }),
  Object.freeze({ name: "farside_1", latDeg: 40.0, lonDeg: 90.0, depthKm: 60, massFraction: -6.0e-6 }),
  Object.freeze({ name: "farside_2", latDeg: 5.0, lonDeg: 140.0, depthKm: 55, massFraction: -6.0e-6 }),
  Object.freeze({ name: "farside_3", latDeg: -20.0, lonDeg: 120.0, depthKm: 60, massFraction: -5.0e-6 }),
  Object.freeze({ name: "farside_4", latDeg: -35.0, lonDeg: 70.0, depthKm: 58, massFraction: -5.0e-6 }),
  Object.freeze({ name: "farside_5", latDeg: 25.0, lonDeg: 160.0, depthKm: 62, massFraction: -4.0e-6 }),
  Object.freeze({ name: "farside_6", latDeg: -5.0, lonDeg: -165.0, depthKm: 65, massFraction: -4.0e-6 }),
  Object.freeze({ name: "farside_7", latDeg: 0.0, lonDeg: 100.0, depthKm: 63, massFraction: -5.0e-6 }),
]);

const DEG_TO_RAD = Math.PI / 180;
const MIN_MASCON_DISTANCE_KM = 8;

const LUNAR_MASCONS = Object.freeze(
  LUNAR_MASCON_DEFS.map((entry) => {
    const latRad = Number(entry.latDeg) * DEG_TO_RAD;
    const lonRad = Number(entry.lonDeg) * DEG_TO_RAD;
    const cosLat = Math.cos(latRad);
    return Object.freeze({
      ...entry,
      ux: cosLat * Math.cos(lonRad),
      uy: cosLat * Math.sin(lonRad),
      uz: Math.sin(latRad),
    });
  }),
);

function vectorLengthSq(v) {
  return (v.x * v.x) + (v.y * v.y) + (v.z * v.z);
}

export function computeLunarMasconAccelerationKmS2({
  targetPosKm = null,
  moonCenterPosKm = null,
  moonMassKg = 0,
  moonRadiusKm = 1737.4,
  moonAxes = null,
  gravitationalConstantKm3PerKgS2 = 6.67430e-20,
} = {}) {
  if (!LUNAR_MASCON_MODEL_ENABLED) {
    return { x: 0, y: 0, z: 0 };
  }
  if (
    !targetPosKm
    || !moonCenterPosKm
    || !moonAxes
    || !moonAxes.pole
    || !moonAxes.xAxis
    || !moonAxes.yAxis
  ) {
    return { x: 0, y: 0, z: 0 };
  }
  const bodyMassKg = Number(moonMassKg);
  const bodyRadiusKm = Number(moonRadiusKm);
  const gKm3 = Number(gravitationalConstantKm3PerKgS2);
  if (!(bodyMassKg > 0) || !(bodyRadiusKm > 100) || !(gKm3 > 0)) {
    return { x: 0, y: 0, z: 0 };
  }

  let ax = 0;
  let ay = 0;
  let az = 0;
  for (let i = 0; i < LUNAR_MASCONS.length; i += 1) {
    const mascon = LUNAR_MASCONS[i];
    const massFraction = Number(mascon.massFraction);
    if (!(massFraction !== 0)) {
      continue;
    }
    const masconRadiusKm = Math.max(40, bodyRadiusKm - Math.max(0, Number(mascon.depthKm) || 0));
    const lx = masconRadiusKm * mascon.ux;
    const ly = masconRadiusKm * mascon.uy;
    const lz = masconRadiusKm * mascon.uz;
    const mx = moonCenterPosKm.x + (moonAxes.xAxis.x * lx) + (moonAxes.yAxis.x * ly) + (moonAxes.pole.x * lz);
    const my = moonCenterPosKm.y + (moonAxes.xAxis.y * lx) + (moonAxes.yAxis.y * ly) + (moonAxes.pole.y * lz);
    const mz = moonCenterPosKm.z + (moonAxes.xAxis.z * lx) + (moonAxes.yAxis.z * ly) + (moonAxes.pole.z * lz);

    const rx = targetPosKm.x - mx;
    const ry = targetPosKm.y - my;
    const rz = targetPosKm.z - mz;
    const minDistSq = MIN_MASCON_DISTANCE_KM * MIN_MASCON_DISTANCE_KM;
    const rSq = Math.max(vectorLengthSq({ x: rx, y: ry, z: rz }), minDistSq);
    if (!(rSq > 1e-10)) {
      continue;
    }
    const r = Math.sqrt(rSq);
    const mu = gKm3 * bodyMassKg * massFraction;
    const scale = -mu / (rSq * r);
    ax += scale * rx;
    ay += scale * ry;
    az += scale * rz;
  }
  return { x: ax, y: ay, z: az };
}
