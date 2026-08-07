import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanPngBuffer, scanText, scanTree, validateReadyRepository, validateSkeleton } from "../tools/release-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

test("repository passes its applicable structure, license, and privacy validation", () => {
  const releaseReady = fs.existsSync(path.join(ROOT, "release", "checksums.sha256"));
  const hasGitMetadata = fs.existsSync(path.join(ROOT, ".git"));
  const report = releaseReady ? validateReadyRepository(ROOT, { allowGitMetadata: hasGitMetadata }) : validateSkeleton(ROOT);
  assert.equal(report.mode, releaseReady ? "ready" : "skeleton");
  assert.equal(report.releaseReady, releaseReady);
  if (releaseReady) assert.equal(report.gitMetadataExcluded, hasGitMetadata);
  assert.equal(report.privacyFindings, 0);
  assert.equal(report.licenses.code, "MIT");
  assert.equal(report.licenses.data, "CC-BY-4.0-full-legal-code");
});

test("pre-Git ready validation still rejects initialized Git metadata", { skip: !fs.existsSync(path.join(ROOT, "release", "checksums.sha256")) || !fs.existsSync(path.join(ROOT, ".git")) }, () => {
  assert.throws(() => validateReadyRepository(ROOT), /must not contain Git history before review/);
  assert.equal(validateReadyRepository(ROOT, { allowGitMetadata: true }).gitMetadataExcluded, true);
});

test("privacy scanner detects representative private material", () => {
  const samples = [
    ["api", `${"s"}${"k-"}example-private-value`],
    ["account", `${"arn:"}${"aws:"}lambda:us-east-1:${"123456"}${"789012"}:function:private`],
    ["path", `${"C:"}${"\\Users\\"}private\\evidence.json`],
    ["email", `${"private"}${"@"}example.com`],
    ["admin", `https://chat-deep.ai/${"wp-admin/"}post.php`],
    ["resource", `${"chatdeep-context-"}${"benchmark-us-rawbucket-private"}`],
    ["secret-name", `${"chatdeep/"}${"deepseek-1m-context-benchmark/api-key"}`],
  ];
  for (const [label, value] of samples) assert.ok(scanText(value, label).length > 0, `${label} should be detected`);
});

test("privacy scanner permits hashes and immutable public release URLs", () => {
  const safe = [
    "39c68bfc607157011012dc47d59524dcf3d5d7155071e6862c5038410d642c16",
    "https://raw.githubusercontent.com/chatdeepai/deepseek-1m-context-benchmark/v1.0.0/release/summary.json",
    "https://github.com/chatdeepai/deepseek-1m-context-benchmark/releases/tag/v1.0.0",
    `${"pilot-us-"}${"20260806-001-retry1"}`,
  ].join("\n");
  assert.deepEqual(scanText(safe, "safe"), []);
});

test("privacy scanner treats SHA-256 checksum manifests as text", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-public-scan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = path.join(root, "checksums.sha256");
  fs.writeFileSync(manifest, `${"a".repeat(64)}  release/summary.json\n`, "utf8");
  assert.deepEqual(scanTree(root), []);
  fs.writeFileSync(manifest, `${"private"}${"@"}example.com\n`, "utf8");
  assert.ok(scanTree(root).some((finding) => finding.pattern === "email_address"));
});

function pngChunk(type, data) {
  const body = Buffer.from(data);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  chunk.write(type, 4, 4, "ascii");
  body.copy(chunk, 8);
  // CRC bytes are structurally present. Release integrity is independently SHA-256-bound.
  return chunk;
}

function testPng(chunks) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), ...chunks, pngChunk("IEND", Buffer.alloc(0))]);
}

test("PNG scanner ignores compressed pixel bytes rather than treating them as metadata", () => {
  const pixelBytes = Buffer.from(`${"123456"}${"789012"}${"s"}${"k-"}not-metadata`);
  assert.deepEqual(scanPngBuffer(testPng([pngChunk("IDAT", pixelBytes)]), "pixels.png"), []);
});

test("PNG scanner inspects explicit textual metadata", () => {
  const text = Buffer.from(`Comment\0${"private"}${"@"}example.com`, "latin1");
  const findings = scanPngBuffer(testPng([pngChunk("tEXt", text), pngChunk("IDAT", Buffer.from([1]))]), "metadata.png");
  assert.ok(findings.some((finding) => finding.pattern === "email_address"));
});

test("PNG scanner rejects arbitrary EXIF metadata chunks", () => {
  assert.throws(() => scanPngBuffer(testPng([pngChunk("eXIf", Buffer.from([1, 2, 3])), pngChunk("IDAT", Buffer.from([1]))]), "exif.png"), /unapproved ancillary PNG chunk eXIf/);
});
