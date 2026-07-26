import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CIRCUITARIUM_MCP_ROOT,
  ELECTRONICS_MCP_ROOT,
  MAX_CRU_BYTES,
  MAX_CRU_COMPARISON_BYTES,
  readCruFile,
  requireCruComparisonSize,
  resolveCircuitariumMcpRoot,
} from "../src/adapters/crumb/io.js";
import { compareCru } from "../src/adapters/crumb/compare.js";
import { generateFixture } from "../src/adapters/crumb/fixtures.js";

test("CRUMB file reads are confined to CIRCUITARIUM_MCP_ROOT", async () => {
  const directory = await mkdtemp(join(tmpdir(), "circuitarium-mcp-test-"));
  const path = join(directory, "outside.cru");
  try {
    await writeFile(path, "<SaveData />", "utf8");
    await assert.rejects(readCruFile(path), /outside CIRCUITARIUM_MCP_ROOT/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("the legacy root export aliases CIRCUITARIUM_MCP_ROOT", () => {
  assert.equal(ELECTRONICS_MCP_ROOT, CIRCUITARIUM_MCP_ROOT);
});

test("CIRCUITARIUM_MCP_ROOT takes precedence over the legacy environment variable", () => {
  const circuitariumRoot = join(tmpdir(), "circuitarium-primary-root");
  const legacyRoot = join(tmpdir(), "electronics-legacy-root");
  assert.equal(
    resolveCircuitariumMcpRoot({
      CIRCUITARIUM_MCP_ROOT: circuitariumRoot,
      ELECTRONICS_MCP_ROOT: legacyRoot,
    }),
    circuitariumRoot,
  );
});

test("ELECTRONICS_MCP_ROOT remains a backward-compatible fallback", () => {
  const legacyRoot = join(tmpdir(), "electronics-legacy-root");
  assert.equal(
    resolveCircuitariumMcpRoot({
      CIRCUITARIUM_MCP_ROOT: undefined,
      ELECTRONICS_MCP_ROOT: legacyRoot,
    }),
    legacyRoot,
  );
});

test("CRUMB comparison size limits retain room for the Unity evidence corpus", () => {
  assert.equal(MAX_CRU_BYTES, 3 * 1024 * 1024);
  assert.equal(MAX_CRU_COMPARISON_BYTES, 5 * 1024 * 1024);
  assert.doesNotThrow(() =>
    requireCruComparisonSize(2_149_258, 2_149_258),
  );
  assert.throws(
    () => requireCruComparisonSize(MAX_CRU_BYTES, MAX_CRU_BYTES),
    /Combined CRUMB comparison input/,
  );
});

test("file identity preserves a UTF-8 BOM and rejects malformed UTF-8", async () => {
  const directory = await mkdtemp(
    join(process.cwd(), "circuitarium-utf8-test-"),
  );
  const plainPath = join(directory, "plain.cru");
  const bomPath = join(directory, "bom.cru");
  const invalidPath = join(directory, "invalid.cru");
  const xml = generateFixture("empty");
  try {
    await writeFile(plainPath, Buffer.from(xml, "utf8"));
    await writeFile(
      bomPath,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(xml, "utf8"),
      ]),
    );
    await writeFile(invalidPath, Buffer.from([0xc3, 0x28]));

    const plain = await readCruFile(plainPath);
    const bom = await readCruFile(bomPath);
    assert.notEqual(plain.digest, bom.digest);
    assert.equal(bom.bytes, plain.bytes + 3);
    assert.equal(bom.xml.charCodeAt(0), 0xfeff);

    const comparison = compareCru(plain.xml, bom.xml, {
      baselineByteDigest: plain.digest,
      candidateByteDigest: bom.digest,
    });
    assert.equal(comparison.equivalence.byteEquivalent, false);
    assert.equal(comparison.equivalence.modeledContentEquivalent, true);
    assert.equal(
      comparison.equivalence.modeledRepresentationEquivalent,
      true,
    );
    assert.equal(comparison.equivalence.assessment, "modeled-only");

    await assert.rejects(
      readCruFile(invalidPath),
      /valid UTF-8 text/,
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});
