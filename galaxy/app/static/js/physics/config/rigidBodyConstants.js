// Physical rigid-body constants used by torque-driven attitude dynamics.
// Units:
// - principalMomentsKgKm2: kg*km^2
// - deltaTSeconds: s
export const RIGID_BODY_PHYSICAL_CONSTANTS = Object.freeze({
  sun: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.749418e+40,
      B: 6.749418e+40,
      C: 6.759060e+40,
    }),
  }),
  mercury: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.739469e+29,
      B: 6.741433e+29,
      C: 6.798414e+29,
    }),
  }),
  venus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.005872e+31,
      B: 6.006764e+31,
      C: 6.011221e+31,
    }),
  }),
  earth: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 7.990528e+31,
      B: 7.990722e+31,
      C: 8.016830e+31,
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
      A: 8.711984e+28,
      B: 8.714200e+28,
      C: 8.717524e+28,
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
  mars: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.697569e+30,
      B: 2.698674e+30,
      C: 2.699780e+30,
    }),
  }),
  phobos: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.302660e+17,
      B: 5.615107e+17,
      C: 6.467521e+17,
    }),
  }),
  deimos: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.929334e+16,
      B: 2.553531e+16,
      C: 2.757813e+16,
    }),
  }),
  jupiter: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.356496e+36,
      B: 2.356496e+36,
      C: 2.467827e+36,
    }),
  }),
  io: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.114391e+29,
      B: 1.117355e+29,
      C: 1.120319e+29,
    }),
  }),
  europa: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.022315e+28,
      B: 4.034008e+28,
      C: 4.045701e+28,
    }),
  }),
  ganymede: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 3.197745e+29,
      B: 3.208027e+29,
      C: 3.218309e+29,
    }),
  }),
  callisto: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.212674e+29,
      B: 2.218924e+29,
      C: 2.225175e+29,
    }),
  }),
  amalthea: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.147652e+21,
      B: 6.105460e+21,
      C: 7.149624e+21,
    }),
  }),
  thebe: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 3.135332e+20,
      B: 4.493976e+20,
      C: 4.912020e+20,
    }),
  }),
  adrastea: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.168880e+16,
      B: 5.782640e+16,
      C: 6.589520e+16,
    }),
  }),
  metis: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.325733e+19,
      B: 1.856026e+19,
      C: 2.209555e+19,
    }),
  }),
  himalia: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 7.571150e+21,
      B: 7.980402e+21,
      C: 8.389653e+21,
    }),
  }),
  elara: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.469342e+20,
      B: 6.756246e+20,
      C: 7.560561e+20,
    }),
  }),
  pasiphae: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 7.991289e+19,
      B: 1.073829e+20,
      C: 1.248639e+20,
    }),
  }),
  sinope: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 8.122500e+18,
      B: 1.191300e+19,
      C: 1.353750e+19,
    }),
  }),
  carme: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.131870e+19,
      B: 2.957110e+19,
      C: 3.438500e+19,
    }),
  }),
  ananke: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.234400e+18,
      B: 3.202640e+18,
      C: 3.724000e+18,
    }),
  }),
  saturn: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.143526e+35,
      B: 4.143526e+35,
      C: 4.432609e+35,
    }),
  }),
  mimas: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.301823e+23,
      B: 5.817278e+23,
      C: 6.553643e+23,
    }),
  }),
  enceladus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.333718e+24,
      B: 2.470995e+24,
      C: 2.608273e+24,
    }),
  }),
  tethys: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.791784e+25,
      B: 6.878858e+25,
      C: 6.965932e+25,
    }),
  }),
  dione: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.242400e+26,
      B: 1.259656e+26,
      C: 1.294167e+26,
    }),
  }),
  rhea: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.776845e+26,
      B: 4.844124e+26,
      C: 4.978683e+26,
    }),
  }),
  titan: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 3.031929e+29,
      B: 3.049764e+29,
      C: 3.085434e+29,
    }),
  }),
  hyperion: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.959740e+22,
      B: 4.388580e+22,
      C: 5.103000e+22,
    }),
  }),
  iapetus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 3.360657e+26,
      B: 3.409363e+26,
      C: 3.506773e+26,
    }),
  }),
  phoebe: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.915548e+22,
      B: 3.950097e+22,
      C: 4.702497e+22,
    }),
  }),
  janus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.014497e+21,
      B: 6.382087e+21,
      C: 7.597722e+21,
    }),
  }),
  epimetheus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.508455e+20,
      B: 7.640761e+20,
      C: 8.884606e+20,
    }),
  }),
  atlas: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.213625e+17,
      B: 6.470924e+17,
      C: 7.674817e+17,
    }),
  }),
  prometheus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 8.888664e+19,
      B: 1.274042e+20,
      C: 1.481444e+20,
    }),
  }),
  pandora: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.813143e+19,
      B: 9.765505e+19,
      C: 1.135524e+20,
    }),
  }),
  pan: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.755507e+17,
      B: 4.231671e+17,
      C: 5.018958e+17,
    }),
  }),
  uranus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.256375e+34,
      B: 1.256375e+34,
      C: 1.312214e+34,
    }),
  }),
  puck: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.088608e+21,
      B: 7.991298e+21,
      C: 9.513450e+21,
    }),
  }),
  miranda: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.245810e+24,
      B: 1.392376e+24,
      C: 1.575584e+24,
    }),
  }),
  ariel: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.425422e+26,
      B: 1.467346e+26,
      C: 1.551194e+26,
    }),
  }),
  umbriel: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.482024e+26,
      B: 1.525613e+26,
      C: 1.612791e+26,
    }),
  }),
  titania: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 7.243748e+26,
      B: 7.353501e+26,
      C: 7.573009e+26,
    }),
  }),
  oberon: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.766110e+26,
      B: 5.853475e+26,
      C: 6.028206e+26,
    }),
  }),
  cordelia: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.454135e+18,
      B: 7.817594e+18,
      C: 9.090225e+18,
    }),
  }),
  ophelia: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 7.418952e+18,
      B: 1.063383e+19,
      C: 1.236492e+19,
    }),
  }),
  bianca: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.027044e+19,
      B: 2.811706e+19,
      C: 3.269426e+19,
    }),
  }),
  cressida: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.267232e+20,
      B: 1.663242e+20,
      C: 1.980050e+20,
    }),
  }),
  juliet: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.033728e+20,
      B: 6.606768e+20,
      C: 7.865200e+20,
    }),
  }),
  portia: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.427457e+21,
      B: 3.186037e+21,
      C: 3.792901e+21,
    }),
  }),
  rosalind: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.036800e+20,
      B: 1.360800e+20,
      C: 1.620000e+20,
    }),
  }),
  belinda: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.268000e+20,
      B: 2.976750e+20,
      C: 3.543750e+20,
    }),
  }),
  perdita: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 4.725000e+17,
      B: 6.772500e+17,
      C: 7.875000e+17,
    }),
  }),
  cupid: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 3.159000e+16,
      B: 4.527900e+16,
      C: 5.265000e+16,
    }),
  }),
  mab: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.296000e+17,
      B: 1.857600e+17,
      C: 2.160000e+17,
    }),
  }),
  neptune: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.490092e+34,
      B: 1.490092e+34,
      C: 1.564596e+34,
    }),
  }),
  naiad: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.207300e+19,
      B: 8.897130e+19,
      C: 1.034550e+20,
    }),
  }),
  thalassa: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.765050e+20,
      B: 2.529905e+20,
      C: 2.941750e+20,
    }),
  }),
  despina: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 3.661875e+21,
      B: 5.079375e+21,
      C: 5.906250e+21,
    }),
  }),
  galatea: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.253530e+21,
      B: 6.895258e+21,
      C: 8.208640e+21,
    }),
  }),
  larissa: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.288145e+22,
      B: 1.690690e+22,
      C: 2.012726e+22,
    }),
  }),
  proteus: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.209280e+23,
      B: 7.567560e+23,
      C: 8.925840e+23,
    }),
  }),
  triton: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.332116e+28,
      B: 1.339952e+28,
      C: 1.363460e+28,
    }),
  }),
  nereid: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 2.866880e+23,
      B: 3.852370e+23,
      C: 4.479500e+23,
    }),
  }),
  hippocamp: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.816560e+18,
      B: 2.603736e+18,
      C: 3.027600e+18,
    }),
  }),
  halimede: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.256110e+19,
      B: 8.677830e+19,
      C: 1.009050e+20,
    }),
  }),
  sao: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 1.089000e+19,
      B: 1.560900e+19,
      C: 1.815000e+19,
    }),
  }),
  laomedeia: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 8.731800e+18,
      B: 1.251558e+19,
      C: 1.455300e+19,
    }),
  }),
  psamathe: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 6.600000e+18,
      B: 9.460000e+18,
      C: 1.100000e+19,
    }),
  }),
  neso: Object.freeze({
    principalMomentsKgKm2: Object.freeze({
      A: 5.400000e+19,
      B: 7.740000e+19,
      C: 9.000000e+19,
    }),
  }),
});
