import copy
import unittest

from harness.preflight import build_preflight
from harness.protocol import load_protocol


class PreflightTests(unittest.TestCase):
    def test_default_plan_passes_hard_stop(self):
        result = build_preflight(load_protocol())
        self.assertEqual(288, result["paid_calls"])
        self.assertTrue(result["passed"])
        self.assertLessEqual(float(result["guarded_max_cost_usd"]), 60.0)
        self.assertFalse(result["paid_execution_authorized"])
        self.assertEqual(
            {
                "event_ordering": 72,
                "latest_version": 72,
                "multi_hop_join": 72,
                "single_record": 72,
            },
            result["family_call_counts"],
        )

    def test_stricter_operator_budget_stops_run(self):
        result = build_preflight(load_protocol(), operator_budget_usd=1.0)
        self.assertFalse(result["passed"])
        self.assertEqual("1.000000", result["effective_budget_usd"])

    def test_operator_cannot_raise_immutable_hard_stop(self):
        result = build_preflight(load_protocol(), operator_budget_usd=1000.0)
        self.assertEqual("60.000000", result["effective_budget_usd"])
        self.assertEqual("60.000000", result["hard_stop_usd"])

    def test_expensive_plan_is_blocked_by_hard_stop(self):
        protocol = copy.deepcopy(load_protocol())
        for prices in protocol["cost_controls"]["pricing_per_million_tokens"].values():
            prices["input_cache_miss"] *= 10
            prices["output"] *= 10
        result = build_preflight(protocol, operator_budget_usd=1000.0)
        self.assertGreater(float(result["guarded_max_cost_usd"]), 60.0)
        self.assertFalse(result["passed"])


if __name__ == "__main__":
    unittest.main()
