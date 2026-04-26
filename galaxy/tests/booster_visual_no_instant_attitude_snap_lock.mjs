import fs from "node:fs";

const appSource = fs.readFileSync(
  new URL("../app/static/js/app.js", import.meta.url),
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

function main() {
  const boosterVisual = extractFunction(appSource, "updateBoosterVehicleVisuals");

  assert(
    boosterVisual.includes("const boosterActiveFreeFlight = Boolean(snapshot?.boosterActive)"),
    "booster visual attitude must identify active free flight before applying hold locks",
  );
  assert(
    boosterVisual.includes("boosterCaughtVisualLock ? (bodyAxisScene || upScene || defaultAxis)"),
    "caught booster visuals must prefer the physical body axis instead of forcing vertical",
  );
  assert(
    boosterVisual.includes("|| boosterAttached"),
    "attached booster visuals must hard-lock to the stack axis until physical separation",
  );
  assert(
    boosterVisual.includes("|| (visualVerticalHold && !boosterActiveFreeFlight);"),
    "hard booster visual attitude locks must keep active free-flight out of vertical-hold locks",
  );
  assert(
    boosterVisual.includes("if (!hardLockBoosterVisual)"),
    "active free-flight booster attitude should smooth toward the physics body axis, not hard-copy it",
  );
  assert(
    !/boosterBecameVisible[\s\S]{0,220}visual\.tiltGroup\.quaternion\.copy\(targetQuaternion\)/.test(boosterVisual),
    "booster visual attitude must not snap just because the booster became visible",
  );
  assert(
    !/else\s+if\s*\(\s*visualVerticalHold\s*\)\s*\{\s*visual\.tiltGroup\.quaternion\.copy\(targetQuaternion\);?\s*\}/.test(boosterVisual),
    "active booster visual vertical hold must not bypass the free-flight hard-lock gate",
  );

  console.log("PASS booster-visual-no-instant-attitude-snap-lock");
}

main();
