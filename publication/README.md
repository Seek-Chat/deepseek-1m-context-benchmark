# DeepSeek 1M Context Benchmark publication pipeline

This network-free pipeline turns the benchmark validator's sanitized exports into a public data release, original charts, result tables, and a Gutenberg article template. It never reads raw prompts, raw provider responses, credentials, AWS resources, or WordPress.

## Safety boundary

Production `build` refuses to create result-bearing artifacts unless it receives the original deterministic `publication-safe.tar.gz` and the archive's expected lowercase SHA-256 copied out of band from the trusted CloudShell exporter output. The adjacent `.sha256` download is useful for transport checks but is not the trust root. The archive must contain exactly these files under `publication-safe/`:

- `results.csv`
- `results.jsonl`
- `summary.json`
- `validation-report.json`
- `validation-export-manifest.json`

The builder verifies the pinned archive bytes, bounded gzip stream, ustar header checksums, exact allowlisted paths, regular-file types, zero padding, and two-block terminator before it materializes a private temporary input directory. It never accepts an extracted input directory in production mode. The validation report must say `mode: full`, `integrity_valid: true`, and `full_run_complete: true`. The validator-emitted export manifest must bind the exact byte size and SHA-256 of all four exports. CSV and JSONL rows must match field by field and use the exact validator v1.0.0 public-safe schema. The builder independently revalidates the frozen 344-case identity grid, case IDs, salts, hashes, pair linkage, booleans, canonical UTC timestamps and ordering, timings, grader arithmetic, token arithmetic, cost arithmetic, execution-plan identity, report counts, and aggregate counts/rates/totals/percentiles. Validator `mean_ms` values are also recomputed from rows and may differ by at most 0.01 ms to accommodate Python-versus-JavaScript decimal tie rounding; they are not blindly trusted. This remains fail-closed even when an invalid package has been freshly self-sealed, because production additionally requires the independently captured archive digest.

The public release is rebuilt through an explicit field allowlist. After those release files are written, the article, tables, and charts deliberately read back only `release/summary.json`, `release/primary-cases.csv`, and `release/india-matched-pairs.csv`; they do not consume raw inputs, private object keys, synthetic constants, or a separate output tree.

The chart definitions are package-local in `lib.mjs`; the build has no dependency on the repository's `outputs/` tree. It verifies the package-local frozen protocol and calibration by their fixed SHA-256 values.

`scaffold` is safe before execution. It creates a visibly blocked, result-free draft and a machine-readable gate-status file. It creates no chart that could be mistaken for a result.

## Commands

Use Node.js 20 or newer from this directory.

```powershell
node build_release.mjs scaffold `
  --output-dir ../../../outputs/deepseek-1m-context-benchmark/publication-scaffold
```

After the full validator passes:

```powershell
node build_release.mjs build `
  --source-archive ../aws/artifacts/downloaded-safe-archive/publication-safe.tar.gz `
  --expected-archive-sha256 <LOWERCASE_SHA256_COPIED_FROM_TRUSTED_CLOUDSHELL_OUTPUT> `
  --output-dir ../../../outputs/deepseek-1m-context-benchmark/publication-release `
  --release-version 1.0.0
```

The output contains:

- a public allowlisted dataset bundle under `release/`;
- ten result charts plus one design chart in SVG and PNG;
- chart-source CSVs;
- generated result tables;
- `gutenberg-draft.template.html`;
- `wordpress-metadata.json` with no tags and an explicit preserve-ads instruction;
- a release manifest, QA report, and SHA-256 checksums.

The Gutenberg template deliberately contains media and download placeholders. Upload the full-size chart PNGs to WordPress, then provide a JSON map and run `bind`:

```json
{
  "CH00_URL": "https://seek-chat.com/wp-content/uploads/.../design.png",
  "CH01_URL": "https://seek-chat.com/wp-content/uploads/.../tier.png",
  "CH02_URL": "https://seek-chat.com/wp-content/uploads/.../family.png",
  "CH03_URL": "https://seek-chat.com/wp-content/uploads/.../position.png",
  "CH04_URL": "https://seek-chat.com/wp-content/uploads/.../pairs.png",
  "CH05_URL": "https://seek-chat.com/wp-content/uploads/.../diagnostics.png",
  "CH06_URL": "https://seek-chat.com/wp-content/uploads/.../latency.png",
  "CH07_URL": "https://seek-chat.com/wp-content/uploads/.../cost.png",
  "CH08_URL": "https://seek-chat.com/wp-content/uploads/.../funnel.png",
  "CH09_URL": "https://seek-chat.com/wp-content/uploads/.../tokens.png",
  "CH10_URL": "https://seek-chat.com/wp-content/uploads/.../india.png",
  "REPOSITORY_URL": "https://github.com/Seek-Chat/deepseek-1m-context-benchmark",
  "RELEASE_URL": "https://github.com/Seek-Chat/deepseek-1m-context-benchmark/releases/tag/v1.0.0",
  "ALL_ATTEMPTS_URL": "https://raw.githubusercontent.com/.../all-attempts.csv",
  "PRIMARY_CASES_URL": "https://raw.githubusercontent.com/.../primary-cases.csv",
  "INDIA_CASES_URL": "https://raw.githubusercontent.com/.../india-latency-cases.csv",
  "SUMMARY_URL": "https://raw.githubusercontent.com/.../summary.json",
  "DATE_PUBLISHED": "2026-08-06",
  "DATE_MODIFIED": "2026-08-06",
  "FEATURED_IMAGE_URL": "https://seek-chat.com/wp-content/uploads/.../featured.webp",
  "AUTHOR_ID": "https://seek-chat.com/author/caht-deep/",
  "PUBLISHER_ID": "https://seek-chat.com/#organization"
}
```

```powershell
node build_release.mjs bind `
  --template ../../../outputs/deepseek-1m-context-benchmark/publication-release/gutenberg-draft.template.html `
  --media-map media-map.json `
  --output ../../../outputs/deepseek-1m-context-benchmark/publication-release/wordpress-ready/gutenberg-draft.ready.html
```

`bind` first verifies the passed release QA, manifest, template hash, and every checksum. It then fails on a missing or extra placeholder, a non-canonical date, an unsafe or incorrectly scoped URL, any linked image, any image width other than 75%, any Arabic-script character, an unresolved token, or a privacy pattern. Output inside the sealed release must be a new file under `wordpress-ready/`; neither the HTML nor its QA sidecar may already exist. It does not log in to WordPress or publish.

## Public-data contract

The release reconstructs rows through an explicit allowlist. It excludes validator-local paths, S3 object keys, batch IDs, raw content, and raw SSE data. The current sanitized validator export contains aggregate field counts but not per-field expected or observed values, so this pipeline publishes aggregate field diagnostics rather than inventing field-level rows.

The article body is English only. It contains no body-level H1, no WordPress tags, no linked images, and every image block uses the full source at a centered 75% rendered width. Existing ad settings are not changed by this pipeline.
