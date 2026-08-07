import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const CONTRACT = Object.freeze({
  releaseVersion: "1.0.0",
  releaseTag: "v1.0.0",
  protocolId: "deepseek-v4-long-context-retrieval-v1.1.0",
  protocolSha256: "39c68bfc607157011012dc47d59524dcf3d5d7155071e6862c5038410d642c16",
  calibrationSha256: "0d8265a9f74bb39d9b1947e90e041dc330dcdb9b445d2d82a27da378f3bd88b2",
  tokenizerSha256: "8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf",
  counts: Object.freeze({ all: 344, pilot_excluded: 20, primary_accuracy: 288, india_latency_validation: 36 }),
});

export const PUBLIC_COLUMNS = Object.freeze([
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
]);

const REQUIRED_ROOT_DOCS = Object.freeze([
  ".gitignore",
  "CHANGELOG.md",
  "CITATION.cff",
  "LICENSE",
  "LICENSE-DATA.md",
  "NOTICE.md",
  "README.md",
  "RELEASE-CONTRACT.md",
  "SECURITY.md",
  "package.json",
]);

const RELEASE_REQUIRED = Object.freeze([
  "README.md",
  "DATA-DICTIONARY.md",
  "LICENSE-CODE.txt",
  "LICENSE-DATA.txt",
  "all-attempts.csv",
  "all-attempts.jsonl",
  "primary-cases.csv",
  "pilot-excluded-cases.csv",
  "india-latency-cases.csv",
  "india-matched-pairs.csv",
  "failures.csv",
  "model-fingerprints.csv",
  "release-case-inventory.csv",
  "pilot-evidence-summary.json",
  "summary.json",
  "methodology.json",
  "protocol.json",
  "calibration.json",
  "prices.json",
  "run-manifest.json",
  "validator-export-manifest.json",
  "qa-report.json",
  "manifest.json",
  "checksums.sha256",
]);

const BENCHMARK_FILES = Object.freeze([
  "README.md",
  "PROTOCOL.md",
  "protocol.json",
  "calibration.json",
  "harness/__init__.py",
  "harness/__main__.py",
  "harness/calibration.py",
  "harness/cli.py",
  "harness/fixtures.py",
  "harness/grader.py",
  "harness/preflight.py",
  "harness/protocol.py",
  "tests/test_calibration.py",
  "tests/test_fixtures.py",
  "tests/test_grader.py",
  "tests/test_offline_boundary.py",
  "tests/test_preflight.py",
  "tests/test_protocol.py",
]);

const PUBLICATION_FILES = Object.freeze([
  "README.md",
  "package.json",
  "build_release.mjs",
  "lib.mjs",
  "tests/build_release.test.mjs",
]);

const TEXT_EXTENSIONS = new Set(["", ".cff", ".csv", ".html", ".js", ".json", ".jsonl", ".md", ".mjs", ".py", ".sha256", ".svg", ".txt", ".yaml", ".yml"]);

const PRIVACY_PATTERNS = Object.freeze([
  ["deepseek_api_key", /\bsk-[A-Za-z0-9_-]{10,}\b/g],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["authorization_value", /\bauthorization\b\s*[:=]\s*["']?(?:bearer\s+)?[^\s"',}{]{8,}/gi],
  ["aws_account_id", /(?<![0-9A-Fa-f])\d{12}(?![0-9A-Fa-f])/g],
  ["aws_arn", /\barn:(?:aws|aws-us-gov|aws-cn):[a-z0-9-]+:[a-z0-9-]*:\d{12}:[^\s"'<>]+/gi],
  ["s3_url", /\bs3:\/\/[^\s"'<>]+/gi],
  ["aws_console_url", /https:\/\/[^\s"'<>]*console\.aws\.amazon\.com[^\s"'<>]*/gi],
  ["private_benchmark_resource_name", /\bchatdeep-context-benchmark(?:-[a-z0-9]+)+\b|\bchatdeep\/deepseek-1m-context-benchmark\/api-key\b/gi],
  ["workspace_absolute_path", /\b[A-Za-z]:\\Users\\[^\s"'<>]+|\/home\/[A-Za-z0-9._-]+\//g],
  ["wordpress_private_url", /https?:\/\/chat-deep\.ai\/(?:wp-admin\/|[^\s"'<>]*[?&](?:preview|preview_id|preview_nonce)=)/gi],
  ["email_address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ["private_uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi],
  ["realistic_signed_url", /https?:\/\/[^\s"'<>]+[?&](?:X-Amz-Credential=[^&\s"'<>]+|X-Amz-Signature=[0-9a-f]{32,}|Signature=[A-Za-z0-9%+/_=-]{24,})/gi],
  ["arabic_script", /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/g],
  ["common_mojibake", /(?:\u00c3.|\u00c2.|\u00e2\u20ac|\u00ef\u00bf\u00bd)/g],
]);

export class ReleaseValidationError extends Error {}

export function ensure(condition, message) {
  if (!condition) throw new ReleaseValidationError(message);
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ReleaseValidationError(`invalid JSON: ${file}: ${error.message}`);
  }
}

export function normalizedRelative(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file)).replaceAll("\\", "/");
  ensure(relative && relative !== "." && !relative.startsWith("../") && !path.isAbsolute(relative), `path escapes root: ${file}`);
  return relative;
}

export function listFiles(root) {
  ensure(fs.existsSync(root) && fs.statSync(root).isDirectory(), `directory is missing: ${root}`);
  const files = [];
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      ensure(!stat.isSymbolicLink(), `symbolic links are forbidden: ${file}`);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push(normalizedRelative(root, file));
      else throw new ReleaseValidationError(`unsupported filesystem entry: ${file}`);
    }
  };
  walk(path.resolve(root));
  return files;
}

export function scanText(text, relativePath = "<memory>") {
  const findings = [];
  for (const [name, pattern] of PRIVACY_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    if (matches.length) findings.push({ file: relativePath, pattern: name, count: matches.length });
  }
  return findings;
}

function nulIndex(buffer, start, label) {
  const index = buffer.indexOf(0, start);
  ensure(index >= start, `PNG ${label} is missing a null terminator`);
  return index;
}

export function scanPngBuffer(buffer, relativePath = "<png>") {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  ensure(Buffer.isBuffer(buffer) && buffer.length >= 20 && buffer.subarray(0, 8).equals(signature), `invalid PNG signature: ${relativePath}`);
  const safeAncillary = new Set(["cHRM", "gAMA", "sBIT", "sRGB", "bKGD", "hIST", "tRNS", "pHYs"]);
  const findings = [];
  let offset = 8;
  let chunkIndex = 0;
  let idatChunks = 0;
  let ended = false;
  while (offset < buffer.length) {
    ensure(offset + 12 <= buffer.length, `truncated PNG chunk header: ${relativePath}`);
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    ensure(/^[A-Za-z]{4}$/.test(type), `invalid PNG chunk type in ${relativePath}`);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    ensure(dataEnd + 4 <= buffer.length, `truncated PNG ${type} chunk: ${relativePath}`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (chunkIndex === 0) ensure(type === "IHDR" && length === 13, `PNG must begin with a 13-byte IHDR: ${relativePath}`);
    if (type === "IHDR") ensure(chunkIndex === 0, `PNG contains an extra IHDR: ${relativePath}`);
    else if (type === "IDAT") idatChunks += 1;
    else if (type === "IEND") {
      ensure(length === 0 && dataEnd + 4 === buffer.length, `PNG IEND must be empty and final: ${relativePath}`);
      ended = true;
    } else if (type === "tEXt") {
      const separator = nulIndex(data, 0, "tEXt keyword");
      findings.push(...scanText(data.subarray(0, separator).toString("latin1"), relativePath));
      findings.push(...scanText(data.subarray(separator + 1).toString("latin1"), relativePath));
    } else if (type === "zTXt") {
      const separator = nulIndex(data, 0, "zTXt keyword");
      ensure(separator + 2 <= data.length && data[separator + 1] === 0, `unsupported PNG zTXt compression method: ${relativePath}`);
      findings.push(...scanText(data.subarray(0, separator).toString("latin1"), relativePath));
      let text;
      try { text = zlib.inflateSync(data.subarray(separator + 2)).toString("latin1"); }
      catch { throw new ReleaseValidationError(`invalid compressed PNG zTXt text: ${relativePath}`); }
      findings.push(...scanText(text, relativePath));
    } else if (type === "iTXt") {
      const keywordEnd = nulIndex(data, 0, "iTXt keyword");
      ensure(keywordEnd + 3 <= data.length, `truncated PNG iTXt control fields: ${relativePath}`);
      const compressionFlag = data[keywordEnd + 1];
      const compressionMethod = data[keywordEnd + 2];
      ensure([0, 1].includes(compressionFlag) && compressionMethod === 0, `unsupported PNG iTXt compression settings: ${relativePath}`);
      const languageStart = keywordEnd + 3;
      const languageEnd = nulIndex(data, languageStart, "iTXt language tag");
      const translatedStart = languageEnd + 1;
      const translatedEnd = nulIndex(data, translatedStart, "iTXt translated keyword");
      const textBytes = data.subarray(translatedEnd + 1);
      let text;
      try { text = (compressionFlag ? zlib.inflateSync(textBytes) : textBytes).toString("utf8"); }
      catch { throw new ReleaseValidationError(`invalid compressed PNG iTXt text: ${relativePath}`); }
      for (const value of [data.subarray(0, keywordEnd).toString("latin1"), data.subarray(languageStart, languageEnd).toString("ascii"), data.subarray(translatedStart, translatedEnd).toString("utf8"), text]) findings.push(...scanText(value, relativePath));
    } else if (safeAncillary.has(type)) {
      // Deterministic image/color chunks have fixed binary schemas and carry no free-form text.
    } else {
      const critical = type[0] === type[0].toUpperCase();
      throw new ReleaseValidationError(`${critical ? "unsupported critical" : "unapproved ancillary"} PNG chunk ${type}: ${relativePath}`);
    }
    offset = dataEnd + 4;
    chunkIndex += 1;
    if (ended) break;
  }
  ensure(ended && idatChunks > 0 && offset === buffer.length, `PNG is missing IDAT/IEND or has trailing bytes: ${relativePath}`);
  return findings;
}

function scanFile(root, relative) {
  const file = path.join(root, relative);
  const extension = path.extname(relative).toLowerCase();
  const buffer = fs.readFileSync(file);
  if (TEXT_EXTENSIONS.has(extension)) return scanText(buffer.toString("utf8"), relative);
  if (extension === ".png") return scanPngBuffer(buffer, relative);
  throw new ReleaseValidationError(`unsupported binary file in public tree: ${relative}`);
}

export function scanTree(root, files = listFiles(root)) {
  return files.flatMap((relative) => scanFile(root, relative));
}

function validateRootDocuments(root, mode) {
  for (const name of REQUIRED_ROOT_DOCS) ensure(fs.existsSync(path.join(root, name)), `required repository document is missing: ${name}`);
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const localMarker = readme.includes("LOCAL SKELETON — NOT A DATA RELEASE");
  ensure(mode === "skeleton" ? localMarker : !localMarker, mode === "skeleton" ? "skeleton README lacks its publication blocker" : "ready README still says LOCAL SKELETON");
  for (const token of [CONTRACT.protocolId, CONTRACT.protocolSha256, CONTRACT.calibrationSha256, "https://chat-deep.ai/research/deepseek-1m-context-benchmark/"]) {
    ensure(readme.includes(token), `README is missing contract token: ${token}`);
  }

  const mit = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  ensure(mit.startsWith("MIT License\n") && mit.includes("Copyright (c) 2026 Chat Deep AI") && mit.includes("Permission is hereby granted, free of charge") && mit.includes('THE SOFTWARE IS PROVIDED "AS IS"'), "LICENSE is not the complete project MIT license");

  const cc = fs.readFileSync(path.join(root, "LICENSE-DATA.md"), "utf8");
  for (const token of ["Creative Commons Attribution 4.0 International Public License", "Section 1 -- Definitions.", "Section 2 -- Scope.", "Section 3 -- License Conditions.", "Section 4 -- Sui Generis Database Rights.", "Section 5 -- Disclaimer of Warranties and Limitation of Liability.", "Section 6 -- Term and Termination.", "Section 7 -- Other Terms and Conditions.", "Section 8 -- Interpretation.", "Creative Commons may be contacted at creativecommons.org."]) {
    ensure(cc.includes(token), `LICENSE-DATA.md is missing legal-code token: ${token}`);
  }
  ensure(cc.length > 15000, "LICENSE-DATA.md is unexpectedly short for full CC BY 4.0 legal code");

  const cff = fs.readFileSync(path.join(root, "CITATION.cff"), "utf8");
  for (const token of ["cff-version: 1.2.0", "version: 1.0.0", "date-released: 2026-08-06", "repository-code: \"https://github.com/chatdeepai/deepseek-1m-context-benchmark\"", "license: CC-BY-4.0"]) {
    ensure(cff.includes(token), `CITATION.cff is missing: ${token}`);
  }
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  ensure(!quoted, "CSV contains an unterminated quoted field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  ensure(rows.length > 0, "CSV is empty");
  const headers = rows[0];
  ensure(headers.every(Boolean) && new Set(headers).size === headers.length, "CSV headers are invalid");
  return {
    headers,
    rows: rows.slice(1).filter((values) => values.some((value) => value !== "")).map((values, index) => {
      ensure(values.length === headers.length, `CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}`);
      return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    }),
  };
}

function exactKeys(actual, expected, label) {
  ensure(JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), `${label} keys are not exact`);
}

function exactCount(value, expected, label) {
  ensure(Number(value) === expected, `${label} is ${value}; expected ${expected}`);
}

function comparableScalar(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function parseChecksumFile(root) {
  const checksumPath = path.join(root, "release", "checksums.sha256");
  const entries = fs.readFileSync(checksumPath, "utf8").replace(/\r\n?/g, "\n").split("\n").filter(Boolean).map((line, index) => {
    const match = /^([0-9a-f]{64})  ([^\\\r\n]+)$/.exec(line);
    ensure(match, `checksums.sha256 line ${index + 1} is invalid`);
    const relative = match[2].replaceAll("\\", "/");
    ensure(!relative.startsWith("/") && !relative.startsWith("../") && !relative.includes("/../"), `unsafe checksum path: ${relative}`);
    return { sha256: match[1], path: relative };
  });
  ensure(entries.length > 0 && new Set(entries.map((entry) => entry.path)).size === entries.length, "checksum inventory is empty or duplicated");
  for (const entry of entries) {
    const file = path.join(root, entry.path);
    ensure(fs.existsSync(file) && fs.statSync(file).isFile(), `checksummed file is missing: ${entry.path}`);
    ensure(sha256File(file) === entry.sha256, `checksum mismatch: ${entry.path}`);
  }
  return entries;
}

export function validateProductionRelease(root, { embedded = false } = {}) {
  const resolved = path.resolve(root);
  const expectedTopLevel = ["charts", "gutenberg-draft.template.html", "release", "tables", "template-bindings.required.json", "wordpress-metadata.json"];
  if (!embedded) ensure(JSON.stringify(fs.readdirSync(resolved).sort()) === JSON.stringify(expectedTopLevel), "publication-release top-level inventory is not exact");
  else for (const name of expectedTopLevel) ensure(fs.existsSync(path.join(resolved, name)), `embedded publication release is missing ${name}`);
  for (const name of RELEASE_REQUIRED) ensure(fs.existsSync(path.join(resolved, "release", name)), `publication release is missing release/${name}`);
  ensure(!fs.existsSync(path.join(resolved, "SYNTHETIC-TEST-ONLY.txt")), "synthetic QA marker is forbidden");

  const qa = readJson(path.join(resolved, "release", "qa-report.json"));
  ensure(qa.release_version === CONTRACT.releaseVersion && qa.all_passed === true && qa.synthetic_test_data === false, "release QA is not a passing production v1.0.0 report");
  ensure(Array.isArray(qa.privacy_findings) && qa.privacy_findings.length === 0, "release QA contains privacy findings");

  const manifest = readJson(path.join(resolved, "release", "manifest.json"));
  ensure(manifest.release_version === CONTRACT.releaseVersion && manifest.protocol_id === CONTRACT.protocolId, "release manifest identity is invalid");
  ensure(typeof manifest.status === "string" && !/synthetic|test_only|blocked/i.test(manifest.status), "release manifest status is not publishable");
  exactCount(manifest.counts?.terminal_rows, CONTRACT.counts.all, "manifest terminal rows");
  exactCount(manifest.counts?.pilot_excluded, CONTRACT.counts.pilot_excluded, "manifest pilot rows");
  exactCount(manifest.counts?.primary_accuracy, CONTRACT.counts.primary_accuracy, "manifest primary rows");
  exactCount(manifest.counts?.india_latency_validation, CONTRACT.counts.india_latency_validation, "manifest India rows");

  const summary = readJson(path.join(resolved, "release", "summary.json"));
  ensure(summary.release_version === CONTRACT.releaseVersion && summary.protocol_id === CONTRACT.protocolId && summary.synthetic_test_data === false, "summary identity or production status is invalid");
  exactCount(summary.counts?.terminal_rows, CONTRACT.counts.all, "summary terminal rows");
  exactCount(summary.counts?.pilot_excluded, CONTRACT.counts.pilot_excluded, "summary pilot rows");
  exactCount(summary.counts?.primary_accuracy, CONTRACT.counts.primary_accuracy, "summary primary rows");
  exactCount(summary.counts?.india_latency_validation, CONTRACT.counts.india_latency_validation, "summary India rows");

  ensure(sha256File(path.join(resolved, "release", "protocol.json")) === CONTRACT.protocolSha256, "release protocol hash is wrong");
  ensure(sha256File(path.join(resolved, "release", "calibration.json")) === CONTRACT.calibrationSha256, "release calibration hash is wrong");

  const checksumEntries = parseChecksumFile(resolved);
  const checksumPaths = checksumEntries.map((entry) => entry.path).sort();
  ensure(Array.isArray(manifest.files) && manifest.files.length > 0, "release manifest file inventory is missing");
  const manifestPaths = manifest.files.map((entry) => {
    ensure(entry && typeof entry.path === "string" && Number.isInteger(entry.bytes) && entry.bytes > 0 && /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""), "release manifest entry is invalid");
    const file = path.join(resolved, entry.path);
    ensure(fs.existsSync(file), `manifest file is missing: ${entry.path}`);
    ensure(fs.statSync(file).size === entry.bytes && sha256File(file) === entry.sha256, `manifest size/hash mismatch: ${entry.path}`);
    return entry.path;
  }).sort();
  ensure(JSON.stringify(checksumPaths) === JSON.stringify([...manifestPaths, "release/manifest.json"].sort()), "checksum inventory must equal manifest files plus release/manifest.json");
  let actualReleaseFiles = checksumPaths;
  if (!embedded) {
    actualReleaseFiles = listFiles(resolved).filter((relative) => relative !== "release/checksums.sha256").sort();
    ensure(JSON.stringify(actualReleaseFiles) === JSON.stringify(checksumPaths), "publication-release contains an unsealed or missing file");
  }

  const datasets = [
    ["all-attempts.csv", CONTRACT.counts.all, null],
    ["primary-cases.csv", CONTRACT.counts.primary_accuracy, "primary_accuracy"],
    ["pilot-excluded-cases.csv", CONTRACT.counts.pilot_excluded, "pilot_excluded"],
    ["india-latency-cases.csv", CONTRACT.counts.india_latency_validation, "india_latency_validation"],
  ];
  const parsedDatasets = {};
  for (const [name, expectedRows, expectedRole] of datasets) {
    const parsed = parseCsv(fs.readFileSync(path.join(resolved, "release", name), "utf8"));
    exactKeys(parsed.headers, PUBLIC_COLUMNS, name);
    exactCount(parsed.rows.length, expectedRows, `${name} rows`);
    if (expectedRole) ensure(parsed.rows.every((row) => row.analysis_role === expectedRole), `${name} contains a wrong analysis role`);
    parsedDatasets[name] = parsed.rows;
  }

  const allRows = parsedDatasets["all-attempts.csv"];
  const primaryRows = parsedDatasets["primary-cases.csv"];
  const roleCounts = Object.fromEntries(["pilot_excluded", "primary_accuracy", "india_latency_validation"].map((role) => [role, allRows.filter((row) => row.analysis_role === role).length]));
  exactCount(roleCounts.pilot_excluded, CONTRACT.counts.pilot_excluded, "all-attempts pilot role count");
  exactCount(roleCounts.primary_accuracy, CONTRACT.counts.primary_accuracy, "all-attempts primary role count");
  exactCount(roleCounts.india_latency_validation, CONTRACT.counts.india_latency_validation, "all-attempts India role count");
  ensure(allRows.every((row) => ["pilot_excluded", "primary_accuracy", "india_latency_validation"].includes(row.analysis_role)), "all-attempts contains an unknown analysis role");
  ensure(primaryRows.every((row) => String(row.include_in_primary_accuracy_denominators).toLowerCase() === "true"), "a primary row is excluded from the primary denominator");
  ensure(parsedDatasets["pilot-excluded-cases.csv"].every((row) => String(row.include_in_primary_accuracy_denominators).toLowerCase() === "false"), "a pilot row enters the primary denominator");
  ensure(parsedDatasets["india-latency-cases.csv"].every((row) => String(row.include_in_primary_accuracy_denominators).toLowerCase() === "false"), "an India row enters the primary denominator");
  exactCount(primaryRows.filter((row) => row.model_id === "deepseek-v4-flash").length, 144, "primary Flash rows");
  exactCount(primaryRows.filter((row) => row.model_id === "deepseek-v4-pro").length, 144, "primary Pro rows");
  ensure(primaryRows.every((row) => ["deepseek-v4-flash", "deepseek-v4-pro"].includes(row.model_id)), "primary data contains an unexpected model ID");
  ensure(new Set(allRows.map((row) => row.public_case_uid)).size === CONTRACT.counts.all, "public_case_uid values are missing or duplicated");

  const jsonl = fs.readFileSync(path.join(resolved, "release", "all-attempts.jsonl"), "utf8").replace(/\r\n?/g, "\n").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new ReleaseValidationError(`all-attempts.jsonl line ${index + 1} is invalid JSON`); }
  });
  exactCount(jsonl.length, CONTRACT.counts.all, "all-attempts.jsonl rows");
  jsonl.forEach((row, index) => {
    exactKeys(Object.keys(row), PUBLIC_COLUMNS, `all-attempts.jsonl row ${index + 1}`);
    for (const field of PUBLIC_COLUMNS) ensure(comparableScalar(row[field]) === comparableScalar(allRows[index][field]), `CSV/JSONL mismatch at row ${index + 1}, field ${field}`);
  });

  const pairs = parseCsv(fs.readFileSync(path.join(resolved, "release", "india-matched-pairs.csv"), "utf8"));
  exactCount(pairs.rows.length, CONTRACT.counts.india_latency_validation, "India coordinate pairs");
  ensure(pairs.rows.every((row) => String(row.coordinate_pair_matched).toLowerCase() === "true"), "India pair table contains an unmatched coordinate");

  const findings = scanTree(resolved, [...checksumPaths, "release/checksums.sha256"]);
  ensure(findings.length === 0, `publication release privacy scan failed: ${JSON.stringify(findings)}`);
  return { files: actualReleaseFiles.length + 1, checksums: checksumEntries.length, terminalRows: CONTRACT.counts.all, privacyFindings: 0, embedded };
}

export function validateSkeleton(root) {
  const resolved = path.resolve(root);
  validateRootDocuments(resolved, "skeleton");
  ensure(fs.existsSync(path.join(resolved, "release", "NOT-BUILT.md")), "skeleton release blocker is missing");
  ensure(!fs.existsSync(path.join(resolved, "release", "summary.json")), "skeleton must not contain result data");
  ensure(!fs.existsSync(path.join(resolved, "charts")) && !fs.existsSync(path.join(resolved, "tables")) && !fs.existsSync(path.join(resolved, "publication")), "skeleton contains a result or copied-code directory before assembly");
  const files = listFiles(resolved);
  const findings = scanTree(resolved, files);
  ensure(findings.length === 0, `skeleton privacy scan failed: ${JSON.stringify(findings)}`);
  return { mode: "skeleton", files: files.length, privacyFindings: 0, releaseReady: false, licenses: { code: "MIT", data: "CC-BY-4.0-full-legal-code" } };
}

export function validateReadyRepository(root) {
  const resolved = path.resolve(root);
  validateRootDocuments(resolved, "ready");
  ensure(!fs.existsSync(path.join(resolved, ".git")), "ready staging directory must not contain Git history before review");
  ensure(!fs.existsSync(path.join(resolved, "release", "NOT-BUILT.md")), "ready repository still contains the skeleton release blocker");
  for (const relative of BENCHMARK_FILES) ensure(fs.existsSync(path.join(resolved, "benchmark", relative)), `curated benchmark file is missing: ${relative}`);
  for (const relative of PUBLICATION_FILES) ensure(fs.existsSync(path.join(resolved, "publication", relative)), `curated publication file is missing: ${relative}`);
  ensure(sha256File(path.join(resolved, "benchmark", "protocol.json")) === CONTRACT.protocolSha256, "benchmark protocol hash is wrong");
  ensure(sha256File(path.join(resolved, "benchmark", "calibration.json")) === CONTRACT.calibrationSha256, "benchmark calibration hash is wrong");
  ensure(sha256File(path.join(resolved, "benchmark", "protocol.json")) === sha256File(path.join(resolved, "release", "protocol.json")), "benchmark and release protocol copies differ");
  ensure(sha256File(path.join(resolved, "benchmark", "calibration.json")) === sha256File(path.join(resolved, "release", "calibration.json")), "benchmark and release calibration copies differ");
  ensure(!fs.existsSync(path.join(resolved, "benchmark", "tokenizer", "tokenizer.json")) && !fs.existsSync(path.join(resolved, "benchmark", "tokenizer", "tokenizer_config.json")), "uncleared tokenizer file is present");
  ensure(!fs.existsSync(path.join(resolved, "benchmark", "sources")) && !fs.existsSync(path.join(resolved, "benchmark", "evidence")) && !fs.existsSync(path.join(resolved, "aws")), "excluded benchmark or AWS directory is present");
  const release = validateProductionRelease(resolved, { embedded: true });
  const files = listFiles(resolved);
  const findings = scanTree(resolved, files);
  ensure(findings.length === 0, `ready repository privacy scan failed: ${JSON.stringify(findings)}`);
  return { mode: "ready", files: files.length, releaseFiles: release.files, checksums: release.checksums, terminalRows: release.terminalRows, privacyFindings: 0, releaseReady: true, licenses: { code: "MIT", data: "CC-BY-4.0-full-legal-code" } };
}

export const CURATED = Object.freeze({ benchmarkFiles: BENCHMARK_FILES, publicationFiles: PUBLICATION_FILES, rootDocuments: REQUIRED_ROOT_DOCS });
