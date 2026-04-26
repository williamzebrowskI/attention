import fs from "node:fs";

const controllerSource = fs.readFileSync(
  new URL("../app/static/js/physics/launch/launchController.js", import.meta.url),
  "utf8",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert(start >= 0, `missing function ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert(signatureEnd >= 0, `missing function body delimiter for ${name}`);
  const open = source.indexOf("{", signatureEnd);
  assert(open >= 0, `missing body for function ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function assertOnlyConstrainedBoosterPositionWrites(source) {
  const assignmentPattern = /boosterState\.position\s*=/g;
  const allowedConstraintContexts = [
    "function placeBoosterOnCrashSurface",
    "function ensureAttachedBoosterInNBody",
    "function updateAttachedStackJointState",
    "function stabilizeAttachedStackConstraint",
    "caughtSupportLocked",
  ];
  const failures = [];
  let match = assignmentPattern.exec(source);
  while (match) {
    const before = source.slice(Math.max(0, match.index - 6000), match.index);
    const after = source.slice(match.index, Math.min(source.length, match.index + 700));
    const context = `${before}${after}`;
    const allowed = allowedConstraintContexts.some((token) => context.includes(token));
    if (!allowed) {
      failures.push(lineNumberAt(source, match.index));
    }
    match = assignmentPattern.exec(source);
  }
  assert(
    failures.length === 0,
    `booster_no_kinematic_positioning_lock: unconstrained direct booster position writes at lines ${failures.join(", ")}`,
  );
}

function main() {
  const bannedKinematicTokens = [
    "BOOSTER_KINEMATIC_CATCH_ASSIST_ENABLED",
    "computeBoosterCatchConstraintStep",
    "corridorCorrectionAccelerationKmS2",
    "corridorGuidanceActive",
    "maxCorrectionAccelKmS2",
    "contactProgress:",
    "captureProgress:",
    "initialFlipRateRadS",
    "BOOSTER_FULL_6DOF_RECOVERY_ENABLED",
    "stabilizeBoosterAttitudeTowardDirection",
  ];

  for (const token of bannedKinematicTokens) {
    assert(
      !controllerSource.includes(token),
      `booster_no_kinematic_positioning_lock: unexpected kinematic positioning token ${token}`,
    );
  }

  assert(
    controllerSource.includes("runtime.booster.attitude = integrateBoosterAttitudeState(runtime.booster.attitude"),
    "booster_no_kinematic_positioning_lock: booster recovery must integrate 6-DOF attitude directly",
  );

  const postSeparationContact = extractFunction(controllerSource, "applyBoosterShipSeparationContact");
  assert(
    !/boosterState\.position\s*=/.test(postSeparationContact),
    "booster_no_kinematic_positioning_lock: post-separation contact must not directly reposition the booster",
  );
  assert(
    !/rocketState\.position\s*=/.test(postSeparationContact),
    "booster_no_kinematic_positioning_lock: post-separation contact must not directly reposition Starship",
  );
  assert(
    /boosterState\.velocity\s*=/.test(postSeparationContact),
    "booster_no_kinematic_positioning_lock: separation contact should remain a physical impulse, not disappear",
  );
  assertOnlyConstrainedBoosterPositionWrites(controllerSource);

  const accelerationStart = controllerSource.indexOf("accelerationKmS2: add(\n        add(scale(thrustVectorDirectionActual");
  assert(
    accelerationStart >= 0,
    "booster_no_kinematic_positioning_lock: could not find booster acceleration composition",
  );
  const accelerationText = controllerSource.slice(accelerationStart, accelerationStart + 900);
  for (const requiredForce of [
    "thrustVectorDirectionActual",
    "aero.accelerationKmS2",
    "boosterRcsAccelerationKmS2",
  ]) {
    assert(
      accelerationText.includes(requiredForce),
      `booster_no_kinematic_positioning_lock: acceleration missing ${requiredForce}`,
    );
  }
  assert(
    !/constraint|correction|kinematic/i.test(accelerationText),
    "booster_no_kinematic_positioning_lock: booster acceleration includes a non-component correction",
  );

  console.log("PASS booster-no-kinematic-positioning-lock");
}

main();
