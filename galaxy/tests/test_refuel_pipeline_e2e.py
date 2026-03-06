import shutil
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def run_node_script(script_name: str) -> subprocess.CompletedProcess[str]:
    script_path = REPO_ROOT / "tests" / script_name
    return subprocess.run(
        ["node", str(script_path)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )


@unittest.skipIf(shutil.which("node") is None, "Node.js is required for JS refuel pipeline tests")
class RefuelPipelineE2ETests(unittest.TestCase):
    def assert_script_passes(self, script_name: str) -> None:
        result = run_node_script(script_name)
        if result.returncode != 0:
            self.fail(
                f"{script_name} failed with code {result.returncode}\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )

    def test_refuel_pipeline_quickcheck(self) -> None:
        self.assert_script_passes("refuel_pipeline_quickcheck.mjs")

    def test_refuel_pipeline_e2e(self) -> None:
        self.assert_script_passes("refuel_pipeline_e2e.mjs")

    def test_refuel_pipeline_close_range_altitude_e2e(self) -> None:
        self.assert_script_passes("refuel_pipeline_close_range_altitude_e2e.mjs")

    def test_refuel_pipeline_edge_cases_e2e(self) -> None:
        self.assert_script_passes("refuel_pipeline_edge_cases_e2e.mjs")

    def test_refuel_closedloop_e2e(self) -> None:
        self.assert_script_passes("refuel_closedloop_e2e.mjs")

    def test_refuel_controller_state_progression_e2e(self) -> None:
        self.assert_script_passes("refuel_controller_state_progression_e2e.mjs")

    def test_refuel_launch_controller_smoke(self) -> None:
        self.assert_script_passes("refuel_launch_controller_smoke.mjs")


if __name__ == "__main__":
    unittest.main()
