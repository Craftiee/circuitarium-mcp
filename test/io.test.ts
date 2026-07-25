import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CIRCUITARIUM_MCP_ROOT,
  ELECTRONICS_MCP_ROOT,
  readCruFile,
  resolveCircuitariumMcpRoot,
} from "../src/adapters/crumb/io.js";

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
