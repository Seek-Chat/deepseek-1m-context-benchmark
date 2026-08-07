"""Deterministically construct four objective long-context task families."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any


WORDS = tuple("abcdefghijklmnopqrstuvwxyz")
KEY_SPACE = len(WORDS) ** 5


@dataclass(frozen=True)
class Fixture:
    case_seed: str
    system_prompt: str
    user_prompt: str
    expected: dict[str, Any]
    metadata: dict[str, Any]

    def request_payload(self, model_id: str, request_settings: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": self.user_prompt},
            ],
            "stream": request_settings["stream"],
            "temperature": request_settings["temperature"],
            "max_tokens": request_settings["max_tokens"],
            "response_format": request_settings["response_format"],
        }
        payload.update(request_settings["extra_body"])
        return payload


def _digest(seed: str, index: int) -> bytes:
    return hashlib.sha256(f"{seed}|{index}".encode("utf-8")).digest()


def _offset(seed: str) -> int:
    return int.from_bytes(hashlib.sha256(seed.encode("utf-8")).digest()[:5], "big")


def _word_key(number: int) -> str:
    words: list[str] = []
    value = number % KEY_SPACE
    for _ in range(5):
        words.append(WORDS[value % len(WORDS)])
        value //= len(WORDS)
    return " ".join(reversed(words))


def _fields(seed: str, index: int) -> dict[str, Any]:
    digest = _digest(seed, index)
    return {
        "alpha": WORDS[digest[6] % len(WORDS)],
        "beta": WORDS[digest[7] % len(WORDS)],
        "gamma": WORDS[digest[8] % len(WORDS)],
        "quantity": int.from_bytes(digest[9:12], "big") % 900 + 100,
        "checksum": _word_key(_offset(seed) + index * 104729 + 7919),
    }


def _single_record(seed: str, index: int) -> tuple[str, dict[str, Any]]:
    values = {"lookup_key": _word_key(_offset(seed) + index), **_fields(seed, index)}
    line = (
        f"record key {values['lookup_key']} alpha {values['alpha']} beta {values['beta']} "
        f"gamma {values['gamma']} quantity {values['quantity']} "
        f"checksum {values['checksum']} end"
    )
    return line, values


def _multi_record(
    seed: str, index: int, link_override: str | None = None
) -> tuple[str, dict[str, Any]]:
    key = _word_key(_offset(seed) + index)
    link = link_override or _word_key(_offset(seed) + index * 17 + 313)
    values = {"lookup_key": key, "link_key": link, **_fields(seed, index)}
    line = (
        f"record key {key} link {link} alpha {values['alpha']} beta {values['beta']} "
        f"gamma {values['gamma']} quantity {values['quantity']} "
        f"checksum {values['checksum']} end"
    )
    return line, values


def _version_record(
    seed: str,
    index: int,
    entity_override: str | None = None,
    version_override: int | None = None,
) -> tuple[str, dict[str, Any]]:
    entity_key = entity_override or _word_key(_offset(seed) + index)
    version = version_override or (_digest(seed, index)[0] % 9 + 1)
    values = {"entity_key": entity_key, "version": version, **_fields(seed, index)}
    line = (
        f"record entity {entity_key} version {version} alpha {values['alpha']} "
        f"beta {values['beta']} gamma {values['gamma']} quantity {values['quantity']} "
        f"checksum {values['checksum']} end"
    )
    return line, values


def _event_record(
    seed: str,
    index: int,
    group_override: str | None = None,
    sequence_override: int | None = None,
    code_override: str | None = None,
) -> tuple[str, dict[str, Any]]:
    digest = _digest(seed, index)
    group_key = group_override or _word_key(_offset(seed) + index)
    sequence = sequence_override or (digest[0] % 9 + 1)
    event_code = code_override or WORDS[digest[1] % len(WORDS)]
    checksum = _word_key(_offset(seed) + index * 65537 + 1237)
    values = {
        "group_key": group_key,
        "sequence": sequence,
        "event_code": event_code,
        "checksum": checksum,
    }
    line = (
        f"event group {group_key} sequence {sequence} code {event_code} "
        f"checksum {checksum} filler a b c d e end"
    )
    return line, values


def _fraction_index(record_count: int, fraction: float) -> int:
    return round((record_count - 1) * fraction)


def _single_family(
    seed: str, record_count: int, position_fraction: float
) -> tuple[list[str], dict[str, Any], list[int], str]:
    target_index = _fraction_index(record_count, position_fraction)
    lines: list[str] = []
    expected: dict[str, Any] | None = None
    for index in range(record_count):
        line, values = _single_record(seed, index)
        lines.append(line)
        if index == target_index:
            expected = values
    assert expected is not None
    query = (
        f"Find the record whose lookup_key is {expected['lookup_key']}. Return its exact fields."
    )
    return lines, expected, [target_index], query


def _multi_family(
    seed: str, record_count: int, position_id: str, position_fraction: float
) -> tuple[list[str], dict[str, Any], list[int], str]:
    linked_fraction = {"beginning": 0.9, "middle": 0.1, "end": 0.5}[position_id]
    source_index = _fraction_index(record_count, position_fraction)
    linked_index = _fraction_index(record_count, linked_fraction)
    source_key = _word_key(_offset(seed) + source_index)
    linked_key = _word_key(_offset(seed) + linked_index)
    lines: list[str] = []
    linked_values: dict[str, Any] | None = None
    for index in range(record_count):
        override = linked_key if index == source_index else None
        line, values = _multi_record(seed, index, override)
        lines.append(line)
        if index == linked_index:
            linked_values = values
    assert linked_values is not None
    expected = {
        "source_key": source_key,
        "linked_key": linked_key,
        **{key: linked_values[key] for key in ("alpha", "beta", "gamma", "quantity", "checksum")},
    }
    query = (
        f"Find source record {source_key}, follow its link to a second record, and return "
        "the source_key, linked_key, and the linked record's exact data fields."
    )
    return lines, expected, [source_index, linked_index], query


def _latest_family(
    seed: str, record_count: int, position_id: str, position_fraction: float
) -> tuple[list[str], dict[str, Any], list[int], str]:
    other_fractions = {
        "beginning": (0.5, 0.9),
        "middle": (0.1, 0.9),
        "end": (0.1, 0.5),
    }[position_id]
    latest_index = _fraction_index(record_count, position_fraction)
    older_indices = [_fraction_index(record_count, value) for value in other_fractions]
    version_by_index = {older_indices[0]: 1, older_indices[1]: 2, latest_index: 3}
    entity_key = _word_key(_offset(seed) + record_count + 1009)
    lines: list[str] = []
    expected: dict[str, Any] | None = None
    for index in range(record_count):
        if index in version_by_index:
            line, values = _version_record(
                seed, index, entity_override=entity_key, version_override=version_by_index[index]
            )
        else:
            line, values = _version_record(seed, index)
        lines.append(line)
        if index == latest_index:
            expected = values
    assert expected is not None
    query = (
        f"Find every record for entity {entity_key}. Select the highest numeric version and "
        "return that record's exact fields, including entity_key and version."
    )
    return lines, expected, [older_indices[0], older_indices[1], latest_index], query


def _event_family(
    seed: str, record_count: int, position_id: str, position_fraction: float
) -> tuple[list[str], dict[str, Any], list[int], str]:
    other_fractions = {
        "beginning": (0.35, 0.6, 0.9),
        "middle": (0.1, 0.35, 0.9),
        "end": (0.1, 0.4, 0.65),
    }[position_id]
    latest_index = _fraction_index(record_count, position_fraction)
    other_indices = [_fraction_index(record_count, value) for value in other_fractions]
    sequence_by_index = {
        other_indices[0]: 2,
        other_indices[1]: 1,
        other_indices[2]: 3,
        latest_index: 4,
    }
    group_key = _word_key(_offset(seed) + record_count + 2027)
    event_by_sequence: dict[int, dict[str, Any]] = {}
    lines: list[str] = []
    code_base = _digest(seed, record_count)[0]
    for index in range(record_count):
        if index in sequence_by_index:
            sequence = sequence_by_index[index]
            line, values = _event_record(
                seed,
                index,
                group_override=group_key,
                sequence_override=sequence,
                code_override=WORDS[(code_base + sequence) % len(WORDS)],
            )
            event_by_sequence[sequence] = values
        else:
            line, values = _event_record(seed, index)
        lines.append(line)
    expected = {
        "group_key": group_key,
        "ordered_event_codes": [event_by_sequence[value]["event_code"] for value in (1, 2, 3, 4)],
        "ordered_checksums": [event_by_sequence[value]["checksum"] for value in (1, 2, 3, 4)],
    }
    query = (
        f"Find the four events for group {group_key}. Order them by ascending numeric sequence "
        "and return group_key, ordered_event_codes, and ordered_checksums."
    )
    evidence = [other_indices[0], other_indices[1], other_indices[2], latest_index]
    return lines, expected, evidence, query


def build_fixture(
    protocol: dict[str, Any],
    family_id: str,
    tier_id: str,
    position_id: str,
    repeat: int,
) -> Fixture:
    families = {item["id"]: item for item in protocol["task_families"]}
    tiers = {item["id"]: item for item in protocol["context_tiers"]}
    positions = {item["id"]: item for item in protocol["positions"]}
    if family_id not in families:
        raise ValueError(f"unknown family: {family_id}")
    if tier_id not in tiers:
        raise ValueError(f"unknown tier: {tier_id}")
    if position_id not in positions:
        raise ValueError(f"unknown position: {position_id}")
    if not 1 <= repeat <= protocol["repeats"]:
        raise ValueError("repeat is outside the frozen range")

    tier = tiers[tier_id]
    fraction = positions[position_id]["fraction"]
    seed = f"{protocol['protocol_id']}|{family_id}|{tier_id}|{position_id}|r{repeat}"
    record_count = tier["record_counts"][family_id]

    if family_id == "single_record":
        lines, expected, evidence_indices, query = _single_family(seed, record_count, fraction)
    elif family_id == "multi_hop_join":
        lines, expected, evidence_indices, query = _multi_family(
            seed, record_count, position_id, fraction
        )
    elif family_id == "latest_version":
        lines, expected, evidence_indices, query = _latest_family(
            seed, record_count, position_id, fraction
        )
    elif family_id == "event_ordering":
        lines, expected, evidence_indices, query = _event_family(
            seed, record_count, position_id, fraction
        )
    else:
        raise AssertionError("unhandled task family")

    corpus = "\n".join(lines)
    system_prompt = (
        "You are a deterministic retrieval engine. Use only the supplied corpus. "
        "Return one JSON object and no Markdown or explanatory text."
    )
    key_list = ", ".join(families[family_id]["required_keys"])
    user_prompt = (
        "Synthetic corpus begins. Every line is an independent record.\n"
        f"{corpus}\n"
        "Synthetic corpus ends.\n"
        f"{query} Return exactly these keys: {key_list}. Preserve every value exactly."
    )
    fixture_hash = hashlib.sha256(user_prompt.encode("utf-8")).hexdigest()
    expected_json = json.dumps(expected, sort_keys=True, separators=(",", ":"))
    metadata = {
        "protocol_id": protocol["protocol_id"],
        "family_id": family_id,
        "tier_id": tier_id,
        "position_id": position_id,
        "position_fraction": fraction,
        "repeat": repeat,
        "record_count": record_count,
        "evidence_record_indices": evidence_indices,
        "evidence_record_fractions": [
            index / (record_count - 1) for index in evidence_indices
        ],
        "prompt_character_count": len(user_prompt),
        "heuristic_prompt_tokens_at_0_3_per_character": round(len(user_prompt) * 0.3),
        "fixture_sha256": fixture_hash,
        "expected_sha256": hashlib.sha256(expected_json.encode("utf-8")).hexdigest(),
    }
    return Fixture(seed, system_prompt, user_prompt, expected, metadata)
