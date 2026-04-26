import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const controllerPath = path.resolve(__dirname, "../app/static/js/physics/launch/launchController.js");
const controllerSource = fs.readFileSync(controllerPath, "utf8");

function main() {
  [
    "physicalFlipAngularAccelerationRadS2",
    "physicalUprightAngularAccelerationRadS2",
    "commandedFlipAccelRadS2",
    "commandedUprightAccelRadS2",
    "flipTorqueBodyNm",
    "physicalGuidedTiltReferenceActive",
  ].forEach((token) => {
    assert(
      !controllerSource.includes(token),
      `booster attitude control still contains obsolete non-hardware helper ${token}`,
    );
  });

  const torqueSectionMatch = controllerSource.match(/let totalBodyTorqueNm = add\([\s\S]*?let totalTorqueWorldNm =/);
  assert(torqueSectionMatch, "could not locate booster attitude torque integration section");
  const torqueSection = torqueSectionMatch[0];
  assert(
    !torqueSection.includes("totalBodyTorqueNm = add(totalBodyTorqueNm"),
    "booster attitude torque section should not inject extra generic body torque after hardware torques are summed",
  );

  [
    "\"grid-fins\"",
    "\"engine-gimbal\"",
    "\"rcs-thrusters\"",
    "\"engine-asymmetry\"",
    "\"aero-moment\"",
  ].forEach((sourceName) => {
    assert(
      torqueSection.includes(sourceName),
      `missing named booster attitude torque source ${sourceName}`,
    );
  });

  assert(
    controllerSource.includes("attitudeTorqueSources")
      && controllerSource.includes("attitudeTorqueSourceText"),
    "booster telemetry must expose named attitude torque sources",
  );

  console.log("PASS booster-named-attitude-torque-lock");
}

main();
