"""Command-line entry point for the offline benchmark harness."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .calibration import build_calibration, validate_calibration
from .fixtures import build_fixture
from .grader import grade_response
from .preflight import build_preflight
from .protocol import iter_cases, load_protocol, validate_protocol


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline DeepSeek benchmark harness")
    sub = parser.add_subparsers(dest="command", required=True)

    preflight = sub.add_parser("preflight", help="calculate the conservative paid-run ceiling")
    preflight.add_argument("--budget-usd", type=float)

    sub.add_parser("manifest", help="print the deterministic 288-case manifest")

    calibration = sub.add_parser(
        "calibrate", help="tokenize and validate all 144 model-independent fixtures"
    )
    calibration.add_argument("--output", type=Path)
    calibration.add_argument("--check", action="store_true")

    fixture = sub.add_parser("fixture", help="materialize one deterministic case")
    fixture.add_argument(
        "--family",
        required=True,
        choices=("single_record", "multi_hop_join", "latest_version", "event_ordering"),
    )
    fixture.add_argument("--tier", required=True, choices=("32k", "128k", "512k", "950k"))
    fixture.add_argument(
        "--position", required=True, choices=("beginning", "middle", "end")
    )
    fixture.add_argument("--repeat", required=True, type=int, choices=(1, 2, 3))
    fixture.add_argument("--model", default="deepseek-v4-flash", choices=("deepseek-v4-flash", "deepseek-v4-pro"))
    fixture.add_argument("--output-dir", required=True, type=Path)

    grade = sub.add_parser("grade", help="grade one captured response")
    grade.add_argument("--expected", required=True, type=Path)
    grade.add_argument("--response", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    protocol = load_protocol()
    validate_protocol(protocol)
    if args.command == "preflight":
        result = build_preflight(protocol, args.budget_usd)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["passed"] else 3
    if args.command == "manifest":
        manifest = [case.__dict__ for case in iter_cases(protocol)]
        print(json.dumps({"protocol_id": protocol["protocol_id"], "cases": manifest}, indent=2))
        return 0
    if args.command == "calibrate":
        result = build_calibration(protocol)
        validate_calibration(protocol, result)
        output = args.output or (
            Path(__file__).resolve().parent.parent
            / protocol["tokenizer_calibration"]["calibration_file"]
        )
        rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.check:
            if not output.is_file() or output.read_text(encoding="utf-8") != rendered:
                print(f"calibration drift: {output}")
                return 5
        else:
            output.write_text(rendered, encoding="utf-8")
        print(
            json.dumps(
                {
                    "output": str(output),
                    "unique_fixtures": result["unique_fixtures"],
                    "paid_cases_represented": result["paid_cases_represented"],
                    "fixture_manifest_sha256": result["fixture_manifest_sha256"],
                    "all_passed": result["all_passed"],
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    if args.command == "fixture":
        fixture = build_fixture(protocol, args.family, args.tier, args.position, args.repeat)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        _write_json(args.output_dir / "request.json", fixture.request_payload(args.model, protocol["request"]))
        _write_json(args.output_dir / "expected.json", fixture.expected)
        _write_json(args.output_dir / "metadata.json", fixture.metadata)
        print(json.dumps(fixture.metadata, indent=2, sort_keys=True))
        return 0
    if args.command == "grade":
        expected = json.loads(args.expected.read_text(encoding="utf-8"))
        response = json.loads(args.response.read_text(encoding="utf-8"))
        result = grade_response(expected, response)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["exact_match"] else 4
    raise AssertionError("unhandled command")
