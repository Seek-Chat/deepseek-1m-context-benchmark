# Frozen benchmark protocol

## Decision record

Protocol `deepseek-v4-long-context-retrieval-v1.1.0` was frozen on
2026-08-06. Any change to prompts, fixture construction, model parameters,
positions, repeats, graders, pricing assumptions, or exclusion rules requires a
new protocol identifier and a separate results directory.

The benchmark compares `deepseek-v4-flash` and `deepseek-v4-pro` on four
objective long-context retrieval and synthesis families. It does not test
general knowledge, writing quality, web search, or subjective helpfulness.

## Matrix

The complete matrix contains 288 paid cases:

- 2 models: V4 Flash and V4 Pro.
- 4 task families: exact single-record retrieval, two-record multi-hop join,
  latest-version conflict resolution, and scattered event ordering.
- 4 prompt tiers: 32K, 128K, 512K, and approximately 950K tokens.
- 3 target positions: 10%, 50%, and 90% of the synthetic corpus.
- 3 deterministic repeats per model, tier, and position.

Each repeat has a different corpus seed and objective answer. The same fixture
is used for both models so model results are paired.

Position labels have a frozen family-specific meaning. For single retrieval the
named position is the requested record. For the multi-hop join it is the source
record, while the linked record is placed in a different frozen band. For
version resolution it is version 3, while versions 1 and 2 are placed in the
other bands. For event ordering it is sequence 4, while sequences 1 through 3
are scattered across three other frozen fractions. Physical order therefore
cannot be used as a substitute for following links, comparing versions, or
sorting sequences.

## Request controls

The request uses the OpenAI-compatible Chat Completions format with streaming
enabled, explicit non-thinking mode, temperature zero, JSON output, and a
256-token output ceiling. Non-thinking mode isolates retrieval from variable
reasoning-token generation and keeps the cost ceiling auditable.

No unsupported sampling parameter is sent. No model alias is accepted. The
returned model identifier and system fingerprint must be retained by the
future execution adapter.

## Synthetic corpus and objective answer

Every fixture is generated from the protocol ID, family, tier, position, and
repeat by SHA-256. It contains many structurally identical records. There is no
marked needle and no external fact.

The four families are:

1. **Exact single-record retrieval:** find one ordinary `lookup_key` and return
   its six fields.
2. **Two-record multi-hop join:** find a source record, follow its `link` to a
   second record, and return the linked record's exact fields.
3. **Latest-version conflict resolution:** find three conflicting versions of
   one entity and select the record with the highest numeric version, regardless
   of physical order.
4. **Scattered event ordering:** find four events for one group and return their
   codes and checksums in ascending sequence order, not corpus order.

The deterministic grader requires:

1. A parseable JSON object with no Markdown fence or surrounding prose.
2. Exactly the frozen keys for that task family.
3. Exact string values and an integer `quantity`.

The primary score is exact match. Field accuracy and JSON validity are
diagnostics only and cannot turn a failed exact match into a pass.

## Prompt-token calibration

Each family and tier has a frozen record count in `protocol.json`. The counts
were selected and then verified across all 144 model-independent fixtures with
the frozen official DeepSeek-V4-Pro `tokenizer.json` input. Its frozen SHA-256 is
`8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf`.
Calibration encodes `system_prompt + "\n" + user_prompt` with special tokens
disabled. `calibration.json` records every prompt-token count, fixture hash,
answer hash, record count, family-tier min/max, and a checksum over the complete
144-fixture manifest.

The local tokenizer calibration protects the paid preflight; it is not a claim
about the provider's live billing path. The API response's `usage.prompt_tokens`
remains authoritative. A live count outside the frozen acceptance interval
invalidates that case for its tier and must not be silently moved or resized.

The approximately 950K tier leaves a 20K-token safety margin below the stated
one-million-token context boundary. If current API documentation or tokenizer
behavior makes that margin unsafe, the run must stop and a new protocol must be
versioned.

## Cost and stopping rules

The cost preflight assumes every input token is a cache miss, charges the full
256-token output ceiling, uses each tier's conservative billable prompt cap,
and applies a 15% safety multiplier. The preflight must pass both the operator
budget and the immutable USD 60 hard stop before any paid adapter is enabled.

There is exactly one paid attempt per case. There are no automatic retries.
Timeouts, HTTP errors, invalid JSON, and incomplete streams remain recorded
failures. A remediation run requires a new run ID and is reported separately.

Prices are a dated input, not a timeless fact. The operator must compare the
frozen snapshot with the current official pricing page before execution. A
price increase requires a new signed preflight; it must never be hidden by a
cache-hit assumption.

## Required raw evidence

A future execution adapter must preserve one append-only record per attempt:

- protocol, run, case, model, tier, position, and repeat IDs;
- fixture and request SHA-256 hashes;
- UTC timestamps and monotonic latency measurements;
- time to first SSE event, first reasoning token, first answer token, and end;
- HTTP status, finish reason, returned model, and system fingerprint;
- prompt, cache-hit, cache-miss, completion, and reasoning token counts;
- raw final content, raw-response SHA-256, and grader output;
- calculated provider cost using the dated price table.

Credentials, authorization headers, account identifiers, and private console
URLs are forbidden in evidence files.

## Analysis rules

Report exact-match counts and Wilson 95% intervals by model, family, tier, and
position. Report paired case deltas between Flash and Pro. Each model-family-tier
subgroup contains nine observations, enough to report empirical p50 and p95
with an explicit `n=9` warning; it is not enough for a narrow confidence claim.
Latency summaries require p50, p95, and the sample count; never report only an
average. Cache-hit cases are separated from cache-miss cases for both cost and
latency.

The protocol does not infer a provider deployment location from an AWS client
region. If regional clients are added later, they are network vantage points,
not user-country or model-hosting claims.
