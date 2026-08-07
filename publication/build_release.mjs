#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { bindTemplate, buildRelease, createScaffold, DEFAULTS, PublicationError } from "./lib.mjs";

function usage() {
  return `DeepSeek 1M publication pipeline

Usage:
  node build_release.mjs scaffold [--output-dir PATH] [--protocol PATH]
  node build_release.mjs build --source-archive PATH --expected-archive-sha256 HEX --output-dir PATH [--release-version 1.0.0]
  node build_release.mjs bind --template PATH --media-map PATH --output PATH [--release-root PATH]

The build command is network-free. Production mode requires the original publication-safe.tar.gz and its out-of-band SHA-256 copied from trusted CloudShell output; it refuses incomplete or failed validator exports.`;
}

function parseArgs(values) {
  const args = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2).replaceAll("-", "_");
    const next = values[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function absolute(value) {
  return value ? path.resolve(process.cwd(), value) : undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    console.log(usage());
    return command ? 0 : 2;
  }
  if (command === "scaffold") {
    const outputDir = absolute(args.output_dir) ?? path.resolve(path.dirname(DEFAULTS.protocol), "../../../outputs/deepseek-1m-context-benchmark/publication-scaffold");
    const gate = createScaffold(outputDir, { protocol: absolute(args.protocol) ?? DEFAULTS.protocol });
    console.log(JSON.stringify({ status: gate.status, output_dir: outputDir, result_claims_allowed: false }));
    return 0;
  }
  if (command === "build") {
    if (!args.source_archive || !args.expected_archive_sha256 || !args.output_dir) throw new PublicationError("build requires --source-archive, --expected-archive-sha256, and --output-dir");
    if (args.input_dir) throw new PublicationError("production build does not accept --input-dir; pass the pinned publication-safe archive");
    const result = buildRelease({
      sourceArchivePath: absolute(args.source_archive),
      expectedArchiveSha256: args.expected_archive_sha256,
      outputDir: absolute(args.output_dir),
      releaseVersion: args.release_version ?? "1.0.0",
      protocolPath: absolute(args.protocol) ?? DEFAULTS.protocol,
      calibrationPath: absolute(args.calibration) ?? DEFAULTS.calibration,
    });
    console.log(JSON.stringify({
      status: "PASS",
      output_dir: result.outputDir,
      terminal_rows: result.summary.counts.terminal_rows,
      charts: result.charts.length,
      dataset_release_all_passed: result.qa.all_passed,
      wordpress_ready: result.qa.wordpress_ready,
    }));
    return 0;
  }
  if (command === "bind") {
    if (!args.template || !args.media_map || !args.output) throw new PublicationError("bind requires --template, --media-map, and --output");
    const qa = bindTemplate({ template: absolute(args.template), mediaMap: absolute(args.media_map), output: absolute(args.output), releaseRoot: absolute(args.release_root) });
    console.log(JSON.stringify({ status: "PASS", output: absolute(args.output), ...qa }));
    return 0;
  }
  throw new PublicationError(`unknown command: ${command}`);
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  const expected = error instanceof PublicationError;
  console.error(JSON.stringify({ status: "FAIL", error: error.message, expected }));
  process.exitCode = 1;
});
