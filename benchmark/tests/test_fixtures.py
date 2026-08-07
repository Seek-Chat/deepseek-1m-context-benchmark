import json
import unittest

from harness.fixtures import build_fixture
from harness.protocol import load_protocol


FAMILIES = ("single_record", "multi_hop_join", "latest_version", "event_ordering")


class FixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = load_protocol()

    def _corpus(self, fixture):
        return fixture.user_prompt.split("Synthetic corpus begins. Every line is an independent record.\n", 1)[1].split(
            "\nSynthetic corpus ends.", 1
        )[0]

    def test_every_family_is_deterministic(self):
        for family in FAMILIES:
            first = build_fixture(self.protocol, family, "32k", "beginning", 1)
            second = build_fixture(self.protocol, family, "32k", "beginning", 1)
            self.assertEqual(first.user_prompt, second.user_prompt)
            self.assertEqual(first.expected, second.expected)
            self.assertEqual(family, first.metadata["family_id"])

    def test_single_record_has_one_target(self):
        fixture = build_fixture(self.protocol, "single_record", "32k", "beginning", 1)
        needle = f"record key {fixture.expected['lookup_key']} "
        self.assertEqual(1, self._corpus(fixture).count(needle))

    def test_multi_hop_has_one_source_and_one_linked_record(self):
        fixture = build_fixture(self.protocol, "multi_hop_join", "32k", "middle", 2)
        corpus = self._corpus(fixture)
        source = f"record key {fixture.expected['source_key']} "
        linked = f"record key {fixture.expected['linked_key']} "
        self.assertEqual(1, corpus.count(source))
        self.assertEqual(1, corpus.count(linked))
        source_line = next(line for line in corpus.splitlines() if line.startswith(source))
        self.assertIn(f" link {fixture.expected['linked_key']} ", source_line)

    def test_latest_version_has_three_conflicts_and_selects_version_three(self):
        fixture = build_fixture(self.protocol, "latest_version", "32k", "end", 3)
        corpus = self._corpus(fixture)
        needle = f"record entity {fixture.expected['entity_key']} version "
        lines = [line for line in corpus.splitlines() if line.startswith(needle)]
        self.assertEqual(3, len(lines))
        self.assertEqual({1, 2, 3}, {int(line.split(" version ", 1)[1].split()[0]) for line in lines})
        self.assertEqual(3, fixture.expected["version"])

    def test_event_ordering_has_four_scattered_events(self):
        fixture = build_fixture(self.protocol, "event_ordering", "32k", "beginning", 1)
        corpus = self._corpus(fixture)
        needle = f"event group {fixture.expected['group_key']} sequence "
        lines = [line for line in corpus.splitlines() if line.startswith(needle)]
        self.assertEqual(4, len(lines))
        self.assertEqual(4, len(fixture.expected["ordered_event_codes"]))
        self.assertEqual(4, len(fixture.expected["ordered_checksums"]))

    def test_positions_are_within_rounding_tolerance(self):
        for position, expected_fraction in (("beginning", 0.1), ("middle", 0.5), ("end", 0.9)):
            fixture = build_fixture(self.protocol, "single_record", "32k", position, 2)
            actual = fixture.metadata["evidence_record_fractions"][0]
            self.assertAlmostEqual(expected_fraction, actual, places=3)

    def test_payload_explicitly_disables_thinking(self):
        fixture = build_fixture(self.protocol, "multi_hop_join", "32k", "middle", 3)
        payload = fixture.request_payload("deepseek-v4-pro", self.protocol["request"])
        self.assertEqual({"type": "disabled"}, payload["thinking"])
        self.assertEqual(256, payload["max_tokens"])
        self.assertTrue(payload["stream"])
        json.dumps(payload)

    def test_fixtures_consume_frozen_family_record_counts(self):
        tiers = {item["id"]: item for item in self.protocol["context_tiers"]}
        for family in FAMILIES:
            for tier_id, tier in tiers.items():
                fixture = build_fixture(self.protocol, family, tier_id, "middle", 1)
                self.assertEqual(tier["record_counts"][family], fixture.metadata["record_count"])


if __name__ == "__main__":
    unittest.main()
