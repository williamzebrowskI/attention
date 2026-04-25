import { execFileSync } from "node:child_process";

const seeds = [0, 1, 2, 3, 4, 5];

for (const seed of seeds) {
  try {
    execFileSync(
      process.execPath,
      ["tests/earth_orbit_hold_booster_catch_e2e.mjs"],
      {
        env: {
          ...process.env,
          BOOSTER_CATCH_WIND_SEED: String(seed),
        },
        stdio: "pipe",
      },
    );
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : "";
    const stderr = error?.stderr ? String(error.stderr) : "";
    throw new Error(`earth_orbit_hold_booster_catch_wind_sweep_e2e: seed ${seed} failed\n${stdout}${stderr}`);
  }
}

console.log(`PASS earth-orbit-hold-booster-catch-wind-sweep-e2e ${seeds.length} seeds`);
