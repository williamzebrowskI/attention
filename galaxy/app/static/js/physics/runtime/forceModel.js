function zeroVector() {
  return { x: 0, y: 0, z: 0 };
}

function finiteVector3(value) {
  return Boolean(
    value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  );
}

function finiteAccelerationKmS2(value) {
  if (!finiteVector3(value)) {
    return zeroVector();
  }
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
}

function dotVector3(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function crossVector3(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalizeVector3OrNull(vector) {
  if (!finiteVector3(vector)) {
    return null;
  }
  const magSq = (vector.x * vector.x) + (vector.y * vector.y) + (vector.z * vector.z);
  if (!(magSq > 1e-18)) {
    return null;
  }
  const invMag = 1 / Math.sqrt(magSq);
  return {
    x: vector.x * invMag,
    y: vector.y * invMag,
    z: vector.z * invMag,
  };
}

export function createPhysicsForceModel(options = {}) {
  const {
    gravitationalConstantKm3PerKgS2 = 0,
    eclipticObliquityDeg = 0,
    getMetaById = () => null,
    getBodyRadiusKm = () => null,
    getBodyMassKg = () => null,
    getRigidBodyPhysicalConstants = () => null,
    getOblateGravityEnabled = () => false,
    getOblateGravityModel = () => null,
    getLunarMasconModelEnabled = () => false,
    getEarthSolidTideEnabled = () => false,
    getEarthSolidTideSourceBodyIds = () => [],
    getSolarRadiationPressureEnabled = () => false,
    getAtmosphereDynamicsController = () => null,
    isLaunchFeatureEnabled = () => false,
    getLaunchController = () => null,
    earthConventionalGravityModel = () => null,
    currentPoleEquatorialDegForBody = () => null,
    equatorialPoleToEclipticVector = () => null,
    primeMeridianModelForBody = () => null,
    modelTimestampMs = (value) => value,
    julianDayFromUnixMs = () => Number.NaN,
    normalizeDegrees = (value) => value,
    rad = (degrees) => (degrees * Math.PI) / 180,
    estimateEarthOrientationParameters = () => null,
    applyEarthOrientationToAxes = () => null,
    computeOblateGravityPerturbationKmS2 = () => zeroVector(),
    computeEarthSolidTidePerturbationKmS2 = () => zeroVector(),
    computeLunarMasconAccelerationKmS2 = () => zeroVector(),
    computeSolarShadowTransmittance = () => 1,
    computeSolarRadiationAccelerationKmS2 = () => zeroVector(),
  } = options;

  function oblateModelForBody(bodyId, timestampMs = Date.now(), earthOrientation = null) {
    if (!getOblateGravityEnabled()) {
      return null;
    }
    const staticModel = getOblateGravityModel()?.[bodyId] || null;
    const earthDynamicModel = bodyId === "earth"
      ? earthConventionalGravityModel(timestampMs, earthOrientation)
      : null;
    const model = earthDynamicModel || staticModel;
    const fallbackRadius = Number(getMetaById(bodyId)?.radius_km);
    const equatorialRadiusKm = Number(model?.equatorialRadiusKm);
    const referenceRadiusKm =
      Number.isFinite(equatorialRadiusKm) && equatorialRadiusKm > 0
        ? equatorialRadiusKm
        : (Number.isFinite(fallbackRadius) && fallbackRadius > 0 ? fallbackRadius : null);
    if (!(referenceRadiusKm > 0)) {
      return null;
    }

    const j2 = Number(model?.j2);
    const j3 = Number(model?.j3);
    const j4 = Number(model?.j4);
    const j5 = Number(model?.j5);
    const j6 = Number(model?.j6);
    const c21 = Number(model?.c21);
    const s21 = Number(model?.s21);
    const c22 = Number(model?.c22);
    const s22 = Number(model?.s22);
    const effectiveC21 = Number.isFinite(c21) ? c21 : 0;
    const effectiveS21 = Number.isFinite(s21) ? s21 : 0;
    let effectiveC22 = Number.isFinite(c22) ? c22 : 0;
    let effectiveS22 = Number.isFinite(s22) ? s22 : 0;

    if (!Number.isFinite(c22) || !Number.isFinite(s22)) {
      const rigidConstants = getRigidBodyPhysicalConstants(bodyId);
      const principalMoments = rigidConstants?.principalMomentsKgKm2;
      const aMoment = Number(principalMoments?.A);
      const bMoment = Number(principalMoments?.B);
      const massKg = Number(getMetaById(bodyId)?.mass_kg);
      const mr2 = massKg * referenceRadiusKm * referenceRadiusKm;
      if (
        Number.isFinite(aMoment)
        && Number.isFinite(bMoment)
        && Number.isFinite(massKg)
        && mr2 > 0
      ) {
        const derivedC22 = (bMoment - aMoment) / (4 * mr2);
        if (!Number.isFinite(c22) && Number.isFinite(derivedC22)) {
          effectiveC22 = derivedC22;
        }
        if (!Number.isFinite(s22)) {
          effectiveS22 = 0;
        }
      }
    }

    const effectiveJ2 = Number.isFinite(j2) ? j2 : 0;
    const effectiveJ3 = Number.isFinite(j3) ? j3 : 0;
    const effectiveJ4 = Number.isFinite(j4) ? j4 : 0;
    const effectiveJ5 = Number.isFinite(j5) ? j5 : 0;
    const effectiveJ6 = Number.isFinite(j6) ? j6 : 0;
    const hasNonZeroHarmonic =
      Math.abs(effectiveJ2) > 1e-20 ||
      Math.abs(effectiveJ3) > 1e-20 ||
      Math.abs(effectiveJ4) > 1e-20 ||
      Math.abs(effectiveJ5) > 1e-20 ||
      Math.abs(effectiveJ6) > 1e-20 ||
      Math.abs(effectiveC21) > 1e-20 ||
      Math.abs(effectiveS21) > 1e-20 ||
      Math.abs(effectiveC22) > 1e-20 ||
      Math.abs(effectiveS22) > 1e-20;
    if (!hasNonZeroHarmonic) {
      return null;
    }

    return {
      source: String(model?.source || ""),
      j2: effectiveJ2,
      j3: effectiveJ3,
      j4: effectiveJ4,
      j5: effectiveJ5,
      j6: effectiveJ6,
      c21: effectiveC21,
      s21: effectiveS21,
      c22: effectiveC22,
      s22: effectiveS22,
      harmonics: Array.isArray(model?.harmonics)
        ? model.harmonics.map((term) => ({ ...term }))
        : null,
      referenceRadiusKm,
    };
  }

  function sourcePoleUnitVectorEclipticForBody(bodyId, timestampMs = Date.now()) {
    const pole = currentPoleEquatorialDegForBody(bodyId, timestampMs);
    if (!pole) {
      return null;
    }
    return equatorialPoleToEclipticVector(
      Number(pole.raDeg),
      Number(pole.decDeg),
      eclipticObliquityDeg,
    );
  }

  function sourceBodyFixedAxesEclipticForBody(bodyId, pole, timestampMs = Date.now()) {
    const poleUnit = normalizeVector3OrNull(pole);
    if (!poleUnit) {
      return null;
    }

    const buildBaseAxis = (reference) => {
      const projection = dotVector3(reference, poleUnit);
      return normalizeVector3OrNull({
        x: reference.x - (projection * poleUnit.x),
        y: reference.y - (projection * poleUnit.y),
        z: reference.z - (projection * poleUnit.z),
      });
    };

    let xBase = buildBaseAxis({ x: 1, y: 0, z: 0 });
    if (!xBase) {
      xBase = buildBaseAxis({ x: 0, y: 1, z: 0 });
    }
    if (!xBase) {
      return null;
    }
    const yBase = normalizeVector3OrNull(crossVector3(poleUnit, xBase));
    if (!yBase) {
      return null;
    }

    const body = getMetaById(bodyId);
    const spinModel = primeMeridianModelForBody(body);
    let spinAngleRad = 0;
    let earthOrientation = null;
    if (spinModel) {
      const daysSinceJ2000 = julianDayFromUnixMs(modelTimestampMs(timestampMs)) - 2_451_545.0;
      spinAngleRad = rad(normalizeDegrees(
        spinModel.w0Deg + (spinModel.wRateDegPerDay * daysSinceJ2000),
      ));
    }
    if (bodyId === "earth") {
      earthOrientation = estimateEarthOrientationParameters(timestampMs);
      spinAngleRad += Number(earthOrientation?.dut1Rad) || 0;
    }

    const c = Math.cos(spinAngleRad);
    const s = Math.sin(spinAngleRad);
    const xAxis = normalizeVector3OrNull({
      x: (xBase.x * c) + (yBase.x * s),
      y: (xBase.y * c) + (yBase.y * s),
      z: (xBase.z * c) + (yBase.z * s),
    });
    const yAxis = normalizeVector3OrNull({
      x: (yBase.x * c) - (xBase.x * s),
      y: (yBase.y * c) - (xBase.y * s),
      z: (yBase.z * c) - (xBase.z * s),
    });
    if (!xAxis || !yAxis) {
      return null;
    }
    if (bodyId === "earth") {
      const adjusted = applyEarthOrientationToAxes({
        xAxis,
        yAxis,
        pole: poleUnit,
        orientation: earthOrientation,
      });
      return {
        xAxis: adjusted?.xAxis || xAxis,
        yAxis: adjusted?.yAxis || yAxis,
        pole: adjusted?.pole || poleUnit,
        earthOrientation: adjusted
          ? {
              source: adjusted.orientationSource,
              dut1Sec: adjusted.dut1Sec,
              xpArcsec: adjusted.xpArcsec,
              ypArcsec: adjusted.ypArcsec,
              precessionLongitudeArcsec: adjusted.precessionLongitudeArcsec,
              precessionObliquityArcsec: adjusted.precessionObliquityArcsec,
              nutationLongitudeArcsec: adjusted.nutationLongitudeArcsec,
              nutationObliquityArcsec: adjusted.nutationObliquityArcsec,
              lodSec: adjusted.lodSec,
            }
          : null,
      };
    }
    return { xAxis, yAxis, pole: poleUnit };
  }

  function buildOblateSourceContextMapFromIds(sourceIds, timestampMs = Date.now()) {
    const contextById = new Map();
    if (!getOblateGravityEnabled() && !getLunarMasconModelEnabled()) {
      return contextById;
    }
    for (const sourceId of sourceIds || []) {
      if (!sourceId || contextById.has(sourceId)) {
        continue;
      }
      const useLunarMasconAxes = getLunarMasconModelEnabled() && sourceId === "moon";
      const pole = sourcePoleUnitVectorEclipticForBody(sourceId, timestampMs);
      if (!pole) {
        continue;
      }
      const fixedAxes = sourceBodyFixedAxesEclipticForBody(sourceId, pole, timestampMs);
      const model = oblateModelForBody(sourceId, timestampMs, fixedAxes?.earthOrientation || null);
      if (!model && !useLunarMasconAxes) {
        continue;
      }
      const fallbackRadiusKm = Number(getMetaById(sourceId)?.radius_km) || 0;
      const effectivePole = fixedAxes?.pole || pole;
      contextById.set(sourceId, {
        j2: Number(model?.j2) || 0,
        j3: Number(model?.j3) || 0,
        j4: Number(model?.j4) || 0,
        j5: Number(model?.j5) || 0,
        j6: Number(model?.j6) || 0,
        c21: Number(model?.c21) || 0,
        s21: Number(model?.s21) || 0,
        c22: Number(model?.c22) || 0,
        s22: Number(model?.s22) || 0,
        harmonics: Array.isArray(model?.harmonics) ? model.harmonics.map((term) => ({ ...term })) : null,
        referenceRadiusKm: Number(model?.referenceRadiusKm) || fallbackRadiusKm || 1737.4,
        gravityModelSource: String(model?.source || ""),
        pole: effectivePole,
        xAxis: fixedAxes?.xAxis || null,
        yAxis: fixedAxes?.yAxis || null,
        earthOrientation: fixedAxes?.earthOrientation || null,
        lunarMasconEnabled: useLunarMasconAxes,
      });
    }
    return contextById;
  }

  function buildOblateSourceContextMapForNBody(state, timestampMs = Date.now()) {
    const sourceIds = [];
    for (const sourceId of state?.dynamicBodies?.keys?.() || []) {
      sourceIds.push(sourceId);
    }
    for (const sourceId of state?.staticSources?.keys?.() || []) {
      sourceIds.push(sourceId);
    }
    return buildOblateSourceContextMapFromIds(sourceIds, timestampMs);
  }

  function computeGravityAccelerationFromSource(
    targetPos,
    sourceId,
    sourceMassKg,
    sourcePos,
    oblateSourceContextById = null,
    sourceEnvironment = null,
  ) {
    if (!(sourceMassKg > 0) || !finiteVector3(targetPos) || !finiteVector3(sourcePos)) {
      return zeroVector();
    }

    const rx = targetPos.x - sourcePos.x;
    const ry = targetPos.y - sourcePos.y;
    const rz = targetPos.z - sourcePos.z;
    const radiusSq = (rx * rx) + (ry * ry) + (rz * rz);
    if (!(radiusSq > 1e-10)) {
      return zeroVector();
    }
    const radius = Math.sqrt(radiusSq);
    const invRadius = 1 / radius;
    const invRadiusCubed = invRadius / radiusSq;
    const muOverR3 = gravitationalConstantKm3PerKgS2 * sourceMassKg * invRadiusCubed;

    let ax = -muOverR3 * rx;
    let ay = -muOverR3 * ry;
    let az = -muOverR3 * rz;

    const oblate = oblateSourceContextById?.get(sourceId);
    if (oblate) {
      const oblatePerturbation = computeOblateGravityPerturbationKmS2({
        relPosKm: { x: rx, y: ry, z: rz },
        radiusKm: radius,
        muOverR3,
        referenceRadiusKm: Number(oblate.referenceRadiusKm) || 0,
        pole: oblate.pole,
        xAxis: oblate.xAxis,
        yAxis: oblate.yAxis,
        j2: Number(oblate.j2) || 0,
        j3: Number(oblate.j3) || 0,
        j4: Number(oblate.j4) || 0,
        j5: Number(oblate.j5) || 0,
        j6: Number(oblate.j6) || 0,
        c21: Number(oblate.c21) || 0,
        s21: Number(oblate.s21) || 0,
        c22: Number(oblate.c22) || 0,
        s22: Number(oblate.s22) || 0,
        harmonicTerms: Array.isArray(oblate.harmonics) ? oblate.harmonics : null,
      });
      ax += Number(oblatePerturbation.x) || 0;
      ay += Number(oblatePerturbation.y) || 0;
      az += Number(oblatePerturbation.z) || 0;
    }

    if (getEarthSolidTideEnabled() && sourceId === "earth") {
      const sourceStateLookup = typeof sourceEnvironment?.getBodyState === "function"
        ? sourceEnvironment.getBodyState
        : null;
      const tideRaisingBodies = [];
      for (const bodyId of getEarthSolidTideSourceBodyIds() || []) {
        const bodyState = sourceStateLookup?.(bodyId);
        const positionKm = finiteVector3(bodyState?.position)
          ? bodyState.position
          : (finiteVector3(bodyState) ? bodyState : null);
        const bodyMassKg = Number(bodyState?.massKg) || getBodyMassKg(bodyId);
        if (!positionKm || !(bodyMassKg > 0)) {
          continue;
        }
        tideRaisingBodies.push({ positionKm, massKg: bodyMassKg });
      }
      if (tideRaisingBodies.length > 0) {
        const earthRadiusKm = Number(oblate?.referenceRadiusKm) || getBodyRadiusKm("earth") || 6378.137;
        const tidePerturbation = computeEarthSolidTidePerturbationKmS2({
          targetPosKm: targetPos,
          earthPosKm: sourcePos,
          earthRadiusKm,
          gravitationalConstantKm3PerKgS2,
          tideRaisingBodies,
        });
        ax += Number(tidePerturbation.x) || 0;
        ay += Number(tidePerturbation.y) || 0;
        az += Number(tidePerturbation.z) || 0;
      }
    }

    if (
      getLunarMasconModelEnabled()
      && sourceId === "moon"
      && oblate?.xAxis
      && oblate?.yAxis
      && oblate?.pole
    ) {
      const masconAcceleration = computeLunarMasconAccelerationKmS2({
        targetPosKm: targetPos,
        moonCenterPosKm: sourcePos,
        moonMassKg: sourceMassKg,
        moonRadiusKm: Number(oblate.referenceRadiusKm) || getBodyRadiusKm("moon") || 1737.4,
        moonAxes: {
          xAxis: oblate.xAxis,
          yAxis: oblate.yAxis,
          pole: oblate.pole,
        },
        gravitationalConstantKm3PerKgS2,
      });
      if (
        Number.isFinite(masconAcceleration.x)
        && Number.isFinite(masconAcceleration.y)
        && Number.isFinite(masconAcceleration.z)
      ) {
        ax += masconAcceleration.x;
        ay += masconAcceleration.y;
        az += masconAcceleration.z;
      }
    }

    return { x: ax, y: ay, z: az };
  }

  function computeNBodyAccelerationForTarget(state, targetId, oblateSourceContextById = null) {
    const target = state?.dynamicBodies?.get(targetId);
    if (!target?.position) {
      return zeroVector();
    }

    let ax = 0;
    let ay = 0;
    let az = 0;
    const targetPos = target.position;

    const sourceEnvironment = {
      getBodyState: (sourceId) => (
        state?.dynamicBodies?.get(sourceId)
        || state?.staticSources?.get(sourceId)
        || null
      ),
    };
    const addSourceAcceleration = (sourceId, sourceMassKg, sourcePos) => {
      const contribution = computeGravityAccelerationFromSource(
        targetPos,
        sourceId,
        sourceMassKg,
        sourcePos,
        oblateSourceContextById,
        sourceEnvironment,
      );
      ax += contribution.x;
      ay += contribution.y;
      az += contribution.z;
    };

    for (const [sourceId, source] of state?.dynamicBodies || []) {
      if (sourceId === targetId) {
        continue;
      }
      addSourceAcceleration(sourceId, source.massKg, source.position);
    }
    for (const [sourceId, source] of state?.staticSources || []) {
      addSourceAcceleration(sourceId, source.massKg, source.position);
    }

    return { x: ax, y: ay, z: az };
  }

  function computeNBodySolarRadiationAccelerationForTarget(state, targetId) {
    if (!getSolarRadiationPressureEnabled()) {
      return zeroVector();
    }
    const targetBody = state?.dynamicBodies?.get(targetId);
    if (!targetBody?.position) {
      return zeroVector();
    }
    const targetMeta = getMetaById(targetId) || null;
    if (String(targetMeta?.body_type || "").trim().toLowerCase() !== "spacecraft") {
      return zeroVector();
    }
    const sunState =
      state?.dynamicBodies?.get("sun")
      || state?.staticSources?.get("sun")
      || null;
    if (!sunState?.position) {
      return zeroVector();
    }
    const sunRadiusKm = getBodyRadiusKm("sun");
    if (!(sunRadiusKm > 0)) {
      return zeroVector();
    }

    const occluders = [];
    for (const [occluderId, occluderState] of state?.dynamicBodies || []) {
      if (!occluderState?.position || occluderId === "sun" || occluderId === targetId) {
        continue;
      }
      const radiusKm = getBodyRadiusKm(occluderId);
      if (!(radiusKm > 0)) {
        continue;
      }
      occluders.push({
        id: occluderId,
        positionKm: occluderState.position,
        radiusKm,
      });
    }
    for (const [occluderId, occluderState] of state?.staticSources || []) {
      if (!occluderState?.position || occluderId === "sun" || occluderId === targetId) {
        continue;
      }
      const radiusKm = getBodyRadiusKm(occluderId);
      if (!(radiusKm > 0)) {
        continue;
      }
      occluders.push({
        id: occluderId,
        positionKm: occluderState.position,
        radiusKm,
      });
    }

    const shadowTransmittance = computeSolarShadowTransmittance({
      targetId,
      targetPosKm: targetBody.position,
      sunPosKm: sunState.position,
      sunRadiusKm,
      occluders,
    });
    return computeSolarRadiationAccelerationKmS2({
      bodyId: targetId,
      bodyMeta: targetMeta,
      bodyMassKg: Number(targetBody.massKg) || Number(targetMeta?.mass_kg) || 0,
      targetPosKm: targetBody.position,
      sunPosKm: sunState.position,
      transmittance: shadowTransmittance,
    });
  }

  function computeNBodyTotalAccelerationForTarget(
    state,
    targetId,
    oblateSourceContextById = null,
    stepNowMs = Date.now(),
  ) {
    const gravity = finiteAccelerationKmS2(
      computeNBodyAccelerationForTarget(state, targetId, oblateSourceContextById),
    );
    const atmospheric = finiteAccelerationKmS2(
      getAtmosphereDynamicsController()?.computeAtmosphericAccelerationKmS2(state, targetId, stepNowMs) || zeroVector(),
    );
    const thrust = isLaunchFeatureEnabled()
      ? finiteAccelerationKmS2(getLaunchController()?.externalAccelerationKmS2(targetId) || zeroVector())
      : zeroVector();
    const solarRadiation = finiteAccelerationKmS2(
      computeNBodySolarRadiationAccelerationForTarget(state, targetId),
    );
    const totalX = gravity.x + atmospheric.x + thrust.x + solarRadiation.x;
    const totalY = gravity.y + atmospheric.y + thrust.y + solarRadiation.y;
    const totalZ = gravity.z + atmospheric.z + thrust.z + solarRadiation.z;
    if (!Number.isFinite(totalX) || !Number.isFinite(totalY) || !Number.isFinite(totalZ)) {
      return zeroVector();
    }
    return { x: totalX, y: totalY, z: totalZ };
  }

  return {
    oblateModelForBody,
    sourcePoleUnitVectorEclipticForBody,
    sourceBodyFixedAxesEclipticForBody,
    buildOblateSourceContextMapFromIds,
    buildOblateSourceContextMapForNBody,
    computeGravityAccelerationFromSource,
    computeNBodyAccelerationForTarget,
    computeNBodySolarRadiationAccelerationForTarget,
    computeNBodyTotalAccelerationForTarget,
  };
}
