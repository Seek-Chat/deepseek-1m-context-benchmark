# Public data dictionary

The case CSVs are reconstructed through an explicit allowlist. Empty cells mean the provider or adapter did not supply a value; they are not silently imputed.

| Field | Meaning |
|---|---|
| `protocol_id` | Frozen benchmark protocol identifier. |
| `protocol_version` | Frozen protocol semantic version. |
| `analysis_role` | pilot_excluded, primary_accuracy, or india_latency_validation. |
| `include_in_primary_accuracy_denominators` | True only for the 288 U.S. primary rows. |
| `region_vantage` | AWS client network vantage used to send the request; not provider hosting or user location. |
| `case_id` | Deterministic effective case identifier; not a provider request ID. |
| `public_case_uid` | Release-specific hash of protocol, role, region, and case_id; unique across all 344 public rows. |
| `model_id` | Exact requested DeepSeek API model ID. |
| `family_id` | Frozen objective task family. |
| `tier_id` | Frozen provider-counted prompt-token tier. |
| `position_id` | Frozen beginning, middle, or end target position label. |
| `repeat` | Deterministic fixture repeat number. |
| `started_at` | UTC request start timestamp. |
| `finished_at` | UTC terminal timestamp. |
| `http_status` | Observed HTTP status when available. |
| `transport_complete` | True only when the HTTP stream completed under the frozen adapter contract. |
| `finish_reason` | Provider-returned completion finish reason. |
| `returned_model` | Provider-returned model identifier. |
| `system_fingerprint` | Provider-returned backend fingerprint when supplied. |
| `time_to_first_sse_event_ms` | Milliseconds from request start to the first SSE event. |
| `time_to_first_reasoning_token_ms` | Milliseconds to the first reasoning token; normally blank because thinking was disabled. |
| `time_to_first_answer_token_ms` | Milliseconds from request start to the first answer token. |
| `time_to_end_ms` | Milliseconds from request start to stream termination. |
| `prompt_tokens` | Provider-returned prompt-token count. |
| `completion_tokens` | Provider-returned completion-token count. |
| `total_tokens` | Provider-returned total-token count. |
| `prompt_cache_hit_tokens` | Provider-returned prompt cache-hit tokens. |
| `prompt_cache_miss_tokens` | Provider-returned prompt cache-miss tokens. |
| `reasoning_tokens` | Provider-returned reasoning-token count when supplied. |
| `valid_json` | Whether the final answer was one parseable JSON object. |
| `exact_keys` | Whether the parsed object had exactly the family-specific key set. |
| `exact_match` | Frozen primary outcome: exact keys, types, and values with no surrounding prose. |
| `field_accuracy` | Matched required fields divided by total required fields for the case. |
| `matched_fields` | Number of exact required fields. |
| `total_fields` | Number of required fields for the case family. |
| `grader_errors` | Pipe-delimited public-safe grader error labels. |
| `prompt_tier_calibration_passed` | Whether provider-returned prompt_tokens fell inside the frozen accepted tier. |
| `thinking_disabled_violation` | True if reasoning content appeared despite the frozen non-thinking request. |
| `sse_event_count` | Count of captured SSE events. |
| `sse_parse_error_count` | Count of SSE parse errors. |
| `sse_done_received` | Whether the terminal SSE marker was captured. |
| `stream_error_class` | Public-safe stream error class, if any. |
| `error_class` | Public-safe adapter error class, if any. |
| `observed_provider_cost_usd_cache_miss_upper_bound` | Dated cache-miss upper-bound cost calculated from returned token counts. |
| `generator_bundle_sha256` | SHA-256 of the frozen generator bundle. |
| `base_fixture_sha256` | SHA-256 of the unsalted deterministic fixture. |
| `execution_salt_sha256` | SHA-256 of the role-and-region execution salt. |
| `salted_user_prompt_sha256` | SHA-256 of the sent salted user prompt. |
| `expected_sha256` | SHA-256 of the objective expected JSON value. |
| `request_sha256` | SHA-256 of the canonical sent request body. |
| `raw_response_sha256` | SHA-256 of the immutable raw provider response bytes; raw bytes are not public. |

The sanitized validator export exposes aggregate field counts but not per-field expected and observed values. No per-field row dataset is synthesized.
