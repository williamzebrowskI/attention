# Launch Physics Model

This simulation now includes a dedicated launch dynamics system under:

- `app/static/js/physics/launch/launchConfig.js`
- `app/static/js/physics/launch/launchController.js`
- `app/static/js/physics/launch/launchVisuals.js`
- `app/static/js/physics/launch/launchTrail.js`

## What Is Modeled

1. Staged vehicle mass model
- Two-stage vehicle with:
  - per-stage dry mass
  - per-stage propellant mass
  - payload mass
- Propellant depletion is integrated every N-body step.
- Dry mass is jettisoned at stage separation.

2. Thrust model
- Stage thrust interpolates from sea-level to vacuum using local pressure:
  - `T = T_vac - (T_vac - T_sl) * (P/P0)`
- Isp is interpolated in the same way.
- Mass flow:
  - `mdot = T / (Isp * g0)`

3. Guidance model
- Initial pitch program from local vertical into downrange heading.
- Gravity-turn progression blends toward prograde direction.
- Throttle profile includes a reduced-throttle max-q window.
- Autopilot orbital insertion (physics-driven):
  - vertical ascent
  - gravity turn
  - main engine cutoff (MECO) when target apoapsis is reached
  - coast to near apoapsis
  - circularization burn to target LEO altitude
  - orbital-hold coast state (no thrust)

4. Earth launch pad initialization
- Launch site is Cape Canaveral, Florida (SLC-40 coordinates).
- Initial inertial velocity includes Earth co-rotation:
  - `v0 = v_earth + (omega_earth x r_site)`

5. Coupling with existing physics
- Total acceleration in integrator:
  - `a_total = a_gravity + a_atmospheric_drag + a_thrust`
- Gravity is from existing full N-body + J2/J4/C22/S22 model.
- Atmospheric drag is from existing US1976 atmosphere module.
- Orbit decay is emergent from atmospheric drag + gravity once in low Earth orbit.

6. Vehicle visual model
- Starship + Super Heavy parametric geometry with real dimensions:
  - diameter 9 m
  - booster height 71 m
  - ship height 50.3 m
  - total stack height 121.3 m
- Rendered with those exact proportions and real size mapping to scene km scale.
- HD local PBR-style texture maps are generated and applied for:
  - stainless body skin
  - thermal tile band
  - engine metal/heat tones
- Stage-separation visual state is coupled to propulsion stage index.

7. Trail and plume visualization
- Dedicated launch trail controller:
  - smoke-point trail with bounded age (short-lived)
  - ascent path line
  - throttle-linked engine plume
- Trail visuals are driven from live launch telemetry/state each frame.

## Notes

- The launch body is a synthetic `spacecraft` body (`earth_launch_vehicle`) added to the catalog and startup state.
- The launch system is deterministic from the startup-seeded ephemeris and then fully machine-simulated in your local runtime.
- The model is physically grounded, but still a first-pass flight dynamics model (no full 6-DOF aeroelastic control law yet).
