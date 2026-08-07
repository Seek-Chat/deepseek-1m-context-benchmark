import json
import unittest
from pathlib import Path

from harness.calibration import (
    CalibrationDependencyError,
    build_calibration,
    validate_calibration,
)
from harness.fixtures import build_fixture
from harness.protocol import load_protocol


ROOT = Path(__file__).resolve().parent.parent


class CalibrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = load_protocol()
        cls.calibration = json.loads((ROOT / "calibration.json").read_text(encoding="utf-8"))

    def test_checked_in_calibration_is_valid(self):
        validate_calibration(self.protocol, self.calibration)
        self.assertTrue(self.calibration["all_passed"])
        self.assertEqual(144, self.calibration["unique_fixtures"])
        self.assertEqual(288, self.calibration["paid_cases_represented"])

    def test_no_fixture_is_out_of_band_or_over_980k(self):
        for entry in self.calibration["fixtures"]:
            self.assertGreaterEqual(
                entry["prompt_tokens"], entry["accepted_prompt_tokens_min"], entry["fixture_id"]
            )
            self.assertLessEqual(
                entry["prompt_tokens"], entry["accepted_prompt_tokens_max"], entry["fixture_id"]
            )
            self.assertLessEqual(entry["prompt_tokens"], 980000, entry["fixture_id"])
            self.assertTrue(entry["within_tier"], entry["fixture_id"])
            self.assertTrue(entry["under_980k"], entry["fixture_id"])

    def test_calibration_hashes_match_current_fixture_generator(self):
        entries = {entry["fixture_id"]: entry for entry in self.calibration["fixtures"]}
        for family in self.protocol["task_families"]:
            for tier in self.protocol["context_tiers"]:
                for position in self.protocol["positions"]:
                    for repeat in range(1, self.protocol["repeats"] + 1):
                        fixture = build_fixture(
                            self.protocol,
                            family["id"],
                            tier["id"],
                            position["id"],
                            repeat,
                        )
                        fixture_id = (
                            f"{self.protocol['protocol_id']}:{family['id']}:{tier['id']}:"
                            f"{position['id']}:r{repeat}"
                        )
                        entry = entries[fixture_id]
                        self.assertEqual(entry["record_count"], fixture.metadata["record_count"])
                        self.assertEqual(entry["fixture_sha256"], fixture.metadata["fixture_sha256"])
                        self.assertEqual(entry["expected_sha256"], fixture.metadata["expected_sha256"])

    def test_optional_official_tokenizer_rebuild_matches(self):
        try:
            rebuilt = build_calibration(self.protocol)
        except CalibrationDependencyError as exc:
            self.skipTest(str(exc))
        self.assertEqual(
            self.calibration["fixture_manifest_sha256"], rebuilt["fixture_manifest_sha256"]
        )
        self.assertEqual(self.calibration["summaries"], rebuilt["summaries"])
        self.assertEqual(self.calibration["fixtures"], rebuilt["fixtures"])


if __name__ == "__main__":
    unittest.main()
