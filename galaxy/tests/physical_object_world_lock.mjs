import {
  createCapsuleRigidBody,
  createStaticBoxCollider,
  queryRigidBodyContacts,
  resolveDynamicBodyContacts,
} from "../app/static/js/physics/objects/physicalObjectWorld.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const floorBox = createStaticBoxCollider({
  id: "test-floor",
  centerKm: { x: 0, y: 0, z: 0 },
  axes: {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
  },
  halfExtentsKm: { x: 1, y: 1, z: 0.5 },
  surfaceVelocityKmS: { x: 0, y: 0, z: 0 },
  material: { restitution: 0.1, friction: 0.8 },
  metadata: { role: "floor" },
});

const fallingCapsule = createCapsuleRigidBody({
  id: "test-capsule",
  massKg: 1000,
  positionKm: { x: 0.08, y: 0, z: 0.72 },
  velocityKmS: { x: 0.004, y: 0, z: -0.030 },
  axisKm: { x: 0, y: 0, z: 1 },
  halfLengthKm: 0.30,
  radiusKm: 0.08,
  material: { restitution: 0.04, friction: 0.75 },
});

const contacts = queryRigidBodyContacts(fallingCapsule, [floorBox]);
assert(contacts.length === 1, "physical_object_world_lock: expected a capsule/box contact");
assert(contacts[0].penetrationKm > 0, "physical_object_world_lock: contact should have positive penetration");
assert(contacts[0].normalKm.z > 0.9, "physical_object_world_lock: contact normal should push the body upward");
assert(contacts[0].normalSpeedKmS < 0, "physical_object_world_lock: body should be moving into the contact");

const resolved = resolveDynamicBodyContacts(fallingCapsule, [floorBox]);
assert(resolved.resolved, "physical_object_world_lock: contact should resolve");
assert(resolved.body.positionKm.z > fallingCapsule.positionKm.z, "physical_object_world_lock: body should be projected out of the collider");
assert(resolved.body.velocityKmS.z >= -0.001, "physical_object_world_lock: impact normal velocity should be removed");
assert(
  Math.abs(resolved.body.velocityKmS.x) < Math.abs(fallingCapsule.velocityKmS.x),
  "physical_object_world_lock: tangential velocity should be reduced by friction",
);

console.log("physical-object-world-lock: ok");
