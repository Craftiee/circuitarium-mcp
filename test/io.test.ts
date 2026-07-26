import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CIRCUITARIUM_MCP_ROOT,
  ELECTRONICS_MCP_ROOT,
  listCruFiles,
  readCruFile,
  resolveCircuitariumMcpRoot,
  WorkspacePathDeniedError,
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

test("file snapshots preserve a UTF-8 BOM and reject malformed UTF-8", async () => {
  const directory = await mkdtemp(
    join(CIRCUITARIUM_MCP_ROOT, ".circuitarium-utf8-test-"),
  );
  const plainPath = join(directory, "plain.cru");
  const bomPath = join(directory, "bom.cru");
  const invalidPath = join(directory, "invalid.cru");
  const xml = '<?xml version="1.0" encoding="utf-8"?><SaveData />';
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
    assert.equal(bom.xml.charCodeAt(0), 0xfeff);
    assert.equal(bom.bytes.byteLength, plain.bytes.byteLength + 3);
    assert.notDeepEqual(bom.bytes, plain.bytes);
    const invalid = await readCruFile(invalidPath);
    assert.throws(
      () => invalid.xml,
      /valid UTF-8 text/,
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("workspace listing respects recursion and skips ignored directories", async () => {
  const directory = await mkdtemp(
    join(CIRCUITARIUM_MCP_ROOT, ".circuitarium-walker-test-"),
  );
  try {
    await mkdir(join(directory, "nested"));
    await mkdir(join(directory, ".hidden"));
    await mkdir(join(directory, "node_modules"));
    await Promise.all([
      writeFile(join(directory, "root.cru"), "", "utf8"),
      writeFile(join(directory, "nested", "nested.cru"), "", "utf8"),
      writeFile(join(directory, ".hidden", "hidden.cru"), "", "utf8"),
      writeFile(join(directory, "node_modules", "dependency.cru"), "", "utf8"),
    ]);

    const shallow = await listCruFiles(directory, { recursive: false });
    assert.deepEqual(
      shallow.entries.map((entry) => entry.ref.split("/").at(-1)),
      ["root.cru"],
    );

    const recursive = await listCruFiles(directory);
    assert.deepEqual(
      recursive.entries.map((entry) => entry.ref.split("/").at(-1)),
      ["nested.cru", "root.cru"],
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("workspace listing skips symbolic-link directories", async (context) => {
  const directory = await mkdtemp(
    join(CIRCUITARIUM_MCP_ROOT, ".circuitarium-symlink-test-"),
  );
  const outsideDirectory = await mkdtemp(
    join(tmpdir(), "circuitarium-symlink-outside-"),
  );
  try {
    const realDirectory = join(directory, "real");
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, "inside.cru"), "", "utf8");
    await writeFile(join(outsideDirectory, "outside.cru"), "", "utf8");
    try {
      await symlink(
        realDirectory,
        join(directory, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await symlink(
        outsideDirectory,
        join(directory, "outside-linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        context.skip(`Directory links are unavailable on this runner (${code})`);
        return;
      }
      throw error;
    }

    const listing = await listCruFiles(directory);
    assert.equal(listing.entries.length, 1);
    const [entry] = listing.entries;
    assert.ok(entry);
    assert.match(entry.ref, /\/real\/inside\.cru$/);
    assert.doesNotMatch(entry.ref, /\/linked\//);
    assert.doesNotMatch(entry.ref, /\/outside-linked\//);
  } finally {
    await rm(directory, { recursive: true });
    await rm(outsideDirectory, { recursive: true });
  }
});

test("workspace listing rejects a start directory outside the configured root", async () => {
  const outsideDirectory = await mkdtemp(
    join(tmpdir(), "circuitarium-walker-outside-"),
  );
  try {
    await assert.rejects(
      listCruFiles(outsideDirectory),
      WorkspacePathDeniedError,
    );
  } finally {
    await rm(outsideDirectory, { recursive: true });
  }
});

test("workspace listing enforces its streaming scan budget", async () => {
  const directory = await mkdtemp(
    join(CIRCUITARIUM_MCP_ROOT, ".circuitarium-budget-test-"),
  );
  try {
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        writeFile(join(directory, `${index}.cru`), "", "utf8"),
      ),
    );
    const listing = await listCruFiles(directory, { scanEntryLimit: 2 });

    assert.equal(listing.scannedEntries, 2);
    assert.equal(listing.scanTruncated, true);
    assert.ok(listing.entries.length <= 2);
  } finally {
    await rm(directory, { recursive: true });
  }
});
