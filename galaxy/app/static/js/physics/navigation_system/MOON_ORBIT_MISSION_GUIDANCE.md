# Moon Orbit Mission Guidance (Simple)

This file now includes both:

- A short definition of each label.
- A plain "how it works" note for each label (when it is active and what it commands).

## Core Moon mission labels (telemetry)

| Label | Definition | How it works |
|---|---|---|
| `autopilot-vertical-ascent` | Initial straight-up ascent. | Active right after liftoff; commands near-up direction and high throttle until vertical-hold gate ends. |
| `autopilot-gravity-turn` | Pitch program from vertical to prograde. | Runs during early ascent; gradually rotates thrust vector toward downrange velocity to build horizontal speed. |
| `autopilot-apoapsis-raise` | Raises apoapsis to parking target. | Burns while apoapsis is below target; uses climb/prograde blend and moderate-high throttle. |
| `autopilot-coast-to-apoapsis` | Coast segment before next orbital burn. | Engines off while waiting for better burn geometry near apoapsis. |
| `autopilot-circularization-burn` | Raises periapsis for bounded orbit. | Near apoapsis, burns prograde to lift periapsis and close parking orbit. |
| `autopilot-max-q-limit` | Dynamic-pressure protection mode. | If dynamic pressure exceeds threshold, throttle is clipped until aero loads are back in limit. |
| `autopilot-parking-orbit-hold` | Parking orbit hold. | Once parking conditions are met, throttle goes to zero and guidance holds stable orbit attitude. |
| `autopilot-tli-periapsis-protect` | TLI safety burn to protect periapsis. | During `tli_burn`, if periapsis drops below recovery gate, burn adds up-bias and limited throttle to recover margin. |
| `autopilot-tli-burn` | Main trans-lunar injection burn. | Applies sustained powered prograde/Moon-biased burn until TLI phase-complete gates are satisfied. |
| `autopilot-midcourse-correction` | Moon-transfer correction burn. | In `coast_to_moon`, engages when closing is weak, projected miss is high, or Earth-fallback risk appears; exits after stable recovery + minimum burn time. |
| `autopilot-coast-to-moon` | Coast to lunar approach gate. | Default Moon-transfer coast when no correction burn is needed. |
| `autopilot-lunar-capture` | Lunar capture retrograde burn. | Near Moon gate, burns against Moon-relative velocity to reduce energy and capture into Moon orbit. |
| `autopilot-lunar-orbit-hold` | Lunar orbit station hold. | After capture gates are met, keeps throttle at zero and holds lunar orbit state. |

## Orbital refuel labels (telemetry)

| Label | Definition | How it works |
|---|---|---|
| `navsys:orbital-refuel-await-target` | Waiting for eligible tanker. | No target selected; holds orbit and keeps propulsion off except stabilization. |
| `navsys:orbital-refuel-orbit-recovery` | Recover orbit before chase. | If orbital energy/periapsis is unsafe, prioritizes orbit repair instead of intercept. |
| `navsys:orbital-refuel-speed-brake` | Bleed excess energy. | If speed/apoapsis is too high for safe rendezvous, commands braking-biased burn first. |
| `navsys:orbital-refuel-phase-catchup-lower` | Long-range lower-orbit phase correction. | If tanker is ahead in-track, performs controlled retrograde-biased phasing burn to drop orbit period and catch up in phase. |
| `navsys:orbital-refuel-phase-catchup-raise` | Long-range raise-orbit phase correction. | If tanker is behind in-track, performs prograde-biased phasing burn to increase period and align intercept timing. |
| `navsys:orbital-refuel-phase-catchup` | Long-range phase correction (fallback). | Fallback guidance if detailed frame solution is unavailable; uses conservative phase/intercept blend. |
| `navsys:orbital-refuel-rendezvous-far` | Far-range rendezvous. | Guides along horizontal/intercept direction with controlled throttle toward tanker. |
| `navsys:orbital-refuel-rendezvous-mid` | Mid-range rendezvous. | Adds stronger relative-velocity damping while reducing approach corridor. |
| `navsys:orbital-refuel-brake` | Near-range speed trim. | If near target but approach speed is high, burns to reduce relative velocity before final approach. |
| `navsys:orbital-refuel-final-approach` | Fine docking approach. | Very low-throttle closure with line-of-sight and velocity damping for precision dock corridor. |
| `navsys:orbital-refuel-lock` | Docked lock state. | Relative motion conditions met; guidance holds lock for transfer operation. |

## Navigation planner equivalents (`navsys:*`)

These are planner-side labels that map to the same mission behavior:

- `navsys:tli-periapsis-protect`: Planner equivalent of periapsis-protect TLI burn.
- `navsys:tli-burn`: Planner equivalent of main TLI burn.
- `navsys:moon-midcourse-correction`: Planner equivalent of midcourse correction.
- `navsys:coast-to-moon`: Planner equivalent of coast-to-moon.
- `navsys:lunar-capture-retrograde`: Planner equivalent of lunar capture burn.
- `navsys:lunar-orbit-hold`: Planner equivalent of lunar-orbit hold.
- `navsys:tei-burn`: Burn from lunar orbit toward Earth return.
- `navsys:coast-to-earth`: Coast phase on Earth-return leg.
- `navsys:earth-capture`: Earth-capture burn before Earth orbit hold.

## `autopilot-midcourse-correction` (focused behavior)

- Inputs used: filtered Moon distance, Moon closing speed, projected miss distance, and direction estimate.
- Entry condition: still far from Moon and risk detected (weak closing, high miss, or Earth-fallback trend).
- Commanding: throttle scales with risk/deficit; direction is mostly Moon line-of-sight with small prograde/up bias.
- Exit condition: correction is no longer needed and minimum burn + stable timers are both satisfied.
- Fallback mode after exit: `autopilot-coast-to-moon`.
