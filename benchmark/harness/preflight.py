"""Conservative paid-run cost planning with an immutable hard stop."""

from __future__ import annotations

from collections import Counter
from decimal import Decimal, ROUND_UP
from typing import Any

from .protocol import iter_cases, validate_protocol


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.000001"), rounding=ROUND_UP))


def build_preflight(protocol: dict[str, Any], operator_budget_usd: float | None = None) -> dict[str, Any]:
    validate_protocol(protocol)
    controls = protocol["cost_controls"]
    hard_stop = Decimal(str(controls["hard_stop_usd"]))
    requested = Decimal(
        str(
            controls["default_operator_budget_usd"]
            if operator_budget_usd is None
            else operator_budget_usd
        )
    )
    if requested <= 0:
        raise ValueError("operator budget must be positive")
    effective_budget = min(requested, hard_stop)
    tiers = {item["id"]: item for item in protocol["context_tiers"]}
    prices = controls["pricing_per_million_tokens"]
    output_cap = Decimal(str(protocol["request"]["max_tokens"]))
    per_model: dict[str, dict[str, Any]] = {}
    total = Decimal("0")
    calls = list(iter_cases(protocol))
    for model in protocol["models"]:
        model_id = model["id"]
        model_cases = [case for case in calls if case.model_id == model_id]
        input_tokens = sum(tiers[case.tier_id]["max_billable_prompt_tokens"] for case in model_cases)
        output_tokens = int(output_cap) * len(model_cases)
        input_cost = Decimal(input_tokens) / Decimal(1_000_000) * Decimal(
            str(prices[model_id]["input_cache_miss"])
        )
        output_cost = Decimal(output_tokens) / Decimal(1_000_000) * Decimal(
            str(prices[model_id]["output"])
        )
        model_cost = input_cost + output_cost
        total += model_cost
        per_model[model_id] = {
            "calls": len(model_cases),
            "max_input_tokens": input_tokens,
            "max_output_tokens": output_tokens,
            "input_cost_usd": _money(input_cost),
            "output_cost_usd": _money(output_cost),
            "subtotal_usd": _money(model_cost),
        }
    guarded_total = total * Decimal(str(controls["safety_multiplier"]))
    tier_counts = Counter(case.tier_id for case in calls)
    family_counts = Counter(case.family_id for case in calls)
    passed = guarded_total <= effective_budget and guarded_total <= hard_stop
    return {
        "protocol_id": protocol["protocol_id"],
        "paid_calls": len(calls),
        "max_paid_attempts_per_case": controls["max_paid_attempts_per_case"],
        "tier_call_counts": dict(sorted(tier_counts.items())),
        "family_call_counts": dict(sorted(family_counts.items())),
        "assumption": "all_input_tokens_are_cache_misses_and_all_outputs_reach_the_cap",
        "pricing_snapshot_date": controls["pricing_snapshot_date"],
        "pricing_source": controls["pricing_source"],
        "per_model": per_model,
        "raw_max_cost_usd": _money(total),
        "safety_multiplier": controls["safety_multiplier"],
        "guarded_max_cost_usd": _money(guarded_total),
        "operator_budget_usd": _money(requested),
        "effective_budget_usd": _money(effective_budget),
        "hard_stop_usd": _money(hard_stop),
        "passed": passed,
        "paid_execution_authorized": False,
    }
