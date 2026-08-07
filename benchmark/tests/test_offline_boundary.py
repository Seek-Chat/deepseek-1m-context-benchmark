import unittest
from pathlib import Path


class OfflineBoundaryTests(unittest.TestCase):
    def test_harness_has_no_network_or_credential_client(self):
        harness_dir = Path(__file__).resolve().parent.parent / "harness"
        combined = "\n".join(path.read_text(encoding="utf-8") for path in harness_dir.glob("*.py"))
        forbidden = (
            "import requests",
            "import urllib",
            "import socket",
            "DEEPSEEK_API_KEY",
            "Authorization",
        )
        for marker in forbidden:
            self.assertNotIn(marker, combined)


if __name__ == "__main__":
    unittest.main()
