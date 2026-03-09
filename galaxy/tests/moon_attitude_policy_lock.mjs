import {
  computeMoonAimTelemetry,
  resolveMoonMissionAttitudeDirection,
} from "../app/static/js/physics/launch/lunar/moonAttitudePolicy.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const coastPolicy = resolveMoonMissionAttitudeDirection({
    missionId: "moon_orbit_return",
    missionPhase: "coast_to_moon",
    requestedThrottle: 0,
    desiredDirection: { x: 0, y: 1, z: 0 },
    toMoonVectorKm: { x: 1, y: 0, z: 0 },
    fallbackDirection: { x: 0, y: 1, z: 0 },
    currentDirection: { x: 0, y: 1, z: 0 },
    dtSeconds: 1,
  });
  assert(coastPolicy.passiveMoonCoastPointing, "expected passive coast moon pointing to activate");
  assert(coastPolicy.passiveMoonCoastAttitudeAssist?.active, "expected passive coast attitude assist to activate");
  assert(
    coastPolicy.requestedDirection.x > 0 && coastPolicy.requestedDirection.x < 1,
    `expected gradual coast turn toward moon on x axis, got ${coastPolicy.requestedDirection.x}`,
  );
  assert(
    coastPolicy.requestedDirection.y > 0 && coastPolicy.requestedDirection.y < 1,
    `expected gradual coast turn toward moon on y axis, got ${coastPolicy.requestedDirection.y}`,
  );
  assert(
    Number(coastPolicy.passiveMoonCoastAttitudeAssist.errorDeg) > 0,
    `expected positive coast attitude error, got ${coastPolicy.passiveMoonCoastAttitudeAssist.errorDeg}`,
  );
  assert(
    Array.isArray(coastPolicy.passiveMoonCoastAttitudeAssist.jets)
      && coastPolicy.passiveMoonCoastAttitudeAssist.jets.length > 0,
    "expected passive coast attitude assist jets",
  );

  const burnPolicy = resolveMoonMissionAttitudeDirection({
    missionId: "moon_orbit_return",
    missionPhase: "coast_to_moon",
    requestedThrottle: 0.4,
    desiredDirection: { x: 0, y: 1, z: 0 },
    toMoonVectorKm: { x: 1, y: 0, z: 0 },
    fallbackDirection: { x: 0, y: 1, z: 0 },
    currentDirection: { x: 0, y: 1, z: 0 },
    dtSeconds: 1,
  });
  assert(!burnPolicy.passiveMoonCoastPointing, "expected powered correction to keep burn vector");
  assert(Math.abs(burnPolicy.requestedDirection.y - 1) < 1e-6, `expected burn direction y=1, got ${burnPolicy.requestedDirection.y}`);

  const telemetryToward = computeMoonAimTelemetry({
    requestedDirectionKm: { x: 1, y: 0, z: 0 },
    bodyAxisDirectionKm: { x: 1, y: 0, z: 0 },
    moonRelativePositionKm: { x: 10, y: 0, z: 0 },
  });
  assert(telemetryToward.guidanceMoonState === "toward", `expected command moonward, got ${telemetryToward.guidanceMoonState}`);
  assert(telemetryToward.bodyMoonState === "toward", `expected nose moonward, got ${telemetryToward.bodyMoonState}`);
  assert(Number(telemetryToward.guidanceMoonAngleDeg) < 1, `expected near-zero command off-moon angle, got ${telemetryToward.guidanceMoonAngleDeg}`);

  const telemetryAway = computeMoonAimTelemetry({
    requestedDirectionKm: { x: -1, y: 0, z: 0 },
    bodyAxisDirectionKm: { x: -1, y: 0, z: 0 },
    moonRelativePositionKm: { x: 10, y: 0, z: 0 },
  });
  assert(telemetryAway.guidanceMoonState === "away", `expected command away, got ${telemetryAway.guidanceMoonState}`);
  assert(telemetryAway.bodyMoonState === "away", `expected nose away, got ${telemetryAway.bodyMoonState}`);
  assert(Number(telemetryAway.bodyMoonAngleDeg) > 179, `expected near-180 nose off-moon angle, got ${telemetryAway.bodyMoonAngleDeg}`);

  console.log("PASS moon-attitude-policy-lock");
}

main();
