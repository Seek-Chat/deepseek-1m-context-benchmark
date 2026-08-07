"""Strict deterministic grader for benchmark responses."""

from __future__ import annotations

import json
from typing import Any


def _content_from_response(response: Any) -> str:
    if isinstance(response, str):
        return response
    if not isinstance(response, dict):
        raise ValueError("response must be a string or object")
    if isinstance(response.get("content"), str):
        return response["content"]
    try:
        content = response["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("response has no supported content field") from exc
    if not isinstance(content, str):
        raise ValueError("response content must be a string")
    return content


def grade_response(expected: dict[str, Any], response: Any) -> dict[str, Any]:
    content = _content_from_response(response)
    errors: list[str] = []
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        return {
            "valid_json": False,
            "exact_keys": False,
            "exact_match": False,
            "field_accuracy": 0.0,
            "matched_fields": 0,
            "total_fields": len(expected),
            "errors": [f"invalid_json:{exc.msg}"],
        }
    if not isinstance(parsed, dict):
        return {
            "valid_json": True,
            "exact_keys": False,
            "exact_match": False,
            "field_accuracy": 0.0,
            "matched_fields": 0,
            "total_fields": len(expected),
            "errors": ["json_value_is_not_an_object"],
        }

    exact_keys = set(parsed) == set(expected)
    if not exact_keys:
        missing = sorted(set(expected) - set(parsed))
        extra = sorted(set(parsed) - set(expected))
        if missing:
            errors.append("missing_keys:" + ",".join(missing))
        if extra:
            errors.append("extra_keys:" + ",".join(extra))
    matched = sum(
        1
        for key, value in expected.items()
        if key in parsed and type(parsed[key]) is type(value) and parsed[key] == value
    )
    for key, value in expected.items():
        if key not in parsed:
            continue
        if type(parsed[key]) is not type(value):
            errors.append(f"wrong_type:{key}")
        elif parsed[key] != value:
            errors.append(f"wrong_value:{key}")
    exact_match = exact_keys and matched == len(expected)
    return {
        "valid_json": True,
        "exact_keys": exact_keys,
        "exact_match": exact_match,
        "field_accuracy": matched / len(expected),
        "matched_fields": matched,
        "total_fields": len(expected),
        "errors": errors,
    }
