import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { bindTemplate, buildRelease, createScaffold, DEFAULTS, deriveValidatorAggregateForSyntheticQa, PublicationError } from "../lib.mjs";

const MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];
const FAMILIES = ["single_record", "multi_hop_join", "latest_version", "event_ordering"];
const TIERS = ["32k", "128k", "512k", "950k"];
const POSITIONS = ["beginning", "middle", "end"];
const TARGETS = { "32k": 32000, "128k": 128000, "512k": 512000, "950k": 950000 };
const FIELD_COUNTS = { single_record: 6, multi_hop_join: 7, latest_version: 7, event_ordering: 3 };
const SERP_META_DESCRIPTION = "See a reproducible DeepSeek V4 benchmark across 32K–950K prompts, testing retrieval accuracy, multi-hop joins, latency, token use, and real API cost.";
const HEADERS = [
  "protocol_id", "protocol_version", "run_id", "execution_plan_id", "analysis_role", "include_in_primary_accuracy_denominators", "region_vantage", "batch_id", "case_id",
  "model_id", "family_id", "tier_id", "position_id", "repeat", "started_at", "finished_at", "http_status", "transport_complete",
  "finish_reason", "returned_model", "system_fingerprint", "time_to_first_sse_event_ms", "time_to_first_reasoning_token_ms",
  "time_to_first_answer_token_ms", "time_to_end_ms", "prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens", "reasoning_tokens", "valid_json", "exact_keys", "exact_match", "field_accuracy", "matched_fields", "total_fields",
  "grader_errors", "prompt_tier_calibration_passed", "thinking_disabled_violation", "sse_event_count", "sse_parse_error_count", "sse_done_received",
  "stream_error_class", "error_class", "observed_provider_cost_usd_cache_miss_upper_bound", "generator_bundle_sha256", "base_fixture_sha256",
  "execution_salt_sha256", "salted_user_prompt_sha256", "expected_sha256", "request_sha256", "raw_response_sha256", "raw_response_object_key", "result_object_key",
];

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file, rows) {
  fs.writeFileSync(file, `${[HEADERS.join(","), ...rows.map((row) => HEADERS.map((header) => csvCell(row[header])).join(","))].join("\n")}\n`, "utf8");
}

function baseRow({ role, region, model, family, tier, position, repeat, index }) {
  const exact = index % 7 !== 0;
  const totalFields = FIELD_COUNTS[family];
  const matchedFields = exact ? totalFields : totalFields - 1;
  const promptTokens = TARGETS[tier] + repeat * 3;
  const protocolId = "deepseek-v4-long-context-retrieval-v1.1.0";
  const runId = "publication-pipeline-test-run";
  const executionPlanId = "publication-pipeline-plan-v1";
  const fixtureKey = `${family}|${tier}|${position}|${repeat}`;
  const baseHash = digest(`fixture|${fixtureKey}`);
  const executionSalt = digest(`${protocolId}|execution-salt|${role}|${region}|${family}|${tier}|${position}|r${repeat}`);
  const baseCaseId = `${protocolId}:${model}:${family}:${tier}:${position}:r${repeat}`;
  const caseId = role === "pilot_excluded" ? `${baseCaseId}:pilot:${region}:${executionSalt.slice(0, 16)}` : baseCaseId;
  const caseRef = digest(caseId);
  const completionTokens = 20;
  const inputPrice = model.endsWith("flash") ? 0.14 : 0.435;
  const outputPrice = model.endsWith("flash") ? 0.28 : 0.87;
  const cost = Math.ceil((promptTokens * inputPrice + completionTokens * outputPrice) - 1e-12) / 1_000_000;
  return {
    protocol_id: protocolId,
    protocol_version: "1.1.0",
    run_id: runId,
    execution_plan_id: executionPlanId,
    analysis_role: role,
    include_in_primary_accuracy_denominators: role === "primary_accuracy",
    region_vantage: region,
    batch_id: `batch-${role}-${region}`,
    case_id: caseId,
    model_id: model,
    family_id: family,
    tier_id: tier,
    position_id: position,
    repeat,
    started_at: new Date(Date.UTC(2026, 7, 6, 12, 0, 0) + index * 1000).toISOString(),
    finished_at: new Date(Date.UTC(2026, 7, 6, 12, 0, 1) + index * 1000).toISOString(),
    http_status: 200,
    transport_complete: true,
    finish_reason: "stop",
    returned_model: model,
    system_fingerprint: model.endsWith("flash") ? "fp_test_flash" : "fp_test_pro",
    time_to_first_sse_event_ms: 100 + index,
    time_to_first_reasoning_token_ms: "",
    time_to_first_answer_token_ms: 300 + index,
    time_to_end_ms: 800 + index * 3,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: promptTokens,
    reasoning_tokens: 0,
    valid_json: true,
    exact_keys: exact,
    exact_match: exact,
    field_accuracy: matchedFields / totalFields,
    matched_fields: matchedFields,
    total_fields: totalFields,
    grader_errors: exact ? "" : "value_mismatch",
    prompt_tier_calibration_passed: true,
    thinking_disabled_violation: false,
    sse_event_count: 3,
    sse_parse_error_count: 0,
    sse_done_received: true,
    stream_error_class: "",
    error_class: "",
    observed_provider_cost_usd_cache_miss_upper_bound: cost.toFixed(6),
    generator_bundle_sha256: digest("publication-test-generator-bundle"),
    base_fixture_sha256: baseHash,
    execution_salt_sha256: executionSalt,
    salted_user_prompt_sha256: digest(`prompt|${role}|${region}|${fixtureKey}`),
    expected_sha256: digest(`expected|${fixtureKey}`),
    request_sha256: digest(`request|${role}|${region}|${model}|${fixtureKey}`),
    raw_response_sha256: digest(`response|${role}|${region}|${model}|${fixtureKey}`),
    raw_response_object_key: `runs/${runId}/${region}/${caseRef}.response.bin`,
    result_object_key: `results/${runId}/${region}/${caseRef}.json`,
  };
}

function createRows() {
  const rows = [];
  let index = 0;
  for (const model of MODELS) for (const family of FAMILIES) for (const tier of TIERS) for (const position of POSITIONS) for (const repeat of [1, 2, 3]) {
    rows.push(baseRow({ role: "primary_accuracy", region: "us-east-1", model, family, tier, position, repeat, index: index++ }));
  }
  for (const region of ["us-east-1", "ap-south-1"]) for (const model of MODELS) {
    for (const family of FAMILIES) rows.push(baseRow({ role: "pilot_excluded", region, model, family, tier: "32k", position: "middle", repeat: 1, index: index++ }));
    rows.push(baseRow({ role: "pilot_excluded", region, model, family: "single_record", tier: "950k", position: "middle", repeat: 1, index: index++ }));
  }
  for (const model of MODELS) for (const tier of ["32k", "950k"]) for (const position of POSITIONS) for (const repeat of [1, 2, 3]) {
    rows.push(baseRow({ role: "india_latency_validation", region: "ap-south-1", model, family: "single_record", tier, position, repeat, index: index++ }));
  }
  return rows;
}

function makeInput(root, validationOverrides = {}, mutateRows = null) {
  const input = path.join(root, "input");
  fs.mkdirSync(input, { recursive: true });
  const rows = createRows();
  if (mutateRows) mutateRows(rows);
  writeCsv(path.join(input, "results.csv"), rows);
  fs.writeFileSync(path.join(input, "results.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const aggregate = deriveValidatorAggregateForSyntheticQa(rows);
  const counts = (field) => Object.fromEntries([...new Set(rows.map((row) => row[field]))].sort().map((value) => [value, rows.filter((row) => row[field] === value).length]));
  fs.writeFileSync(path.join(input, "summary.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
  fs.writeFileSync(path.join(input, "validation-report.json"), `${JSON.stringify({
    validator_schema_version: "1.0.0",
    protocol_id: "deepseek-v4-long-context-retrieval-v1.1.0",
    protocol_version: "1.1.0",
    mode: "full",
    input_dir: input,
    raw_dir: input,
    expected_result_count: 344,
    discovered_result_count: 344,
    role_counts: counts("analysis_role"),
    region_counts: counts("region_vantage"),
    model_counts: counts("model_id"),
    execution_plan_ids: [rows[0].execution_plan_id],
    integrity_valid: true,
    pilot_accepted: false,
    full_run_complete: true,
    errors: [],
    leak_finding_count: 0,
    aggregate,
    ...validationOverrides,
  }, null, 2)}\n`);
  const validation = JSON.parse(fs.readFileSync(path.join(input, "validation-report.json"), "utf8"));
  const files = {};
  for (const name of ["results.csv", "results.jsonl", "summary.json", "validation-report.json"]) {
    const bytes = fs.readFileSync(path.join(input, name));
    files[name] = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }
  fs.writeFileSync(path.join(input, "validation-export-manifest.json"), `${JSON.stringify({
    manifest_schema_version: "1.0.0",
    protocol_id: "deepseek-v4-long-context-retrieval-v1.1.0",
    protocol_version: "1.1.0",
    validator_schema_version: "1.0.0",
    mode: "full",
    expected_result_count: 344,
    discovered_result_count: 344,
    integrity_valid: validation.integrity_valid,
    pilot_accepted: false,
    full_run_complete: validation.full_run_complete,
    files,
  }, null, 2)}\n`);
  return input;
}

function resealInput(input) {
  const manifestPath = path.join(input, "validation-export-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const name of ["results.csv", "results.jsonl", "summary.json", "validation-report.json"]) {
    const bytes = fs.readFileSync(path.join(input, name));
    manifest.files[name] = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeTarOctal(header, offset, length, value) {
  const encoded = `${value.toString(8).padStart(length - 1, "0")}\0`;
  header.write(encoded, offset, length, "ascii");
}

function trustedArchive(root, input, suffix = "source", extraEntries = []) {
  const names = ["results.csv", "results.jsonl", "summary.json", "validation-export-manifest.json", "validation-report.json"];
  const parts = [];
  const entries = [
    ...names.map((name) => ({ name: `publication-safe/${name}`, bytes: fs.readFileSync(path.join(input, name)) })),
    ...extraEntries,
  ];
  for (const { name, bytes: rawBytes } of entries) {
    const bytes = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, bytes.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    parts.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  const archive = zlib.gzipSync(Buffer.concat(parts), { level: 9, mtime: 0 });
  const sourceArchivePath = path.join(root, `publication-safe-${suffix}.tar.gz`);
  fs.writeFileSync(sourceArchivePath, archive);
  return { sourceArchivePath, expectedArchiveSha256: digest(archive) };
}

function validBindingMap(required) {
  const map = {};
  for (const key of required) {
    if (key.startsWith("DATE_")) map[key] = "2026-08-06";
    else if (/^CH\d{2}_URL$/.test(key)) map[key] = `https://chat-deep.ai/wp-content/uploads/2026/08/${key.toLowerCase()}.png`;
    else if (key === "FEATURED_IMAGE_URL") map[key] = "https://chat-deep.ai/wp-content/uploads/2026/08/deepseek-1m-featured.webp";
    else if (key === "REPOSITORY_URL") map[key] = "https://github.com/chatdeepai/deepseek-1m-context-benchmark";
    else if (key === "RELEASE_URL") map[key] = "https://github.com/chatdeepai/deepseek-1m-context-benchmark/releases/tag/v1.0.0";
    else if (key === "AUTHOR_ID") map[key] = "https://chat-deep.ai/author/caht-deep/";
    else if (key === "PUBLISHER_ID") map[key] = "https://chat-deep.ai/#organization";
    else {
      const basename = {
        ALL_ATTEMPTS_URL: "all-attempts.csv",
        PRIMARY_CASES_URL: "primary-cases.csv",
        INDIA_CASES_URL: "india-latency-cases.csv",
        SUMMARY_URL: "summary.json",
      }[key];
      map[key] = `https://raw.githubusercontent.com/chatdeepai/deepseek-1m-context-benchmark/v1.0.0/release/${basename}`;
    }
  }
  return map;
}

function jsonLdGraph(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/);
  assert.ok(match, "custom JSON-LD graph is missing");
  return JSON.parse(match[1])["@graph"];
}

function testRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("scaffold is visibly blocked and contains no result chart", (t) => {
  const root = testRoot(t, "ds1m-scaffold-");
  const output = path.join(root, "out");
  const gate = createScaffold(output);
  assert.equal(gate.status, "blocked_unrun");
  assert.equal(gate.result_claims_allowed, false);
  const html = fs.readFileSync(path.join(output, "gutenberg-draft.placeholder.html"), "utf8");
  assert.match(html, /Publication blocked/);
  assert.doesNotMatch(html, /<h1\b/i);
  assert.equal(fs.existsSync(path.join(output, "charts")), false);
  const metadata = JSON.parse(fs.readFileSync(path.join(output, "wordpress-metadata.json"), "utf8"));
  assert.equal(metadata.meta_description, SERP_META_DESCRIPTION);
  assert.equal(metadata.meta_description.length, 149);
});

test("release build refuses a validator report that did not pass", (t) => {
  const root = testRoot(t, "ds1m-refuse-");
  const input = makeInput(root, { integrity_valid: false, full_run_complete: false, errors: [{ code: "test" }] });
  const output = path.join(root, "out");
  assert.throws(() => buildRelease({ inputDir: input, outputDir: output, syntheticQa: true }), PublicationError);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes(".staging-")), []);
});

test("release build rejects any results export changed after validator sealing", (t) => {
  const root = testRoot(t, "ds1m-seal-");
  const input = makeInput(root);
  fs.appendFileSync(path.join(input, "results.csv"), "\n");
  assert.throws(() => buildRelease({ inputDir: input, outputDir: path.join(root, "out"), syntheticQa: true }), /validator-emitted export hash/);
  assert.equal(fs.existsSync(path.join(root, "out")), false);
});

test("production build requires the exact out-of-band-pinned publication-safe archive", (t) => {
  const root = testRoot(t, "ds1m-pinned-archive-");
  const input = makeInput(root);
  assert.throws(
    () => buildRelease({ inputDir: input, outputDir: path.join(root, "extracted-input-out") }),
    /must consume the pinned publication-safe archive/,
  );
  const pinned = trustedArchive(root, input, "pinned");
  assert.throws(
    () => buildRelease({ sourceArchivePath: pinned.sourceArchivePath, outputDir: path.join(root, "missing-digest-out") }),
    /out-of-band expectedArchiveSha256/,
  );
  assert.throws(
    () => buildRelease({ ...pinned, expectedArchiveSha256: "0".repeat(64), outputDir: path.join(root, "wrong-digest-out") }),
    /trusted source archive SHA-256 mismatch/,
  );
  const extra = trustedArchive(root, input, "extra", [{ name: "publication-safe/unexpected.txt", bytes: "not allowlisted\n" }]);
  assert.throws(
    () => buildRelease({ ...extra, outputDir: path.join(root, "extra-file-out") }),
    /unexpected path/,
  );
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes(".staging-") || name.includes(".publication-trusted-input-")), []);
});

test("CSV and JSONL parity accepts equivalent numeric spellings but rejects different numbers", (t) => {
  const root = testRoot(t, "ds1m-number-parity-");
  const input = makeInput(root);
  const csvPath = path.join(input, "results.csv");
  const original = fs.readFileSync(csvPath, "utf8");
  const equivalent = original.replace(",true,true,true,1,6,6,", ",true,true,true,1.0,6,6,");
  assert.notEqual(equivalent, original);
  fs.writeFileSync(csvPath, equivalent, "utf8");
  resealInput(input);
  assert.doesNotThrow(() => buildRelease({ inputDir: input, outputDir: path.join(root, "equivalent-output"), syntheticQa: true }));

  const different = equivalent.replace(",true,true,true,1.0,6,6,", ",true,true,true,0.9,6,6,");
  assert.notEqual(different, equivalent);
  fs.writeFileSync(csvPath, different, "utf8");
  resealInput(input);
  assert.throws(() => buildRelease({ inputDir: input, outputDir: path.join(root, "different-output"), syntheticQa: true }), /results\.csv and results\.jsonl differ/);
});

test("release build rejects extra validator-manifest schema fields", (t) => {
  const root = testRoot(t, "ds1m-manifest-schema-");
  const input = makeInput(root);
  const manifestPath = path.join(input, "validation-export-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.unapproved_extra = true;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => buildRelease({ inputDir: input, outputDir: path.join(root, "out"), syntheticQa: true }), /top-level schema is not exact/);
});

test("release build rejects internally invalid packages even when their files are freshly self-sealed", (t) => {
  const root = testRoot(t, "ds1m-invalid-self-sealed-");
  const invalidIdentity = makeInput(path.join(root, "identity"), {}, (rows) => {
    rows.find((row) => row.analysis_role === "india_latency_validation").tier_id = "128k";
  });
  assert.throws(() => buildRelease({ inputDir: invalidIdentity, outputDir: path.join(root, "identity-out"), syntheticQa: true }), /frozen full-run identity grid|does not match its frozen coordinates/);

  const invalidCost = makeInput(path.join(root, "cost"), {}, (rows) => {
    rows.find((row) => row.transport_complete === true).observed_provider_cost_usd_cache_miss_upper_bound = "9.999999";
  });
  assert.throws(() => buildRelease({ inputDir: invalidCost, outputDir: path.join(root, "cost-out"), syntheticQa: true }), /non-reconciling provider-cost estimate/);

  const invalidTimestamp = makeInput(path.join(root, "timestamp"), {}, (rows) => {
    rows[0].finished_at = "2026-08-06T11:59:59.999999Z";
  });
  assert.throws(() => buildRelease({ inputDir: invalidTimestamp, outputDir: path.join(root, "timestamp-out"), syntheticQa: true }), /finished_at precedes started_at/);

  const invalidAggregate = makeInput(path.join(root, "aggregate"));
  const summaryPath = path.join(invalidAggregate, "summary.json");
  const reportPath = path.join(invalidAggregate, "validation-report.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summary.overall.exact_matches += 1;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.aggregate = summary;
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  resealInput(invalidAggregate);
  assert.throws(() => buildRelease({ inputDir: invalidAggregate, outputDir: path.join(root, "aggregate-out"), syntheticQa: true }), /aggregate does not independently reconcile/);

  const invalidMean = makeInput(path.join(root, "mean"));
  const meanSummaryPath = path.join(invalidMean, "summary.json");
  const meanReportPath = path.join(invalidMean, "validation-report.json");
  const meanSummary = JSON.parse(fs.readFileSync(meanSummaryPath, "utf8"));
  meanSummary.overall.latency.end_to_end.mean_ms += 100;
  const meanReport = JSON.parse(fs.readFileSync(meanReportPath, "utf8"));
  meanReport.aggregate = meanSummary;
  fs.writeFileSync(meanSummaryPath, `${JSON.stringify(meanSummary, null, 2)}\n`);
  fs.writeFileSync(meanReportPath, `${JSON.stringify(meanReport, null, 2)}\n`);
  resealInput(invalidMean);
  assert.throws(() => buildRelease({ inputDir: invalidMean, outputDir: path.join(root, "mean-out"), syntheticQa: true }), /mean_ms does not independently reconcile/);
});

test("production article and chart outcomes vary only with sealed validator rows", (t) => {
  const root = testRoot(t, "ds1m-dynamic-results-");
  const firstInput = makeInput(path.join(root, "first"));
  const secondInput = makeInput(path.join(root, "second"), {}, (rows) => {
    const row = rows.find((candidate) => candidate.analysis_role === "primary_accuracy" && candidate.exact_match === true);
    row.exact_match = false;
    row.matched_fields -= 1;
    row.field_accuracy = row.matched_fields / row.total_fields;
    row.grader_errors = "value_mismatch";
  });
  const firstOutput = path.join(root, "first-out");
  const secondOutput = path.join(root, "second-out");
  const first = buildRelease({ inputDir: firstInput, outputDir: firstOutput, syntheticQa: true });
  const second = buildRelease({ inputDir: secondInput, outputDir: secondOutput, syntheticQa: true });
  assert.equal(first.summary.primary_accuracy.exact_matches, second.summary.primary_accuracy.exact_matches + 1);
  assert.notEqual(fs.readFileSync(path.join(firstOutput, "gutenberg-draft.template.html"), "utf8"), fs.readFileSync(path.join(secondOutput, "gutenberg-draft.template.html"), "utf8"));
  const firstTierChart = first.charts.find((chart) => chart.id === "CH01");
  const secondTierChart = second.charts.find((chart) => chart.id === "CH01");
  assert.notEqual(fs.readFileSync(path.join(firstOutput, firstTierChart.data), "utf8"), fs.readFileSync(path.join(secondOutput, secondTierChart.data), "utf8"));
  const cli = fs.readFileSync(fileURLToPath(new URL("../build_release.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(cli, /generate_synthetic_qa|syntheticOutcome|fp_synthetic/);
});

test("failed India transports remain coordinate pairs but never enter paired latency", (t) => {
  const root = testRoot(t, "ds1m-india-");
  const input = makeInput(root, {}, (rows) => {
    const row = rows.find((item) => item.analysis_role === "india_latency_validation");
    row.transport_complete = false;
    row.http_status = 500;
    row.valid_json = false;
    row.exact_keys = false;
    row.exact_match = false;
  });
  const result = buildRelease({ inputDir: input, outputDir: path.join(root, "out"), syntheticQa: true });
  assert.equal(result.summary.india_latency_validation.matched_pairs, 36);
  assert.equal(result.summary.india_latency_validation.transport_complete_timing_pairs, 35);
  assert.equal(result.summary.india_latency_validation.end_to_end_delta_ms.n, 35);
});

test("missing failure usage and cost are never coerced to zero or labeled complete", (t) => {
  const root = testRoot(t, "ds1m-coverage-");
  const input = makeInput(root, {}, (rows) => {
    const row = rows.find((item) => item.analysis_role === "primary_accuracy");
    row.transport_complete = false;
    row.http_status = 503;
    row.prompt_tokens = "";
    row.prompt_cache_hit_tokens = "";
    row.prompt_cache_miss_tokens = "";
    row.completion_tokens = "";
    row.observed_provider_cost_usd_cache_miss_upper_bound = "";
    row.valid_json = false;
    row.exact_keys = false;
    row.exact_match = false;
  });
  const output = path.join(root, "out");
  const result = buildRelease({ inputDir: input, outputDir: output, syntheticQa: true });
  assert.equal(result.summary.primary_accuracy.cost_observed_rows, 287);
  assert.equal(result.summary.primary_accuracy.cost_missing_rows, 1);
  assert.equal(result.summary.primary_accuracy.cost_coverage_complete, false);
  assert.equal(result.summary.primary_accuracy.estimated_provider_cost_usd_cache_miss_upper_bound, null);
  assert.ok(result.summary.primary_accuracy.estimated_provider_cost_usd_cache_miss_known_usage_total > 0);
  assert.equal(result.summary.primary_accuracy.usage_observed_rows, 287);
  assert.equal(result.summary.primary_accuracy.usage_missing_rows, 1);
  assert.equal(result.summary.primary_accuracy.prompt_tokens, null);
  const article = fs.readFileSync(path.join(output, "gutenberg-draft.template.html"), "utf8");
  assert.match(article, /1 rows had no cost value, so no full-group upper bound is reported/);
  const roleTable = fs.readFileSync(path.join(output, "tables", "analysis-role-summary.csv"), "utf8");
  assert.match(roleTable, /cost_observed_rows,cost_missing_rows,cost_coverage_complete/);
  const ch07 = result.charts.find((chart) => chart.id === "CH07");
  assert.match(fs.readFileSync(path.join(output, ch07.data), "utf8"), /PRIMARY N287\/288/);
});

test("release build reconciles rows, creates public data, charts, article template, and bind-ready output", (t) => {
  const root = testRoot(t, "ds1m-release-");
  const input = makeInput(root);
  const output = path.join(root, "out");
  const pinned = trustedArchive(root, input);
  const result = buildRelease({ ...pinned, outputDir: output, releaseVersion: "test-1.0.0" });
  assert.equal(result.qa.all_passed, true);
  assert.equal(result.qa.wordpress_ready, false);
  assert.equal(result.qa.checks.production_source_archive_gate_passed, true);
  assert.equal(result.qa.trusted_source_archive_sha256, pinned.expectedArchiveSha256);
  assert.equal(result.manifest.trusted_source_archive_sha256, pinned.expectedArchiveSha256);
  assert.equal(result.summary.source_hashes.publication_safe_archive_sha256, pinned.expectedArchiveSha256);
  assert.equal(result.summary.counts.terminal_rows, 344);
  assert.equal(result.summary.primary_accuracy.attempts, 288);
  assert.equal(result.summary.primary_accuracy.paired_flash_vs_pro.complete_pairs, 144);
  assert.equal(result.summary.india_latency_validation.matched_pairs, 36);
  assert.match(result.summary.interpretation_boundaries.join(" "), /primary accuracy denominator/);
  assert.equal(result.charts.length, 11);
  for (const chart of result.charts) {
    const png = fs.readFileSync(path.join(output, chart.png));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.match(fs.readFileSync(path.join(output, chart.svg), "utf8"), /<svg/);
  }
  const indiaLatencyChart = result.charts.find((chart) => chart.id === "CH10");
  const indiaLatencyData = fs.readFileSync(path.join(output, indiaLatencyChart.data), "utf8");
  assert.doesNotMatch(indiaLatencyData, /\bN0\b|,,ms/);
  assert.equal((indiaLatencyData.match(/\bN9\b/g) ?? []).length, 4);
  const metadata = JSON.parse(fs.readFileSync(path.join(output, "wordpress-metadata.json"), "utf8"));
  assert.deepEqual(metadata.tags, []);
  assert.equal(metadata.meta_description, SERP_META_DESCRIPTION);
  assert.equal(metadata.meta_description.length, 149);
  assert.equal(metadata.ads.instruction, "preserve_existing");
  assert.equal(metadata.images.rendered_width_percent, 75);
  const template = fs.readFileSync(path.join(output, "gutenberg-draft.template.html"), "utf8");
  assert.doesNotMatch(template, /<h1\b/i);
  assert.doesNotMatch(template, /<a\b[^>]*>\s*<img\b/i);
  assert.match(template, /documented 384K maximum output/);
  assert.match(template, /study's request contract capped each generated answer at 256 tokens/);
  assert.doesNotMatch(template, /256-token output ceiling|pilot-us-\d{8}-\d{3}-retry\d+/i);
  assert.equal((template.match(/<figure class="wp-block-image aligncenter size-full" style="width:75%">/g) ?? []).length, 11);
  const templateGraph = jsonLdGraph(template);
  const templateArticle = templateGraph.find((node) => node["@type"] === "TechArticle");
  const templatePerson = templateGraph.find((node) => node["@type"] === "Person");
  const templateOrganization = templateGraph.find((node) => node["@type"] === "Organization");
  assert.equal(templateGraph.filter((node) => node["@type"] === "Person").length, 1);
  assert.equal(templateGraph.filter((node) => node["@type"] === "Organization").length, 1);
  assert.equal(templateArticle.description, SERP_META_DESCRIPTION);
  assert.deepEqual(templateArticle.author, { "@id": "{{AUTHOR_ID}}" });
  assert.deepEqual(templateArticle.publisher, { "@id": "{{PUBLISHER_ID}}" });
  assert.deepEqual(templatePerson, { "@type": "Person", "@id": "{{AUTHOR_ID}}", name: "Chat Deep AI", url: "{{AUTHOR_ID}}" });
  assert.equal(templateOrganization["@id"], "{{PUBLISHER_ID}}");
  assert.equal(templateOrganization.name, "Chat-Deep.ai");
  assert.equal(templateOrganization.url, "https://chat-deep.ai/");
  assert.deepEqual(templateOrganization.logo, { "@type": "ImageObject", "@id": "https://chat-deep.ai/#logo", url: "https://chat-deep.ai/wp-content/uploads/2026/01/deep-ai-logo.png", contentUrl: "https://chat-deep.ai/wp-content/uploads/2026/01/deep-ai-logo.png", width: 765, height: 267 });
  assert.equal(fs.readFileSync(path.join(output, "release", "all-attempts.csv"), "utf8").trim().split("\n").length, 345);
  const releaseReadme = fs.readFileSync(path.join(output, "release", "README.md"), "utf8");
  assert.doesNotMatch(releaseReadme, /pilot-us-\d{8}-\d{3}-retry\d+/i);
  const methodology = JSON.parse(fs.readFileSync(path.join(output, "release", "methodology.json"), "utf8"));
  assert.deepEqual(methodology.documented_model_limits_at_protocol_freeze, {
    source: "https://api-docs.deepseek.com/quick_start/pricing/",
    context_capacity: "1M",
    maximum_output: "384K",
  });
  assert.equal(methodology.study_generation_cap.max_tokens_per_request, 256);
  assert.equal(methodology.operational_preflight_disclosure.retry_execution_label_published, false);
  assert.doesNotMatch(JSON.stringify(methodology), /pilot-us-\d{8}-\d{3}-retry\d+/i);
  const checksums = fs.readFileSync(path.join(output, "release", "checksums.sha256"), "utf8");
  assert.match(checksums, /release\/summary\.json/);
  assert.equal(checksums.trim().split(/\r?\n/).length, 69);
  const ch10 = result.charts.find((chart) => chart.id === "CH10");
  assert.match(fs.readFileSync(path.join(output, ch10.data), "utf8"), /,ms\r?\n/);
  const ch06 = result.charts.find((chart) => chart.id === "CH06");
  const ch06Data = fs.readFileSync(path.join(output, ch06.data), "utf8");
  assert.match(ch06Data, /FIRST P50/);
  assert.match(ch06Data, /,ms\r?\n/);
  assert.match(ch06Data, /F32 N36/);
  const ch01 = result.charts.find((chart) => chart.id === "CH01");
  const ch01Svg = fs.readFileSync(path.join(output, ch01.svg), "utf8");
  assert.match(ch01Svg, />100%<\/text>/);
  assert.doesNotMatch(ch01Svg, />112%<\/text>/);

  const required = JSON.parse(fs.readFileSync(path.join(output, "template-bindings.required.json"), "utf8")).placeholders;
  const map = validBindingMap(required);
  const mediaMap = path.join(root, "media-map.json");
  fs.writeFileSync(mediaMap, `${JSON.stringify(map, null, 2)}\n`);
  const signedMap = { ...map, CH00_URL: "https://chat-deep.ai/chart.png?X-Amz-Signature=secret" };
  const signedMapPath = path.join(root, "signed-map.json");
  fs.writeFileSync(signedMapPath, `${JSON.stringify(signedMap, null, 2)}\n`);
  const signedOutput = path.join(output, "wordpress-ready", "should-not-exist.html");
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap: signedMapPath, output: signedOutput }), /query string or signed token/);
  assert.equal(fs.existsSync(signedOutput), false);
  const injectionMapPath = path.join(root, "injection-map.json");
  fs.writeFileSync(injectionMapPath, `${JSON.stringify({ ...map, CH00_URL: 'https://chat-deep.ai/wp-content/uploads/2026/08/chart.png" onerror="alert(1)' }, null, 2)}\n`);
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap: injectionMapPath, output: path.join(output, "wordpress-ready", "injection.html") }), /unsafe URL character/);
  const badDateMapPath = path.join(root, "bad-date-map.json");
  fs.writeFileSync(badDateMapPath, `${JSON.stringify({ ...map, DATE_MODIFIED: "2026-02-30" }, null, 2)}\n`);
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap: badDateMapPath, output: path.join(output, "wordpress-ready", "bad-date.html") }), /real ISO calendar date/);
  const wwwEntityMapPath = path.join(root, "www-entity-map.json");
  fs.writeFileSync(wwwEntityMapPath, `${JSON.stringify({ ...map, AUTHOR_ID: "https://www.chat-deep.ai/author/caht-deep/" }, null, 2)}\n`);
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap: wwwEntityMapPath, output: path.join(output, "wordpress-ready", "www-entity.html") }), /live chat-deep.ai Person entity URL/);
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap, output: path.join(output, "outside-dedicated.html") }), /must be under wordpress-ready/);
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap, output: path.join(output, "gutenberg-draft.template.html") }), /must not overwrite/);
  const checksumsPath = path.join(output, "release", "checksums.sha256");
  const originalChecksums = fs.readFileSync(checksumsPath, "utf8");
  fs.writeFileSync(checksumsPath, `${originalChecksums.trim().split(/\r?\n/).slice(1).join("\n")}\n`);
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap, output: path.join(output, "wordpress-ready", "missing-checksum.html") }), /checksum path set does not exactly match/);
  fs.writeFileSync(checksumsPath, originalChecksums);
  const ready = path.join(output, "wordpress-ready", "gutenberg-draft.ready.html");
  const qa = bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap, output: ready });
  assert.equal(qa.ready_for_wordpress_draft, true);
  const readyHtml = fs.readFileSync(ready, "utf8");
  assert.doesNotMatch(readyHtml, /\{\{/);
  const readyGraph = jsonLdGraph(readyHtml);
  const readyArticle = readyGraph.find((node) => node["@type"] === "TechArticle");
  const readyPerson = readyGraph.find((node) => node["@type"] === "Person");
  const readyOrganization = readyGraph.find((node) => node["@type"] === "Organization");
  assert.equal(readyPerson["@id"], "https://chat-deep.ai/author/caht-deep/");
  assert.equal(readyPerson.url, readyPerson["@id"]);
  assert.equal(readyOrganization["@id"], "https://chat-deep.ai/#organization");
  assert.equal(readyArticle.author["@id"], readyPerson["@id"]);
  assert.equal(readyArticle.publisher["@id"], readyOrganization["@id"]);
  assert.throws(() => bindTemplate({ template: path.join(output, "gutenberg-draft.template.html"), mediaMap, output: ready }), /must not already exist/);
});

test("binding refuses a template that no longer matches the passed release manifest", (t) => {
  const root = testRoot(t, "ds1m-bind-seal-");
  const input = makeInput(root);
  const output = path.join(root, "out");
  buildRelease({ ...trustedArchive(root, input), outputDir: output });
  const template = path.join(output, "gutenberg-draft.template.html");
  fs.appendFileSync(template, "<!-- changed after QA -->\n");
  const mediaMap = path.join(root, "map.json");
  fs.writeFileSync(mediaMap, "{}\n");
  assert.throws(() => bindTemplate({ template, mediaMap, output: path.join(output, "ready.html") }), /release manifest verification failed|does not match the passed release manifest/);
  assert.equal(fs.existsSync(path.join(output, "ready.html")), false);
});
