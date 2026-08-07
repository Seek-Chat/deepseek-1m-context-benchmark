#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { ReleaseValidationError, ensure, validateReadyRepository, validateSkeleton } from "./release-lib.mjs";

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

try {
  const args = parseArgs(process.argv.slice(2));
  ensure(Object.keys(args).every((key) => ["git_metadata", "mode", "root"].includes(key)), "only --git-metadata, --mode, and --root are accepted");
  const mode = args.mode ?? "skeleton";
  ensure(["skeleton", "ready"].includes(mode), "--mode must be skeleton or ready");
  const gitMetadata = args.git_metadata ?? "reject";
  ensure(["allow", "reject"].includes(gitMetadata), "--git-metadata must be allow or reject");
  ensure(mode === "ready" || gitMetadata === "reject", "--git-metadata allow is valid only in ready mode");
  const root = path.resolve(args.root ?? ".");
  const report = mode === "skeleton" ? validateSkeleton(root) : validateReadyRepository(root, { allowGitMetadata: gitMetadata === "allow" });
  process.stdout.write(`${JSON.stringify({ status: "PASS", validation_scope: "repository_content_only", root, ...report }, null, 2)}\n`);
} catch (error) {
  const expected = error instanceof ReleaseValidationError;
  process.stderr.write(`${JSON.stringify({ status: "FAIL", expected, error: error.message })}\n`);
  process.exitCode = 1;
}
