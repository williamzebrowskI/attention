import {
  createBoosterCapsulePhysicsBody,
  createLaunchSiteStaticPhysicsObjects,
  queryBoosterCatchPointContacts,
  queryLaunchSiteObjectContacts,
} from "../app/static/js/physics/launch/launchSitePhysicsObjects.js";
import { LAUNCH_BOOSTER_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { computeLaunchSiteCatchFrame } from "../app/static/js/physics/launch/launchSiteCatchGeometry.js";
import { queryRigidBodyContacts } from "../app/static/js/physics/objects/physicalObjectWorld.js";

const EARTH_MASS_KG = 5.97237e24;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

const earthState = {
  id: "earth",
  massKg: EARTH_MASS_KG,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
};
const axes = earthAxes();
const colliders = createLaunchSiteStaticPhysicsObjects({
  earthState,
  earthAxes: axes,
});

assert(colliders.length >= 4, "launch_site_physics_object_lock: expected tower and chopstick static colliders");
assert(colliders.some((collider) => collider.metadata?.role === "tower"), "launch_site_physics_object_lock: tower collider missing");
assert(colliders.some((collider) => collider.metadata?.role === "chopstick-arm"), "launch_site_physics_object_lock: chopstick arm collider missing");

const towerCollider = colliders.find((collider) => collider.metadata?.role === "tower");
const towerStrikeBody = createBoosterCapsulePhysicsBody({
  boosterState: {
    id: LAUNCH_BOOSTER_BODY_ID,
    massKg: 210000,
    position: towerCollider.centerKm,
    velocity: { x: -0.010, y: 0, z: -0.004 },
  },
  bodyAxisKm: towerCollider.axes.z,
});
const towerContacts = queryRigidBodyContacts(towerStrikeBody, colliders);
assert(towerContacts.length > 0, "launch_site_physics_object_lock: booster should contact the launch tower collider");
assert(
  towerContacts[0].metadata?.role === "tower",
  `launch_site_physics_object_lock: expected tower as primary contact, got ${towerContacts[0].metadata?.role}`,
);

const chopstickCollider = colliders.find((collider) => collider.metadata?.role === "chopstick-arm");
const chopstickGraze = queryLaunchSiteObjectContacts({
  boosterState: {
    id: LAUNCH_BOOSTER_BODY_ID,
    massKg: 210000,
    position: chopstickCollider.centerKm,
    velocity: { x: -0.004, y: -0.006, z: -0.002 },
  },
  bodyAxisKm: chopstickCollider.axes.z,
  earthState,
  earthAxes: axes,
});

assert(chopstickGraze.contacts.length > 0, "launch_site_physics_object_lock: booster should contact chopstick hardware");
assert(
  chopstickGraze.contacts[0].metadata?.role === "chopstick-arm",
  `launch_site_physics_object_lock: expected chopstick arm as primary contact, got ${chopstickGraze.contacts[0].metadata?.role}`,
);

const catchFrame = computeLaunchSiteCatchFrame({
  earthState,
  earthRadiusKm: 6371.0084,
  earthAxes: axes,
});
const uprightCatchContact = queryBoosterCatchPointContacts({
  boosterState: {
    id: LAUNCH_BOOSTER_BODY_ID,
    massKg: 210000,
    position: catchFrame.centerPosition,
    velocity: catchFrame.centerVelocity,
  },
  bodyAxesWorld: {
    forward: catchFrame.surfaceNormal,
    right: catchFrame.eastAxis,
    top: catchFrame.northAxis,
  },
  omegaWorldRadS: { x: 0, y: 0, z: 0 },
  earthState,
  earthAxes: axes,
});
assert(
  uprightCatchContact.captureEligible,
  `launch_site_physics_object_lock: upright catch pins should be physically supported ${JSON.stringify(uprightCatchContact)}`,
);
assert(
  uprightCatchContact.supportedPinCount >= 2 && uprightCatchContact.supportedArmCount >= 2,
  `launch_site_physics_object_lock: catch should require pins on both chopsticks ${JSON.stringify(uprightCatchContact)}`,
);

const sidewaysCatchContact = queryBoosterCatchPointContacts({
  boosterState: {
    id: LAUNCH_BOOSTER_BODY_ID,
    massKg: 210000,
    position: catchFrame.centerPosition,
    velocity: catchFrame.centerVelocity,
  },
  bodyAxesWorld: {
    forward: catchFrame.eastAxis,
    right: catchFrame.surfaceNormal,
    top: catchFrame.northAxis,
  },
  omegaWorldRadS: { x: 0, y: 0, z: 0 },
  earthState,
  earthAxes: axes,
});
assert(
  !sidewaysCatchContact.captureEligible,
  "launch_site_physics_object_lock: sideways booster must not satisfy catch-pin support",
);

console.log("launch-site-physics-object-lock: ok");
