import { applyInlineStarshipVisualStage } from "../app/static/js/physics/launch/starshipInlineVisual.js";

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
  applyInlineStarshipVisualStage(attached, 0, {
    stageIndex: 0,
    hotstageActive: false,
    boosterActive: false,
  });
  assert(
    attached.shipGroup.position.y === attached.fullShipCenterY,
    `expected stacked ship visual before hotstage, got ${attached.shipGroup.position.y}`,
  );

  const hotstage = makeStageState();
  applyInlineStarshipVisualStage(hotstage, 1, {
    stageIndex: 1,
    hotstageActive: true,
    boosterActive: false,
  });
  assert(
    hotstage.shipGroup.position.y === hotstage.detachedShipCenterY,
    `expected ship-reference visual during hotstage, got ${hotstage.shipGroup.position.y}`,
  );

  const detached = makeStageState();
  applyInlineStarshipVisualStage(detached, 1, {
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
