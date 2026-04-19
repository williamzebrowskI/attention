const VISIBLE_SCATTERING_TOP_KM = 100;
const PHYSICAL_ATMOSPHERE_TOP_KM = 1000;
const RAYLEIGH_SCALE_HEIGHT_KM = 8;
const MIE_SCALE_HEIGHT_KM = 1.2;
const OZONE_PEAK_ALTITUDE_KM = 25;
const OZONE_HALF_WIDTH_KM = 15;
const ATMOSPHERE_BOUNDARY_SHELLS = Object.freeze([
  Object.freeze({ altitudeKm: 11, colorHex: 0x9be7ff, opacity: 0.06 }),
  Object.freeze({ altitudeKm: 47, colorHex: 0x96f5d2, opacity: 0.045 }),
  Object.freeze({ altitudeKm: 86, colorHex: 0x86a8ff, opacity: 0.038 }),
  Object.freeze({ altitudeKm: 120, colorHex: 0xb9a0ff, opacity: 0.032 }),
  Object.freeze({ altitudeKm: 700, colorHex: 0xffbfdc, opacity: 0.018 }),
  Object.freeze({ altitudeKm: PHYSICAL_ATMOSPHERE_TOP_KM, colorHex: 0xf1f7ff, opacity: 0.014 }),
]);

const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
  varying vec3 vWorldPosition;

  uniform vec3 uPlanetCenter;
  uniform vec3 uSunDirection;
  uniform float uPlanetRadius;
  uniform float uAtmosphereRadius;
  uniform float uSceneToKm;
  uniform float uRayleighScaleHeightKm;
  uniform float uMieScaleHeightKm;
  uniform float uOzonePeakKm;
  uniform float uOzoneHalfWidthKm;
  uniform vec3 uBetaRayleigh;
  uniform vec3 uBetaMie;
  uniform vec3 uBetaOzone;
  uniform float uMieG;
  uniform float uSunIntensity;
  uniform float uExposure;
  uniform float uAlphaScale;

  const float PI = 3.141592653589793;
  const int PRIMARY_STEPS = 12;
  const int LIGHT_STEPS = 6;

  float rayleighPhase(float mu) {
    return (3.0 / (16.0 * PI)) * (1.0 + (mu * mu));
  }

  float henyeyGreensteinPhase(float mu, float g) {
    float g2 = g * g;
    float denom = max(1.0 + g2 - (2.0 * g * mu), 1e-3);
    return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + (mu * mu))) / ((2.0 + g2) * pow(denom, 1.5));
  }

  vec2 raySphereIntersect(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - (radius * radius);
    float h = (b * b) - c;
    if (h < 0.0) {
      return vec2(1e20, -1e20);
    }
    float s = sqrt(h);
    return vec2(-b - s, -b + s);
  }

  float ozoneDensity(float heightKm) {
    float halfWidth = max(uOzoneHalfWidthKm, 0.001);
    float x = abs(heightKm - uOzonePeakKm) / halfWidth;
    return max(0.0, 1.0 - x);
  }

  vec3 integrateOpticalDepthToSun(vec3 samplePos, vec3 sunDir) {
    vec2 atmHit = raySphereIntersect(samplePos, sunDir, uAtmosphereRadius);
    float tMax = atmHit.y;
    if (tMax <= 0.0) {
      return vec3(0.0);
    }

    vec2 groundHit = raySphereIntersect(samplePos, sunDir, uPlanetRadius);
    if (groundHit.x > 0.0 && groundHit.x < tMax) {
      return vec3(1e6);
    }

    float stepLen = tMax / float(LIGHT_STEPS);
    float stepKm = stepLen * uSceneToKm;
    float t = stepLen * 0.5;
    vec3 opticalDepth = vec3(0.0);

    for (int i = 0; i < LIGHT_STEPS; i += 1) {
      vec3 p = samplePos + (sunDir * t);
      float heightKm = max(0.0, (length(p) - uPlanetRadius) * uSceneToKm);
      float densityR = exp(-heightKm / max(uRayleighScaleHeightKm, 0.001));
      float densityM = exp(-heightKm / max(uMieScaleHeightKm, 0.001));
      float densityO = ozoneDensity(heightKm);
      opticalDepth += vec3(densityR, densityM, densityO) * stepKm;
      t += stepLen;
    }

    return opticalDepth;
  }

  void main() {
    vec3 ro = cameraPosition - uPlanetCenter;
    vec3 rd = normalize(vWorldPosition - cameraPosition);
    vec3 sunDir = normalize(uSunDirection);
    float fragDistance = length(vWorldPosition - cameraPosition);

    vec2 atmHit = raySphereIntersect(ro, rd, uAtmosphereRadius);
    float tStart = max(atmHit.x, 0.0);
    float tEnd = min(atmHit.y, fragDistance);
    if (tEnd <= tStart) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec2 groundHit = raySphereIntersect(ro, rd, uPlanetRadius);
    if (groundHit.x > 0.0) {
      tEnd = min(tEnd, groundHit.x);
    }
    if (tEnd <= tStart) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float mu = clamp(dot(-rd, sunDir), -1.0, 1.0);
    float phaseR = rayleighPhase(mu);
    float phaseM = henyeyGreensteinPhase(mu, uMieG);

    float stepLen = (tEnd - tStart) / float(PRIMARY_STEPS);
    float stepKm = stepLen * uSceneToKm;
    float t = tStart + (stepLen * 0.5);
    vec3 opticalDepth = vec3(0.0);
    vec3 inScatter = vec3(0.0);

    for (int i = 0; i < PRIMARY_STEPS; i += 1) {
      vec3 samplePos = ro + (rd * t);
      float heightKm = max(0.0, (length(samplePos) - uPlanetRadius) * uSceneToKm);
      float densityR = exp(-heightKm / max(uRayleighScaleHeightKm, 0.001));
      float densityM = exp(-heightKm / max(uMieScaleHeightKm, 0.001));
      float densityO = ozoneDensity(heightKm);

      opticalDepth += vec3(densityR, densityM, densityO) * stepKm;

      vec3 lightDepth = integrateOpticalDepthToSun(samplePos, sunDir);
      vec3 tau =
        (uBetaRayleigh * (opticalDepth.x + lightDepth.x))
        + (uBetaMie * (opticalDepth.y + lightDepth.y))
        + (uBetaOzone * (opticalDepth.z + lightDepth.z));
      vec3 transmittance = exp(-tau);

      vec3 scatterCoefficients = (densityR * uBetaRayleigh * phaseR) + (densityM * uBetaMie * phaseM);
      inScatter += scatterCoefficients * transmittance * stepKm;
      t += stepLen;
    }

    vec3 color = vec3(1.0) - exp(-(inScatter * uSunIntensity) * uExposure);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float alpha = clamp(1.0 - exp(-luminance * uAlphaScale), 0.0, 0.62);
    if (!gl_FrontFacing) {
      alpha *= 0.72;
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

function disposeObject3DResources(root) {
  if (!root) {
    return;
  }
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material?.dispose?.());
    } else if (node.material) {
      node.material.dispose();
    }
  });
}

function createEarthAtmosphereMesh(THREE, radius, distanceScale) {
  const scale = Number.isFinite(distanceScale) && distanceScale > 0 ? distanceScale : 1 / 700000;
  const sceneToKm = 1 / scale;
  const atmosphereRadius = radius + (VISIBLE_SCATTERING_TOP_KM * scale);
  const geometry = new THREE.SphereGeometry(atmosphereRadius, 88, 88);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPlanetCenter: { value: new THREE.Vector3() },
      uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
      uPlanetRadius: { value: radius },
      uAtmosphereRadius: { value: atmosphereRadius },
      uSceneToKm: { value: sceneToKm },
      uRayleighScaleHeightKm: { value: RAYLEIGH_SCALE_HEIGHT_KM },
      uMieScaleHeightKm: { value: MIE_SCALE_HEIGHT_KM },
      uOzonePeakKm: { value: OZONE_PEAK_ALTITUDE_KM },
      uOzoneHalfWidthKm: { value: OZONE_HALF_WIDTH_KM },
      // Physical scattering/absorption coefficients in 1/km.
      uBetaRayleigh: { value: new THREE.Vector3(0.005802, 0.013558, 0.033100) },
      uBetaMie: { value: new THREE.Vector3(0.003996, 0.003996, 0.003996) },
      uBetaOzone: { value: new THREE.Vector3(0.000650, 0.001881, 0.000085) },
      uMieG: { value: 0.8 },
      uSunIntensity: { value: 20.0 },
      uExposure: { value: 1.15 },
      uAlphaScale: { value: 2.35 },
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 42;
  return mesh;
}

function createAtmosphereBoundaryMesh(THREE, radius, distanceScale, {
  altitudeKm = 0,
  colorHex = 0xffffff,
  opacity = 0.02,
} = {}) {
  const scale = Number.isFinite(distanceScale) && distanceScale > 0 ? distanceScale : 1 / 700000;
  const shellRadius = radius + (Math.max(0, Number(altitudeKm) || 0) * scale);
  const geometry = new THREE.SphereGeometry(shellRadius, 72, 72);
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: Math.max(0, Number(opacity) || 0),
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 43;
  mesh.userData.atmosphereAltitudeKm = Math.max(0, Number(altitudeKm) || 0);
  return mesh;
}

function createEarthAtmosphereVisualRoot(THREE, radius, distanceScale) {
  const root = new THREE.Group();
  const scatteringMesh = createEarthAtmosphereMesh(THREE, radius, distanceScale);
  root.add(scatteringMesh);
  const boundaryMeshes = ATMOSPHERE_BOUNDARY_SHELLS.map((shell, index) => {
    const mesh = createAtmosphereBoundaryMesh(THREE, radius, distanceScale, shell);
    mesh.renderOrder = 43 + index;
    root.add(mesh);
    return mesh;
  });
  root.userData.scatteringMesh = scatteringMesh;
  root.userData.boundaryMeshes = boundaryMeshes;
  return root;
}

export function createEarthAtmosphereController(options) {
  const {
    THREE,
    getBodyVisual,
    getCoordinatesKm,
    earthBodyId = "earth",
    sunBodyId = "sun",
    distanceScale = 1,
  } = options || {};

  let enabled = true;
  let mesh = null;

  function clear() {
    if (!mesh) {
      return;
    }
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    disposeObject3DResources(mesh);
    mesh = null;
  }

  function ensureMesh() {
    if (!THREE) {
      return null;
    }
    const earthVisual = getBodyVisual?.(earthBodyId);
    if (!earthVisual?.tiltGroup || !(earthVisual.renderRadius > 0)) {
      return null;
    }
    if (mesh && mesh.parent === earthVisual.tiltGroup) {
      return mesh;
    }
    clear();
    mesh = createEarthAtmosphereVisualRoot(THREE, earthVisual.renderRadius, distanceScale);
    earthVisual.tiltGroup.add(mesh);
    earthVisual.atmosphereMesh = mesh;
    mesh.visible = enabled;
    return mesh;
  }

  function rebuild() {
    clear();
    ensureMesh();
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (mesh) {
      mesh.visible = enabled;
    }
  }

  function update() {
    const earthVisual = getBodyVisual?.(earthBodyId);
    if (!earthVisual || !earthVisual.root?.visible) {
      if (mesh) {
        mesh.visible = false;
      }
      return;
    }

    const atmosphereMesh = ensureMesh();
    if (!atmosphereMesh) {
      return;
    }
    const scale = Number.isFinite(distanceScale) && distanceScale > 0 ? distanceScale : 1 / 700000;
    const scatteringMesh = atmosphereMesh.userData?.scatteringMesh || atmosphereMesh;
    const uniforms = scatteringMesh.material?.uniforms;
    if (!uniforms) {
      return;
    }

    const earthCoords = getCoordinatesKm?.(earthBodyId);
    const sunCoords = getCoordinatesKm?.(sunBodyId);
    if (!earthCoords || !sunCoords) {
      atmosphereMesh.visible = false;
      return;
    }

    const sunVisual = getBodyVisual?.(sunBodyId);
    const sunDirectionWorld = new THREE.Vector3();
    if (sunVisual?.root) {
      sunDirectionWorld.subVectors(sunVisual.root.position, earthVisual.root.position);
    } else {
      sunDirectionWorld.set(
        (sunCoords.x - earthCoords.x) * scale,
        (sunCoords.z - earthCoords.z) * scale,
        (sunCoords.y - earthCoords.y) * scale,
      );
    }

    if (!(sunDirectionWorld.lengthSq() > 1e-16)) {
      atmosphereMesh.visible = false;
      return;
    }
    sunDirectionWorld.normalize();

    uniforms.uPlanetCenter.value.copy(earthVisual.root.position);
    uniforms.uSunDirection.value.copy(sunDirectionWorld);
    uniforms.uPlanetRadius.value = earthVisual.renderRadius;
    uniforms.uSceneToKm.value = 1 / scale;
    uniforms.uAtmosphereRadius.value = earthVisual.renderRadius + (VISIBLE_SCATTERING_TOP_KM * scale);

    atmosphereMesh.visible = enabled;
  }

  return {
    rebuild,
    clear,
    update,
    setEnabled,
    isEnabled() {
      return enabled;
    },
  };
}
