import { ensureRuntimeCatalogBody } from "../app/static/js/ui/runtimeVehicleRegistry.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const bodies = [{
    id: "earth_mission_ship_1",
    name: "Starship 1 (Moon Orbit + Return)",
    body_type: "spacecraft",
    parent: "earth",
  }];
  const metaById = new Map(bodies.map((body) => [body.id, body]));
  const bodyVisuals = new Map();
  let createCalls = 0;
  let mountCalls = 0;

  const registered = await ensureRuntimeCatalogBody({
    bodyMeta: {
      id: "earth_mission_ship_1",
      name: "Starship 1 (Moon Orbit + Return)",
      body_type: "spacecraft",
      parent: "earth",
    },
    hasBody: (id) => metaById.has(id) && bodyVisuals.has(id),
    registerBody: (normalized) => {
      const existingIndex = bodies.findIndex((body) => body?.id === normalized.id);
      if (existingIndex >= 0) {
        bodies.splice(existingIndex, 1, normalized);
      } else {
        bodies.push(normalized);
      }
      metaById.set(normalized.id, normalized);
    },
    createBodyVisual: async (normalized) => {
      createCalls += 1;
      return {
        id: normalized.id,
        root: {},
      };
    },
    mountBodyVisual: (visual) => {
      mountCalls += 1;
      bodyVisuals.set(visual.id, visual);
    },
    rebuildBodyLegend: () => {},
    onError: (error) => {
      throw error;
    },
  });

  assert(registered === true, "runtime registry should report success");
  assert(bodies.length === 1, "existing runtime catalog entry should be updated, not duplicated");
  assert(createCalls === 1, "missing visual should be created even when metadata already exists");
  assert(mountCalls === 1, "created visual should be mounted");
  assert(bodyVisuals.has("earth_mission_ship_1"), "visual map should contain the mission ship");

  console.log("PASS runtime-vehicle-registry-missing-visual-lock");
}

await main();
