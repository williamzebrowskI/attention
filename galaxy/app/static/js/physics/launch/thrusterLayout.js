/*
 * Thruster hardpoints normalized to vehicle geometry.
 *
 * Public references describe:
 * - Starship: 4 hot-gas thrusters below payload-bay region, + 2 on the oxygen-tank section.
 * - Super Heavy: attitude vents near interstage + downward-canted vents below common-dome region.
 *
 * We model those zones directly on our procedural meshes using normalized coordinates.
 * xR/zR scale with body radius; yH scales with body height.
 */

export const STARSHIP_THRUSTER_LAYOUT = Object.freeze({
  port: Object.freeze({
    anchor: Object.freeze({ xR: -1.002, yH: 0.34, zR: 0.0 }),
    direction: Object.freeze({ x: -1, y: 0, z: 0 }),
  }),
  starboard: Object.freeze({
    anchor: Object.freeze({ xR: 1.002, yH: 0.34, zR: 0.0 }),
    direction: Object.freeze({ x: 1, y: 0, z: 0 }),
  }),
  dorsal: Object.freeze({
    anchor: Object.freeze({ xR: 0.0, yH: 0.34, zR: 1.002 }),
    direction: Object.freeze({ x: 0, y: 0, z: 1 }),
  }),
  ventral: Object.freeze({
    anchor: Object.freeze({ xR: 0.0, yH: 0.34, zR: -1.002 }),
    direction: Object.freeze({ x: 0, y: 0, z: -1 }),
  }),
  forward: Object.freeze({
    anchor: Object.freeze({ xR: 0.72, yH: -0.04, zR: 0.62 }),
    direction: Object.freeze({ x: 0, y: 1, z: 0 }),
  }),
  aft: Object.freeze({
    anchor: Object.freeze({ xR: -0.72, yH: -0.04, zR: -0.62 }),
    direction: Object.freeze({ x: 0, y: -1, z: 0 }),
  }),
});

export const BOOSTER_THRUSTER_LAYOUT = Object.freeze({
  port: Object.freeze({
    anchor: Object.freeze({ xR: -1.003, yH: 0.44, zR: 0.0 }),
    direction: Object.freeze({ x: -1, y: 0, z: 0 }),
  }),
  starboard: Object.freeze({
    anchor: Object.freeze({ xR: 1.003, yH: 0.44, zR: 0.0 }),
    direction: Object.freeze({ x: 1, y: 0, z: 0 }),
  }),
  dorsal: Object.freeze({
    anchor: Object.freeze({ xR: 0.0, yH: 0.44, zR: 1.003 }),
    direction: Object.freeze({ x: 0, y: 0, z: 1 }),
  }),
  ventral: Object.freeze({
    anchor: Object.freeze({ xR: 0.0, yH: 0.44, zR: -1.003 }),
    direction: Object.freeze({ x: 0, y: 0, z: -1 }),
  }),
  forward: Object.freeze({
    anchor: Object.freeze({ xR: 0.0, yH: -0.2, zR: 1.003 }),
    direction: Object.freeze({ x: 0, y: -0.93, z: 0.37 }),
  }),
  aft: Object.freeze({
    anchor: Object.freeze({ xR: 0.0, yH: -0.2, zR: -1.003 }),
    direction: Object.freeze({ x: 0, y: -0.93, z: -0.37 }),
  }),
});
