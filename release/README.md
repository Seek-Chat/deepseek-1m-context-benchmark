# DeepSeek 1M Context Benchmark dataset v1.0.0

This release contains 344 sanitized terminal rows from frozen protocol `deepseek-v4-long-context-retrieval-v1.1.0`: 20 excluded pilot calls, 288 U.S. primary accuracy cases, and 36 matched India network-vantage validation calls.

## Primary denominator

Only rows with `analysis_role=primary_accuracy` enter the 288-case primary accuracy denominator. Pilot and India rows are published for auditability but excluded from that calculation.

## Operational preflight disclosure

Before the paid U.S. pilot began, the first Step Functions execution stopped at the S3 result-existence preflight because the execution role lacked the required bucket-list permission. It stopped before any provider POST, so it incurred no provider cost. Least-privilege access was added, and the same frozen run ID and version were launched under a clearly labeled infrastructure-only retry execution. None of the 20 paid pilot cases were retried, and this event is outside every model denominator.

## Public files

- `all-attempts.csv` and `all-attempts.jsonl`: all 344 sanitized terminal rows.
- `primary-cases.csv`: the 288 U.S. primary rows.
- `pilot-excluded-cases.csv`: the 20 two-region pilot rows.
- `india-latency-cases.csv`: the 36 India network-vantage rows.
- `india-matched-pairs.csv`: paired U.S.-versus-India timing values.
- `failures.csv`: all non-exact terminal states with public-safe stage labels.
- `model-fingerprints.csv`: requested/returned model and fingerprint splits.
- `summary.json`: canonical article metrics.
- `methodology.json`, `protocol.json`, `calibration.json`, and `release-case-inventory.csv`: reproducibility material. The case inventory is sorted for presentation and is not an AWS dispatch log.
- `DATA-DICTIONARY.md` and the top-level `tables/` directory: field definitions and publication tables with explicit numerators and denominators.
- `qa-report.json`, `manifest.json`, `validator-export-manifest.json`, and `checksums.sha256`: publication integrity evidence.

## Important limits

The records are deterministic synthetic English data and strict JSON grading tests a narrow behavior. The India slice labels an AWS client network vantage, not Indian users or provider hosting. Timing is a one-run workload observation, not recurring reliability. Prices are dated.

Token and cost aggregates expose observed and missing row counts. A complete-run token total or cache-miss upper bound is reported only when every row in that group contains the required usage or cost value.

The validator export contains aggregate field counts but not per-field expected and observed values. This release therefore publishes aggregate field diagnostics and does not invent field-level rows.

## Privacy

The public dataset is rebuilt through an explicit allowlist. It excludes credentials, authorization headers, raw prompts, raw responses, object-store keys, local paths, batch identifiers, account IDs, ARNs, and account data.

## License

Dataset and original charts: CC BY 4.0. Code: MIT. Provider names and trademarks belong to their owners.
