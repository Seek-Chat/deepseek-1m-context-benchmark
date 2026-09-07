import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_ROOT = path.resolve(HERE, "..");

export const DEFAULTS = Object.freeze({
  protocol: path.join(BENCHMARK_ROOT, "benchmark", "protocol.json"),
  calibration: path.join(BENCHMARK_ROOT, "benchmark", "calibration.json"),
  canonicalUrl: "https://seek-chat.com/research/deepseek-1m-context-benchmark/",
  researchHubUrl: "https://seek-chat.com/research/",
});

const EXPECTED_PROTOCOL_ID = "deepseek-v4-long-context-retrieval-v1.1.0";
const EXPECTED_PROTOCOL_SHA256 = "39c68bfc607157011012dc47d59524dcf3d5d7155071e6862c5038410d642c16";
const EXPECTED_CALIBRATION_SHA256 = "0d8265a9f74bb39d9b1947e90e041dc330dcdb9b445d2d82a27da378f3bd88b2";
const SERP_META_DESCRIPTION = "See a reproducible DeepSeek V4 benchmark across 32K–950K prompts, testing retrieval accuracy, multi-hop joins, latency, token use, and real API cost.";
const EXPECTED_COUNTS = Object.freeze({
  all: 344,
  pilot_excluded: 20,
  primary_accuracy: 288,
  india_latency_validation: 36,
});
const TRUSTED_ARCHIVE_FILES = Object.freeze([
  "results.csv",
  "results.jsonl",
  "summary.json",
  "validation-export-manifest.json",
  "validation-report.json",
]);
const TRUSTED_ARCHIVE_PREFIX = "publication-safe/";
const MAX_TRUSTED_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_TRUSTED_ARCHIVE_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];
const FAMILIES = ["single_record", "multi_hop_join", "latest_version", "event_ordering"];
const TIERS = ["32k", "128k", "512k", "950k"];
const POSITIONS = ["beginning", "middle", "end"];
const EXPECTED_FIELD_COUNTS = Object.freeze({ single_record: 6, multi_hop_join: 7, latest_version: 7, event_ordering: 3 });

// This is the exact public-safe CSV schema emitted by validator v1.0.0. Raw
// object keys are accepted only at the sealed input boundary and are never
// copied into the public release.
const VALIDATOR_COLUMNS = [
  "protocol_id",
  "protocol_version",
  "run_id",
  "execution_plan_id",
  "analysis_role",
  "include_in_primary_accuracy_denominators",
  "region_vantage",
  "batch_id",
  "case_id",
  "model_id",
  "family_id",
  "tier_id",
  "position_id",
  "repeat",
  "started_at",
  "finished_at",
  "http_status",
  "transport_complete",
  "finish_reason",
  "returned_model",
  "system_fingerprint",
  "time_to_first_sse_event_ms",
  "time_to_first_reasoning_token_ms",
  "time_to_first_answer_token_ms",
  "time_to_end_ms",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens",
  "reasoning_tokens",
  "valid_json",
  "exact_keys",
  "exact_match",
  "field_accuracy",
  "matched_fields",
  "total_fields",
  "grader_errors",
  "prompt_tier_calibration_passed",
  "thinking_disabled_violation",
  "sse_event_count",
  "sse_parse_error_count",
  "sse_done_received",
  "stream_error_class",
  "error_class",
  "observed_provider_cost_usd_cache_miss_upper_bound",
  "generator_bundle_sha256",
  "base_fixture_sha256",
  "execution_salt_sha256",
  "salted_user_prompt_sha256",
  "expected_sha256",
  "request_sha256",
  "raw_response_sha256",
  "raw_response_object_key",
  "result_object_key",
];

const VALIDATION_REPORT_KEYS = [
  "validator_schema_version",
  "protocol_id",
  "protocol_version",
  "mode",
  "input_dir",
  "raw_dir",
  "expected_result_count",
  "discovered_result_count",
  "role_counts",
  "region_counts",
  "model_counts",
  "execution_plan_ids",
  "integrity_valid",
  "pilot_accepted",
  "full_run_complete",
  "errors",
  "leak_finding_count",
  "aggregate",
];

const PUBLIC_COLUMNS = [
  "protocol_id",
  "protocol_version",
  "analysis_role",
  "include_in_primary_accuracy_denominators",
  "region_vantage",
  "case_id",
  "public_case_uid",
  "model_id",
  "family_id",
  "tier_id",
  "position_id",
  "repeat",
  "started_at",
  "finished_at",
  "http_status",
  "transport_complete",
  "finish_reason",
  "returned_model",
  "system_fingerprint",
  "time_to_first_sse_event_ms",
  "time_to_first_reasoning_token_ms",
  "time_to_first_answer_token_ms",
  "time_to_end_ms",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens",
  "reasoning_tokens",
  "valid_json",
  "exact_keys",
  "exact_match",
  "field_accuracy",
  "matched_fields",
  "total_fields",
  "grader_errors",
  "prompt_tier_calibration_passed",
  "thinking_disabled_violation",
  "sse_event_count",
  "sse_parse_error_count",
  "sse_done_received",
  "stream_error_class",
  "error_class",
  "observed_provider_cost_usd_cache_miss_upper_bound",
  "generator_bundle_sha256",
  "base_fixture_sha256",
  "execution_salt_sha256",
  "salted_user_prompt_sha256",
  "expected_sha256",
  "request_sha256",
  "raw_response_sha256",
];

const COLORS = ["#2563eb", "#f97316", "#14b8a6", "#7c3aed", "#dc2626", "#64748b"];

export class PublicationError extends Error {}

function ensure(condition, message) {
  if (!condition) throw new PublicationError(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function tarText(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  if (nul !== -1) ensure(field.subarray(nul).every((byte) => byte === 0), "trusted source archive contains non-zero bytes after a tar text terminator");
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function tarOctal(block, offset, length, field) {
  const raw = block.subarray(offset, offset + length).toString("ascii").replace(/[\0 ]+$/g, "").replace(/^ +/g, "");
  ensure(/^[0-7]+$/.test(raw), `trusted archive ${field} is not canonical octal`);
  const value = Number.parseInt(raw, 8);
  ensure(Number.isSafeInteger(value) && value >= 0, `trusted archive ${field} is outside the accepted range`);
  return value;
}

function readPinnedPublicationArchive(sourceArchivePath, expectedArchiveSha256) {
  ensure(sourceArchivePath, "production build requires sourceArchivePath");
  ensure(/^[0-9a-f]{64}$/.test(expectedArchiveSha256 ?? ""), "production build requires a lowercase out-of-band expectedArchiveSha256");
  ensure(fs.existsSync(sourceArchivePath) && fs.statSync(sourceArchivePath).isFile(), `trusted source archive is missing: ${sourceArchivePath}`);
  const archiveSize = fs.statSync(sourceArchivePath).size;
  ensure(archiveSize > 0 && archiveSize <= MAX_TRUSTED_ARCHIVE_BYTES, "trusted source archive is empty or exceeds the size limit");
  const archiveBytes = fs.readFileSync(sourceArchivePath);
  const archiveSha256 = sha256Buffer(archiveBytes);
  ensure(archiveSha256 === expectedArchiveSha256, `trusted source archive SHA-256 mismatch: expected ${expectedArchiveSha256}, received ${archiveSha256}`);

  let tar;
  try {
    tar = zlib.gunzipSync(archiveBytes, { maxOutputLength: MAX_TRUSTED_ARCHIVE_UNCOMPRESSED_BYTES });
  } catch (error) {
    throw new PublicationError(`trusted source archive is not a bounded valid gzip stream: ${error.message}`);
  }
  ensure(tar.length >= 1024 && tar.length % 512 === 0, "trusted source archive has an invalid tar length");
  const expectedPaths = new Set(TRUSTED_ARCHIVE_FILES.map((name) => `${TRUSTED_ARCHIVE_PREFIX}${name}`));
  const files = new Map();
  let foundEnd = false;
  let totalPayloadBytes = 0;
  for (let offset = 0; offset < tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ensure(offset + 1024 <= tar.length && tar.subarray(offset + 512, offset + 1024).every((byte) => byte === 0), "trusted source archive is missing the two-block tar terminator");
      ensure(tar.subarray(offset).every((byte) => byte === 0), "trusted source archive contains data after its tar terminator");
      foundEnd = true;
      break;
    }
    const storedChecksum = tarOctal(header, 148, 8, "header checksum");
    let computedChecksum = 0;
    for (let index = 0; index < 512; index += 1) computedChecksum += index >= 148 && index < 156 ? 32 : header[index];
    ensure(storedChecksum === computedChecksum, "trusted source archive contains a tar header checksum mismatch");
    ensure(tarText(header, 257, 6) === "ustar" && tarText(header, 263, 2) === "00", "trusted source archive must use the frozen ustar format");
    ensure(header[156] === 0 || header[156] === 48, "trusted source archive may contain regular files only");
    ensure(tarText(header, 157, 100) === "", "trusted source archive may not contain links");
    const prefix = tarText(header, 345, 155);
    const name = tarText(header, 0, 100);
    const archivePath = prefix ? `${prefix}/${name}` : name;
    ensure(expectedPaths.has(archivePath), `trusted source archive contains an unexpected path: ${archivePath}`);
    ensure(!files.has(archivePath), `trusted source archive contains a duplicate path: ${archivePath}`);
    const size = tarOctal(header, 124, 12, `${archivePath} size`);
    totalPayloadBytes += size;
    ensure(totalPayloadBytes <= MAX_TRUSTED_ARCHIVE_UNCOMPRESSED_BYTES, "trusted source archive payload exceeds the size limit");
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    ensure(dataEnd <= tar.length, `trusted source archive truncates ${archivePath}`);
    files.set(archivePath, Buffer.from(tar.subarray(dataStart, dataEnd)));
    const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
    ensure(tar.subarray(dataEnd, paddedEnd).every((byte) => byte === 0), `trusted source archive contains non-zero padding after ${archivePath}`);
    offset = paddedEnd;
  }
  ensure(foundEnd, "trusted source archive has no tar terminator");
  ensure(files.size === expectedPaths.size && [...expectedPaths].every((name) => files.has(name)), "trusted source archive does not contain the exact publication-safe file set");
  return { archiveSha256, files };
}

function materializePinnedPublicationArchive(sourceArchivePath, expectedArchiveSha256, parentDirectory) {
  const trusted = readPinnedPublicationArchive(sourceArchivePath, expectedArchiveSha256);
  const inputDir = fs.mkdtempSync(path.join(parentDirectory, ".publication-trusted-input-"));
  try {
    for (const name of TRUSTED_ARCHIVE_FILES) fs.writeFileSync(path.join(inputDir, name), trusted.files.get(`${TRUSTED_ARCHIVE_PREFIX}${name}`));
  } catch (error) {
    if (fs.existsSync(inputDir)) fs.rmSync(inputDir, { recursive: true, force: true });
    throw error;
  }
  return { inputDir, archiveSha256: trusted.archiveSha256 };
}

function normalizeNewline(value) {
  return value.replace(/\r\n?/g, "\n");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new PublicationError("CSV contains an unterminated quoted field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  ensure(headers.every(Boolean), "CSV contains an empty header");
  ensure(new Set(headers).size === headers.length, "CSV contains duplicate headers");
  return rows.slice(1).filter((values) => values.some((value) => value !== "")).map((values, rowIndex) => {
    ensure(values.length === headers.length, `CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file, rows, columns) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function bool(value) {
  return value === true || String(value).toLowerCase() === "true" || String(value) === "1";
}

function csvJsonScalarsEqual(jsonValue, csvValue, field, rowNumber) {
  if (jsonValue === null || jsonValue === undefined) return csvValue === "";
  if (typeof jsonValue === "boolean") {
    const normalized = String(csvValue).toLowerCase();
    ensure(normalized === "true" || normalized === "false", `results.csv row ${rowNumber}, field ${field} is not a canonical boolean`);
    return normalized === String(jsonValue);
  }
  if (typeof jsonValue === "number") {
    ensure(Number.isFinite(jsonValue), `results.jsonl row ${rowNumber}, field ${field} is not a finite number`);
    return strictFiniteNumber(csvValue, `results.csv row ${rowNumber}, field ${field}`) === jsonValue;
  }
  if (typeof jsonValue === "string") return csvValue === jsonValue;
  throw new PublicationError(`results.jsonl row ${rowNumber}, field ${field} is not a scalar`);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value) {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort();
}

function sameStringSet(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function strictBoolean(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const normalized = String(value).toLowerCase();
  ensure(normalized === "true" || normalized === "false", `${field} must be a canonical boolean${nullable ? " or blank" : ""}`);
  return normalized === "true";
}

function strictInteger(value, field, { nullable = false, minimum = 0 } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const text = String(value);
  ensure(/^-?\d+$/.test(text), `${field} must be an integer${nullable ? " or blank" : ""}`);
  const parsed = Number(text);
  ensure(Number.isSafeInteger(parsed) && parsed >= minimum, `${field} is outside the accepted integer range`);
  return parsed;
}

function strictFiniteNumber(value, field, { nullable = false, minimum = -Infinity, maximum = Infinity } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const text = String(value);
  ensure(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text), `${field} must be a finite number${nullable ? " or blank" : ""}`);
  const parsed = Number(text);
  ensure(Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum, `${field} is outside the accepted numeric range`);
  return parsed;
}

function strictUtcTimestampMicros(value, field) {
  ensure(typeof value === "string", `${field} must be a UTC timestamp string`);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/);
  ensure(match, `${field} must be a canonical UTC timestamp with at most microsecond precision`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = ""] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  ensure(month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 59, `${field} has an invalid calendar or clock component`);
  const fraction = fractionText.padEnd(6, "0");
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3)));
  ensure(
    date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
      && date.getUTCHours() === hour
      && date.getUTCMinutes() === minute
      && date.getUTCSeconds() === second,
    `${field} is not a real UTC calendar timestamp`,
  );
  return BigInt(date.getTime()) * 1000n + BigInt(fraction.slice(3));
}

function fixedSixMicros(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const text = String(value);
  const match = text.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  ensure(match, `${field} must be a non-negative decimal with at most six fractional digits${nullable ? " or blank" : ""}`);
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function microsToFixedSix(value) {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0");
  return `${whole}.${fraction}`;
}

function decimalToMillionths(value, field) {
  const text = String(value);
  const match = text.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  ensure(match, `${field} must use at most six decimal places`);
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function expectedCostMicros(row, protocol) {
  const prices = protocol.cost_controls?.pricing_per_million_tokens?.[row.model_id];
  ensure(prices, `pricing is missing for ${row.model_id}`);
  const promptTokens = strictInteger(row.prompt_tokens, `${row.case_id}.prompt_tokens`);
  const completionTokens = strictInteger(row.completion_tokens, `${row.case_id}.completion_tokens`);
  const inputPrice = decimalToMillionths(prices.input_cache_miss, `${row.model_id}.input_cache_miss`);
  const outputPrice = decimalToMillionths(prices.output, `${row.model_id}.output`);
  return ceilDiv(BigInt(promptTokens) * inputPrice + BigInt(completionTokens) * outputPrice, 1_000_000n);
}

function roundRationalHalfEven(numerator, denominator, digits) {
  if (!denominator) return null;
  const scale = 10 ** digits;
  const scaledNumerator = numerator * scale;
  const quotient = Math.floor(scaledNumerator / denominator);
  const remainder = scaledNumerator - quotient * denominator;
  let rounded = quotient;
  if (remainder * 2 > denominator || (remainder * 2 === denominator && quotient % 2 === 1)) rounded += 1;
  return rounded / scale;
}

function validatorLatency(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return { n: 0, min_ms: null, mean_ms: null, p50_ms: null, p95_ms: null, max_ms: null };
  return {
    n: clean.length,
    min_ms: clean[0],
    mean_ms: roundRationalHalfEven(clean.reduce((sum, value) => sum + value, 0), clean.length, 2),
    p50_ms: percentile(clean, 0.5),
    p95_ms: percentile(clean, 0.95),
    max_ms: clean.at(-1),
  };
}

function validatorMetric(rows) {
  const exact = rows.filter((row) => strictBoolean(row.exact_match, `${row.case_id}.exact_match`)).length;
  const validJson = rows.filter((row) => strictBoolean(row.valid_json, `${row.case_id}.valid_json`)).length;
  const transport = rows.filter((row) => strictBoolean(row.transport_complete, `${row.case_id}.transport_complete`)).length;
  const costMicros = rows.reduce((sum, row) => sum + (fixedSixMicros(row.observed_provider_cost_usd_cache_miss_upper_bound, `${row.case_id}.observed_provider_cost_usd_cache_miss_upper_bound`, { nullable: true }) ?? 0n), 0n);
  const usageSum = (field) => rows.reduce((sum, row) => sum + (strictInteger(row[field], `${row.case_id}.${field}`, { nullable: true }) ?? 0), 0);
  const completeRows = rows.filter((row) => strictBoolean(row.transport_complete, `${row.case_id}.transport_complete`));
  const timing = (field) => completeRows.map((row) => strictInteger(row[field], `${row.case_id}.${field}`, { nullable: true })).filter(Number.isFinite);
  return {
    attempts: rows.length,
    transport_complete: transport,
    transport_success_rate: rows.length ? roundRationalHalfEven(transport, rows.length, 6) : null,
    exact_matches: exact,
    exact_match_rate: rows.length ? roundRationalHalfEven(exact, rows.length, 6) : null,
    valid_json: validJson,
    valid_json_rate: rows.length ? roundRationalHalfEven(validJson, rows.length, 6) : null,
    provider_cost_usd_cache_miss_upper_bound: microsToFixedSix(costMicros),
    prompt_tokens: usageSum("prompt_tokens"),
    completion_tokens: usageSum("completion_tokens"),
    latency: {
      first_sse_event: validatorLatency(timing("time_to_first_sse_event_ms")),
      first_answer_token: validatorLatency(timing("time_to_first_answer_token_ms")),
      end_to_end: validatorLatency(timing("time_to_end_ms")),
    },
  };
}

function validatorAggregate(rows) {
  const group = (values, fields) => groupMetricsRaw(values, fields).map(({ group: labels, rows: groupRows }) => ({ group: labels, ...validatorMetric(groupRows) }));
  return {
    overall: validatorMetric(rows),
    by_role: group(rows, ["analysis_role"]),
    by_region_model: group(rows, ["region_vantage", "model_id"]),
    primary_by_model: group(rows.filter((row) => row.analysis_role === "primary_accuracy"), ["model_id"]),
    primary_by_model_tier: group(rows.filter((row) => row.analysis_role === "primary_accuracy"), ["model_id", "tier_id"]),
    primary_by_model_family: group(rows.filter((row) => row.analysis_role === "primary_accuracy"), ["model_id", "family_id"]),
    latency_by_region_model_tier: group(rows, ["region_vantage", "model_id", "tier_id"]),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// Exposed only so the synthetic visual-QA harness can emit the same validator
// v1.0.0 aggregate shape. Production build still recomputes it independently.
export function deriveValidatorAggregateForSyntheticQa(rows) {
  return validatorAggregate(rows);
}

function countBy(rows, field) {
  const output = {};
  for (const row of rows) output[row[field]] = (output[row[field]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

function latency(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return { n: 0, min_ms: null, p50_ms: null, p95_ms: null, max_ms: null };
  return {
    n: clean.length,
    min_ms: Math.min(...clean),
    p50_ms: percentile(clean, 0.5),
    p95_ms: percentile(clean, 0.95),
    max_ms: Math.max(...clean),
  };
}

function wilson(successes, denominator, z = 1.959963984540054) {
  if (!denominator) return { low: null, high: null };
  const p = successes / denominator;
  const z2 = z * z;
  const center = (p + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator)) / (1 + z2 / denominator);
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function metric(rows) {
  const exact = rows.filter((row) => bool(row.exact_match)).length;
  const validJson = rows.filter((row) => bool(row.valid_json)).length;
  const exactKeys = rows.filter((row) => bool(row.exact_keys)).length;
  const transport = rows.filter((row) => bool(row.transport_complete)).length;
  const matchedFields = rows.reduce((sum, row) => sum + (integerOrNull(row.matched_fields) ?? 0), 0);
  const totalFields = rows.reduce((sum, row) => sum + (integerOrNull(row.total_fields) ?? 0), 0);
  const interval = wilson(exact, rows.length);
  const observedCosts = rows.map((row) => numberOrNull(row.observed_provider_cost_usd_cache_miss_upper_bound)).filter(Number.isFinite);
  const observedCostSum = observedCosts.reduce((sum, value) => sum + value, 0);
  const costCoverageComplete = observedCosts.length === rows.length;
  const usageRows = rows.map((row) => ({
    prompt_tokens: integerOrNull(row.prompt_tokens),
    cache_hit_tokens: integerOrNull(row.prompt_cache_hit_tokens),
    cache_miss_tokens: integerOrNull(row.prompt_cache_miss_tokens),
    completion_tokens: integerOrNull(row.completion_tokens),
  })).filter((usage) => Object.values(usage).every(Number.isFinite));
  const usageTotals = Object.fromEntries(["prompt_tokens", "cache_hit_tokens", "cache_miss_tokens", "completion_tokens"].map((field) => [field, usageRows.reduce((sum, usage) => sum + usage[field], 0)]));
  const usageCoverageComplete = usageRows.length === rows.length;
  const firstAnswer = rows.filter((row) => bool(row.transport_complete)).map((row) => numberOrNull(row.time_to_first_answer_token_ms));
  const endToEnd = rows.filter((row) => bool(row.transport_complete)).map((row) => numberOrNull(row.time_to_end_ms));
  return {
    attempts: rows.length,
    transport_complete: transport,
    exact_matches: exact,
    exact_match_rate: rows.length ? exact / rows.length : null,
    exact_match_wilson_95: interval,
    valid_json: validJson,
    valid_json_rate: rows.length ? validJson / rows.length : null,
    exact_key_sets: exactKeys,
    exact_key_set_rate: rows.length ? exactKeys / rows.length : null,
    matched_fields: matchedFields,
    total_fields: totalFields,
    field_accuracy: totalFields ? matchedFields / totalFields : null,
    latency: {
      first_answer_token: latency(firstAnswer),
      end_to_end: latency(endToEnd),
    },
    usage_observed_rows: usageRows.length,
    usage_missing_rows: rows.length - usageRows.length,
    usage_coverage_complete: usageCoverageComplete,
    prompt_tokens_known_usage_total: usageTotals.prompt_tokens,
    cache_hit_tokens_known_usage_total: usageTotals.cache_hit_tokens,
    cache_miss_tokens_known_usage_total: usageTotals.cache_miss_tokens,
    completion_tokens_known_usage_total: usageTotals.completion_tokens,
    prompt_tokens: usageCoverageComplete ? usageTotals.prompt_tokens : null,
    cache_hit_tokens: usageCoverageComplete ? usageTotals.cache_hit_tokens : null,
    cache_miss_tokens: usageCoverageComplete ? usageTotals.cache_miss_tokens : null,
    completion_tokens: usageCoverageComplete ? usageTotals.completion_tokens : null,
    cost_observed_rows: observedCosts.length,
    cost_missing_rows: rows.length - observedCosts.length,
    cost_coverage_complete: costCoverageComplete,
    estimated_provider_cost_usd_cache_miss_known_usage_total: Number(observedCostSum.toFixed(6)),
    estimated_provider_cost_usd_cache_miss_known_usage_mean: observedCosts.length ? Number((observedCostSum / observedCosts.length).toFixed(9)) : null,
    estimated_provider_cost_usd_cache_miss_upper_bound: costCoverageComplete ? Number(observedCostSum.toFixed(6)) : null,
  };
}

function groupMetricsRaw(rows, fields) {
  const groups = new Map();
  for (const row of rows) {
    const key = fields.map((field) => row[field]).join("\u001f");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      group: Object.fromEntries(fields.map((field, index) => [field, key.split("\u001f")[index]])),
      rows: values,
    }));
}

function groupMetrics(rows, fields) {
  return groupMetricsRaw(rows, fields).map(({ group, rows: groupRows }) => ({ group, ...metric(groupRows) }));
}

function expectedFullIdentities() {
  const expected = new Set();
  for (const region of ["us-east-1", "ap-south-1"]) for (const model of MODELS) {
    for (const family of FAMILIES) expected.add(["pilot_excluded", region, model, family, "32k", "middle", 1].join("|"));
    expected.add(["pilot_excluded", region, model, "single_record", "950k", "middle", 1].join("|"));
  }
  for (const model of MODELS) for (const family of FAMILIES) for (const tier of TIERS) for (const position of POSITIONS) for (const repeat of [1, 2, 3]) {
    expected.add(["primary_accuracy", "us-east-1", model, family, tier, position, repeat].join("|"));
  }
  for (const model of MODELS) for (const tier of ["32k", "950k"]) for (const position of POSITIONS) for (const repeat of [1, 2, 3]) {
    expected.add(["india_latency_validation", "ap-south-1", model, "single_record", tier, position, repeat].join("|"));
  }
  return expected;
}

function validateSanitizedRows(rows, protocol) {
  ensure(rows.length === EXPECTED_COUNTS.all, `results.csv has ${rows.length} rows; expected 344`);
  const expectedIdentities = expectedFullIdentities();
  const actualIdentities = new Set();
  const resultObjectKeys = new Set();
  const executionPlanIds = new Set();
  const generatorHashes = new Set();
  let observedCostMicros = 0n;
  const hex64 = /^[0-9a-f]{64}$/;
  const hashFields = ["generator_bundle_sha256", "base_fixture_sha256", "execution_salt_sha256", "salted_user_prompt_sha256", "expected_sha256", "request_sha256", "raw_response_sha256"];
  const publicStringFields = ["protocol_id", "protocol_version", "analysis_role", "region_vantage", "case_id", "model_id", "family_id", "tier_id", "position_id", "started_at", "finished_at", "finish_reason", "returned_model", "system_fingerprint", "grader_errors", "stream_error_class", "error_class"];

  for (const row of rows) {
    for (const field of publicStringFields) {
      const value = row[field];
      if (value === "") continue;
      ensure(!/[\u0000-\u001f\u007f]/.test(value), `${row.case_id || "row"}.${field} contains a control character`);
      ensure(!/^[=+\-@]/.test(value), `${row.case_id || "row"}.${field} could trigger spreadsheet formula execution`);
    }
    ensure(row.protocol_id === EXPECTED_PROTOCOL_ID && row.protocol_version === "1.1.0", `${row.case_id || "row"} has a protocol mismatch`);
    ensure(MODELS.includes(row.model_id), `${row.case_id || "row"} has an invalid model_id`);
    ensure(FAMILIES.includes(row.family_id), `${row.case_id || "row"} has an invalid family_id`);
    ensure(TIERS.includes(row.tier_id), `${row.case_id || "row"} has an invalid tier_id`);
    ensure(POSITIONS.includes(row.position_id), `${row.case_id || "row"} has an invalid position_id`);
    ensure(Object.hasOwn(EXPECTED_COUNTS, row.analysis_role), `${row.case_id || "row"} has an invalid analysis_role`);
    ensure(["us-east-1", "ap-south-1"].includes(row.region_vantage), `${row.case_id || "row"} has an invalid region_vantage`);
    const startedAtMicros = strictUtcTimestampMicros(row.started_at, `${row.case_id || "row"}.started_at`);
    const finishedAtMicros = strictUtcTimestampMicros(row.finished_at, `${row.case_id || "row"}.finished_at`);
    ensure(finishedAtMicros >= startedAtMicros, `${row.case_id || "row"}.finished_at precedes started_at`);
    const repeat = strictInteger(row.repeat, `${row.case_id || "row"}.repeat`, { minimum: 1 });
    ensure([1, 2, 3].includes(repeat), `${row.case_id || "row"}.repeat is outside the frozen protocol`);
    const identity = [row.analysis_role, row.region_vantage, row.model_id, row.family_id, row.tier_id, row.position_id, repeat].join("|");
    ensure(!actualIdentities.has(identity), `results.csv contains duplicate frozen identity ${identity}`);
    actualIdentities.add(identity);

    const expectedSalt = sha256Buffer(Buffer.from(`${EXPECTED_PROTOCOL_ID}|execution-salt|${row.analysis_role}|${row.region_vantage}|${row.family_id}|${row.tier_id}|${row.position_id}|r${repeat}`));
    const baseCaseId = `${EXPECTED_PROTOCOL_ID}:${row.model_id}:${row.family_id}:${row.tier_id}:${row.position_id}:r${repeat}`;
    const expectedCaseId = row.analysis_role === "pilot_excluded" ? `${baseCaseId}:pilot:${row.region_vantage}:${expectedSalt.slice(0, 16)}` : baseCaseId;
    ensure(row.case_id === expectedCaseId, `${row.case_id || "row"} does not match its frozen coordinates`);
    for (const field of hashFields) ensure(hex64.test(row[field] ?? ""), `${row.case_id}.${field} must be lowercase SHA-256`);
    ensure(row.execution_salt_sha256 === expectedSalt, `${row.case_id}.execution_salt_sha256 does not match its coordinates`);
    generatorHashes.add(row.generator_bundle_sha256);

    for (const field of ["run_id", "execution_plan_id", "batch_id", "raw_response_object_key", "result_object_key"]) ensure(typeof row[field] === "string" && row[field] !== "", `${row.case_id}.${field} must be a non-empty string`);
    executionPlanIds.add(row.execution_plan_id);
    const caseRef = sha256Buffer(Buffer.from(row.case_id));
    ensure(row.raw_response_object_key === `runs/${row.run_id}/${row.region_vantage}/${caseRef}.response.bin`, `${row.case_id}.raw_response_object_key does not match its identity`);
    ensure(row.result_object_key === `results/${row.run_id}/${row.region_vantage}/${caseRef}.json`, `${row.case_id}.result_object_key does not match its identity`);
    ensure(!resultObjectKeys.has(row.result_object_key), `results.csv contains duplicate result_object_key ${row.result_object_key}`);
    resultObjectKeys.add(row.result_object_key);

    const includePrimary = strictBoolean(row.include_in_primary_accuracy_denominators, `${row.case_id}.include_in_primary_accuracy_denominators`);
    ensure(includePrimary === (row.analysis_role === "primary_accuracy"), `${row.case_id} has an invalid primary-denominator flag`);
    const transportComplete = strictBoolean(row.transport_complete, `${row.case_id}.transport_complete`);
    const validJson = strictBoolean(row.valid_json, `${row.case_id}.valid_json`);
    const exactKeys = strictBoolean(row.exact_keys, `${row.case_id}.exact_keys`);
    const exactMatch = strictBoolean(row.exact_match, `${row.case_id}.exact_match`);
    const calibrationPassed = strictBoolean(row.prompt_tier_calibration_passed, `${row.case_id}.prompt_tier_calibration_passed`, { nullable: true });
    const thinkingViolation = strictBoolean(row.thinking_disabled_violation, `${row.case_id}.thinking_disabled_violation`);
    const doneReceived = strictBoolean(row.sse_done_received, `${row.case_id}.sse_done_received`);
    const httpStatus = strictInteger(row.http_status, `${row.case_id}.http_status`, { nullable: true });
    const timing = Object.fromEntries(["time_to_first_sse_event_ms", "time_to_first_reasoning_token_ms", "time_to_first_answer_token_ms", "time_to_end_ms"].map((field) => [field, strictInteger(row[field], `${row.case_id}.${field}`, { nullable: true })]));
    const sseEventCount = strictInteger(row.sse_event_count, `${row.case_id}.sse_event_count`);
    const sseParseErrors = strictInteger(row.sse_parse_error_count, `${row.case_id}.sse_parse_error_count`);
    if (timing.time_to_end_ms !== null) {
      for (const field of ["time_to_first_sse_event_ms", "time_to_first_reasoning_token_ms", "time_to_first_answer_token_ms"]) ensure(timing[field] === null || timing[field] <= timing.time_to_end_ms, `${row.case_id}.${field} exceeds time_to_end_ms`);
    }
    ensure(timing.time_to_first_sse_event_ms === null || timing.time_to_first_answer_token_ms === null || timing.time_to_first_sse_event_ms <= timing.time_to_first_answer_token_ms, `${row.case_id} has impossible SSE/answer timing order`);
    void sseEventCount;

    const matchedFields = strictInteger(row.matched_fields, `${row.case_id}.matched_fields`);
    const totalFields = strictInteger(row.total_fields, `${row.case_id}.total_fields`);
    const fieldAccuracy = strictFiniteNumber(row.field_accuracy, `${row.case_id}.field_accuracy`, { minimum: 0, maximum: 1 });
    ensure(matchedFields <= totalFields, `${row.case_id} has matched_fields greater than total_fields`);
    ensure(totalFields === EXPECTED_FIELD_COUNTS[row.family_id], `${row.case_id} has an invalid total_fields count for ${row.family_id}`);
    if (totalFields > 0) ensure(Math.abs(fieldAccuracy - matchedFields / totalFields) <= 1e-9, `${row.case_id} has inconsistent field accuracy`);
    if (exactMatch) ensure(validJson && exactKeys && matchedFields === totalFields && fieldAccuracy === 1 && row.grader_errors === "", `${row.case_id} has inconsistent exact-match grader fields`);

    const usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "reasoning_tokens"].map((field) => [field, strictInteger(row[field], `${row.case_id}.${field}`, { nullable: true })]));
    const storedCostMicros = fixedSixMicros(row.observed_provider_cost_usd_cache_miss_upper_bound, `${row.case_id}.observed_provider_cost_usd_cache_miss_upper_bound`, { nullable: true });
    observedCostMicros += storedCostMicros ?? 0n;
    if (transportComplete) {
      for (const field of ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens"]) ensure(usage[field] !== null, `${row.case_id}.${field} is required for a complete transport`);
      for (const field of ["time_to_first_sse_event_ms", "time_to_first_answer_token_ms", "time_to_end_ms"]) ensure(timing[field] !== null, `${row.case_id}.${field} is required for a complete transport`);
      ensure(httpStatus === 200 && doneReceived && sseParseErrors === 0 && row.stream_error_class === "" && row.error_class === "", `${row.case_id} has conflicting complete-transport evidence`);
      ensure(row.returned_model === row.model_id && row.system_fingerprint !== "", `${row.case_id} has invalid routing or fingerprint evidence`);
      ensure(calibrationPassed === true && thinkingViolation === false, `${row.case_id} violates calibration or non-thinking mode`);
      ensure(usage.total_tokens === usage.prompt_tokens + usage.completion_tokens, `${row.case_id} has inconsistent total_tokens`);
      ensure(usage.prompt_tokens === usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens, `${row.case_id} has inconsistent cache-token totals`);
      const tier = protocol.context_tiers.find((item) => item.id === row.tier_id);
      ensure(tier && usage.prompt_tokens >= tier.accepted_prompt_tokens_min && usage.prompt_tokens <= tier.accepted_prompt_tokens_max, `${row.case_id}.prompt_tokens is outside its frozen accepted tier`);
      ensure(storedCostMicros !== null && storedCostMicros === expectedCostMicros(row, protocol), `${row.case_id} has a non-reconciling provider-cost estimate`);
    }
  }

  ensure(actualIdentities.size === expectedIdentities.size && [...expectedIdentities].every((identity) => actualIdentities.has(identity)), "results.csv does not contain the exact frozen full-run identity grid");
  ensure(executionPlanIds.size === 1, "results.csv must contain exactly one execution_plan_id");
  ensure(generatorHashes.size === 1, "results.csv contains more than one generator bundle hash");
  const hardStopMicros = BigInt(Math.round(Number(protocol.cost_controls?.hard_stop_usd) * 1_000_000));
  ensure(hardStopMicros > 0n && observedCostMicros <= hardStopMicros, "results.csv observed cost exceeds the frozen protocol hard stop");

  const pairGroups = groupMetricsRaw(rows, ["analysis_role", "region_vantage", "family_id", "tier_id", "position_id", "repeat"]);
  for (const pair of pairGroups) {
    ensure(pair.rows.length === 2 && sameStringSet(new Set(pair.rows.map((row) => row.model_id)), MODELS), `model pairing is incomplete for ${canonicalJson(pair.group)}`);
    for (const field of ["base_fixture_sha256", "execution_salt_sha256", "salted_user_prompt_sha256", "expected_sha256"]) ensure(new Set(pair.rows.map((row) => row[field])).size === 1, `paired models differ on ${field} for ${canonicalJson(pair.group)}`);
  }
  const coordinateGroups = groupMetricsRaw(rows, ["family_id", "tier_id", "position_id", "repeat"]);
  for (const coordinate of coordinateGroups) for (const field of ["base_fixture_sha256", "expected_sha256"]) ensure(new Set(coordinate.rows.map((row) => row[field])).size === 1, `cross-role coordinate differs on ${field} for ${canonicalJson(coordinate.group)}`);
  return { executionPlanId: [...executionPlanIds][0] };
}

function normalizeAggregateForComparison(aggregate) {
  const withoutValidatorOnlyMeans = (value) => {
    if (Array.isArray(value)) return value.map(withoutValidatorOnlyMeans);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "mean_ms").map(([key, item]) => [key, withoutValidatorOnlyMeans(item)]));
  };
  const output = withoutValidatorOnlyMeans(aggregate);
  for (const key of ["by_role", "by_region_model", "primary_by_model", "primary_by_model_tier", "primary_by_model_family", "latency_by_region_model_tier"]) {
    if (Array.isArray(output[key])) output[key] = [...output[key]].sort((a, b) => canonicalJson(a.group).localeCompare(canonicalJson(b.group)));
  }
  return output;
}

function validateValidatorMeans(actual, expected, pointer = "aggregate") {
  if (Array.isArray(expected)) {
    ensure(Array.isArray(actual) && actual.length === expected.length, `${pointer} mean_ms structure does not match recomputed rows`);
    expected.forEach((item, index) => validateValidatorMeans(actual[index], item, `${pointer}[${index}]`));
    return;
  }
  if (!expected || typeof expected !== "object") return;
  ensure(actual && typeof actual === "object" && !Array.isArray(actual), `${pointer} mean_ms structure does not match recomputed rows`);
  for (const key of Object.keys(actual)) if (key === "mean_ms") ensure(Object.hasOwn(expected, key), `${pointer}.mean_ms is not part of the validator aggregate schema`);
  for (const [key, expectedValue] of Object.entries(expected)) {
    ensure(Object.hasOwn(actual, key), `${pointer}.${key} is missing from the validator aggregate`);
    if (key === "mean_ms") {
      const actualValue = actual[key];
      if (expectedValue === null) ensure(actualValue === null, `${pointer}.mean_ms must be null when no timing rows exist`);
      else ensure(typeof actualValue === "number" && Number.isFinite(actualValue) && Math.abs(actualValue - expectedValue) <= 0.010000001, `${pointer}.mean_ms does not independently reconcile to results.csv within the 0.01 ms tie-rounding allowance`);
    } else validateValidatorMeans(actual[key], expectedValue, `${pointer}.${key}`);
  }
}

function validateValidatorEvidence(rows, validatorSummary, validation, manifest, executionPlanId) {
  ensure(validation && typeof validation === "object" && !Array.isArray(validation), "validation-report.json must contain an object");
  ensure(JSON.stringify(sortedKeys(validation)) === JSON.stringify([...VALIDATION_REPORT_KEYS].sort()), "validation-report.json top-level schema is not exact for validator v1.0.0");
  ensure(validation.validator_schema_version === "1.0.0" && validation.protocol_id === EXPECTED_PROTOCOL_ID && validation.protocol_version === "1.1.0", "validation-report.json protocol or schema mismatch");
  ensure(validation.mode === "full" && validation.integrity_valid === true && validation.full_run_complete === true && validation.pilot_accepted === false, "validation-report.json does not describe a passed full run");
  ensure(validation.expected_result_count === 344 && validation.discovered_result_count === 344, "validation-report.json counts do not reconcile to 344");
  ensure(Array.isArray(validation.errors) && validation.errors.length === 0 && validation.leak_finding_count === 0, "validation-report.json contains errors or leak findings");
  ensure(typeof validation.input_dir === "string" && validation.input_dir !== "" && typeof validation.raw_dir === "string" && validation.raw_dir !== "", "validation-report.json is missing validator source paths");
  ensure(Array.isArray(validation.execution_plan_ids) && validation.execution_plan_ids.length === 1 && validation.execution_plan_ids[0] === executionPlanId, "validation-report.json execution plan does not match results.csv");
  ensure(canonicalJson(validation.role_counts) === canonicalJson(countBy(rows, "analysis_role")), "validation-report.json role counts do not match results.csv");
  ensure(canonicalJson(validation.region_counts) === canonicalJson(countBy(rows, "region_vantage")), "validation-report.json region counts do not match results.csv");
  ensure(canonicalJson(validation.model_counts) === canonicalJson(countBy(rows, "model_id")), "validation-report.json model counts do not match results.csv");
  for (const field of ["validator_schema_version", "mode", "expected_result_count", "discovered_result_count", "integrity_valid", "pilot_accepted", "full_run_complete"]) ensure(manifest[field] === validation[field], `validator manifest and validation report differ on ${field}`);
  ensure(manifest.protocol_id === validation.protocol_id && manifest.protocol_version === validation.protocol_version, "validator manifest and validation report protocol fields differ");
  ensure(canonicalJson(validatorSummary) === canonicalJson(validation.aggregate), "summary.json does not exactly match validation-report.json aggregate");
  const recomputedAggregate = validatorAggregate(rows);
  validateValidatorMeans(validatorSummary, recomputedAggregate);
  const expectedAggregate = normalizeAggregateForComparison(recomputedAggregate);
  const actualAggregate = normalizeAggregateForComparison(validatorSummary);
  ensure(canonicalJson(actualAggregate) === canonicalJson(expectedAggregate), "validator aggregate does not independently reconcile to results.csv");
}

function validateInputs(rows, validatorSummary, validation, protocol, manifest) {
  ensure(validation?.mode === "full", "validation-report.json is not a full-run report");
  ensure(validation?.integrity_valid === true, "validation-report.json did not pass integrity validation");
  ensure(validation?.full_run_complete === true, "validation-report.json does not mark the full run complete");
  ensure(validation?.errors?.length === 0, "validation-report.json contains errors");
  const { executionPlanId } = validateSanitizedRows(rows, protocol);
  validateValidatorEvidence(rows, validatorSummary, validation, manifest, executionPlanId);

  const roles = countBy(rows, "analysis_role");
  for (const [role, count] of Object.entries(EXPECTED_COUNTS)) {
    if (role !== "all") ensure(roles[role] === count, `${role} has ${roles[role] ?? 0} rows; expected ${count}`);
  }
  const primary = rows.filter((row) => row.analysis_role === "primary_accuracy");
  const pilot = rows.filter((row) => row.analysis_role === "pilot_excluded");
  const india = rows.filter((row) => row.analysis_role === "india_latency_validation");
  ensure(primary.every((row) => row.region_vantage === "us-east-1" && bool(row.include_in_primary_accuracy_denominators)), "primary rows violate region or denominator flags");
  ensure(pilot.every((row) => !bool(row.include_in_primary_accuracy_denominators)), "pilot rows entered primary denominators");
  ensure(india.every((row) => row.region_vantage === "ap-south-1" && !bool(row.include_in_primary_accuracy_denominators)), "India rows violate region or denominator flags");
  ensure(countBy(pilot, "region_vantage")["us-east-1"] === 10 && countBy(pilot, "region_vantage")["ap-south-1"] === 10, "pilot rows are not split 10/10 by region");
  ensure(india.every((row) => row.family_id === "single_record" && ["32k", "950k"].includes(row.tier_id)), "India rows exceed the frozen single-record edge-tier slice");
  ensure(JSON.stringify(countBy(primary, "model_id")) === JSON.stringify({ "deepseek-v4-flash": 144, "deepseek-v4-pro": 144 }), "primary model counts do not reconcile to 144/144");
  ensure(FAMILIES.every((family) => countBy(primary, "family_id")[family] === 72), "primary family counts do not reconcile to 72 each");
  ensure(TIERS.every((tier) => countBy(primary, "tier_id")[tier] === 72), "primary tier counts do not reconcile to 72 each");
  ensure(POSITIONS.every((position) => countBy(primary, "position_id")[position] === 96), "primary position counts do not reconcile to 96 each");
  ensure(validatorSummary?.overall?.attempts === 344, "summary.json overall attempts do not reconcile to 344");
  ensure(validation?.discovered_result_count === 344 && validation?.expected_result_count === 344, "validation report counts do not reconcile to 344");
  return { primary, pilot, india };
}

function validatorFileEntry(manifest, name) {
  if (Array.isArray(manifest.files)) return manifest.files.find((entry) => entry.path === name || entry.name === name);
  if (manifest.files && typeof manifest.files === "object") return manifest.files[name];
  return null;
}

function validateValidatorExportManifest(inputDir, manifest) {
  ensure(manifest && typeof manifest === "object", "validation-export-manifest.json must contain an object");
  const expectedTopLevel = ["manifest_schema_version", "protocol_id", "protocol_version", "validator_schema_version", "mode", "expected_result_count", "discovered_result_count", "integrity_valid", "pilot_accepted", "full_run_complete", "files"].sort();
  ensure(JSON.stringify(Object.keys(manifest).sort()) === JSON.stringify(expectedTopLevel), "validator export manifest top-level schema is not exact");
  ensure(manifest.manifest_schema_version === "1.0.0", "validator export manifest schema mismatch");
  ensure(manifest.protocol_id === EXPECTED_PROTOCOL_ID && manifest.protocol_version === "1.1.0", "validator export manifest protocol mismatch");
  ensure(manifest.validator_schema_version === "1.0.0", "validator export manifest validator schema mismatch");
  ensure(manifest.mode === "full", "validator export manifest is not for full mode");
  ensure(manifest.integrity_valid === true, "validator export manifest does not record passed integrity");
  ensure(manifest.full_run_complete === true, "validator export manifest does not record a complete run");
  ensure(manifest.pilot_accepted === false, "full-run validator export manifest has an invalid pilot_accepted state");
  ensure(manifest.expected_result_count === 344, "validator export manifest expected count is not 344");
  ensure(manifest.discovered_result_count === 344, "validator export manifest discovered count is not 344");
  ensure(manifest.files && !Array.isArray(manifest.files) && typeof manifest.files === "object", "validator export manifest files must be an object");
  ensure(JSON.stringify(Object.keys(manifest.files).sort()) === JSON.stringify(["results.csv", "results.jsonl", "summary.json", "validation-report.json"].sort()), "validator export manifest file inventory is not exact");
  for (const name of ["results.csv", "results.jsonl", "summary.json", "validation-report.json"]) {
    const entry = validatorFileEntry(manifest, name);
    ensure(entry, `validator export manifest is missing ${name}`);
    ensure(entry && typeof entry === "object" && !Array.isArray(entry), `validator export manifest entry for ${name} must be an object`);
    ensure(JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(["bytes", "sha256"]), `validator export manifest entry schema is not exact for ${name}`);
    ensure(Number.isInteger(entry.bytes) && entry.bytes > 0, `validator export manifest has an invalid byte size for ${name}`);
    const expectedHash = entry.sha256;
    const expectedBytes = entry.bytes;
    ensure(/^[0-9a-f]{64}$/.test(expectedHash ?? ""), `validator export manifest has an invalid SHA-256 for ${name}`);
    const file = path.join(inputDir, name);
    ensure(sha256File(file) === expectedHash, `${name} does not match the validator-emitted export hash`);
    ensure(fs.statSync(file).size === expectedBytes, `${name} does not match the validator-emitted byte size`);
  }
}

function pairedSummary(primary) {
  const pairs = new Map();
  for (const row of primary) {
    const key = [row.family_id, row.tier_id, row.position_id, row.repeat].join("|");
    if (!pairs.has(key)) pairs.set(key, {});
    pairs.get(key)[row.model_id] = row;
  }
  const outcomes = { both_pass: 0, flash_only_pass: 0, pro_only_pass: 0, both_fail: 0, complete_pairs: 0 };
  for (const value of pairs.values()) {
    const flash = value["deepseek-v4-flash"];
    const pro = value["deepseek-v4-pro"];
    ensure(flash && pro, "primary Flash/Pro pairing is incomplete");
    ensure(flash.base_fixture_sha256 === pro.base_fixture_sha256, "paired models do not share a base fixture hash");
    outcomes.complete_pairs += 1;
    const fp = bool(flash.exact_match);
    const pp = bool(pro.exact_match);
    if (fp && pp) outcomes.both_pass += 1;
    else if (fp) outcomes.flash_only_pass += 1;
    else if (pp) outcomes.pro_only_pass += 1;
    else outcomes.both_fail += 1;
  }
  ensure(outcomes.complete_pairs === 144, `paired comparison has ${outcomes.complete_pairs} pairs; expected 144`);
  outcomes.flash_minus_pro_exact_pass_delta = (outcomes.flash_only_pass - outcomes.pro_only_pass) / outcomes.complete_pairs;
  return outcomes;
}

function indiaPairs(primary, india) {
  const primaryMap = new Map(primary.map((row) => [[row.model_id, row.family_id, row.tier_id, row.position_id, row.repeat].join("|"), row]));
  const pairs = india.map((indiaRow) => {
    const key = [indiaRow.model_id, indiaRow.family_id, indiaRow.tier_id, indiaRow.position_id, indiaRow.repeat].join("|");
    const us = primaryMap.get(key);
    ensure(us, `India row ${indiaRow.case_id} has no matched U.S. primary row`);
    ensure(us.base_fixture_sha256 === indiaRow.base_fixture_sha256, `India row ${indiaRow.case_id} does not share the base fixture hash`);
    const timingPairAvailable = bool(us.transport_complete) && bool(indiaRow.transport_complete);
    const usFirst = timingPairAvailable ? numberOrNull(us.time_to_first_answer_token_ms) : null;
    const indiaFirst = timingPairAvailable ? numberOrNull(indiaRow.time_to_first_answer_token_ms) : null;
    const usEnd = timingPairAvailable ? numberOrNull(us.time_to_end_ms) : null;
    const indiaEnd = timingPairAvailable ? numberOrNull(indiaRow.time_to_end_ms) : null;
    return {
      matched_pair_id: sha256Buffer(Buffer.from(key)).slice(0, 16),
      model_id: indiaRow.model_id,
      tier_id: indiaRow.tier_id,
      position_id: indiaRow.position_id,
      repeat: indiaRow.repeat,
      coordinate_pair_matched: true,
      transport_complete_at_both_vantages: timingPairAvailable,
      us_first_answer_ms: usFirst,
      india_first_answer_ms: indiaFirst,
      first_answer_delta_ms: usFirst === null || indiaFirst === null ? null : indiaFirst - usFirst,
      us_end_to_end_ms: usEnd,
      india_end_to_end_ms: indiaEnd,
      end_to_end_delta_ms: usEnd === null || indiaEnd === null ? null : indiaEnd - usEnd,
      us_cache_hit_tokens: integerOrNull(us.prompt_cache_hit_tokens),
      india_cache_hit_tokens: integerOrNull(indiaRow.prompt_cache_hit_tokens),
    };
  });
  ensure(pairs.length === 36, `India matching produced ${pairs.length} pairs; expected 36`);
  return pairs;
}

function buildSummary(rows, primary, pilot, india, protocol, validation, sourceHashes, releaseVersion, syntheticQa = false) {
  const paired = pairedSummary(primary);
  const matchedIndia = indiaPairs(primary, india);
  const startTimes = rows.map((row) => Date.parse(row.started_at)).filter(Number.isFinite);
  const finishTimes = rows.map((row) => Date.parse(row.finished_at)).filter(Number.isFinite);
  ensure(startTimes.length === rows.length && finishTimes.length === rows.length, "all rows must have valid start and finish timestamps");
  const modelFingerprints = countBy(rows.map((row) => ({ split: `${row.model_id}|${row.returned_model}|${row.system_fingerprint}` })), "split");
  return {
    release_schema_version: "1.0.0",
    release_version: releaseVersion,
    synthetic_test_data: syntheticQa,
    protocol_id: protocol.protocol_id,
    protocol_frozen_on: protocol.frozen_on,
    generated_at_utc: new Date().toISOString(),
    run_window_utc: {
      started_at: new Date(Math.min(...startTimes)).toISOString(),
      finished_at: new Date(Math.max(...finishTimes)).toISOString(),
    },
    source_hashes: sourceHashes,
    counts: {
      planned_calls: 344,
      terminal_rows: rows.length,
      pilot_excluded: pilot.length,
      primary_accuracy: primary.length,
      india_latency_validation: india.length,
    },
    overall_terminal_records: metric(rows),
    pilot_excluded: {
      ...metric(pilot),
      included_in_primary_accuracy: false,
      regions: groupMetrics(pilot, ["region_vantage"]),
    },
    primary_accuracy: {
      ...metric(primary),
      denominator: 288,
      network_vantage: "us-east-1",
      by_model: groupMetrics(primary, ["model_id"]),
      by_model_tier: groupMetrics(primary, ["model_id", "tier_id"]),
      by_model_family: groupMetrics(primary, ["model_id", "family_id"]),
      by_model_position: groupMetrics(primary, ["model_id", "position_id"]),
      by_tier: groupMetrics(primary, ["tier_id"]),
      by_family: groupMetrics(primary, ["family_id"]),
      by_position: groupMetrics(primary, ["position_id"]),
      paired_flash_vs_pro: paired,
    },
    india_latency_validation: {
      ...metric(india),
      included_in_primary_accuracy: false,
      network_vantage: "ap-south-1",
      matched_pairs: matchedIndia.length,
      transport_complete_timing_pairs: matchedIndia.filter((row) => row.transport_complete_at_both_vantages).length,
      first_answer_delta_ms: latency(matchedIndia.map((row) => row.first_answer_delta_ms)),
      end_to_end_delta_ms: latency(matchedIndia.map((row) => row.end_to_end_delta_ms)),
      by_model_tier: groupMetrics(india, ["model_id", "tier_id"]),
    },
    model_routing_and_fingerprints: modelFingerprints,
    routing: {
      requested_models: [...new Set(rows.map((row) => row.model_id))].sort(),
      returned_models: [...new Set(rows.map((row) => row.returned_model).filter(Boolean))].sort(),
      fingerprint_split_count: Object.keys(modelFingerprints).length,
    },
    pricing: {
      snapshot_date: protocol.cost_controls.pricing_snapshot_date,
      source: protocol.cost_controls.pricing_source,
      currency: protocol.cost_controls.currency,
      per_million_tokens: protocol.cost_controls.pricing_per_million_tokens,
      estimate_semantics: "Each non-null row value is a dated cache-miss upper-bound estimate derived from observed usage. Aggregates expose observed and missing row counts; a full-group upper bound is reported only when every row has a cost value.",
    },
    validator: {
      schema_version: validation.validator_schema_version,
      full_run_complete: validation.full_run_complete,
      integrity_valid: validation.integrity_valid,
      errors: validation.errors.length,
    },
    interpretation_boundaries: [
      "Primary accuracy uses exactly 288 us-east-1 primary_accuracy rows.",
      "The 20 pilot_excluded rows are preserved but excluded from every primary accuracy denominator.",
      "The 36 ap-south-1 rows are a matched client network-vantage check, not a sample of Indian users or provider hosting.",
      "Synthetic English records and strict JSON grading do not measure general model quality.",
      "Latency belongs to this workload and narrow run window; it is not recurring reliability evidence.",
      "Prices are dated and can change.",
      "Cost totals with incomplete usage coverage are labeled known-usage partial sums and are never presented as full-run upper bounds.",
      "Token and cache totals are reported as complete only when every row contains the full usage tuple; otherwise the release exposes known-usage totals with observed and missing row counts.",
    ],
  };
}

function publicRow(row) {
  const output = Object.fromEntries(PUBLIC_COLUMNS.map((column) => [column, row[column] ?? ""]));
  output.public_case_uid = sha256Buffer(Buffer.from(`${row.protocol_id}|${row.analysis_role}|${row.region_vantage}|${row.case_id}`)).slice(0, 24);
  return output;
}

function failureRow(row) {
  let stage = "strict_exact_match";
  if (!bool(row.transport_complete)) stage = "transport";
  else if (!bool(row.prompt_tier_calibration_passed)) stage = "prompt_tier_calibration";
  else if (!bool(row.valid_json)) stage = "json_parse";
  else if (!bool(row.exact_keys)) stage = "exact_key_set";
  return {
    analysis_role: row.analysis_role,
    region_vantage: row.region_vantage,
    case_id: row.case_id,
    model_id: row.model_id,
    family_id: row.family_id,
    tier_id: row.tier_id,
    position_id: row.position_id,
    repeat: row.repeat,
    failure_stage: stage,
    http_status: row.http_status,
    finish_reason: row.finish_reason,
    grader_errors: row.grader_errors,
    stream_error_class: row.stream_error_class,
    error_class: row.error_class,
    raw_response_sha256: row.raw_response_sha256,
  };
}

function fingerprintRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.analysis_role, row.region_vantage, row.model_id, row.returned_model, row.system_fingerprint].join("\u001f");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [analysis_role, region_vantage, requested_model, returned_model, system_fingerprint] = key.split("\u001f");
    return {
      analysis_role,
      region_vantage,
      requested_model,
      returned_model,
      system_fingerprint,
      first_seen_utc: values.map((row) => row.started_at).sort()[0],
      last_seen_utc: values.map((row) => row.finished_at).sort().at(-1),
      attempts: values.length,
    };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function esc(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function prettyPercent(value, digits = 1) {
  return value === null || value === undefined ? "not available" : `${(value * 100).toFixed(digits)}%`;
}

function prettyMs(value) {
  if (value === null || value === undefined) return "not available";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function prettyUsd(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "not available";
  return `USD ${Number(value).toFixed(6)}`;
}

function costCoverageSentence(item, label = "The dated cost estimate") {
  if (item.cost_coverage_complete) {
    return `${label} was a cache-miss upper bound of ${prettyUsd(item.estimated_provider_cost_usd_cache_miss_upper_bound)} with complete coverage (${item.cost_observed_rows}/${item.attempts} rows).`;
  }
  return `${label} totaled ${prettyUsd(item.estimated_provider_cost_usd_cache_miss_known_usage_total)} across ${item.cost_observed_rows}/${item.attempts} rows with observed usage; ${item.cost_missing_rows} rows had no cost value, so no full-group upper bound is reported.`;
}

function tableBlock(headers, rows) {
  const head = headers.map((header) => `<th>${esc(header)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
  return `<!-- wp:table {"hasFixedLayout":false,"className":"is-style-stripes"} -->\n<figure class="wp-block-table is-style-stripes"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></figure>\n<!-- /wp:table -->`;
}

function paragraph(text, className = "") {
  const attrs = className ? ` {"className":"${className}"}` : "";
  const cls = className ? ` class="${className}"` : "";
  return `<!-- wp:paragraph${attrs} -->\n<p${cls}>${text}</p>\n<!-- /wp:paragraph -->`;
}

function heading(level, text) {
  return `<!-- wp:heading {"level":${level}} -->\n<h${level} class="wp-block-heading">${text}</h${level}>\n<!-- /wp:heading -->`;
}

function imageBlock(id, alt, caption) {
  return `<!-- wp:image {"align":"center","sizeSlug":"full","linkDestination":"none","style":{"dimensions":{"width":"75%"}}} -->\n<figure class="wp-block-image aligncenter size-full" style="width:75%"><img src="{{${id}_URL}}" alt="${esc(alt)}"/><figcaption class="wp-element-caption">${esc(caption)}</figcaption></figure>\n<!-- /wp:image -->`;
}

function listBlock(items) {
  return `<!-- wp:list -->\n<ul class="wp-block-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul>\n<!-- /wp:list -->`;
}

function faqBlock(faqs) {
  const pieces = [heading(2, "Frequently asked questions")];
  for (const item of faqs) {
    pieces.push(heading(3, esc(item.question)), paragraph(item.answer));
  }
  return pieces.join("\n\n");
}

function modelMetric(summary, model) {
  return summary.primary_accuracy.by_model.find((item) => item.group.model_id === model);
}

function generatedFaqs(summary) {
  const primary = summary.primary_accuracy;
  const flash = modelMetric(summary, "deepseek-v4-flash");
  const pro = modelMetric(summary, "deepseek-v4-pro");
  const position = Object.fromEntries(primary.by_position.map((item) => [item.group.position_id, item]));
  const flash950 = primary.by_model_tier.find((item) => item.group.model_id === "deepseek-v4-flash" && item.group.tier_id === "950k");
  const pro950 = primary.by_model_tier.find((item) => item.group.model_id === "deepseek-v4-pro" && item.group.tier_id === "950k");
  const comparison = flash.exact_match_rate === pro.exact_match_rate
    ? `The two models tied at ${flash.exact_matches}/${flash.attempts} strict exact answers in this workload.`
    : flash.exact_match_rate > pro.exact_match_rate
      ? `Flash recorded the higher task-specific strict exact rate: ${flash.exact_matches}/${flash.attempts} versus ${pro.exact_matches}/${pro.attempts} for Pro.`
      : `Pro recorded the higher task-specific strict exact rate: ${pro.exact_matches}/${pro.attempts} versus ${flash.exact_matches}/${flash.attempts} for Flash.`;
  return [
    {
      question: "Does DeepSeek support a one-million-token context window?",
      answer: "DeepSeek documented a one-million-token context capacity for the tested V4 model IDs on the protocol freeze date. This study tested provider-counted prompt tiers from 32K to approximately 950K; it did not call 950K input tokens one million input tokens.",
    },
    {
      question: "What does the DeepSeek 1M context benchmark test?",
      answer: "It tests exact single-record retrieval, a two-record join, latest-version conflict resolution, and scattered event ordering across four provider-counted prompt tiers and three target positions. It does not test general knowledge, writing quality, agents, or web search.",
    },
    {
      question: "How many prompts were tested?",
      answer: `The execution plan produced ${summary.counts.planned_calls} terminal rows: ${primary.attempts} U.S. primary cases, 20 excluded pilot calls, and 36 matched India network-vantage calls. Only the ${primary.attempts} primary cases enter the accuracy denominator.`,
    },
    {
      question: "Why test 32K, 128K, 512K, and approximately 950K tokens?",
      answer: "The four tiers show behavior from a substantial prompt to near the documented capacity. The approximately 950K band stays below the documented one-million-token context capacity; separately, the study capped each generated answer at 256 tokens. That study cap is not the model's documented maximum output, and 950K is not described as one million input tokens.",
    },
    {
      question: "Does target position affect DeepSeek retrieval accuracy?",
      answer: `Across both models, beginning targets returned ${position.beginning.exact_matches}/${position.beginning.attempts} strict exact answers, middle targets ${position.middle.exact_matches}/${position.middle.attempts}, and end targets ${position.end.exact_matches}/${position.end.attempts}. Position semantics differ by family, so the detailed table is the correct interpretation.`,
    },
    {
      question: "Which is better for long context, V4 Flash or V4 Pro?",
      answer: `${comparison} This narrow synthetic strict-JSON benchmark cannot establish a universal winner; paired outcomes, latency, cost, and the task family still matter.`,
    },
    {
      question: "How much does a near-1M-token DeepSeek API request cost?",
      answer: `For the approximately 950K primary tier, Flash had cost coverage for ${flash950.cost_observed_rows}/${flash950.attempts} rows and Pro for ${pro950.cost_observed_rows}/${pro950.attempts}. The observed-row means were ${prettyUsd(flash950.estimated_provider_cost_usd_cache_miss_known_usage_mean)} for Flash and ${prettyUsd(pro950.estimated_provider_cost_usd_cache_miss_known_usage_mean)} for Pro. A full-tier cache-miss upper bound exists only where coverage is complete. These estimates use the ${summary.pricing.snapshot_date} official-price snapshot and are not current quotes.`,
    },
    {
      question: "Does the India subset measure DeepSeek's server location or regional reliability?",
      answer: `No. It is a bounded ${summary.india_latency_validation.matched_pairs}-pair comparison from the AWS ap-south-1 client network vantage. It does not identify model-hosting location, represent Indian users, or establish recurring regional reliability.`,
    },
  ];
}

function generateArticle(summary, protocol, releaseVersion) {
  const primary = summary.primary_accuracy;
  const flash = modelMetric(summary, "deepseek-v4-flash");
  const pro = modelMetric(summary, "deepseek-v4-pro");
  const faqs = generatedFaqs(summary);
  const runDate = summary.run_window_utc.started_at.slice(0, 10);
  const modelRows = primary.by_model.map((item) => [
    item.group.model_id,
    `${item.exact_matches}/${item.attempts}`,
    prettyPercent(item.exact_match_rate),
    `${prettyPercent(item.exact_match_wilson_95.low)}–${prettyPercent(item.exact_match_wilson_95.high)}`,
    `${item.valid_json}/${item.attempts}`,
    prettyPercent(item.field_accuracy),
    prettyMs(item.latency.end_to_end.p50_ms),
    prettyMs(item.latency.end_to_end.p95_ms),
    String(item.latency.end_to_end.n),
    `${item.cost_observed_rows}/${item.attempts}`,
    item.cost_coverage_complete ? prettyUsd(item.estimated_provider_cost_usd_cache_miss_upper_bound) : `${prettyUsd(item.estimated_provider_cost_usd_cache_miss_known_usage_total)} observed-only`,
  ]);
  const tierRows = primary.by_model_tier.map((item) => [
    item.group.model_id,
    item.group.tier_id,
    `${item.exact_matches}/${item.attempts}`,
    prettyPercent(item.exact_match_rate),
    `${prettyPercent(item.exact_match_wilson_95.low)}–${prettyPercent(item.exact_match_wilson_95.high)}`,
    prettyMs(item.latency.end_to_end.p50_ms),
    prettyMs(item.latency.end_to_end.p95_ms),
    String(item.latency.end_to_end.n),
  ]);
  const familyRows = primary.by_model_family.map((item) => [item.group.model_id, item.group.family_id, `${item.exact_matches}/${item.attempts}`, prettyPercent(item.exact_match_rate), prettyPercent(item.field_accuracy)]);
  const positionRows = primary.by_model_position.map((item) => [item.group.model_id, item.group.position_id, `${item.exact_matches}/${item.attempts}`, prettyPercent(item.exact_match_rate)]);
  const pair = primary.paired_flash_vs_pro;
  const failureCount = primary.attempts - primary.exact_matches;
  const returnedModels = summary.routing.returned_models.length ? summary.routing.returned_models.join(" and ") : "none on the terminal records";
  const answerBox = `From ${esc(summary.run_window_utc.started_at)} to ${esc(summary.run_window_utc.finished_at)}, the run requested ${esc(summary.routing.requested_models.join(" and "))} and recorded returned model IDs ${esc(returnedModels)}. All ${summary.counts.planned_calls} planned attempts produced terminal records. In the 288-case U.S. primary matrix, Flash returned <strong>${flash.exact_matches}/${flash.attempts}</strong> strict exact answers (${prettyPercent(flash.exact_match_rate)}) and Pro <strong>${pro.exact_matches}/${pro.attempts}</strong> (${prettyPercent(pro.exact_match_rate)}). Primary end-to-end latency was ${prettyMs(primary.latency.end_to_end.p50_ms)} at p50 and ${prettyMs(primary.latency.end_to_end.p95_ms)} at p95 (n=${primary.latency.end_to_end.n}). ${costCoverageSentence(summary.overall_terminal_records, "The dated all-role cost estimate")} Synthetic strict-JSON tasks are not general model quality.`;

  const article = [
    `<!-- DeepSeek 1M publication template; release ${esc(releaseVersion)}; no body H1 -->`,
    ...(summary.synthetic_test_data ? [paragraph("<strong>SYNTHETIC QA ONLY — DO NOT PUBLISH OR CITE:</strong> every number and chart in this file was generated from artificial pipeline-test rows, not from the DeepSeek benchmark.", "deepseek-synthetic-warning")] : []),
    paragraph(answerBox, "deepseek-benchmark-answer"),
    paragraph(`This independent benchmark tested exact retrieval and synthesis at provider-counted prompts from 32K to approximately 950K tokens. It used deterministic synthetic English records, one paid attempt per case, streaming Chat Completions, non-thinking mode, temperature 0, JSON Output, and a strict family-specific grader. Download the <a href="{{RELEASE_URL}}">versioned public release</a> or inspect the <a href="{{REPOSITORY_URL}}">reproducible repository</a>.`),
    heading(2, "DeepSeek 1M Context Benchmark Results"),
    tableBlock(
      ["Item", "Frozen design or observed release"],
      [
        ["Protocol", protocol.protocol_id],
        ["Models", MODELS.join(", ")],
        ["Task families", "Single record, multi-hop join, latest version, event ordering"],
        ["Prompt tiers", "32K, 128K, 512K, approximately 950K"],
        ["Primary accuracy", "288 cases from us-east-1"],
        ["Excluded pilot", "20 calls: 10 per network vantage"],
        ["India validation", "36 matched single-record calls from ap-south-1"],
        ["Attempts", "One per case; no automatic retry"],
        ["Run window", `${summary.run_window_utc.started_at} to ${summary.run_window_utc.finished_at}`],
      ],
    ),
    imageBlock("CH00", "Benchmark design chart showing the three analysis roles and their separate denominators.", `Protocol ${protocol.protocol_id}; release ${releaseVersion}; 344 terminal rows split into 20 excluded pilot, 288 primary, and 36 India validation rows.`),
    heading(2, "What DeepSeek officially documents"),
    paragraph(`DeepSeek's <a href="https://api-docs.deepseek.com/quick_start/pricing/">official Models &amp; Pricing documentation</a> was the frozen source for the tested model IDs, the documented 1M context capacity, the documented 384K maximum output, and dated rates. A context capacity is an input-and-output budget, not proof that a model will retrieve or synthesize every requested detail at every position. This study targeted four returned prompt-token bands: 24K–36K, 110K–140K, 450K–550K, and 850K–980K. The final tier is described as approximately 950K, not one million input tokens. Independently of the model's documented 384K maximum, the study's request contract capped each generated answer at ${protocol.request.max_tokens} tokens; it did not test long-form maximum output.`),
    paragraph(`The current specification and planning details belong in the <a href="https://seek-chat.com/docs/deepseek-v4-context-output-limits/">DeepSeek V4 context and output limits guide</a>. This page owns the independent measured benchmark.`),
    heading(2, "Original test methodology"),
    paragraph("The corpus generator created deterministic synthetic records with objective answers and no external-knowledge requirement. Flash and Pro received the same unsalted base fixture for each matched primary condition. A deterministic role-and-region prefix separated pilot, primary, U.S., and India request prefixes while keeping the two models paired within a role and vantage."),
    heading(3, "Operational preflight disclosure"),
    paragraph("Before the paid U.S. pilot began, the first Step Functions execution stopped during the S3 result-existence preflight because the execution role lacked the required bucket-list permission. It stopped before any provider POST, so it generated no provider request or provider cost. The role was corrected with least-privilege access, and the same frozen run ID and version were launched under a clearly labeled infrastructure-only retry execution. None of the 20 paid pilot cases were retried, and the event is outside every model-result denominator."),
    listBlock([
      "<strong>Exact single-record retrieval:</strong> find one keyed record and return six exact fields.",
      "<strong>Two-record multi-hop join:</strong> find a source, follow its link, and return the linked record's fields.",
      "<strong>Latest-version conflict resolution:</strong> select the highest numeric version despite corpus order.",
      "<strong>Scattered event ordering:</strong> find four events and return their codes and checksums in sequence order.",
    ]),
    paragraph("Every response had to be one exact JSON object with the frozen keys, values, arrays, and types. No repair prompt or manual correction was allowed. Provider-reported prompt tokens determined tier validity."),
    heading(2, "Overall V4 Flash vs V4 Pro accuracy"),
    tableBlock(["Model", "Exact", "Rate", "Wilson 95% CI", "Valid JSON", "Field accuracy", "E2E p50", "E2E p95", "Latency n", "Cost coverage", "Dated cost value"], modelRows),
    paragraph(`The strict primary denominator remained 288 even when a request or output failed. There were ${failureCount} non-exact primary terminal records; their stages remain in <a href="{{ALL_ATTEMPTS_URL}}">the sanitized attempt dataset</a> and the failure table.`),
    heading(2, "Accuracy by prompt tier"),
    imageBlock("CH01", "Grouped chart of strict exact-match rate by provider-counted prompt tier for DeepSeek V4 Flash and Pro.", `Release ${releaseVersion}; ${runDate}; primary denominator 288, with 36 cases per model at each tier.`),
    tableBlock(["Model", "Tier", "Exact", "Rate", "Wilson 95% CI", "E2E p50", "E2E p95", "n"], tierRows),
    heading(2, "Accuracy by task family"),
    imageBlock("CH02", "Grouped chart of strict exact-match rate by retrieval task family for Flash and Pro.", `Release ${releaseVersion}; ${runDate}; 36 primary cases per model in each family.`),
    tableBlock(["Model", "Family", "Exact", "Rate", "Field accuracy"], familyRows),
    heading(2, "Position sensitivity"),
    imageBlock("CH03", "Grouped chart comparing strict exact-match rate at beginning, middle, and end target positions.", `Release ${releaseVersion}; ${runDate}; 48 primary cases per model at each position.`),
    tableBlock(["Model", "Position", "Exact", "Rate"], positionRows),
    heading(2, "Paired Flash-versus-Pro outcomes"),
    imageBlock("CH04", "Bar chart of both-pass, Flash-only, Pro-only, and both-fail outcomes across matched fixtures.", `Release ${releaseVersion}; ${runDate}; ${pair.complete_pairs} complete matched fixture pairs.`),
    paragraph(`Across ${pair.complete_pairs} matched fixtures, both models passed ${pair.both_pass}, Flash alone passed ${pair.flash_only_pass}, Pro alone passed ${pair.pro_only_pass}, and both failed ${pair.both_fail}. The paired exact-pass delta, Flash minus Pro, was ${prettyPercent(pair.flash_minus_pro_exact_pass_delta)}. This is a task-specific paired comparison, not a general-purpose model ranking.`),
    heading(2, "JSON and field diagnostics"),
    imageBlock("CH05", "Grouped diagnostic chart for valid JSON, exact key sets, and field accuracy by model.", `Release ${releaseVersion}; ${runDate}; all diagnostic denominators are shown in the accompanying tables and source CSV.`),
    paragraph(`Primary outputs produced ${primary.valid_json}/${primary.attempts} parseable JSON objects and ${primary.exact_key_sets}/${primary.attempts} exact key sets. At field level, ${primary.matched_fields}/${primary.total_fields} fields matched exactly (${prettyPercent(primary.field_accuracy)}). These diagnostics never override strict exact match.`),
    heading(2, "Latency, tokens, cache accounting, and dated cost"),
    imageBlock("CH06", "Grouped latency chart showing first-answer and end-to-end p50 and p95 stream time by model and prompt tier.", `Release ${releaseVersion}; ${runDate}; timings are from the disclosed us-east-1 client network vantage and show n for every group.`),
    imageBlock("CH07", "Bar chart of dated provider cost upper bounds by analysis role.", `Release ${releaseVersion}; prices frozen ${protocol.cost_controls.pricing_snapshot_date}; all ${summary.counts.planned_calls} terminal rows included.`),
    paragraph(`The U.S. primary end-to-end latency was ${prettyMs(primary.latency.end_to_end.p50_ms)} at p50 and ${prettyMs(primary.latency.end_to_end.p95_ms)} at p95 across n=${primary.latency.end_to_end.n} transport-complete streams. ${costCoverageSentence(summary.overall_terminal_records, "The all-role known-usage cost estimate")} These figures use the dated ${protocol.cost_controls.pricing_snapshot_date} price snapshot and are not a current price quote.`),
    paragraph(`For current implementation guidance, see the <a href="https://seek-chat.com/docs/api/">DeepSeek API guide</a>, <a href="https://seek-chat.com/docs/deepseek-context-caching/">context-caching guide</a>, and <a href="https://seek-chat.com/pricing/">current pricing page</a>.`),
    heading(2, "Failure and exclusion accounting"),
    imageBlock("CH08", "Funnel chart reconciling 344 planned calls and the separate 288-case primary grading stages.", `Release ${releaseVersion}; 20 pilot rows and 36 India rows are excluded from the primary accuracy denominator.`),
    paragraph("All terminal states stay visible. The public failure file distinguishes transport, prompt-tier calibration, JSON parsing, exact-key, and strict-value stages. There was no automatic retry and no failed row was silently removed from its assigned denominator."),
    heading(2, "Provider-counted prompt lengths"),
    imageBlock("CH09", "Chart comparing returned prompt-token distributions with the four frozen accepted tiers.", `Release ${releaseVersion}; ${runDate}; primary cases only; target and accepted intervals come from protocol v1.1.0.`),
    heading(2, "Matched India network-vantage validation"),
    imageBlock("CH10", "Bar chart of paired India-minus-US end-to-end latency deltas by model and edge prompt tier.", `Release ${releaseVersion}; ${runDate}; ${summary.india_latency_validation.matched_pairs} matched single-record pairs; network-vantage interpretation only.`),
    paragraph(`The India slice contains ${summary.india_latency_validation.matched_pairs} matched single-record pairs at 32K and approximately 950K. Across available paired end-to-end timings, the India-minus-U.S. delta had p50 ${prettyMs(summary.india_latency_validation.end_to_end_delta_ms.p50_ms)} and p95 ${prettyMs(summary.india_latency_validation.end_to_end_delta_ms.p95_ms)} with n=${summary.india_latency_validation.end_to_end_delta_ms.n}. This labels AWS client network vantages, not Indian users, model-hosting location, or recurring reliability. Ongoing availability belongs in the <a href="https://seek-chat.com/research/deepseek-reliability-report/">regional DeepSeek reliability report</a>.`),
    heading(2, "Reproducibility and downloads"),
    listBlock([
      '<a href="{{PRIMARY_CASES_URL}}">Primary 288-case CSV</a>',
      '<a href="{{INDIA_CASES_URL}}">India 36-pair validation CSV</a>',
      '<a href="{{ALL_ATTEMPTS_URL}}">All 344 sanitized terminal rows</a>',
      '<a href="{{SUMMARY_URL}}">Canonical JSON summary</a>',
      '<a href="{{RELEASE_URL}}">Versioned release, protocol, calibration, charts, QA, and checksums</a>',
    ]),
    paragraph("The public rows are reconstructed through an explicit allowlist. They exclude credentials, authorization headers, raw prompts, raw response bodies, private S3 object keys, local paths, and account data. The validator export contains aggregate field counts rather than per-field expected and observed values, so the release does not fabricate a field-level dataset."),
    heading(2, "Limitations"),
    listBlock(summary.interpretation_boundaries.map(esc)),
    paragraph(`This work belongs to the <a href="${DEFAULTS.researchHubUrl}">DeepSeek research hub</a> and supports the site's <a href="https://seek-chat.com/">independent DeepSeek AI guide</a>. For model internals rather than measurements, use the <a href="https://seek-chat.com/docs/deepseek-v4-architecture/">DeepSeek V4 architecture explainer</a>.`),
    heading(2, "Sources and related research"),
    listBlock([
      '<a href="https://api-docs.deepseek.com/quick_start/pricing/">DeepSeek Models &amp; Pricing</a> — current model specifications and the dated price source.',
      '<a href="https://api-docs.deepseek.com/api/create-chat-completion">Create Chat Completion</a> — streaming, model, finish-reason, fingerprint, and usage fields.',
      '<a href="https://api-docs.deepseek.com/guides/kv_cache">DeepSeek Context Caching</a> — cache behavior and returned hit/miss accounting.',
      '<a href="https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro">Official DeepSeek V4 Pro model card</a> and <a href="https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/DeepSeek_V4.pdf">technical report</a> — vendor architecture and vendor-reported benchmarks.',
      '<a href="https://arxiv.org/abs/2605.02173">Retrieval and Multi-Hop Reasoning in 1M-Token Context Windows</a> — separate independent research with a different protocol and corpus.',
    ]),
    faqBlock(faqs),
  ];

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${DEFAULTS.canonicalUrl}#article`,
        url: DEFAULTS.canonicalUrl,
        headline: "DeepSeek 1M Context Benchmark: Retrieval Accuracy, Latency, and Cost",
        description: SERP_META_DESCRIPTION,
        datePublished: "{{DATE_PUBLISHED}}",
        dateModified: "{{DATE_MODIFIED}}",
        inLanguage: "en",
        mainEntityOfPage: DEFAULTS.canonicalUrl,
        isPartOf: { "@id": `${DEFAULTS.researchHubUrl}#webpage` },
        author: { "@id": "{{AUTHOR_ID}}" },
        publisher: { "@id": "{{PUBLISHER_ID}}" },
        image: ["{{FEATURED_IMAGE_URL}}", ...Array.from({ length: 11 }, (_, index) => `{{CH${String(index).padStart(2, "0")}_URL}}`)],
        about: ["DeepSeek V4", "long-context language models", "model evaluation"],
        isBasedOn: "{{RELEASE_URL}}",
        subjectOf: { "@id": `${DEFAULTS.canonicalUrl}#dataset` },
      },
      {
        "@type": "Dataset",
        "@id": `${DEFAULTS.canonicalUrl}#dataset`,
        name: "DeepSeek 1M Context Benchmark Dataset",
        description: `A ${summary.counts.planned_calls}-row DeepSeek V4 long-context release with separate pilot, U.S. primary, and India network-vantage roles.`,
        url: "{{RELEASE_URL}}",
        sameAs: "{{RELEASE_URL}}",
        creator: { "@id": "{{PUBLISHER_ID}}" },
        datePublished: "{{DATE_PUBLISHED}}",
        dateModified: "{{DATE_MODIFIED}}",
        version: releaseVersion,
        license: "https://creativecommons.org/licenses/by/4.0/",
        measurementTechnique: "Deterministic synthetic long-context API benchmark with family-specific strict exact JSON grading",
        temporalCoverage: `${summary.run_window_utc.started_at}/${summary.run_window_utc.finished_at}`,
        variableMeasured: ["Strict exact-match rate", "Field accuracy", "Valid-JSON rate", "Prompt and cache tokens", "Time to first answer token", "End-to-end stream time", "Estimated provider cost"],
        distribution: [
          { "@type": "DataDownload", name: "All attempts", contentUrl: "{{ALL_ATTEMPTS_URL}}", encodingFormat: "text/csv" },
          { "@type": "DataDownload", name: "Primary cases", contentUrl: "{{PRIMARY_CASES_URL}}", encodingFormat: "text/csv" },
          { "@type": "DataDownload", name: "India latency cases", contentUrl: "{{INDIA_CASES_URL}}", encodingFormat: "text/csv" },
          { "@type": "DataDownload", name: "Summary", contentUrl: "{{SUMMARY_URL}}", encodingFormat: "application/json" },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${DEFAULTS.canonicalUrl}#faq`,
        mainEntity: faqs.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer.replace(/<[^>]+>/g, "") } })),
      },
      {
        "@type": "Person",
        "@id": "{{AUTHOR_ID}}",
        name: "Seek-Chat",
        url: "{{AUTHOR_ID}}",
      },
      {
        "@type": "Organization",
        "@id": "{{PUBLISHER_ID}}",
        name: "Seek-Chat",
        url: "https://seek-chat.com/",
        logo: {
          "@type": "ImageObject",
          "@id": "https://seek-chat.com/#logo",
          url: "https://seek-chat.com/wp-content/uploads/2026/01/deep-ai-logo.png",
          contentUrl: "https://seek-chat.com/wp-content/uploads/2026/01/deep-ai-logo.png",
          width: 765,
          height: 267,
        },
      },
    ],
  };
  article.push(`<!-- wp:html -->\n<script type="application/ld+json">${JSON.stringify(graph)}</script>\n<!-- /wp:html -->`);
  return `${article.join("\n\n")}\n`;
}

function svgChart(spec) {
  const width = 1600;
  const height = 900;
  const margin = { left: 150, right: 70, top: 190, bottom: 150 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const all = spec.series.flatMap((series) => series.values.filter(Number.isFinite));
  const minRaw = Math.min(0, ...all);
  const maxRaw = Math.max(1, ...all);
  const span = maxRaw - minRaw || 1;
  const minY = spec.unit === "rate" ? 0 : minRaw < 0 ? minRaw - span * 0.08 : 0;
  const maxY = spec.unit === "rate" ? 1 : spec.unit === "usd" ? niceTickStep(maxRaw / 5) * 5 : maxRaw + span * 0.12;
  const y = (value) => margin.top + plotH - ((value - minY) / (maxY - minY)) * plotH;
  const zeroY = y(0);
  const groupW = plotW / spec.categories.length;
  const barW = Math.min(92, (groupW * 0.72) / spec.series.length);
  const format = spec.valueFormat ?? ((value) => String(value));
  const axisFormat = spec.axisValueFormat ?? format;
  const svgTitleSize = Math.max(24, Math.min(42, Math.floor(1420 / Math.max(1, spec.title.length * 0.62))));
  const svgSubtitleSize = Math.max(16, Math.min(22, Math.floor(1420 / Math.max(1, spec.subtitle.length * 0.58))));
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${esc(spec.title)}</title>`,
    `<desc id="desc">${esc(spec.description)}</desc>`,
    '<rect width="1600" height="900" fill="#f8fafc"/>',
    '<rect x="40" y="40" width="1520" height="820" rx="28" fill="#ffffff" stroke="#dbeafe" stroke-width="2"/>',
    `<text x="800" y="105" text-anchor="middle" font-family="Arial, sans-serif" font-size="${svgTitleSize}" font-weight="700" fill="#0f172a">${esc(spec.title)}</text>`,
    `<text x="800" y="150" text-anchor="middle" font-family="Arial, sans-serif" font-size="${svgSubtitleSize}" fill="#475569">${esc(spec.subtitle)}</text>`,
  ];
  for (let tick = 0; tick <= 5; tick += 1) {
    const value = minY + ((maxY - minY) * tick) / 5;
    const yy = y(value);
    lines.push(`<line x1="${margin.left}" y1="${yy.toFixed(1)}" x2="${width - margin.right}" y2="${yy.toFixed(1)}" stroke="#e2e8f0"/>`);
    lines.push(`<text x="${margin.left - 20}" y="${(yy + 7).toFixed(1)}" text-anchor="end" font-family="Arial, sans-serif" font-size="20" fill="#64748b">${esc(axisFormat(value))}</text>`);
  }
  lines.push(`<line x1="${margin.left}" y1="${zeroY.toFixed(1)}" x2="${width - margin.right}" y2="${zeroY.toFixed(1)}" stroke="#64748b" stroke-width="2"/>`);
  const showBarValues = spec.series.length <= 2 || spec.categories.length <= 4;
  spec.categories.forEach((category, categoryIndex) => {
    const groupX = margin.left + categoryIndex * groupW;
    lines.push(`<text x="${(groupX + groupW / 2).toFixed(1)}" y="${height - margin.bottom + 44}" text-anchor="middle" font-family="Arial, sans-serif" font-size="21" fill="#334155">${esc(category)}</text>`);
    spec.series.forEach((series, seriesIndex) => {
      const value = series.values[categoryIndex];
      if (!Number.isFinite(value)) return;
      const x = groupX + groupW / 2 - (spec.series.length * barW) / 2 + seriesIndex * barW;
      const valueY = y(value);
      const top = Math.min(valueY, zeroY);
      const h = Math.max(2, Math.abs(zeroY - valueY));
      lines.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(barW - 5).toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${series.color}"/>`);
      if (showBarValues) lines.push(`<text x="${(x + (barW - 5) / 2).toFixed(1)}" y="${(value >= 0 ? top - 10 : top + h + 25).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0f172a">${esc(format(value))}</text>`);
    });
  });
  let legendX = 90;
  for (const series of spec.series) {
    lines.push(`<rect x="${legendX}" y="815" width="22" height="22" rx="4" fill="${series.color}"/>`);
    lines.push(`<text x="${legendX + 32}" y="833" font-family="Arial, sans-serif" font-size="19" fill="#334155">${esc(series.name)}</text>`);
    legendX += Math.max(200, series.name.length * 13 + 70);
  }
  lines.push(`<text x="1510" y="833" text-anchor="end" font-family="Arial, sans-serif" font-size="17" fill="#64748b">${esc(spec.footer)}</text>`);
  lines.push("</svg>");
  return `${lines.join("\n")}\n`;
}

const FONT = {
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "A": ["01110","10001","10001","11111","10001","10001","10001"], "B": ["11110","10001","10001","11110","10001","10001","11110"],
  "C": ["01111","10000","10000","10000","10000","10000","01111"], "D": ["11110","10001","10001","10001","10001","10001","11110"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"], "F": ["11111","10000","10000","11110","10000","10000","10000"],
  "G": ["01111","10000","10000","10111","10001","10001","01111"], "H": ["10001","10001","10001","11111","10001","10001","10001"],
  "I": ["11111","00100","00100","00100","00100","00100","11111"], "J": ["00111","00010","00010","00010","10010","10010","01100"],
  "K": ["10001","10010","10100","11000","10100","10010","10001"], "L": ["10000","10000","10000","10000","10000","10000","11111"],
  "M": ["10001","11011","10101","10101","10001","10001","10001"], "N": ["10001","11001","10101","10011","10001","10001","10001"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"], "P": ["11110","10001","10001","11110","10000","10000","10000"],
  "Q": ["01110","10001","10001","10001","10101","10010","01101"], "R": ["11110","10001","10001","11110","10100","10010","10001"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"], "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"], "V": ["10001","10001","10001","10001","10001","01010","00100"],
  "W": ["10001","10001","10001","10101","10101","10101","01010"], "X": ["10001","10001","01010","00100","01010","10001","10001"],
  "Y": ["10001","10001","01010","00100","00100","00100","00100"], "Z": ["11111","00001","00010","00100","01000","10000","11111"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"], "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"], "3": ["11110","00001","00001","01110","00001","00001","11110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"], "5": ["11111","10000","10000","11110","00001","00001","11110"],
  "6": ["01110","10000","10000","11110","10001","10001","01110"], "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"], "9": ["01110","10001","10001","01111","00001","00001","01110"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"], ".": ["00000","00000","00000","00000","00000","01100","01100"],
  ":": ["00000","01100","01100","00000","01100","01100","00000"], "%": ["11001","11010","00100","01000","10110","00110","00000"],
  "/": ["00001","00010","00100","01000","10000","00000","00000"], "(": ["00010","00100","01000","01000","01000","00100","00010"],
  ")": ["01000","00100","00010","00010","00010","00100","01000"], "+": ["00000","00100","00100","11111","00100","00100","00000"],
  "_": ["00000","00000","00000","00000","00000","00000","11111"], "?": ["01110","10001","00001","00010","00100","00000","00100"],
  "~": ["00000","00000","01001","10110","00000","00000","00000"], "|": ["00100","00100","00100","00100","00100","00100","00100"],
  "=": ["00000","11111","00000","11111","00000","00000","00000"], "$": ["00100","01111","10100","01110","00101","11110","00100"],
  ",": ["00000","00000","00000","00000","00110","00100","01000"], ";": ["00000","00110","00110","00000","00110","00100","01000"],
};

function parseHex(color) {
  const clean = color.replace("#", "");
  return [Number.parseInt(clean.slice(0, 2), 16), Number.parseInt(clean.slice(2, 4), 16), Number.parseInt(clean.slice(4, 6), 16), 255];
}

function makeRaster(width, height, background = "#f8fafc") {
  const pixels = Buffer.alloc(width * height * 4);
  const bg = parseHex(background);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = bg[0]; pixels[index + 1] = bg[1]; pixels[index + 2] = bg[2]; pixels[index + 3] = 255;
  }
  const fillRect = (x, y, w, h, color) => {
    const rgba = parseHex(color);
    const x0 = Math.max(0, Math.floor(x)); const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(width, Math.ceil(x + w)); const y1 = Math.min(height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) {
      const offset = (yy * width + xx) * 4;
      pixels[offset] = rgba[0]; pixels[offset + 1] = rgba[1]; pixels[offset + 2] = rgba[2]; pixels[offset + 3] = 255;
    }
  };
  const textWidth = (text, scale) => String(text).length * 6 * scale;
  const drawText = (x, y, text, scale, color, align = "left") => {
    const normalized = String(text).toUpperCase().replace(/[^A-Z0-9 .:%/()_+\-~|=$,;]/g, "?");
    let cursor = align === "center" ? x - textWidth(normalized, scale) / 2 : align === "right" ? x - textWidth(normalized, scale) : x;
    const rgba = color;
    for (const char of normalized) {
      const glyph = FONT[char] ?? FONT["?"];
      glyph.forEach((line, gy) => [...line].forEach((bit, gx) => { if (bit === "1") fillRect(cursor + gx * scale, y + gy * scale, scale, scale, rgba); }));
      cursor += 6 * scale;
    }
  };
  return { pixels, fillRect, drawText, textWidth };
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dest = y * (width * 4 + 1);
    scanlines[dest] = 0;
    pixels.copy(scanlines, dest + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChart(spec) {
  const width = 1600; const height = 900;
  const raster = makeRaster(width, height);
  const { fillRect, drawText, textWidth, pixels } = raster;
  fillRect(40, 40, 1520, 820, "#ffffff");
  const titleScale = Math.max(2, Math.min(5, Math.floor(1420 / Math.max(1, textWidth(spec.title, 1)))));
  const subtitleText = spec.subtitle.slice(0, 120);
  const subtitleScale = Math.max(2, Math.min(3, Math.floor(1420 / Math.max(1, textWidth(subtitleText, 1)))));
  drawText(width / 2, 82, spec.title, titleScale, "#0f172a", "center");
  drawText(width / 2, 142, subtitleText, subtitleScale, "#475569", "center");
  const margin = { left: 150, right: 70, top: 210, bottom: 160 };
  const plotW = width - margin.left - margin.right; const plotH = height - margin.top - margin.bottom;
  const values = spec.series.flatMap((series) => series.values.filter(Number.isFinite));
  const minRaw = Math.min(0, ...values); const maxRaw = Math.max(1, ...values); const span = maxRaw - minRaw || 1;
  const minY = spec.unit === "rate" ? 0 : minRaw < 0 ? minRaw - span * 0.08 : 0; const maxY = spec.unit === "rate" ? 1 : spec.unit === "usd" ? niceTickStep(maxRaw / 5) * 5 : maxRaw + span * 0.12;
  const y = (value) => margin.top + plotH - ((value - minY) / (maxY - minY)) * plotH;
  const zeroY = y(0); const groupW = plotW / spec.categories.length;
  const barW = Math.min(92, (groupW * 0.72) / spec.series.length);
  const format = spec.valueFormat ?? ((value) => String(Math.round(value)));
  const axisFormat = spec.axisValueFormat ?? format;
  for (let tick = 0; tick <= 5; tick += 1) {
    const value = minY + ((maxY - minY) * tick) / 5; const yy = y(value);
    fillRect(margin.left, yy, plotW, 2, "#e2e8f0");
    drawText(margin.left - 18, yy - 9, axisFormat(value), 2, "#64748b", "right");
  }
  fillRect(margin.left, zeroY, plotW, 3, "#64748b");
  const showBarValues = spec.series.length <= 2 || spec.categories.length <= 4;
  spec.categories.forEach((category, categoryIndex) => {
    const groupX = margin.left + categoryIndex * groupW;
    drawText(groupX + groupW / 2, height - margin.bottom + 38, category, 3, "#334155", "center");
    spec.series.forEach((series, seriesIndex) => {
      const value = series.values[categoryIndex]; if (!Number.isFinite(value)) return;
      const x = groupX + groupW / 2 - (spec.series.length * barW) / 2 + seriesIndex * barW;
      const valueY = y(value); const top = Math.min(valueY, zeroY); const h = Math.max(3, Math.abs(zeroY - valueY));
      fillRect(x, top, barW - 5, h, series.color);
      if (showBarValues) drawText(x + (barW - 5) / 2, value >= 0 ? top - 26 : top + h + 8, format(value), 2, "#0f172a", "center");
    });
  });
  let legendX = 90;
  for (const series of spec.series) {
    fillRect(legendX, 815, 22, 22, series.color);
    drawText(legendX + 32, 814, series.name, 3, "#334155");
    legendX += Math.max(220, series.name.length * 20 + 80);
  }
  drawText(1510, 846, spec.footer.slice(0, 118), 2, "#64748b", "right");
  return encodePng(width, height, pixels);
}

function niceTickStep(roughStep) {
  if (!Number.isFinite(roughStep) || roughStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function chartSpec(id, title, subtitle, description, categories, series, unit, footer) {
  const valueFormat = unit === "rate" ? (value) => `${Math.round(value * 100)}%` : unit === "usd" ? (value) => `$${Number(value).toFixed(3)}` : unit === "seconds" ? (value) => `${(value / 1000).toFixed(1)}S` : unit === "ms" ? (value) => `${Math.round(value)}MS` : unit === "tokens" ? (value) => `${Math.round(value / 1000)}K` : (value) => `${Math.round(value)}`;
  const axisValueFormat = unit === "usd" ? (value) => Number.isInteger(value) ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}` : valueFormat;
  return { id, title, subtitle: subtitle.replaceAll(" | ", " - "), description, categories, series, unit, valueFormat, axisValueFormat, footer: footer.replaceAll(" | ", " - ") };
}

function valueFor(groups, criteria, field) {
  const item = groups.find((candidate) => Object.entries(criteria).every(([key, value]) => candidate.group[key] === value));
  ensure(item, `missing metric group ${JSON.stringify(criteria)}`);
  return item[field];
}

function chartDefinitions(summary, protocol) {
  const primary = summary.primary_accuracy;
  const byModel = primary.by_model;
  const pair = primary.paired_flash_vs_pro;
  const roleMetrics = [summary.pilot_excluded, summary.primary_accuracy, summary.india_latency_validation];
  const returnedByTier = TIERS.map((tier) => {
    const rows = summary._primary_rows.filter((row) => row.tier_id === tier).map((row) => numberOrNull(row.prompt_tokens)).filter(Number.isFinite);
    return { tier, min: Math.min(...rows), median: percentile(rows, 0.5), max: Math.max(...rows) };
  });
  const indiaDeltas = summary._india_pairs;
  const latencyCategory = (model, tier) => {
    const label = `${model.endsWith("flash") ? "F" : "P"}${tier.replace("k", "").toUpperCase()}`;
    const n = valueFor(primary.by_model_tier, { model_id: model, tier_id: tier }, "latency").end_to_end.n;
    return `${label} N${n}`;
  };
  const indiaCategory = (model, tier) => {
    const label = `${model.endsWith("flash") ? "F" : "P"}${tier.replace("k", "").toUpperCase()}`;
    const n = indiaDeltas.filter((row) => row.model_id === model && row.tier_id === tier && Number.isFinite(numberOrNull(row.end_to_end_delta_ms))).length;
    return `${label} N${n}`;
  };
  const specs = [
    chartSpec("CH00", "Frozen Benchmark Design", "Three roles; separate denominators; one attempt per call", "Calls assigned to pilot, primary, and India validation roles.", ["PILOT", "PRIMARY", "INDIA"], [{ name: "PLANNED CALLS", color: COLORS[0], values: [summary.counts.pilot_excluded, summary.counts.primary_accuracy, summary.counts.india_latency_validation] }], "count", `PROTOCOL V1.1.0 | N=${summary.counts.terminal_rows}`),
    chartSpec("CH01", "Strict Exact Match by Prompt Tier", "Primary accuracy; 36 cases per model and tier", "Strict exact-match rates by provider-counted prompt tier.", ["32K", "128K", "512K", "~950K"], MODELS.map((model, index) => ({ name: model.endsWith("flash") ? "V4 FLASH" : "V4 PRO", color: COLORS[index], values: TIERS.map((tier) => valueFor(primary.by_model_tier, { model_id: model, tier_id: tier }, "exact_match_rate")) })), "rate", "PRIMARY N=288 | 95% CI IN SOURCE TABLE"),
    chartSpec("CH02", "Strict Exact Match by Task Family", "Primary accuracy; 36 cases per model and family", "Strict exact-match rates by task family.", ["SINGLE", "JOIN", "LATEST", "ORDER"], MODELS.map((model, index) => ({ name: model.endsWith("flash") ? "V4 FLASH" : "V4 PRO", color: COLORS[index], values: FAMILIES.map((family) => valueFor(primary.by_model_family, { model_id: model, family_id: family }, "exact_match_rate")) })), "rate", "PRIMARY N=288"),
    chartSpec("CH03", "Strict Exact Match by Target Position", "Primary accuracy; 48 cases per model and position", "Strict exact-match rates at beginning, middle, and end positions.", ["BEGIN", "MIDDLE", "END"], MODELS.map((model, index) => ({ name: model.endsWith("flash") ? "V4 FLASH" : "V4 PRO", color: COLORS[index], values: POSITIONS.map((position) => valueFor(primary.by_model_position, { model_id: model, position_id: position }, "exact_match_rate")) })), "rate", "PRIMARY N=288"),
    chartSpec("CH04", "Flash vs Pro Matched Outcomes", "One outcome for each of 144 matched base fixtures", "Paired exact-match outcomes for Flash and Pro.", ["BOTH PASS", "FLASH ONLY", "PRO ONLY", "BOTH FAIL"], [{ name: "MATCHED PAIRS", color: COLORS[3], values: [pair.both_pass, pair.flash_only_pass, pair.pro_only_pass, pair.both_fail] }], "count", "COMPLETE PAIRS N=144"),
    chartSpec("CH05", "JSON and Field Diagnostics", "Diagnostics do not override strict exact match", "Valid JSON, exact key-set, and weighted field-accuracy rates by model.", ["VALID JSON", "EXACT KEYS", "FIELD ACC"], MODELS.map((model, index) => { const item = byModel.find((candidate) => candidate.group.model_id === model); return { name: model.endsWith("flash") ? "V4 FLASH" : "V4 PRO", color: COLORS[index], values: [item.valid_json_rate, item.exact_key_set_rate, item.field_accuracy] }; }), "rate", "PRIMARY N=288"),
    chartSpec("CH06", "Observed US Primary Streaming Time", "first-answer and end-to-end p50/p95 by model and prompt tier", "Streaming latency from the us-east-1 client network vantage.", MODELS.flatMap((model) => TIERS.map((tier) => latencyCategory(model, tier))), [{ name: "FIRST P50", color: COLORS[2], values: MODELS.flatMap((model) => TIERS.map((tier) => valueFor(primary.by_model_tier, { model_id: model, tier_id: tier }, "latency").first_answer_token.p50_ms)) }, { name: "FIRST P95", color: COLORS[0], values: MODELS.flatMap((model) => TIERS.map((tier) => valueFor(primary.by_model_tier, { model_id: model, tier_id: tier }, "latency").first_answer_token.p95_ms)) }, { name: "E2E P50", color: COLORS[1], values: MODELS.flatMap((model) => TIERS.map((tier) => valueFor(primary.by_model_tier, { model_id: model, tier_id: tier }, "latency").end_to_end.p50_ms)) }, { name: "E2E P95", color: COLORS[4], values: MODELS.flatMap((model) => TIERS.map((tier) => valueFor(primary.by_model_tier, { model_id: model, tier_id: tier }, "latency").end_to_end.p95_ms)) }], "ms", "US-EAST-1 CLIENT VANTAGE | EXACT N IN EACH CATEGORY"),
    chartSpec("CH07", "Dated Known-Usage Cost by Analysis Role", `Observed-row sums using the ${protocol.cost_controls.pricing_snapshot_date} snapshot`, "Known-usage cost sums by analysis role; incomplete groups are not full-group upper bounds.", roleMetrics.map((item, index) => `${["PILOT", "PRIMARY", "INDIA"][index]} N${item.cost_observed_rows}/${item.attempts}`), [{ name: "KNOWN-USAGE USD", color: COLORS[1], values: roleMetrics.map((item) => item.estimated_provider_cost_usd_cache_miss_known_usage_total) }], "usd", "FULL UPPER BOUND ONLY WHERE COST COVERAGE N=ATTEMPTS"),
    chartSpec("CH08", "Execution and Primary Grading Funnel", "Roles reconcile separately before the strict primary funnel", "Execution-role counts and primary grading stages.", ["ALL", "PILOT", "PRIMARY", "INDIA", "STREAM", "JSON", "KEYS", "EXACT"], [{ name: "TERMINAL COUNT", color: COLORS[0], values: [summary.counts.terminal_rows, summary.counts.pilot_excluded, summary.counts.primary_accuracy, summary.counts.india_latency_validation, primary.transport_complete, primary.valid_json, primary.exact_key_sets, primary.exact_matches] }], "count", `PRIMARY DENOMINATOR=${primary.denominator}`),
    chartSpec("CH09", "Provider-Counted Primary Prompt Tokens", "Median returned prompt tokens; min and max retained in source CSV", "Median provider-returned prompt tokens by frozen tier.", ["32K", "128K", "512K", "~950K"], [{ name: "RETURNED MEDIAN", color: COLORS[2], values: returnedByTier.map((item) => item.median) }, { name: "FROZEN TARGET", color: COLORS[5], values: protocol.context_tiers.map((tier) => tier.target_prompt_tokens) }], "tokens", "PRIMARY N=288"),
    chartSpec("CH10", "India Minus US Paired End-to-End Latency", "Median paired delta by model and edge prompt tier", "Paired end-to-end latency deltas between ap-south-1 and us-east-1 client vantages.", MODELS.flatMap((model) => ["32k", "950k"].map((tier) => indiaCategory(model, tier))), [{ name: "MEDIAN DELTA MS", color: COLORS[3], values: MODELS.flatMap((model) => ["32k", "950k"].map((tier) => percentile(indiaDeltas.filter((row) => row.model_id === model && row.tier_id === tier).map((row) => numberOrNull(row.end_to_end_delta_ms)).filter(Number.isFinite), 0.5))) }], "ms", `COORDINATE PAIRS N=${indiaDeltas.length} | COMPLETE TIMING N=${summary.india_latency_validation.transport_complete_timing_pairs}`),
  ];
  return { specs, returnedByTier };
}

function chartDataRows(spec) {
  const rows = [];
  spec.categories.forEach((category, index) => {
    for (const series of spec.series) rows.push({ chart_id: spec.id, category, series: series.name, value: series.values[index], unit: spec.unit });
  });
  return rows;
}

function writeCharts(outputDir, summary, protocol) {
  const chartsRoot = path.join(outputDir, "charts");
  const { specs, returnedByTier } = chartDefinitions(summary, protocol);
  if (summary.synthetic_test_data) {
    for (const spec of specs) {
      spec.title = `SYNTHETIC TEST - ${spec.title}`;
      spec.subtitle = `NOT BENCHMARK RESULTS - ${spec.subtitle}`;
      spec.footer = `SYNTHETIC QA ONLY - ${spec.footer}`;
      spec.description = `Synthetic pipeline QA chart. Do not cite or publish. ${spec.description}`;
    }
  }
  fs.mkdirSync(path.join(chartsRoot, "svg"), { recursive: true });
  fs.mkdirSync(path.join(chartsRoot, "png"), { recursive: true });
  fs.mkdirSync(path.join(chartsRoot, "data"), { recursive: true });
  const inventory = [];
  for (const spec of specs) {
    const stem = `${spec.id.toLowerCase()}-${spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const svgFile = path.join(chartsRoot, "svg", `${stem}.svg`);
    const pngFile = path.join(chartsRoot, "png", `${stem}.png`);
    const dataFile = path.join(chartsRoot, "data", `${stem}.csv`);
    fs.writeFileSync(svgFile, svgChart(spec), "utf8");
    fs.writeFileSync(pngFile, pngChart(spec));
    writeCsv(dataFile, chartDataRows(spec), ["chart_id", "category", "series", "value", "unit"]);
    const sourceByChart = {
      CH00: ["release/release-case-inventory.csv"],
      CH01: ["tables/primary-by-model-tier.csv"],
      CH02: ["tables/primary-by-model-family.csv"],
      CH03: ["tables/primary-by-model-position.csv"],
      CH04: ["tables/paired-flash-pro-outcomes.csv"],
      CH05: ["tables/primary-by-model.csv"],
      CH06: ["tables/primary-by-model-tier.csv"],
      CH07: ["tables/analysis-role-summary.csv"],
      CH08: ["tables/primary-funnel.csv"],
      CH09: ["charts/data/ch09-returned-prompt-token-range.csv", "release/protocol.json"],
      CH10: ["tables/india-paired-latency-summary.csv", "release/india-matched-pairs.csv"],
    };
    inventory.push({ id: spec.id, title: spec.title, svg: path.relative(outputDir, svgFile).replaceAll("\\", "/"), png: path.relative(outputDir, pngFile).replaceAll("\\", "/"), data: path.relative(outputDir, dataFile).replaceAll("\\", "/"), width_px: 1600, height_px: 900, source_files: sourceByChart[spec.id] });
  }
  writeCsv(path.join(chartsRoot, "data", "ch09-returned-prompt-token-range.csv"), returnedByTier.map((item) => ({ tier_id: item.tier, returned_min: item.min, returned_median: item.median, returned_max: item.max })), ["tier_id", "returned_min", "returned_median", "returned_max"]);
  writeJson(path.join(chartsRoot, "chart-inventory.json"), { schema_version: "1.0.0", charts: inventory });
  return inventory;
}

function metricTableRow(item) {
  return {
    ...item.group,
    attempts: item.attempts,
    transport_complete: item.transport_complete,
    exact_matches: item.exact_matches,
    exact_match_rate: item.exact_match_rate,
    wilson_95_low: item.exact_match_wilson_95.low,
    wilson_95_high: item.exact_match_wilson_95.high,
    valid_json: item.valid_json,
    valid_json_rate: item.valid_json_rate,
    exact_key_sets: item.exact_key_sets,
    exact_key_set_rate: item.exact_key_set_rate,
    matched_fields: item.matched_fields,
    total_fields: item.total_fields,
    field_accuracy: item.field_accuracy,
    first_answer_p50_ms: item.latency.first_answer_token.p50_ms,
    first_answer_p95_ms: item.latency.first_answer_token.p95_ms,
    first_answer_n: item.latency.first_answer_token.n,
    end_to_end_p50_ms: item.latency.end_to_end.p50_ms,
    end_to_end_p95_ms: item.latency.end_to_end.p95_ms,
    end_to_end_n: item.latency.end_to_end.n,
    usage_observed_rows: item.usage_observed_rows,
    usage_missing_rows: item.usage_missing_rows,
    usage_coverage_complete: item.usage_coverage_complete,
    prompt_tokens_known_usage_total: item.prompt_tokens_known_usage_total,
    cache_hit_tokens_known_usage_total: item.cache_hit_tokens_known_usage_total,
    cache_miss_tokens_known_usage_total: item.cache_miss_tokens_known_usage_total,
    completion_tokens_known_usage_total: item.completion_tokens_known_usage_total,
    prompt_tokens_complete_total: item.prompt_tokens,
    cache_hit_tokens_complete_total: item.cache_hit_tokens,
    cache_miss_tokens_complete_total: item.cache_miss_tokens,
    completion_tokens_complete_total: item.completion_tokens,
    cost_observed_rows: item.cost_observed_rows,
    cost_missing_rows: item.cost_missing_rows,
    cost_coverage_complete: item.cost_coverage_complete,
    estimated_cost_usd_cache_miss_known_usage_total: item.estimated_provider_cost_usd_cache_miss_known_usage_total,
    estimated_cost_usd_cache_miss_known_usage_mean: item.estimated_provider_cost_usd_cache_miss_known_usage_mean,
    estimated_cost_usd_cache_miss_upper_bound: item.estimated_provider_cost_usd_cache_miss_upper_bound,
  };
}

function writeResultTables(outputDir, summary) {
  const root = path.join(outputDir, "tables");
  fs.mkdirSync(root, { recursive: true });
  const metricColumns = ["attempts", "transport_complete", "exact_matches", "exact_match_rate", "wilson_95_low", "wilson_95_high", "valid_json", "valid_json_rate", "exact_key_sets", "exact_key_set_rate", "matched_fields", "total_fields", "field_accuracy", "first_answer_p50_ms", "first_answer_p95_ms", "first_answer_n", "end_to_end_p50_ms", "end_to_end_p95_ms", "end_to_end_n", "usage_observed_rows", "usage_missing_rows", "usage_coverage_complete", "prompt_tokens_known_usage_total", "cache_hit_tokens_known_usage_total", "cache_miss_tokens_known_usage_total", "completion_tokens_known_usage_total", "prompt_tokens_complete_total", "cache_hit_tokens_complete_total", "cache_miss_tokens_complete_total", "completion_tokens_complete_total", "cost_observed_rows", "cost_missing_rows", "cost_coverage_complete", "estimated_cost_usd_cache_miss_known_usage_total", "estimated_cost_usd_cache_miss_known_usage_mean", "estimated_cost_usd_cache_miss_upper_bound"];
  const groups = [
    ["primary-by-model.csv", summary.primary_accuracy.by_model, ["model_id"]],
    ["primary-by-model-tier.csv", summary.primary_accuracy.by_model_tier, ["model_id", "tier_id"]],
    ["primary-by-model-family.csv", summary.primary_accuracy.by_model_family, ["model_id", "family_id"]],
    ["primary-by-model-position.csv", summary.primary_accuracy.by_model_position, ["model_id", "position_id"]],
  ];
  for (const [name, values, keys] of groups) writeCsv(path.join(root, name), values.map(metricTableRow), [...keys, ...metricColumns]);
  const roles = [
    { analysis_role: "pilot_excluded", ...metricTableRow({ group: {}, ...summary.pilot_excluded }) },
    { analysis_role: "primary_accuracy", ...metricTableRow({ group: {}, ...summary.primary_accuracy }) },
    { analysis_role: "india_latency_validation", ...metricTableRow({ group: {}, ...summary.india_latency_validation }) },
  ];
  writeCsv(path.join(root, "analysis-role-summary.csv"), roles, ["analysis_role", ...metricColumns]);
  const pair = summary.primary_accuracy.paired_flash_vs_pro;
  writeCsv(path.join(root, "paired-flash-pro-outcomes.csv"), [pair], ["complete_pairs", "both_pass", "flash_only_pass", "pro_only_pass", "both_fail", "flash_minus_pro_exact_pass_delta"]);
  writeCsv(path.join(root, "primary-funnel.csv"), [
    { stage: "planned_primary", count: 288, denominator: 288 },
    { stage: "transport_complete", count: summary.primary_accuracy.transport_complete, denominator: 288 },
    { stage: "valid_json", count: summary.primary_accuracy.valid_json, denominator: 288 },
    { stage: "exact_key_set", count: summary.primary_accuracy.exact_key_sets, denominator: 288 },
    { stage: "strict_exact_match", count: summary.primary_accuracy.exact_matches, denominator: 288 },
  ], ["stage", "count", "denominator"]);
  writeCsv(path.join(root, "india-paired-latency-summary.csv"), [{
    coordinate_pairs: summary.india_latency_validation.matched_pairs,
    transport_complete_timing_pairs: summary.india_latency_validation.transport_complete_timing_pairs,
    first_answer_delta_p50_ms: summary.india_latency_validation.first_answer_delta_ms.p50_ms,
    first_answer_delta_p95_ms: summary.india_latency_validation.first_answer_delta_ms.p95_ms,
    first_answer_delta_n: summary.india_latency_validation.first_answer_delta_ms.n,
    end_to_end_delta_p50_ms: summary.india_latency_validation.end_to_end_delta_ms.p50_ms,
    end_to_end_delta_p95_ms: summary.india_latency_validation.end_to_end_delta_ms.p95_ms,
    end_to_end_delta_n: summary.india_latency_validation.end_to_end_delta_ms.n,
  }], ["coordinate_pairs", "transport_complete_timing_pairs", "first_answer_delta_p50_ms", "first_answer_delta_p95_ms", "first_answer_delta_n", "end_to_end_delta_p50_ms", "end_to_end_delta_p95_ms", "end_to_end_delta_n"]);
}

function scanPublicText(root, allowTemplatePlaceholders = true) {
  const findings = [];
  const patterns = [
    ["arabic_script", /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/],
    ["deepseek_api_key", /\bsk-[A-Za-z0-9_-]{10,}\b/],
    ["aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ["authorization_header", /authorization\s*[:=]/i],
    ["bearer_token", /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i],
    ["api_key_value", /["']?(?:api[_-]?key|secret[_-]?key)["']?\s*[:=]\s*["'][^"']{8,}["']/i],
    ["secret_material_field", /["'](?:SecretString|SecretBinary)["']\s*:/i],
    ["raw_prompt_field", /["'](?:system_prompt|user_prompt|messages|request_body|raw_final_content|raw_reasoning_content|raw_sse)["']\s*:/i],
    ["benchmark_system_prompt", /You are a deterministic retrieval engine/i],
    ["benchmark_user_prompt", /Synthetic corpus begins/i],
    ["execution_salt_prompt", /Execution isolation salt:\s*[0-9a-f]{16,64}/i],
    ["private_retry_execution_label", /pilot-us-\d{8}-\d{3}-retry\d+/i],
    ["signed_url_query", /[?&](?:X-Amz-[A-Za-z-]+|Signature|Expires|token|sig)=[^&#\s]+/i],
    ["windows_absolute_path", /[A-Za-z]:\\(?:Users|Windows|Program Files)/i],
    ["email_address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ];
  const extensions = new Set([".json", ".jsonl", ".csv", ".md", ".html", ".svg", ".txt"]);
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.has(path.extname(entry.name).toLowerCase())) {
        const text = fs.readFileSync(full, "utf8");
        for (const [code, pattern] of patterns) if (pattern.test(text)) findings.push({ code, file: path.relative(root, full).replaceAll("\\", "/") });
        if (!allowTemplatePlaceholders && /\{\{[A-Z0-9_]+\}\}/.test(text)) findings.push({ code: "unresolved_placeholder", file: path.relative(root, full).replaceAll("\\", "/") });
      }
    }
  };
  walk(root);
  return findings;
}

function scanOneText(text) {
  const temporary = fs.mkdtempSync(path.join(path.dirname(DEFAULTS.protocol), ".publication-scan-"));
  try {
    fs.writeFileSync(path.join(temporary, "candidate.html"), text, "utf8");
    return scanPublicText(temporary, false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function verifyReleaseForBinding(root, template) {
  const qaPath = path.join(root, "release", "qa-report.json");
  const manifestPath = path.join(root, "release", "manifest.json");
  const checksumsPath = path.join(root, "release", "checksums.sha256");
  for (const file of [qaPath, manifestPath, checksumsPath]) ensure(fs.existsSync(file), `binding requires passed release artifact: ${file}`);
  const qa = readJson(qaPath);
  const manifest = readJson(manifestPath);
  ensure(qa.all_passed === true, "release QA did not pass");
  ensure(manifest.status === "dataset_release_passed_article_requires_media_binding", "release manifest status does not permit binding");
  ensure(manifest.protocol_id === EXPECTED_PROTOCOL_ID, "release manifest protocol mismatch");
  ensure(Array.isArray(manifest.files) && manifest.files.length > 0, "release manifest file inventory is invalid");
  const manifestPaths = new Set();
  for (const entry of manifest.files) {
    ensure(entry && typeof entry.path === "string" && /^[0-9a-f]{64}$/.test(entry.sha256) && Number.isInteger(entry.bytes) && entry.bytes >= 0, "release manifest contains an invalid file entry");
    ensure(!manifestPaths.has(entry.path), `release manifest contains a duplicate path: ${entry.path}`);
    manifestPaths.add(entry.path);
    const file = path.resolve(root, entry.path);
    const relative = path.relative(root, file);
    ensure(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "release manifest path escapes the release root");
    ensure(fs.existsSync(file) && fs.statSync(file).size === entry.bytes && sha256File(file) === entry.sha256, `release manifest verification failed for ${entry.path}`);
  }
  const relativeTemplate = path.relative(root, template).replaceAll("\\", "/");
  ensure(relativeTemplate && !relativeTemplate.startsWith("../") && relativeTemplate !== "..", "template must be inside the passed release root");
  const templateEntry = manifest.files.find((entry) => entry.path === relativeTemplate);
  ensure(templateEntry && templateEntry.sha256 === sha256File(template), "template does not match the passed release manifest");
  const checksumLines = fs.readFileSync(checksumsPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  ensure(checksumLines.length > 0, "release checksum list is empty");
  const checksumPaths = new Set();
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    ensure(match, `invalid checksum line: ${line}`);
    const file = path.resolve(root, match[2]);
    ensure(!checksumPaths.has(match[2]), `release checksum list contains a duplicate path: ${match[2]}`);
    checksumPaths.add(match[2]);
    const relative = path.relative(root, file);
    ensure(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "checksum path escapes the release root");
    ensure(fs.existsSync(file) && sha256File(file) === match[1], `release checksum verification failed for ${match[2]}`);
  }
  const expectedChecksumPaths = new Set([...manifestPaths, "release/manifest.json"]);
  ensure(checksumPaths.size === expectedChecksumPaths.size && [...expectedChecksumPaths].every((item) => checksumPaths.has(item)), "release checksum path set does not exactly match the manifest inventory plus release/manifest.json");
  return { qa, manifest };
}

function fileInventory(root, excluded = new Set()) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (entry.isDirectory()) walk(full);
      else if (!excluded.has(rel)) files.push({ path: rel, bytes: fs.statSync(full).size, sha256: sha256File(full) });
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}


function generateReleaseReadme(summary, releaseVersion) {
  const warning = summary.synthetic_test_data
    ? "> **SYNTHETIC QA ONLY - DO NOT PUBLISH OR CITE. Every value in this package is artificial test data used only to inspect the publication pipeline and chart rendering.**\n\n"
    : "";
  return [
    `# DeepSeek 1M Context Benchmark dataset v${releaseVersion}`,
    "",
    `${warning}This release contains ${summary.counts.planned_calls} sanitized terminal rows from frozen protocol \`${summary.protocol_id}\`: 20 excluded pilot calls, 288 U.S. primary accuracy cases, and 36 matched India network-vantage validation calls.`,
    "",
    "## Primary denominator",
    "",
    "Only rows with `analysis_role=primary_accuracy` enter the 288-case primary accuracy denominator. Pilot and India rows are published for auditability but excluded from that calculation.",
    "",
    "## Operational preflight disclosure",
    "",
    "Before the paid U.S. pilot began, the first Step Functions execution stopped at the S3 result-existence preflight because the execution role lacked the required bucket-list permission. It stopped before any provider POST, so it incurred no provider cost. Least-privilege access was added, and the same frozen run ID and version were launched under a clearly labeled infrastructure-only retry execution. None of the 20 paid pilot cases were retried, and this event is outside every model denominator.",
    "",
    "## Public files",
    "",
    "- `all-attempts.csv` and `all-attempts.jsonl`: all 344 sanitized terminal rows.",
    "- `primary-cases.csv`: the 288 U.S. primary rows.",
    "- `pilot-excluded-cases.csv`: the 20 two-region pilot rows.",
    "- `india-latency-cases.csv`: the 36 India network-vantage rows.",
    "- `india-matched-pairs.csv`: paired U.S.-versus-India timing values.",
    "- `failures.csv`: all non-exact terminal states with public-safe stage labels.",
    "- `model-fingerprints.csv`: requested/returned model and fingerprint splits.",
    "- `summary.json`: canonical article metrics.",
    "- `methodology.json`, `protocol.json`, `calibration.json`, and `release-case-inventory.csv`: reproducibility material. The case inventory is sorted for presentation and is not an AWS dispatch log.",
    "- `DATA-DICTIONARY.md` and the top-level `tables/` directory: field definitions and publication tables with explicit numerators and denominators.",
    "- `qa-report.json`, `manifest.json`, `validator-export-manifest.json`, and `checksums.sha256`: publication integrity evidence.",
    "",
    "## Important limits",
    "",
    "The records are deterministic synthetic English data and strict JSON grading tests a narrow behavior. The India slice labels an AWS client network vantage, not Indian users or provider hosting. Timing is a one-run workload observation, not recurring reliability. Prices are dated.",
    "",
    "Token and cost aggregates expose observed and missing row counts. A complete-run token total or cache-miss upper bound is reported only when every row in that group contains the required usage or cost value.",
    "",
    "The validator export contains aggregate field counts but not per-field expected and observed values. This release therefore publishes aggregate field diagnostics and does not invent field-level rows.",
    "",
    "## Privacy",
    "",
    "The public dataset is rebuilt through an explicit allowlist. It excludes credentials, authorization headers, raw prompts, raw responses, object-store keys, local paths, batch identifiers, account IDs, ARNs, and account data.",
    "",
    "## License",
    "",
    "Dataset and original charts: CC BY 4.0. Code: MIT. Provider names and trademarks belong to their owners.",
    "",
  ].join("\n");
}

function generateMethodology(protocol, summary) {
  return {
    schema_version: "1.0.0",
    protocol_id: protocol.protocol_id,
    protocol_sha256: summary.source_hashes.protocol_json,
    frozen_on: protocol.frozen_on,
    language: protocol.language,
    scope: protocol.scope,
    models: protocol.models,
    task_families: protocol.task_families,
    context_tiers: protocol.context_tiers,
    positions: protocol.positions,
    repeats: protocol.repeats,
    request: protocol.request,
    documented_model_limits_at_protocol_freeze: {
      source: protocol.cost_controls.pricing_source,
      context_capacity: "1M",
      maximum_output: "384K",
    },
    study_generation_cap: {
      max_tokens_per_request: protocol.request.max_tokens,
      interpretation: "A study-chosen answer cap for short objective JSON responses; not the model's documented maximum output.",
    },
    grading: protocol.grading,
    execution: {
      attempts_per_case: 1,
      automatic_retries: false,
      primary_accuracy: { calls: 288, region_vantage: "us-east-1" },
      pilot_excluded: { calls: 20, region_vantages: { "us-east-1": 10, "ap-south-1": 10 }, included_in_primary_accuracy: false },
      india_latency_validation: { calls: 36, region_vantage: "ap-south-1", family: "single_record", tiers: ["32k", "950k"], included_in_primary_accuracy: false },
      published_case_inventory: "release-case-inventory.csv",
      published_case_inventory_order: "Lexicographic presentation order only; not the AWS dispatch sequence.",
    },
    operational_preflight_disclosure: {
      stage: "S3 result-existence preflight before the paid U.S. pilot",
      initial_outcome: "Stopped because the execution role lacked the required bucket-list permission.",
      provider_posts_sent: 0,
      provider_cost_incurred: false,
      remediation: "Added the required least-privilege bucket-list permission.",
      retry_execution_label_published: false,
      retry_execution_description: "A clearly labeled infrastructure-only retry execution.",
      same_frozen_run_id_and_version_reused: true,
      paid_pilot_cases_retried: 0,
      included_in_model_denominators: false,
      public_redactions: "Account identifiers, ARNs, and private storage paths are not published.",
    },
    interpretation_boundaries: summary.interpretation_boundaries,
  };
}

function generateDataDictionary() {
  const descriptions = {
    protocol_id: "Frozen benchmark protocol identifier.",
    protocol_version: "Frozen protocol semantic version.",
    analysis_role: "pilot_excluded, primary_accuracy, or india_latency_validation.",
    include_in_primary_accuracy_denominators: "True only for the 288 U.S. primary rows.",
    region_vantage: "AWS client network vantage used to send the request; not provider hosting or user location.",
    case_id: "Deterministic effective case identifier; not a provider request ID.",
    public_case_uid: "Release-specific hash of protocol, role, region, and case_id; unique across all 344 public rows.",
    model_id: "Exact requested DeepSeek API model ID.",
    family_id: "Frozen objective task family.",
    tier_id: "Frozen provider-counted prompt-token tier.",
    position_id: "Frozen beginning, middle, or end target position label.",
    repeat: "Deterministic fixture repeat number.",
    started_at: "UTC request start timestamp.",
    finished_at: "UTC terminal timestamp.",
    http_status: "Observed HTTP status when available.",
    transport_complete: "True only when the HTTP stream completed under the frozen adapter contract.",
    finish_reason: "Provider-returned completion finish reason.",
    returned_model: "Provider-returned model identifier.",
    system_fingerprint: "Provider-returned backend fingerprint when supplied.",
    time_to_first_sse_event_ms: "Milliseconds from request start to the first SSE event.",
    time_to_first_reasoning_token_ms: "Milliseconds to the first reasoning token; normally blank because thinking was disabled.",
    time_to_first_answer_token_ms: "Milliseconds from request start to the first answer token.",
    time_to_end_ms: "Milliseconds from request start to stream termination.",
    prompt_tokens: "Provider-returned prompt-token count.",
    completion_tokens: "Provider-returned completion-token count.",
    total_tokens: "Provider-returned total-token count.",
    prompt_cache_hit_tokens: "Provider-returned prompt cache-hit tokens.",
    prompt_cache_miss_tokens: "Provider-returned prompt cache-miss tokens.",
    reasoning_tokens: "Provider-returned reasoning-token count when supplied.",
    valid_json: "Whether the final answer was one parseable JSON object.",
    exact_keys: "Whether the parsed object had exactly the family-specific key set.",
    exact_match: "Frozen primary outcome: exact keys, types, and values with no surrounding prose.",
    field_accuracy: "Matched required fields divided by total required fields for the case.",
    matched_fields: "Number of exact required fields.",
    total_fields: "Number of required fields for the case family.",
    grader_errors: "Pipe-delimited public-safe grader error labels.",
    prompt_tier_calibration_passed: "Whether provider-returned prompt_tokens fell inside the frozen accepted tier.",
    thinking_disabled_violation: "True if reasoning content appeared despite the frozen non-thinking request.",
    sse_event_count: "Count of captured SSE events.",
    sse_parse_error_count: "Count of SSE parse errors.",
    sse_done_received: "Whether the terminal SSE marker was captured.",
    stream_error_class: "Public-safe stream error class, if any.",
    error_class: "Public-safe adapter error class, if any.",
    observed_provider_cost_usd_cache_miss_upper_bound: "Dated cache-miss upper-bound cost calculated from returned token counts.",
    generator_bundle_sha256: "SHA-256 of the frozen generator bundle.",
    base_fixture_sha256: "SHA-256 of the unsalted deterministic fixture.",
    execution_salt_sha256: "SHA-256 of the role-and-region execution salt.",
    salted_user_prompt_sha256: "SHA-256 of the sent salted user prompt.",
    expected_sha256: "SHA-256 of the objective expected JSON value.",
    request_sha256: "SHA-256 of the canonical sent request body.",
    raw_response_sha256: "SHA-256 of the immutable raw provider response bytes; raw bytes are not public.",
  };
  const rows = PUBLIC_COLUMNS.map((column) => `| \`${column}\` | ${descriptions[column] ?? "Public allowlisted benchmark field."} |`);
  return `# Public data dictionary\n\nThe case CSVs are reconstructed through an explicit allowlist. Empty cells mean the provider or adapter did not supply a value; they are not silently imputed.\n\n| Field | Meaning |\n|---|---|\n${rows.join("\n")}\n\nThe sanitized validator export exposes aggregate field counts but not per-field expected and observed values. No per-field row dataset is synthesized.\n`;
}

export function createScaffold(outputDir, options = {}) {
  const allowedExisting = new Set(["publication-gate-status.json", "wordpress-metadata.json", "gutenberg-draft.placeholder.html"]);
  if (fs.existsSync(outputDir)) {
    const unexpected = fs.readdirSync(outputDir).filter((name) => !allowedExisting.has(name));
    ensure(unexpected.length === 0, `scaffold output contains non-scaffold artifacts: ${unexpected.join(", ")}`);
  } else fs.mkdirSync(outputDir, { recursive: true });
  const protocol = readJson(options.protocol ?? DEFAULTS.protocol);
  ensure(protocol.protocol_id === EXPECTED_PROTOCOL_ID, "scaffold protocol does not match the frozen authority");
  const gate = {
    schema_version: "1.0.0",
    status: "blocked_unrun",
    result_claims_allowed: false,
    protocol_id: protocol.protocol_id,
    required_inputs: ["results.csv", "results.jsonl", "summary.json", "validation-report.json", "validation-export-manifest.json"],
    required_source_archive: "publication-safe.tar.gz",
    required_out_of_band_archive_sha256: true,
    required_terminal_rows: EXPECTED_COUNTS,
    next_action: "Run only the approved execution plan, pass the full validator, then run the publication build command.",
  };
  writeJson(path.join(outputDir, "publication-gate-status.json"), gate);
  writeJson(path.join(outputDir, "wordpress-metadata.json"), {
    status: "draft",
    post_type: "page",
    title: "DeepSeek 1M Context Benchmark: Retrieval Accuracy, Latency, and Cost",
    slug: "deepseek-1m-context-benchmark",
    canonical: DEFAULTS.canonicalUrl,
    parent: "DeepSeek Research Papers, Reports & Reading Guide",
    seo_title: "DeepSeek 1M Context Benchmark: Flash vs Pro (2026)",
    meta_description: SERP_META_DESCRIPTION,
    focus_keyword: "DeepSeek 1M context benchmark",
    tags: [],
    ads: { instruction: "preserve_existing", change_requested: false },
    publication_blocked: true,
  });
  const html = [
    paragraph("<strong>Publication blocked:</strong> this study is preregistered but its result release has not passed full execution and publication QA."),
    paragraph("The frozen plan contains 344 one-attempt calls: 20 excluded pilot calls, 288 U.S. primary accuracy cases, and 36 matched India network-vantage calls. No result, winner, latency, or cost observation belongs on the public page until all sanitized rows reconcile and the full validator passes."),
    heading(2, "Frozen methodology"),
    tableBlock(["Role", "Calls", "Use"], [["pilot_excluded", "20", "QA only; excluded"], ["primary_accuracy", "288", "Sole accuracy denominator"], ["india_latency_validation", "36", "Matched network-vantage timing only"]]),
  ].join("\n\n");
  fs.writeFileSync(path.join(outputDir, "gutenberg-draft.placeholder.html"), `${html}\n`, "utf8");
  return gate;
}

function buildReleaseInto({ inputDir, outputDir, releaseVersion = "1.0.0", protocolPath = DEFAULTS.protocol, calibrationPath = DEFAULTS.calibration, syntheticQa = false, trustedSourceArchiveSha256 = null }) {
  ensure(inputDir && outputDir, "build requires inputDir and outputDir");
  const resultsPath = path.join(inputDir, "results.csv");
  const resultsJsonlPath = path.join(inputDir, "results.jsonl");
  const validatorSummaryPath = path.join(inputDir, "summary.json");
  const validationPath = path.join(inputDir, "validation-report.json");
  const validatorExportManifestPath = path.join(inputDir, "validation-export-manifest.json");
  for (const file of [resultsPath, resultsJsonlPath, validatorSummaryPath, validationPath, validatorExportManifestPath, protocolPath, calibrationPath]) ensure(fs.existsSync(file) && fs.statSync(file).isFile(), `required file is missing: ${file}`);
  const protocol = readJson(protocolPath);
  ensure(protocol.protocol_id === EXPECTED_PROTOCOL_ID && protocol.status === "frozen", "protocol does not match the frozen authority");
  const calibration = readJson(calibrationPath);
  ensure(sha256File(protocolPath) === EXPECTED_PROTOCOL_SHA256, "protocol file SHA-256 does not match the frozen authority");
  ensure(sha256File(calibrationPath) === EXPECTED_CALIBRATION_SHA256, "calibration file SHA-256 does not match the frozen authority");
  ensure(calibration.protocol_id === EXPECTED_PROTOCOL_ID && calibration.protocol_sha256 === EXPECTED_PROTOCOL_SHA256 && calibration.schema_version === "1.0.0", "calibration protocol linkage is invalid");
  ensure(calibration.all_passed === true && calibration.unique_fixtures === 144 && calibration.paid_cases_represented === 288, "calibration counts or pass state are invalid");
  ensure(calibration.tokenizer?.sha256 === protocol.tokenizer_calibration?.tokenizer_sha256, "calibration tokenizer linkage is invalid");
  const rows = parseCsv(normalizeNewline(fs.readFileSync(resultsPath, "utf8")));
  ensure(JSON.stringify(Object.keys(rows[0] ?? {})) === JSON.stringify(VALIDATOR_COLUMNS), "results.csv header does not exactly match the validator v1.0.0 public-safe schema");
  const jsonlRows = normalizeNewline(fs.readFileSync(resultsJsonlPath, "utf8")).split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new PublicationError(`results.jsonl line ${index + 1} is invalid JSON`); }
  });
  ensure(jsonlRows.length === rows.length, "results.csv and results.jsonl row counts differ");
  const csvHeaders = Object.keys(rows[0] ?? {});
  rows.forEach((row, index) => {
    ensure(JSON.stringify(Object.keys(jsonlRows[index] ?? {}).sort()) === JSON.stringify([...csvHeaders].sort()), `results.jsonl row ${index + 1} has missing or extra fields`);
    for (const field of csvHeaders) ensure(csvJsonScalarsEqual(jsonlRows[index]?.[field], row[field], field, index + 1), `results.csv and results.jsonl differ at row ${index + 1}, field ${field}`);
  });
  const validatorSummary = readJson(validatorSummaryPath);
  const validation = readJson(validationPath);
  const validatorExportManifest = readJson(validatorExportManifestPath);
  validateValidatorExportManifest(inputDir, validatorExportManifest);
  const { primary, pilot, india } = validateInputs(rows, validatorSummary, validation, protocol, validatorExportManifest);

  if (fs.existsSync(outputDir)) {
    ensure(fs.readdirSync(outputDir).length === 0, `output directory is not empty: ${outputDir}`);
  } else fs.mkdirSync(outputDir, { recursive: true });
  const releaseDir = path.join(outputDir, "release");
  fs.mkdirSync(releaseDir, { recursive: true });

  const sourceHashes = {
    results_csv: sha256File(resultsPath),
    results_jsonl: sha256File(resultsJsonlPath),
    validator_summary_json: sha256File(validatorSummaryPath),
    validation_report_json: sha256File(validationPath),
    validation_export_manifest_json: sha256File(validatorExportManifestPath),
    protocol_json: sha256File(protocolPath),
    calibration_json: sha256File(calibrationPath),
  };
  if (!syntheticQa) {
    ensure(/^[0-9a-f]{64}$/.test(trustedSourceArchiveSha256 ?? ""), "production build lost its trusted publication archive SHA-256");
    sourceHashes.publication_safe_archive_sha256 = trustedSourceArchiveSha256;
  }
  const summary = buildSummary(rows, primary, pilot, india, protocol, validation, sourceHashes, releaseVersion, syntheticQa);
  summary._primary_rows = primary;
  summary._india_pairs = indiaPairs(primary, india);

  const publicRows = rows.map(publicRow);
  writeCsv(path.join(releaseDir, "all-attempts.csv"), publicRows, PUBLIC_COLUMNS);
  fs.writeFileSync(path.join(releaseDir, "all-attempts.jsonl"), `${publicRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  writeCsv(path.join(releaseDir, "primary-cases.csv"), primary.map(publicRow), PUBLIC_COLUMNS);
  writeCsv(path.join(releaseDir, "pilot-excluded-cases.csv"), pilot.map(publicRow), PUBLIC_COLUMNS);
  writeCsv(path.join(releaseDir, "india-latency-cases.csv"), india.map(publicRow), PUBLIC_COLUMNS);
  writeCsv(path.join(releaseDir, "india-matched-pairs.csv"), summary._india_pairs, ["matched_pair_id", "model_id", "tier_id", "position_id", "repeat", "coordinate_pair_matched", "transport_complete_at_both_vantages", "us_first_answer_ms", "india_first_answer_ms", "first_answer_delta_ms", "us_end_to_end_ms", "india_end_to_end_ms", "end_to_end_delta_ms", "us_cache_hit_tokens", "india_cache_hit_tokens"]);
  const failures = rows.filter((row) => !bool(row.exact_match)).map(failureRow);
  writeCsv(path.join(releaseDir, "failures.csv"), failures, ["analysis_role", "region_vantage", "case_id", "model_id", "family_id", "tier_id", "position_id", "repeat", "failure_stage", "http_status", "finish_reason", "grader_errors", "stream_error_class", "error_class", "raw_response_sha256"]);
  writeCsv(path.join(releaseDir, "model-fingerprints.csv"), fingerprintRows(rows), ["analysis_role", "region_vantage", "requested_model", "returned_model", "system_fingerprint", "first_seen_utc", "last_seen_utc", "attempts"]);
  const caseInventoryRows = [...rows].sort((a, b) => [a.analysis_role, a.region_vantage, a.model_id, a.family_id, a.tier_id, a.position_id, Number(a.repeat)].join("|").localeCompare([b.analysis_role, b.region_vantage, b.model_id, b.family_id, b.tier_id, b.position_id, Number(b.repeat)].join("|"))).map((row, index) => ({
    presentation_sequence: index + 1,
    analysis_role: row.analysis_role,
    region_vantage: row.region_vantage,
    case_id: row.case_id,
    model_id: row.model_id,
    family_id: row.family_id,
    tier_id: row.tier_id,
    position_id: row.position_id,
    repeat: row.repeat,
    included_in_primary_accuracy: row.analysis_role === "primary_accuracy",
    automatic_retry_allowed: false,
  }));
  writeCsv(path.join(releaseDir, "release-case-inventory.csv"), caseInventoryRows, ["presentation_sequence", "analysis_role", "region_vantage", "case_id", "model_id", "family_id", "tier_id", "position_id", "repeat", "included_in_primary_accuracy", "automatic_retry_allowed"]);

  delete summary._primary_rows;
  delete summary._india_pairs;
  writeJson(path.join(releaseDir, "summary.json"), summary);
  writeJson(path.join(releaseDir, "methodology.json"), generateMethodology(protocol, summary));
  writeJson(path.join(releaseDir, "prices.json"), summary.pricing);
  writeJson(path.join(releaseDir, "run-manifest.json"), {
    schema_version: "1.0.0",
    release_version: releaseVersion,
    protocol_id: protocol.protocol_id,
    execution_plan_ids: validation.execution_plan_ids,
    run_window_utc: summary.run_window_utc,
    requested_models: summary.routing.requested_models,
    returned_models: summary.routing.returned_models,
    role_counts: summary.counts,
    region_counts: countBy(rows, "region_vantage"),
    request_contract: protocol.request,
    attempts_per_case: 1,
    automatic_retries: false,
    model_fingerprint_table: "model-fingerprints.csv",
  });
  writeJson(path.join(releaseDir, "pilot-evidence-summary.json"), {
    schema_version: "1.0.0",
    analysis_role: "pilot_excluded",
    terminal_rows: pilot.length,
    regions: countBy(pilot, "region_vantage"),
    transport_complete: pilot.filter((row) => bool(row.transport_complete)).length,
    valid_json: pilot.filter((row) => bool(row.valid_json)).length,
    tier_calibration_passed: pilot.filter((row) => bool(row.prompt_tier_calibration_passed)).length,
    thinking_disabled_violations: pilot.filter((row) => bool(row.thinking_disabled_violation)).length,
    exact_matches_reported_as_outcomes: pilot.filter((row) => bool(row.exact_match)).length,
    accuracy_is_not_an_acceptance_criterion: true,
    included_in_primary_accuracy: false,
    interpretation: "The pilot checks evidence and execution-contract integrity. Retrieval mistakes remain benchmark outcomes and do not by themselves invalidate the evidence gate.",
  });
  fs.copyFileSync(protocolPath, path.join(releaseDir, "protocol.json"));
  fs.copyFileSync(calibrationPath, path.join(releaseDir, "calibration.json"));
  fs.copyFileSync(validatorExportManifestPath, path.join(releaseDir, "validator-export-manifest.json"));
  fs.writeFileSync(path.join(releaseDir, "README.md"), generateReleaseReadme(summary, releaseVersion), "utf8");
  fs.writeFileSync(path.join(releaseDir, "DATA-DICTIONARY.md"), generateDataDictionary(), "utf8");
  fs.writeFileSync(path.join(releaseDir, "LICENSE-DATA.txt"), "Dataset and original charts are licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/\n", "utf8");
  fs.writeFileSync(path.join(releaseDir, "LICENSE-CODE.txt"), "Publication-pipeline code is provided under the MIT License.\n", "utf8");
  if (syntheticQa) fs.writeFileSync(path.join(outputDir, "SYNTHETIC-TEST-ONLY.txt"), "SYNTHETIC QA ONLY — DO NOT PUBLISH OR CITE.\nEvery result value and chart in this directory was generated from artificial pipeline-test rows, not from a DeepSeek API benchmark run.\n", "utf8");

  // Deliberately break provenance from the input directory here. Publication
  // tables, charts, and article copy are generated only after reading back the
  // allowlisted release files that will be sealed into the public manifest.
  const publicationSummary = readJson(path.join(releaseDir, "summary.json"));
  const publicationPrimary = parseCsv(normalizeNewline(fs.readFileSync(path.join(releaseDir, "primary-cases.csv"), "utf8")));
  const publicationIndiaPairs = parseCsv(normalizeNewline(fs.readFileSync(path.join(releaseDir, "india-matched-pairs.csv"), "utf8")));
  ensure(JSON.stringify(Object.keys(publicationPrimary[0] ?? {})) === JSON.stringify(PUBLIC_COLUMNS), "safe primary release schema changed before chart generation");
  ensure(publicationPrimary.length === 288 && publicationIndiaPairs.length === 36, "safe release row counts changed before chart generation");
  ensure(canonicalJson(publicationSummary.source_hashes) === canonicalJson(sourceHashes), "safe release summary lost its sealed source provenance");
  const readBackPrimaryMetric = metric(publicationPrimary);
  for (const key of Object.keys(readBackPrimaryMetric)) ensure(canonicalJson(publicationSummary.primary_accuracy[key]) === canonicalJson(readBackPrimaryMetric[key]), `safe release primary summary differs from primary-cases.csv on ${key}`);
  ensure(canonicalJson(publicationSummary.primary_accuracy.paired_flash_vs_pro) === canonicalJson(pairedSummary(publicationPrimary)), "safe release paired summary differs from primary-cases.csv");
  const completePublicationIndiaPairs = publicationIndiaPairs.filter((row) => bool(row.transport_complete_at_both_vantages));
  ensure(publicationSummary.india_latency_validation.transport_complete_timing_pairs === completePublicationIndiaPairs.length, "safe release India timing denominator differs from india-matched-pairs.csv");
  ensure(canonicalJson(publicationSummary.india_latency_validation.first_answer_delta_ms) === canonicalJson(latency(completePublicationIndiaPairs.map((row) => numberOrNull(row.first_answer_delta_ms)))), "safe release first-answer deltas differ from india-matched-pairs.csv");
  ensure(canonicalJson(publicationSummary.india_latency_validation.end_to_end_delta_ms) === canonicalJson(latency(completePublicationIndiaPairs.map((row) => numberOrNull(row.end_to_end_delta_ms)))), "safe release end-to-end deltas differ from india-matched-pairs.csv");
  const safeReadbackVerified = true;

  writeResultTables(outputDir, publicationSummary);
  publicationSummary._primary_rows = publicationPrimary;
  publicationSummary._india_pairs = publicationIndiaPairs;
  const charts = writeCharts(outputDir, publicationSummary, protocol);
  delete publicationSummary._primary_rows;
  delete publicationSummary._india_pairs;
  const article = generateArticle(publicationSummary, protocol, releaseVersion);
  fs.writeFileSync(path.join(outputDir, "gutenberg-draft.template.html"), article, "utf8");
  writeJson(path.join(outputDir, "wordpress-metadata.json"), {
    status: "draft",
    post_type: "page",
    title: "DeepSeek 1M Context Benchmark: Retrieval Accuracy, Latency, and Cost",
    slug: "deepseek-1m-context-benchmark",
    canonical: DEFAULTS.canonicalUrl,
    parent: "DeepSeek Research Papers, Reports & Reading Guide",
    seo_title: "DeepSeek 1M Context Benchmark: Flash vs Pro (2026)",
    meta_description: SERP_META_DESCRIPTION,
    focus_keyword: "DeepSeek 1M context benchmark",
    excerpt: "A reproducible DeepSeek V4 benchmark with 288 U.S. primary cases, 36 matched India network-vantage calls, and 20 excluded pilot calls across 32K to approximately 950K prompts.",
    robots: ["index", "follow"],
    tags: [],
    ads: { instruction: "preserve_existing", change_requested: false },
    images: { source_size: "full", alignment: "center", rendered_width_percent: 75, link_destination: "none", upload_required: charts.map((item) => item.png) },
    generic_rank_math_article_schema: "remove_if_custom_TechArticle_is_inserted",
    publish_authorization: false,
    synthetic_test_data: syntheticQa,
    publication_blocked: syntheticQa,
  });

  const templatePlaceholders = [...new Set(article.match(/\{\{[A-Z0-9_]+\}\}/g) ?? [])].map((item) => item.slice(2, -2)).sort();
  writeJson(path.join(outputDir, "template-bindings.required.json"), { schema_version: "1.0.0", placeholders: templatePlaceholders, rules: { all_must_be_https_urls_except_dates: true, images_unlinked: true, image_width_percent: 75, full_size_source: true } });

  const releaseFilesBeforeQa = fileInventory(outputDir, new Set(["release/qa-report.json", "release/manifest.json", "release/checksums.sha256"]));
  const privacyFindings = scanPublicText(outputDir, true);
  const qaChecks = {
    production_source_archive_gate_passed: syntheticQa || sourceHashes.publication_safe_archive_sha256 === trustedSourceArchiveSha256,
    validator_export_hashes_and_sizes_verified: true,
    validator_csv_jsonl_field_parity: true,
    validator_full_run_complete: true,
    terminal_rows_344: rows.length === 344,
    role_counts_20_288_36: pilot.length === 20 && primary.length === 288 && india.length === 36,
    primary_model_counts_144_each: MODELS.every((model) => primary.filter((row) => row.model_id === model).length === 144),
    matched_flash_pro_pairs_144: publicationSummary.primary_accuracy.paired_flash_vs_pro.complete_pairs === 144,
    matched_india_pairs_36: publicationSummary.india_latency_validation.matched_pairs === 36,
    no_public_privacy_findings: privacyFindings.length === 0,
    charts_11_svg_and_png: charts.length === 11 && charts.every((item) => fs.existsSync(path.join(outputDir, item.svg)) && fs.existsSync(path.join(outputDir, item.png))),
    publication_tables_present: ["primary-by-model.csv", "primary-by-model-tier.csv", "primary-by-model-family.csv", "primary-by-model-position.csv", "paired-flash-pro-outcomes.csv", "analysis-role-summary.csv", "primary-funnel.csv", "india-paired-latency-summary.csv"].every((name) => fs.existsSync(path.join(outputDir, "tables", name))),
    article_has_no_body_h1: !/<h1\b/i.test(article),
    article_images_unlinked: !/<a\b[^>]*>\s*<img\b/i.test(article),
    article_images_centered_75_percent: (article.match(/<figure class="wp-block-image aligncenter size-full" style="width:75%">/g) ?? []).length === 11,
    wordpress_tags_empty: true,
    ad_instruction_preserves_existing: true,
    article_and_charts_read_back_only_from_allowlisted_release_files: safeReadbackVerified,
  };
  const qa = {
    qa_schema_version: "1.0.0",
    release_version: releaseVersion,
    synthetic_test_data: syntheticQa,
    all_passed: Object.values(qaChecks).every(Boolean),
    wordpress_ready: false,
    wordpress_blocker: "Upload full-size chart images and bind every required public URL/date/entity placeholder before saving the WordPress draft.",
    trusted_source_archive_sha256: syntheticQa ? null : trustedSourceArchiveSha256,
    checks: qaChecks,
    privacy_findings: privacyFindings,
    pre_qa_file_count: releaseFilesBeforeQa.length,
  };
  ensure(qa.all_passed, `publication QA failed: ${JSON.stringify(qa)}`);
  writeJson(path.join(releaseDir, "qa-report.json"), qa);

  const manifestFiles = fileInventory(outputDir, new Set(["release/manifest.json", "release/checksums.sha256"]));
  const manifest = {
    manifest_schema_version: "1.0.0",
    release_version: releaseVersion,
    protocol_id: protocol.protocol_id,
    canonical_article_url: DEFAULTS.canonicalUrl,
    status: syntheticQa ? "synthetic_test_only_do_not_publish" : "dataset_release_passed_article_requires_media_binding",
    generated_at_utc: new Date().toISOString(),
    source_hashes: sourceHashes,
    trusted_source_archive_sha256: syntheticQa ? null : trustedSourceArchiveSha256,
    counts: publicationSummary.counts,
    files: manifestFiles,
  };
  writeJson(path.join(releaseDir, "manifest.json"), manifest);
  const checksumFiles = fileInventory(outputDir, new Set(["release/checksums.sha256"]));
  fs.writeFileSync(path.join(releaseDir, "checksums.sha256"), `${checksumFiles.map((item) => `${item.sha256}  ${item.path}`).join("\n")}\n`, "utf8");
  return { outputDir, summary: publicationSummary, qa, manifest, charts };
}

export function buildRelease(options) {
  const outputDir = options?.outputDir;
  ensure(outputDir, "build requires outputDir");
  const resolvedOutput = path.resolve(outputDir);
  const parent = path.dirname(resolvedOutput);
  fs.mkdirSync(parent, { recursive: true });
  const syntheticQa = options?.syntheticQa === true;
  let trustedInput = null;
  let effectiveInputDir = options?.inputDir;
  let trustedSourceArchiveSha256 = null;
  if (syntheticQa) {
    ensure(effectiveInputDir, "synthetic QA build requires inputDir");
    ensure(!options?.sourceArchivePath && !options?.expectedArchiveSha256, "synthetic QA must not impersonate the production archive trust path");
  } else {
    ensure(!effectiveInputDir, "production build must consume the pinned publication-safe archive, not inputDir");
  }
  if (fs.existsSync(resolvedOutput)) {
    ensure(fs.statSync(resolvedOutput).isDirectory() && fs.readdirSync(resolvedOutput).length === 0, `output directory is not empty: ${resolvedOutput}`);
    fs.rmdirSync(resolvedOutput);
  }
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(resolvedOutput)}.staging-`));
  try {
    if (!syntheticQa) {
      trustedInput = materializePinnedPublicationArchive(options?.sourceArchivePath, options?.expectedArchiveSha256, parent);
      effectiveInputDir = trustedInput.inputDir;
      trustedSourceArchiveSha256 = trustedInput.archiveSha256;
    }
    const result = buildReleaseInto({ ...options, inputDir: effectiveInputDir, outputDir: staging, trustedSourceArchiveSha256 });
    fs.renameSync(staging, resolvedOutput);
    return { ...result, outputDir: resolvedOutput };
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  } finally {
    if (trustedInput?.inputDir && fs.existsSync(trustedInput.inputDir)) fs.rmSync(trustedInput.inputDir, { recursive: true, force: true });
  }
}

function canonicalBindingDate(key, raw) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00Z`);
    ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw, `${key} must be a real ISO calendar date`);
    return raw;
  }
  ensure(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw), `${key} must be an ISO date or canonical UTC timestamp`);
  const parsed = new Date(raw);
  ensure(Number.isFinite(parsed.getTime()), `${key} must be a real ISO timestamp`);
  const canonical = parsed.toISOString();
  const expected = raw.includes(".") ? canonical : canonical.replace(".000Z", "Z");
  ensure(raw === expected, `${key} must be a canonical UTC timestamp`);
  return raw;
}

function canonicalBindingUrl(key, raw) {
  ensure(raw.length <= 2048 && raw === raw.trim(), `${key} contains surrounding whitespace or is too long`);
  ensure(!/[\u0000-\u0020\u007f<>"'`\\&{}]/.test(raw), `${key} contains an unsafe URL character`);
  ensure(!/%(?:0[0-9a-f]|1[0-9a-f]|20|22|27|3c|3e|5c|60|7b|7d|7f)/i.test(raw), `${key} contains an unsafe percent-encoded character`);
  let url;
  try { url = new URL(raw); } catch { throw new PublicationError(`${key} must be a valid HTTPS URL`); }
  ensure(url.protocol === "https:" && url.port === "", `${key} must be a standard-port HTTPS URL`);
  ensure(url.username === "" && url.password === "", `${key} must not contain URL credentials`);
  ensure(url.search === "", `${key} must not contain a query string or signed token`);
  const host = url.hostname.toLowerCase();
  const siteHost = host === "seek-chat.com" || host === "www.seek-chat.com";
  if (/^CH\d{2}_URL$/.test(key)) {
    ensure(siteHost && /^\/wp-content\/uploads\/.+\.png$/i.test(url.pathname) && url.hash === "", `${key} must be an unfragmented WordPress PNG media URL on seek-chat.com`);
  } else if (key === "FEATURED_IMAGE_URL") {
    ensure(siteHost && /^\/wp-content\/uploads\/.+\.(?:png|webp|jpe?g|avif)$/i.test(url.pathname) && url.hash === "", `${key} must be an unfragmented WordPress image URL on seek-chat.com`);
  } else if (key === "REPOSITORY_URL") {
    ensure(host === "github.com" && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname) && url.hash === "", `${key} must be a GitHub repository root URL`);
  } else if (key === "RELEASE_URL") {
    ensure(host === "github.com" && /^\/[^/]+\/[^/]+\/releases\/tag\/[^/]+\/?$/.test(url.pathname) && url.hash === "", `${key} must be a GitHub release-tag URL`);
  } else if (["ALL_ATTEMPTS_URL", "PRIMARY_CASES_URL", "INDIA_CASES_URL", "SUMMARY_URL"].includes(key)) {
    const requiredBasename = {
      ALL_ATTEMPTS_URL: "all-attempts.csv",
      PRIMARY_CASES_URL: "primary-cases.csv",
      INDIA_CASES_URL: "india-latency-cases.csv",
      SUMMARY_URL: "summary.json",
    }[key];
    ensure(host === "raw.githubusercontent.com" && url.pathname.split("/").filter(Boolean).length >= 4 && url.pathname.endsWith(`/${requiredBasename}`) && url.hash === "", `${key} must be a raw.githubusercontent.com URL ending in ${requiredBasename}`);
  } else if (key === "AUTHOR_ID") {
    ensure(host === "seek-chat.com" && url.pathname === "/author/caht-deep/" && url.hash === "", `${key} must be the live seek-chat.com Person entity URL`);
  } else if (key === "PUBLISHER_ID") {
    ensure(host === "seek-chat.com" && url.pathname === "/" && url.hash === "#organization", `${key} must be the seek-chat.com #organization entity URL`);
  } else {
    throw new PublicationError(`no URL policy is defined for ${key}`);
  }
  return url.href;
}

export function bindTemplate({ template, mediaMap, output, releaseRoot }) {
  ensure(template && mediaMap && output, "bind requires template, mediaMap, and output");
  const resolvedTemplate = path.resolve(template);
  const resolvedMediaMap = path.resolve(mediaMap);
  const resolvedOutput = path.resolve(output);
  const resolvedReleaseRoot = path.resolve(releaseRoot ?? path.dirname(resolvedTemplate));
  const verified = verifyReleaseForBinding(resolvedReleaseRoot, resolvedTemplate);
  const qaOutput = path.join(path.dirname(resolvedOutput), "wordpress-ready-qa.json");
  ensure(path.extname(resolvedOutput).toLowerCase() === ".html", "bound output must be an HTML file");
  ensure(resolvedOutput !== resolvedTemplate && resolvedOutput !== resolvedMediaMap && qaOutput !== resolvedTemplate && qaOutput !== resolvedMediaMap, "bind output must not overwrite the template or media map");
  ensure(!fs.existsSync(resolvedOutput) && !fs.existsSync(qaOutput), "bind output and wordpress-ready-qa.json must not already exist");
  const relativeOutput = path.relative(resolvedReleaseRoot, resolvedOutput).replaceAll("\\", "/");
  const outputInsideRelease = relativeOutput !== "" && !relativeOutput.startsWith("../") && !path.isAbsolute(relativeOutput);
  if (outputInsideRelease) ensure(relativeOutput.startsWith("wordpress-ready/"), "bound output inside the release root must be under wordpress-ready/");
  const sealedPaths = new Set(verified.manifest.files.map((entry) => path.resolve(resolvedReleaseRoot, entry.path)));
  ensure(!sealedPaths.has(resolvedOutput) && !sealedPaths.has(qaOutput), "bind output must not overwrite a sealed release artifact");
  let html = fs.readFileSync(resolvedTemplate, "utf8");
  const bindings = readJson(resolvedMediaMap);
  ensure(bindings && typeof bindings === "object" && !Array.isArray(bindings), "media map must be a JSON object");
  const required = [...new Set((html.match(/\{\{[A-Z0-9_]+\}\}/g) ?? []).map((item) => item.slice(2, -2)))];
  ensure(JSON.stringify(Object.keys(bindings).sort()) === JSON.stringify([...required].sort()), "media map keys must exactly match the required placeholders");
  for (const key of required) {
    ensure(Object.hasOwn(bindings, key), `media map is missing ${key}`);
    const raw = String(bindings[key]);
    const value = key.startsWith("DATE_") ? canonicalBindingDate(key, raw) : canonicalBindingUrl(key, raw);
    html = html.replaceAll(`{{${key}}}`, esc(value));
  }
  ensure(!/\{\{[A-Z0-9_]+\}\}/.test(html), "bound article contains an unresolved placeholder");
  ensure(!/<h1\b/i.test(html), "bound article contains a body H1");
  ensure(!/<a\b[^>]*>\s*<img\b/i.test(html), "bound article contains a linked image");
  ensure((html.match(/<figure class="wp-block-image aligncenter size-full" style="width:75%">/g) ?? []).length === 11, "bound article does not contain exactly 11 centered 75% full-size image blocks");
  ensure(!/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(html), "bound article contains Arabic-script text");
  const privacyFindings = scanOneText(html);
  ensure(privacyFindings.length === 0, `bound article failed privacy scan: ${JSON.stringify(privacyFindings)}`);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, html, { encoding: "utf8", flag: "wx" });
  const qa = {
    schema_version: "1.0.0",
    ready_for_wordpress_draft: true,
    publish_authorization: false,
    unresolved_placeholders: 0,
    body_h1: 0,
    image_blocks: 11,
    image_width_percent: 75,
    image_links: 0,
    wordpress_tags: 0,
    ads_instruction: "preserve_existing",
    source_release_qa_sha256: sha256File(path.join(resolvedReleaseRoot, "release", "qa-report.json")),
    source_release_manifest_sha256: sha256File(path.join(resolvedReleaseRoot, "release", "manifest.json")),
    verified_release_version: verified.manifest.release_version,
    sha256: sha256File(resolvedOutput),
  };
  try {
    fs.writeFileSync(qaOutput, `${JSON.stringify(qa, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    fs.rmSync(resolvedOutput, { force: true });
    throw error;
  }
  return qa;
}
