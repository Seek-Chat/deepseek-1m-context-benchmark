import json
import unittest

from harness.grader import grade_response


EXPECTED = {
    "lookup_key": "abc123",
    "alpha": "amber",
    "beta": "birch",
    "gamma": "cedar",
    "quantity": 123456,
    "checksum": "0123456789abcdef",
}


class GraderTests(unittest.TestCase):
    def test_exact_json_passes(self):
        result = grade_response(EXPECTED, json.dumps(EXPECTED))
        self.assertTrue(result["exact_match"])
        self.assertEqual(1.0, result["field_accuracy"])

    def test_markdown_fence_fails_json(self):
        result = grade_response(EXPECTED, "```json\n" + json.dumps(EXPECTED) + "\n```")
        self.assertFalse(result["valid_json"])
        self.assertFalse(result["exact_match"])

    def test_wrong_type_and_extra_key_fail(self):
        response = dict(EXPECTED, quantity="123456", note="extra")
        result = grade_response(EXPECTED, json.dumps(response))
        self.assertFalse(result["exact_keys"])
        self.assertFalse(result["exact_match"])
        self.assertIn("wrong_type:quantity", result["errors"])
        self.assertIn("extra_keys:note", result["errors"])

    def test_openai_response_shape_is_supported(self):
        response = {"choices": [{"message": {"content": json.dumps(EXPECTED)}}]}
        self.assertTrue(grade_response(EXPECTED, response)["exact_match"])


if __name__ == "__main__":
    unittest.main()
