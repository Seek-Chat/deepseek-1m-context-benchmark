#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CURATED, ReleaseValidationError, ensure, listFiles, validateProductionRelease, validateReadyRepository } from "./release-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKELETON_ROOT = path.resolve(HERE, "..");

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    ensure(value.startsWith("--"), `unexpected argument: ${value}`);
    const key = value.slice(2).replaceAll("-", "_");
    ensure(!Object.hasOwn(parsed, key), `duplicate argument: ${value}`);
    const next = values[index + 1];
    ensure(next && !next.startsWith("--"), `missing value for ${value}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function requireDirectory(value, label) {
  ensure(value, `${label} is required`);
  const resolved = path.resolve(value);
  ensure(fs.existsSync(resolved) && fs.statSync(resolved).isDirectory(), `${label} is not a directory: ${resolved}`);
  ensure(!fs.lstatSync(resolved).isSymbolicLink(), `${label} must not be a symbolic link: ${resolved}`);
  return resolved;
}

function copyFile(source, destination) {
  ensure(fs.existsSync(source) && fs.statSync(source).isFile(), `source file is missing: ${source}`);
  ensure(!fs.lstatSync(source).isSymbolicLink(), `source symbolic link is forbidden: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function copyTree(source, destination) {
  ensure(fs.existsSync(source) && fs.statSync(source).isDirectory(), `source directory is missing: ${source}`);
  for (const relative of listFiles(source)) copyFile(path.join(source, relative), path.join(destination, relative));
}

function copySkeleton(output) {
  for (const relative of listFiles(SKELETON_ROOT)) {
    if (relative === "release/NOT-BUILT.md") continue;
    copyFile(path.join(SKELETON_ROOT, relative), path.join(output, relative));
  }
  const readmePath = path.join(output, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  const blocked = "> **LOCAL SKELETON — NOT A DATA RELEASE. No measured benchmark files are present in this directory, and this directory must not be published or cited.**";
  const ready = "> **Dataset release v1.0.0. All result files are sanitized, checksum-bound, and generated from the frozen protocol.**";
  ensure(readme.includes(blocked), "skeleton README publication blocker is missing");
  const skeletonNote = "The local skeleton contains `release/NOT-BUILT.md` instead of results. The assembly tool removes that blocker only after it verifies a real, non-synthetic publication release.";
  const releaseNote = "Release `v1.0.0` was assembled only after the production validator, non-synthetic status, sealed checksums, frozen hashes, row counts, and privacy gates passed.";
  ensure(readme.includes(skeletonNote), "skeleton README assembly note is missing");
  fs.writeFileSync(readmePath, readme.replace(blocked, ready).replace(skeletonNote, releaseNote), "utf8");

  const changelogPath = path.join(output, "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const planned = "Planned first public release under tag `v1.0.0`.";
  const assembled = "First public-data release candidate for immutable tag `v1.0.0`.";
  const blocker = "\nThis entry is not evidence that the release has been published. The local skeleton remains blocked until assembly and ready-mode validation pass.\n";
  ensure(changelog.includes(planned) && changelog.includes(blocker), "skeleton changelog markers are missing");
  fs.writeFileSync(changelogPath, changelog.replace(planned, assembled).replace(blocker, "\n"), "utf8");
}

function copyCurated(sourceRoot, destinationRoot, files, label) {
  for (const relative of files) copyFile(path.join(sourceRoot, relative), path.join(destinationRoot, relative));
  ensure(files.length > 0, `${label} allowlist is empty`);
}

function adaptBenchmarkDocumentation(output) {
  const readmePath = path.join(output, "benchmark", "README.md");
  let readme = fs.readFileSync(readmePath, "utf8");
  const privateCheckoutText = "`calibrate` requires the optional `tokenizers` package and the checked-in\n`tokenizer/tokenizer.json`. The development checkout keeps optional packages in\n`../.deps`; expose that directory on `PYTHONPATH` when it is not already\navailable.";
  const publicText = "`calibrate` requires the optional `tokenizers` package and an independently\nobtained `tokenizer/tokenizer.json` whose bytes and SHA-256 match the frozen\nvalues. Install `tokenizers` in your own isolated environment before running\ncalibration verification; the tokenizer binary is not redistributed here.";
  ensure(readme.includes(privateCheckoutText), "benchmark README private-checkout paragraph changed unexpectedly");
  readme = readme.replace(privateCheckoutText, publicText);
  fs.writeFileSync(readmePath, readme, "utf8");

  const protocolPath = path.join(output, "benchmark", "PROTOCOL.md");
  let protocol = fs.readFileSync(protocolPath, "utf8");
  const checkedIn = "the checked-in official DeepSeek-V4-Pro `tokenizer.json`.";
  const independentlyObtained = "the frozen official DeepSeek-V4-Pro `tokenizer.json` input.";
  ensure(protocol.includes(checkedIn), "benchmark PROTOCOL tokenizer wording changed unexpectedly");
  protocol = protocol.replace(checkedIn, independentlyObtained);
  fs.writeFileSync(protocolPath, protocol, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const expectedArgs = ["benchmark_source", "output", "publication_release", "publication_source"];
  ensure(JSON.stringify(Object.keys(args).sort()) === JSON.stringify(expectedArgs), `arguments must be exactly: ${expectedArgs.map((name) => `--${name.replaceAll("_", "-")}`).join(", ")}`);
  const publicationRelease = requireDirectory(args.publication_release, "--publication-release");
  const benchmarkSource = requireDirectory(args.benchmark_source, "--benchmark-source");
  const publicationSource = requireDirectory(args.publication_source, "--publication-source");
  ensure(args.output, "--output is required");
  const output = path.resolve(args.output);
  ensure(!fs.existsSync(output), `output already exists: ${output}`);
  for (const source of [SKELETON_ROOT, publicationRelease, benchmarkSource, publicationSource]) {
    ensure(output !== source && !output.startsWith(`${source}${path.sep}`), `output must not be inside an input directory: ${source}`);
  }

  // Validate the sealed, non-synthetic release before creating any staging output.
  const sourceValidation = validateProductionRelease(publicationRelease);
  let created = false;
  try {
    fs.mkdirSync(output, { recursive: false });
    created = true;
    copySkeleton(output);
    for (const name of ["charts", "release", "tables"]) copyTree(path.join(publicationRelease, name), path.join(output, name));
    for (const name of ["gutenberg-draft.template.html", "template-bindings.required.json", "wordpress-metadata.json"]) copyFile(path.join(publicationRelease, name), path.join(output, name));
    copyCurated(benchmarkSource, path.join(output, "benchmark"), CURATED.benchmarkFiles, "benchmark");
    copyCurated(publicationSource, path.join(output, "publication"), CURATED.publicationFiles, "publication");
    adaptBenchmarkDocumentation(output);
    const readyValidation = validateReadyRepository(output);
    process.stdout.write(`${JSON.stringify({ status: "PASS", action: "assembled_local_only", output, sourceValidation, readyValidation, remote_repository_created: false, published: false }, null, 2)}\n`);
  } catch (error) {
    if (created && fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

try {
  main();
} catch (error) {
  const expected = error instanceof ReleaseValidationError;
  process.stderr.write(`${JSON.stringify({ status: "FAIL", expected, error: error.message })}\n`);
  process.exitCode = 1;
}
