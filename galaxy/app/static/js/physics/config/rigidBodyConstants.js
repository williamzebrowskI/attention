// Physical rigid-body constants used by torque-driven attitude dynamics.
// Units:
// - principalMomentsKgKm2: kg*km^2
// - deltaTSeconds: s
export const RIGID_BODY_PHYSICAL_CONSTANTS = Object.freeze({
  earth: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      // IERS-style Earth principal moments converted from kg*m^2 to kg*km^2.
      A: 8.010103e31,
      B: 8.010274e31,
      C: 8.036504e31,
    }),
    dynamicTorqueSources: Object.freeze({
      enabled: true,
      includeParent: true,
      includeSun: true,
      topN: 6,
      minTorqueProxy: 1e-26,
    }),
    tidal: Object.freeze({
      model: "constant_time_lag",
      k2: 0.299,
      deltaTSeconds: 638,
      sourceIds: Object.freeze(["moon"]),
    }),
  }),
  moon: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      // Lunar triaxial moments from normalized LP-style values.
      A: 8.710911e28,
      B: 8.714231e28,
      C: 8.718740e28,
    }),
    dynamicTorqueSources: Object.freeze({
      enabled: true,
      includeParent: true,
      includeSun: true,
      topN: 6,
      minTorqueProxy: 1e-26,
    }),
    tidal: Object.freeze({
      model: "constant_time_lag",
      k2: 0.024,
      deltaTSeconds: 45,
      sourceIds: Object.freeze(["earth"]),
    }),
  }),
});

