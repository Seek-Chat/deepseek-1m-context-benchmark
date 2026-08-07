"""Load and validate the frozen machine-readable protocol."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parent.parent
PROTOCOL_PATH = ROOT / "protocol.json"


@dataclass(frozen=True)
class Case:
    case_id: str
    model_id: str
    family_id: str
    tier_id: str
    position_id: str
    repeat: int
    order_key: str


def load_protocol(path: Path = PROTOCOL_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_protocol(protocol: dict[str, Any]) -> None:
    if protocol.get("status") != "frozen":
        raise ValueError("protocol status must be frozen")
    if protocol.get("language") != "en":
        raise ValueError("protocol language must be English")
    model_ids = [item["id"] for item in protocol.get("models", [])]
    if model_ids != ["deepseek-v4-flash", "deepseek-v4-pro"]:
        raise ValueError("the frozen model order or identifiers changed")
    family_ids = [item["id"] for item in protocol.get("task_families", [])]
    if family_ids != ["single_record", "multi_hop_join", "latest_version", "event_ordering"]:
        raise ValueError("the frozen task families changed")
    for family in protocol["task_families"]:
        keys = family.get("required_keys", [])
        if not keys or len(keys) != len(set(keys)):
            raise ValueError(f"invalid required keys for {family['id']}")
    tier_ids = [item["id"] for item in protocol.get("context_tiers", [])]
    if tier_ids != ["32k", "128k", "512k", "950k"]:
        raise ValueError("the frozen context tiers changed")
    positions = protocol.get("positions", [])
    if [(item["id"], item["fraction"]) for item in positions] != [
        ("beginning", 0.1),
        ("middle", 0.5),
        ("end", 0.9),
    ]:
        raise ValueError("the frozen target positions changed")
    if protocol.get("repeats") != 3:
        raise ValueError("the frozen repeat count changed")
    request = protocol.get("request", {})
    if request.get("max_tokens") != 256:
        raise ValueError("the frozen output ceiling changed")
    if request.get("extra_body", {}).get("thinking", {}).get("type") != "disabled":
        raise ValueError("thinking must be explicitly disabled")
    controls = protocol.get("cost_controls", {})
    if controls.get("hard_stop_usd") != 60.0:
        raise ValueError("the USD 60 hard stop changed")
    if controls.get("max_paid_attempts_per_case") != 1:
        raise ValueError("there must be exactly one paid attempt per case")
    for tier in protocol["context_tiers"]:
        lower = tier["accepted_prompt_tokens_min"]
        target = tier["target_prompt_tokens"]
        upper = tier["accepted_prompt_tokens_max"]
        billable = tier["max_billable_prompt_tokens"]
        if not (0 < lower <= target <= upper <= billable <= 980000):
            raise ValueError(f"invalid token bounds for {tier['id']}")
        counts = tier.get("record_counts", {})
        if set(counts) != set(family_ids):
            raise ValueError(f"missing frozen family record counts for {tier['id']}")
        if any(type(value) is not int or value < 20 for value in counts.values()):
            raise ValueError(f"invalid frozen record count for {tier['id']}")
    tokenizer = protocol.get("tokenizer_calibration", {})
    if tokenizer.get("tokenizer_path") != "tokenizer/tokenizer.json":
        raise ValueError("the frozen tokenizer path changed")
    digest = tokenizer.get("tokenizer_sha256", "")
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError("invalid frozen tokenizer SHA-256")


def _case_id(
    protocol_id: str,
    model: str,
    family: str,
    tier: str,
    position: str,
    repeat: int,
) -> str:
    return f"{protocol_id}:{model}:{family}:{tier}:{position}:r{repeat}"


def iter_cases(protocol: dict[str, Any]) -> Iterator[Case]:
    validate_protocol(protocol)
    cases: list[Case] = []
    for model in protocol["models"]:
        for family in protocol["task_families"]:
            for tier in protocol["context_tiers"]:
                for position in protocol["positions"]:
                    for repeat in range(1, protocol["repeats"] + 1):
                        case_id = _case_id(
                            protocol["protocol_id"],
                            model["id"],
                            family["id"],
                            tier["id"],
                            position["id"],
                            repeat,
                        )
                        order_key = hashlib.sha256(case_id.encode("utf-8")).hexdigest()
                        cases.append(
                            Case(
                                case_id=case_id,
                                model_id=model["id"],
                                family_id=family["id"],
                                tier_id=tier["id"],
                                position_id=position["id"],
                                repeat=repeat,
                                order_key=order_key,
                            )
                        )
    yield from sorted(cases, key=lambda item: item.order_key)
