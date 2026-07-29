import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { SERVER_VERSION } from "../src/identity.js";

const CONFIG_DIRECTORY = join(process.cwd(), "examples", "client-configs");
const PACKAGE_SPEC = `circuitarium-mcp@${SERVER_VERSION}`;

interface StdioConfig {
  args?: unknown;
  command?: unknown;
  env?: unknown;
  type?: unknown;
}

async function readExample(name: string): Promise<string> {
  return readFile(join(CONFIG_DIRECTORY, name), "utf8");
}

function assertNpxStdioConfig(config: StdioConfig, expectedRoot: string): void {
  assert.equal(config.command, "npx");
  assert.deepEqual(config.args, ["-y", PACKAGE_SPEC]);
  assert.deepEqual(config.env, {
    CIRCUITARIUM_MCP_ROOT: expectedRoot,
  });
}

function fencedBlocks(
  markdown: string,
): Array<{ body: string; language: string }> {
  return [
    ...markdown.matchAll(/^```([a-z0-9+-]*)\r?\n([\s\S]*?)^```[ \t]*$/gimu),
  ].map((match) => ({
    language: match[1] ?? "",
    body: (match[2] ?? "").trim(),
  }));
}

test("JSON client examples parse and preserve the bounded stdio contract", async () => {
  const vscode = JSON.parse(await readExample("vscode-mcp.json")) as {
    servers?: Record<string, StdioConfig>;
  };
  const vscodeConfig = vscode.servers?.circuitarium;
  assert.ok(vscodeConfig);
  assert.equal(vscodeConfig.type, "stdio");
  assertNpxStdioConfig(vscodeConfig, "${workspaceFolder}");

  const lmStudio = JSON.parse(await readExample("lm-studio-mcp.json")) as {
    mcpServers?: Record<string, StdioConfig>;
  };
  const lmStudioConfig = lmStudio.mcpServers?.circuitarium;
  assert.ok(lmStudioConfig);
  assertNpxStdioConfig(lmStudioConfig, "/absolute/path/to/circuit-workspace");
});

test("Codex TOML example has one version-pinned stdio server definition", async () => {
  const toml = await readExample("codex.toml");
  assert.equal(
    (toml.match(/^\[mcp_servers\.circuitarium\]$/gmu) ?? []).length,
    1,
  );
  assert.match(toml, /^command = "npx"$/mu);
  const argsMatch = /^args = (\[[^\r\n]+\])$/mu.exec(toml);
  assert.ok(argsMatch?.[1]);
  assert.deepEqual(JSON.parse(argsMatch[1]), ["-y", PACKAGE_SPEC]);
  assert.match(
    toml,
    /^env = \{ CIRCUITARIUM_MCP_ROOT = "\/absolute\/path\/to\/circuit-workspace" \}$/mu,
  );
  assert.match(toml, /^startup_timeout_sec = 20$/mu);
  assert.match(toml, /^tool_timeout_sec = 60$/mu);
});

test("Claude Code example uses cmd /c for its native-Windows npx launcher", async () => {
  const markdown = await readExample("claude-code.md");
  const blocks = fencedBlocks(markdown);
  const bash = blocks.find((block) => block.language === "bash")?.body;
  const powershell = blocks.find(
    (block) => block.language === "powershell",
  )?.body;
  assert.ok(bash);
  assert.ok(powershell);
  assert.ok(bash.includes(`npx -y ${PACKAGE_SPEC}`));
  assert.ok(powershell.endsWith(`-- cmd /d /s /c "npx -y ${PACKAGE_SPEC}"`));
  const windowsRoot = /--env "CIRCUITARIUM_MCP_ROOT=([A-Za-z]:\\[^"]+)"/u.exec(
    powershell,
  );
  assert.ok(windowsRoot?.[1]);
  assert.doesNotMatch(windowsRoot[1], /^[A-Za-z]:\\$/u);
});

test("Jan setup table pins the package and a bounded workspace", async () => {
  const markdown = await readExample("jan.md");
  const rows = markdown.split(/\r?\n/u);
  assert.ok(rows.includes("| Transport | `STDIO` |"));
  assert.ok(rows.includes("| Command | `npx` |"));
  assert.ok(rows.includes(`| Args | \`-y\`, \`${PACKAGE_SPEC}\` |`));
  assert.ok(
    rows.includes(
      "| Env | `CIRCUITARIUM_MCP_ROOT=/absolute/path/to/circuit-workspace` |",
    ),
  );
});

test("native Windows cmd launcher preserves the public entrypoint arguments", {
  skip: process.platform !== "win32",
}, () => {
  const command =
    `""${process.execPath}" --import tsx ` +
    `"${join(process.cwd(), "src", "bin.ts")}" --version"`;
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    windowsVerbatimArguments: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `circuitarium-mcp ${SERVER_VERSION}\n`);
  assert.equal(result.stderr, "");
});
