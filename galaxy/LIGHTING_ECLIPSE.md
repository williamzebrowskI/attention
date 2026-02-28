# Lighting, Eclipse, And Earthshine Model

This document describes how sunlight and eclipses are computed.

## Where It Runs

- CPU lighting model: `app/static/js/app.js`
  - `computeIlluminationForBody(...)`
  - `computeSolarTransmittance(...)`
  - `computeEarthshineScaleForMoon(...)`
- Shader eclipse attenuation:
  - `attachBodyEclipseShader(...)`
  - `updateBodyEclipseUniforms(...)`

## Direct Solar Flux

Distance scaling:

- `fluxScale = (AU / distanceToSun)^2`

Per-body direct term:

- `directSolar = fluxScale * transmittance`

## Occlusion / Eclipse Transmittance

Transmittance is computed from apparent disk overlap between Sun and occluders:

1. Compute Sun angular radius at target.
2. For each valid occluder between target and Sun:
   - compute angular radius
   - compute angular separation
   - compute visible Sun fraction from disk-overlap area
3. Use minimum transmittance across occluders.

Disk overlap uses the exact circle-circle overlap equation.

## Shader-Level Surface Attenuation

For bodies with eclipse shader attached:

1. World position of fragment is evaluated.
2. Same Sun/occluder angular geometry is solved per fragment.
3. Result attenuates direct diffuse and specular terms:
   - `reflectedLight.directDiffuse *= transmittance`
   - `reflectedLight.directSpecular *= transmittance`
4. Penumbra gamma and minimum transmittance are configurable.

## Earthshine (Moon)

Moon gets an additional reflected-light term from Earth:

1. Earth phase seen from Moon
2. Earth-Sun flux at Earth
3. Geometric dilution `(R_earth^2 / d_earth-moon^2)`
4. Bond albedo and Lambert factor

Model term:

- `earthshine = lambert * albedo * solarAtEarth * geometricScale * phase`

## Visual Policy

1. Sun is excluded from this model.
2. Dark side is intentionally not fully black due to ambient/base material terms.
3. Earth emissive treatment is adjusted for night visibility while retaining
   physically driven day/night boundary.
