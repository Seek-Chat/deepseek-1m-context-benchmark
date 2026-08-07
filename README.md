# DeepSeek 1M Context Benchmark

> **Dataset release v1.0.0. All result files are sanitized, checksum-bound, and generated from the frozen protocol.**

This repository is the public home of the reproducible **DeepSeek 1M Context Benchmark: Retrieval Accuracy, Latency, and Cost**. The study compares `deepseek-v4-flash` and `deepseek-v4-pro` on deterministic English retrieval and synthesis tasks across provider-counted prompt tiers from 32K to approximately 950K tokens.

The canonical article URL is reserved at:

<https://chat-deep.ai/research/deepseek-1m-context-benchmark/>

## Study design

The frozen primary matrix contains:

- two exact model IDs;
- four task families: single-record retrieval, multi-hop join, latest-version resolution, and event ordering;
- four prompt tiers: 32K, 128K, 512K, and approximately 950K;
- three target positions: beginning, middle, and end;
- three deterministic repeats;
- one paid attempt per case with no automatic retry.

The complete execution plan contains 344 terminal records:

| Analysis role | Records | Primary accuracy denominator |
|---|---:|---|
| Excluded two-region pilot | 20 | No |
| U.S. primary accuracy | 288 | Yes |
| India network-vantage validation | 36 | No |

The India label identifies an AWS client network vantage point. It does not represent Indian users, establish model-hosting location, or measure recurring regional reliability.

## Frozen authority

- Protocol ID: `deepseek-v4-long-context-retrieval-v1.1.0`
- Protocol SHA-256: `39c68bfc607157011012dc47d59524dcf3d5d7155071e6862c5038410d642c16`
- Calibration SHA-256: `0d8265a9f74bb39d9b1947e90e041dc330dcdb9b445d2d82a27da378f3bd88b2`
- Frozen tokenizer SHA-256: `8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf`

`benchmark/protocol.json` is the scientific source of truth. Any change to prompts, fixtures, model IDs, task families, context tiers, target positions, repeats, request controls, grading, exclusions, or attempts requires a new protocol boundary.

## What release v1.0.0 contains

Release `v1.0.0` contains:

- 344 sanitized terminal rows in CSV and JSONL;
- a 288-row primary accuracy cohort;
- 20 excluded pilot rows;
- 36 India network-vantage rows and their valid matched U.S. pairs;
- failure-stage and model-fingerprint tables;
- a canonical machine-readable summary;
- the frozen protocol, calibration, methodology, dated prices, and data dictionary;
- original chart-source CSVs, SVGs, and PNGs;
- generated analysis tables;
- release QA, manifest, and SHA-256 checksums;
- the network-free benchmark harness and deterministic publication builder.

Raw prompts, raw request bodies, raw SSE streams, provider response bodies, credentials, cloud identifiers, object-store locations, private paths, and account data are never public.

## Repository map

```text
benchmark/   Frozen protocol, calibration, network-free harness, and tests
publication/ Deterministic public-release builder and tests
release/     Sanitized datasets, methodology, QA, manifest, and checksums
charts/      Original chart data, SVGs, and PNGs
tables/      Generated publication tables
tools/       Local-only assembly and public-repository validation tools
```

Release `v1.0.0` was assembled only after the production validator, non-synthetic status, sealed checksums, frozen hashes, row counts, and privacy gates passed.

## Reproduction boundary

The checked-in harness is network-free. It generates deterministic fixtures, verifies calibration, performs conservative cost preflight, and grades captured outputs. It does not read credentials or call the DeepSeek API.

```powershell
python -m harness preflight
python -m harness manifest
python -m harness calibrate --check
python -m unittest discover -s tests -v
```

Run these commands from `benchmark/` after obtaining the tokenizer independently and verifying its frozen SHA-256. The tokenizer is not redistributed in this repository unless its redistribution rights and required notices are separately verified.

## Data integrity

From the repository root, verify the sealed result release with:

```powershell
Get-Content release/checksums.sha256 | ForEach-Object {
  $hash, $file = $_ -split '  ', 2
  if ((Get-FileHash -Algorithm SHA256 $file).Hash.ToLower() -ne $hash) {
    throw "Checksum mismatch: $file"
  }
}
```

The repository validation tool also checks structure, row counts, public field allowlists, hashes, licenses, private-data patterns, and synthetic-test blockers.

## Interpretation limits

- Synthetic English records are not production traffic.
- Strict exact JSON tests a narrow behavior rather than general model quality.
- The approximately 950K tier is not one million input tokens.
- One attempt preserves failures but produces finite samples.
- Small subgroups require visible sample-size warnings.
- Latency includes both network and service effects from the stated client vantage.
- Prices, routing, and system fingerprints are dated observations and can change.
- Pilot rows are excluded from every primary accuracy denominator.

## Infrastructure preflight disclosure

Before provider dispatch, an initial orchestration execution stopped at the object-existence preflight because the execution role lacked the required bucket-list permission. It stopped before any provider request and incurred zero provider cost. Least-privilege access was corrected before the paid pilot; no paid benchmark case was retried because of this event.

## Citation

Use `CITATION.cff` for the repository citation. Cite the article, dataset version, protocol ID, and release tag together. Do not cite an unsealed development output or any synthetic pipeline-test package as measured evidence.

## Licenses

- Original code: MIT License, see `LICENSE`.
- Sanitized dataset and original charts: Creative Commons Attribution 4.0 International, see `LICENSE-DATA.md`.
- Third-party names, trademarks, documentation, model artifacts, and tokenizer files are not relicensed; see `NOTICE.md`.

## Security and privacy

See `SECURITY.md`. Do not open a public issue containing a credential, private URL, raw provider output, account identifier, or other sensitive material.
