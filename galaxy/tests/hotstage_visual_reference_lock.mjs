import { applyStarshipVisualStage } from "../app/static/js/physics/launch/launchVisuals.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeStageState() {
  return {
    shipGroup: {
      position: { y: 999 },
    },
    fullShipCenterY: 35.5,
    detachedShipCenterY: 0,
  };
}

function main() {
  const attached = makeStageState();
  applyStarshipVisualStage(attached, 0, {
    stageIndex: 0,
    hotstageActive: false,
    boosterActive: false,
  });
  assert(
    attached.shipGroup.position.y === attached.fullShipCenterY,
    `expected stacked ship visual before hotstage, got ${attached.shipGroup.position.y}`,
  );

  const hotstageBeforeReferenceSwitch = makeStageState();
  applyStarshipVisualStage(hotstageBeforeReferenceSwitch, 1, {
    stageIndex: 1,
    hotstageActive: true,
    boosterActive: false,
    hotstageShipReferenceActive: false,
    attachedJointShipReferenceActive: false,
  });
  assert(
    hotstageBeforeReferenceSwitch.shipGroup.position.y === hotstageBeforeReferenceSwitch.fullShipCenterY,
    `expected no fake hotstage visual gap before reference switch, got ${hotstageBeforeReferenceSwitch.shipGroup.position.y}`,
  );

  const hotstageAfterReferenceSwitch = makeStageState();
  applyStarshipVisualStage(hotstageAfterReferenceSwitch, 1, {
    stageIndex: 1,
    hotstageActive: true,
    boosterActive: false,
    hotstageShipReferenceActive: true,
    attachedJointShipReferenceActive: true,
  });
  assert(
    hotstageAfterReferenceSwitch.shipGroup.position.y === hotstageAfterReferenceSwitch.detachedShipCenterY,
    `expected ship-reference visual during hotstage, got ${hotstageAfterReferenceSwitch.shipGroup.position.y}`,
  );

  const detached = makeStageState();
  applyStarshipVisualStage(detached, 1, {
    stageIndex: 1,
    hotstageActive: false,
    boosterActive: true,
  });
  assert(
    detached.shipGroup.position.y === detached.detachedShipCenterY,
    `expected detached ship visual after booster release, got ${detached.shipGroup.position.y}`,
  );

  console.log("PASS hotstage-visual-reference-lock");
}

main();
