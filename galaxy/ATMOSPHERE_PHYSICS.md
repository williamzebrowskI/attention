# Atmosphere Physics

This project separates atmosphere logic into two modules:

1. Visual atmosphere physics
- File: `app/static/js/physics/atmosphere/visualAtmosphere.js`
- Model: physically based single-scattering approximation using:
  - Rayleigh phase
  - Mie (Henyey-Greenstein) phase
  - Ozone absorption tint
- Runtime inputs:
  - Earth center in world space
  - Sun direction in world space
  - Planet radius + atmosphere shell radius
- UI toggle: `Atmosphere Physics` in the physics panel.

2. Atmosphere dynamics
- File: `app/static/js/physics/atmosphere/atmosphereDynamics.js`
- Model:
  - Gravity with altitude:
    - `g(h) = mu / (R + h)^2`
  - Density/pressure:
    - US Standard Atmosphere 1976 layers (0-86 km)
    - Piecewise exponential extension (86-1000 km)
  - Drag acceleration:
    - `a_drag = -0.5 * rho * Cd * (A/m) * v_rel^2 * v_hat`
  - Relative velocity includes atmosphere co-rotation:
    - `v_rel = v_body - v_earth - (omega_earth x r_rel)`

Integration points:

1. Visual update path
- `updatePhysicsOverlays()` calls Earth atmosphere controller `update()`.

2. N-body dynamics path
- `integrateNBodyStep(...)` uses
  - gravitational acceleration
  - plus atmosphere dynamics acceleration from `AtmosphereDynamicsController`.

Notes:

1. Point-mass gravity already obeys inverse-square behavior with altitude, so atmospheric gravity variation is naturally represented.
2. Atmospheric drag only applies where altitude over Earth is within modeled atmosphere range.
