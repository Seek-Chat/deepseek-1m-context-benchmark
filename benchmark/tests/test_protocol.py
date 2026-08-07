import unittest

from harness.protocol import iter_cases, load_protocol, validate_protocol


class ProtocolTests(unittest.TestCase):
    def test_frozen_protocol_and_matrix(self):
        protocol = load_protocol()
        validate_protocol(protocol)
        cases = list(iter_cases(protocol))
        self.assertEqual(288, len(cases))
        self.assertEqual(288, len({case.case_id for case in cases}))
        self.assertEqual(288, len({case.order_key for case in cases}))

    def test_every_slice_has_three_repeats(self):
        protocol = load_protocol()
        cases = list(iter_cases(protocol))
        slices = {}
        for case in cases:
            key = (case.model_id, case.family_id, case.tier_id, case.position_id)
            slices.setdefault(key, set()).add(case.repeat)
        self.assertEqual(96, len(slices))
        self.assertTrue(all(repeats == {1, 2, 3} for repeats in slices.values()))


if __name__ == "__main__":
    unittest.main()
