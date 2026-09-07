# Public repository assembly contract

This contract governs the local pre-publication assembly process. It does not itself authorize publication.

## Inputs

The assembler requires three explicit local inputs:

1. `--publication-release`: the final production output from the deterministic publication builder.
2. `--benchmark-source`: the frozen `benchmark/` source directory.
3. `--publication-source`: the publication pipeline source directory.

It requires a fourth path, `--output`, which must not already exist. The assembler never writes into the input directories or this skeleton.

Example from the workspace root:

```powershell
node outputs/deepseek-1m-context-benchmark/github-repo-skeleton/tools/assemble-release.mjs `
  --publication-release outputs/deepseek-1m-context-benchmark/publication-release `
  --benchmark-source work/deepseek-1m-context-benchmark/benchmark `
  --publication-source work/deepseek-1m-context-benchmark/publication `
  --output outputs/deepseek-1m-context-benchmark/github-repo-ready-v1.0.0
```

## Accepted publication-release shape

The publication-release input must contain exactly:

```text
charts/
release/
tables/
gutenberg-draft.template.html
template-bindings.required.json
wordpress-metadata.json
```

The checksum set is authoritative. Every source file except `release/checksums.sha256` must be listed in that checksum file. The checksum set must equal the release manifest's file set plus `release/manifest.json`.

The production release must satisfy all of these conditions:

- `release/qa-report.json`: `all_passed: true` and `synthetic_test_data: false`;
- `release/manifest.json`: version `1.0.0`, normal production status, frozen protocol ID, and exact role counts;
- `release/summary.json`: 344 terminal rows split 20/288/36 and `synthetic_test_data: false`;
- exact protocol and calibration hashes;
- exact sanitized public data columns;
- exact CSV/JSONL role counts;
- no synthetic-test marker, raw prompt/response field, credential, cloud identifier, private path, Arabic-script text, or other prohibited pattern;
- every checksum and manifest size/hash entry verifies.

## Curated source allowlist

From the benchmark source, the assembler copies only:

- `README.md`, `PROTOCOL.md`, `protocol.json`, and `calibration.json`;
- the eight files under `harness/`;
- the six files under `tests/`.

From the publication source, it copies only:

- `README.md`, `package.json`, `build_release.mjs`, and `lib.mjs`;
- `tests/build_release.test.mjs`.

It does not copy benchmark sources, tokenizer files, live-contract tools, evidence, AWS code, deployment archives, exported raw evidence, caches, or dependency directories.

## Output

The assembler creates a new local directory, copies the fixed repository documents and tools from this skeleton, imports only the approved final release roots, and copies only the curated source files. It removes `release/NOT-BUILT.md`, changes the root README status from local skeleton to dataset release, then runs ready-mode validation.

If any gate fails, the assembler removes the incomplete output directory. It never initializes Git, creates a remote repository, commits, tags, pushes, binds WordPress, or publishes anything.

## WordPress URL contract

After a separately authorized public GitHub release, the WordPress binder must use these immutable URLs:

```text
REPOSITORY_URL=https://github.com/Seek-Chat/deepseek-1m-context-benchmark
RELEASE_URL=https://github.com/Seek-Chat/deepseek-1m-context-benchmark/releases/tag/v1.0.0
ALL_ATTEMPTS_URL=https://raw.githubusercontent.com/Seek-Chat/deepseek-1m-context-benchmark/v1.0.0/release/all-attempts.csv
PRIMARY_CASES_URL=https://raw.githubusercontent.com/Seek-Chat/deepseek-1m-context-benchmark/v1.0.0/release/primary-cases.csv
INDIA_CASES_URL=https://raw.githubusercontent.com/Seek-Chat/deepseek-1m-context-benchmark/v1.0.0/release/india-latency-cases.csv
SUMMARY_URL=https://raw.githubusercontent.com/Seek-Chat/deepseek-1m-context-benchmark/v1.0.0/release/summary.json
```

No binder URL may point to `main`, contain a query string, or depend on a signed or expiring URL.
