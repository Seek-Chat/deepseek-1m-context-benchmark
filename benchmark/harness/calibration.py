"""Offline tokenizer calibration for all model-independent fixtures."""

from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from .fixtures import build_fixture
from .protocol import PROTOCOL_PATH, ROOT, validate_protocol


class CalibrationDependencyError(RuntimeError):
    """Raised when the optional local tokenizer runtime is unavailable."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _load_tokenizer(protocol: dict[str, Any]):
    try:
        from tokenizers import Tokenizer
    except (ImportError, OSError):
        local_deps = ROOT.parent / ".deps"
        if local_deps.is_dir() and str(local_deps) not in sys.path:
            sys.path.insert(0, str(local_deps))
        try:
            from tokenizers import Tokenizer
        except (ImportError, OSError) as exc:
            raise CalibrationDependencyError(
                "Install the optional tokenizers package or expose ../.deps before calibration"
            ) from exc

    settings = protocol["tokenizer_calibration"]
    tokenizer_path = ROOT / settings["tokenizer_path"]
    if not tokenizer_path.is_file():
        raise CalibrationDependencyError(f"tokenizer file not found: {tokenizer_path}")
    actual_size = tokenizer_path.stat().st_size
    actual_hash = _sha256_file(tokenizer_path)
    if actual_size != settings["tokenizer_bytes"]:
        raise ValueError("tokenizer byte length does not match the frozen protocol")
    if actual_hash != settings["tokenizer_sha256"]:
        raise ValueError("tokenizer SHA-256 does not match the frozen protocol")
    return Tokenizer.from_file(str(tokenizer_path)), tokenizer_path, actual_hash


def _fixture_specs(protocol: dict[str, Any]):
    for family in protocol["task_families"]:
        for tier in protocol["context_tiers"]:
            for position in protocol["positions"]:
                for repeat in range(1, protocol["repeats"] + 1):
                    yield family, tier, position, repeat


def build_calibration(protocol: dict[str, Any]) -> dict[str, Any]:
    validate_protocol(protocol)
    tokenizer, tokenizer_path, tokenizer_hash = _load_tokenizer(protocol)
    entries: list[dict[str, Any]] = []
    grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
    add_special_tokens = protocol["tokenizer_calibration"]["add_special_tokens"]

    for family, tier, position, repeat in _fixture_specs(protocol):
        fixture = build_fixture(
            protocol, family["id"], tier["id"], position["id"], repeat
        )
        counting_text = fixture.system_prompt + "\n" + fixture.user_prompt
        prompt_tokens = len(
            tokenizer.encode(counting_text, add_special_tokens=add_special_tokens).ids
        )
        within_tier = (
            tier["accepted_prompt_tokens_min"]
            <= prompt_tokens
            <= tier["accepted_prompt_tokens_max"]
        )
        under_global_cap = prompt_tokens <= 980000
        fixture_id = (
            f"{protocol['protocol_id']}:{family['id']}:{tier['id']}:"
            f"{position['id']}:r{repeat}"
        )
        entry = {
            "fixture_id": fixture_id,
            "family_id": family["id"],
            "tier_id": tier["id"],
            "position_id": position["id"],
            "repeat": repeat,
            "record_count": fixture.metadata["record_count"],
            "prompt_tokens": prompt_tokens,
            "accepted_prompt_tokens_min": tier["accepted_prompt_tokens_min"],
            "accepted_prompt_tokens_max": tier["accepted_prompt_tokens_max"],
            "within_tier": within_tier,
            "under_980k": under_global_cap,
            "fixture_sha256": fixture.metadata["fixture_sha256"],
            "expected_sha256": fixture.metadata["expected_sha256"],
        }
        entries.append(entry)
        grouped[(family["id"], tier["id"])].append(prompt_tokens)

    summaries = []
    for family in protocol["task_families"]:
        for tier in protocol["context_tiers"]:
            counts = grouped[(family["id"], tier["id"])]
            summaries.append(
                {
                    "family_id": family["id"],
                    "tier_id": tier["id"],
                    "fixtures": len(counts),
                    "record_count": tier["record_counts"][family["id"]],
                    "prompt_tokens_min": min(counts),
                    "prompt_tokens_max": max(counts),
                    "all_within_tier": all(
                        tier["accepted_prompt_tokens_min"]
                        <= value
                        <= tier["accepted_prompt_tokens_max"]
                        for value in counts
                    ),
                    "all_under_980k": max(counts) <= 980000,
                }
            )

    manifest_sha256 = _canonical_sha256(entries)
    all_passed = all(entry["within_tier"] and entry["under_980k"] for entry in entries)
    return {
        "schema_version": "1.0.0",
        "protocol_id": protocol["protocol_id"],
        "calibrated_on": protocol["frozen_on"],
        "counting_method": protocol["tokenizer_calibration"]["counting_input"],
        "add_special_tokens": add_special_tokens,
        "tokenizer": {
            "path": tokenizer_path.relative_to(ROOT).as_posix(),
            "bytes": tokenizer_path.stat().st_size,
            "sha256": tokenizer_hash,
        },
        "protocol_sha256": _sha256_file(PROTOCOL_PATH),
        "unique_fixtures": len(entries),
        "paid_cases_represented": len(entries) * len(protocol["models"]),
        "fixture_manifest_sha256": manifest_sha256,
        "all_passed": all_passed,
        "summaries": summaries,
        "fixtures": entries,
    }


def validate_calibration(protocol: dict[str, Any], calibration: dict[str, Any]) -> None:
    validate_protocol(protocol)
    if calibration.get("protocol_id") != protocol["protocol_id"]:
        raise ValueError("calibration protocol ID mismatch")
    if calibration.get("unique_fixtures") != 144:
        raise ValueError("calibration must contain 144 unique fixtures")
    if calibration.get("paid_cases_represented") != 288:
        raise ValueError("calibration must represent 288 paired paid cases")
    if calibration.get("protocol_sha256") != _sha256_file(PROTOCOL_PATH):
        raise ValueError("calibration protocol SHA-256 mismatch")
    if calibration.get("tokenizer", {}).get("sha256") != protocol["tokenizer_calibration"][
        "tokenizer_sha256"
    ]:
        raise ValueError("calibration tokenizer SHA-256 mismatch")
    entries = calibration.get("fixtures", [])
    if len(entries) != 144 or len({entry["fixture_id"] for entry in entries}) != 144:
        raise ValueError("calibration fixture IDs are missing or duplicated")
    if calibration.get("fixture_manifest_sha256") != _canonical_sha256(entries):
        raise ValueError("calibration fixture manifest checksum mismatch")
    for entry in entries:
        if not entry.get("within_tier") or not entry.get("under_980k"):
            raise ValueError(f"fixture is outside its frozen token band: {entry['fixture_id']}")
        if entry["prompt_tokens"] > 980000:
            raise ValueError(f"fixture exceeds the 980K cap: {entry['fixture_id']}")
        if len(entry.get("fixture_sha256", "")) != 64:
            raise ValueError("invalid fixture SHA-256")
        if len(entry.get("expected_sha256", "")) != 64:
            raise ValueError("invalid expected-answer SHA-256")
    if not calibration.get("all_passed"):
        raise ValueError("calibration is not marked as passed")
