import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { SERVER_VERSION } from "../src/identity.js";
import {
  executeServerCommand,
  parseServerCommand,
  renderInvalidArguments,
  renderServerHelp,
  renderTerminalPanel,
  shouldShowTerminalPanel,
} from "../src/terminal.js";

test("server command parser accepts only the documented exact modes", () => {
  assert.deepEqual(parseServerCommand([]), { kind: "serve" });
  for (const argument of ["help", "-h", "--help"]) {
    assert.deepEqual(parseServerCommand([argument]), { kind: "help" });
  }
  for (const argument of ["version", "-v", "-V", "--version"]) {
    assert.deepEqual(parseServerCommand([argument]), { kind: "version" });
  }
  for (const argument of ["doctor", "--doctor"]) {
    assert.deepEqual(parseServerCommand([argument]), { kind: "doctor" });
  }
  assert.deepEqual(parseServerCommand(["--help", "--version"]), {
    arguments: ["--help", "--version"],
    kind: "invalid",
  });
  assert.deepEqual(parseServerCommand(["--unknown"]), {
    arguments: ["--unknown"],
    kind: "invalid",
  });
});

test("terminal panel requires stdin, stdout, and stderr to all be TTYs", () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const state = {
      stdinIsTTY: (mask & 1) !== 0,
      stdoutIsTTY: (mask & 2) !== 0,
      stderrIsTTY: (mask & 4) !== 0,
    };
    assert.equal(shouldShowTerminalPanel(state), mask === 7);
  }
  assert.equal(shouldShowTerminalPanel({}), false);
});

test("terminal panel is plain ASCII, truthful, and bounded for narrow terminals", () => {
  const panel = renderTerminalPanel(14, 60);
  assert.match(panel, /CIRCUITARIUM MCP/u);
  assert.match(panel, /14 bounded electronics tools/u);
  assert.match(panel, /No MCP host is connected/u);
  assert.match(panel, /configure your MCP host/u);
  assert.match(panel, /no\s+\|\n\|\s+live GUI session/u);
  assert.equal(panel.includes(String.fromCharCode(27)), false);
  for (const line of panel.trimEnd().split("\n")) {
    assert.ok(line.length <= 60, `panel line exceeds 60 columns: ${line}`);
    assert.match(line, /^[\x20-\x7e]+$/u);
  }
});

test("terminal panel uses an unboxed fallback within very narrow terminals", () => {
  const panel = renderTerminalPanel(14, 40);
  assert.match(panel, /DIRECT TERMINAL RUN/u);
  assert.match(panel, /no MCP host is\s+connected/u);
  assert.doesNotMatch(panel, /^\+/mu);
  for (const line of panel.trimEnd().split("\n")) {
    assert.ok(line.length <= 40, `panel line exceeds 40 columns: ${line}`);
  }
});

test("help and invalid-argument copy explain the stdio process", () => {
  const help = renderServerHelp();
  assert.match(help, new RegExp(`Circuitarium MCP ${SERVER_VERSION}`, "u"));
  assert.match(help, /starting it separately does not attach it to a host/u);
  assert.match(help, /npm downloads and extracts the package/u);
  assert.match(help, /CIRCUITARIUM_MCP_ROOT/u);
  assert.match(help, /CIRCUITARIUM_LOGISIM_JAR/u);
  assert.match(help, /doctor, --doctor/u);
  assert.match(help, /@modelcontextprotocol\/inspector/u);
  assert.match(help, /electronics_capabilities/u);

  const invalid = renderInvalidArguments(["--bad\nargument"]);
  assert.equal(
    invalid,
    'Unsupported argument(s): "--bad?argument"\nRun "circuitarium-mcp --help" for usage.\n',
  );
});

test("server command execution keeps non-TTY MCP mode silent", async () => {
  let starts = 0;
  let stdout = "";
  let stderr = "";
  const exitCode = await executeServerCommand(
    [],
    async () => {
      starts += 1;
      return 14;
    },
    {
      stderrIsTTY: false,
      stdinIsTTY: false,
      stdoutIsTTY: false,
      writeStderr: (text) => {
        stderr += text;
      },
      writeStdout: (text) => {
        stdout += text;
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(starts, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
});

test("server command execution prints the panel to stderr only for a real TTY", async () => {
  let stdout = "";
  let stderr = "";
  const exitCode = await executeServerCommand(
    [],
    async () => 14,
    {
      stderrColumns: 72,
      stderrIsTTY: true,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      writeStderr: (text) => {
        stderr += text;
      },
      writeStdout: (text) => {
        stdout += text;
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /DIRECT RUN/u);
});

test("doctor runs without starting the stdio server", async () => {
  let starts = 0;
  let stdout = "";
  const exitCode = await executeServerCommand(
    ["doctor"],
    async () => {
      starts += 1;
      return 20;
    },
    {
      writeStderr: () => {},
      writeStdout: (text) => {
        stdout += text;
      },
    },
    async () => ({
      exitCode: 0,
      text: "doctor ready\n",
    }),
  );
  assert.equal(exitCode, 0);
  assert.equal(starts, 0);
  assert.equal(stdout, "doctor ready\n");
});

function runSourceEntrypoint(arguments_: string[]) {
  const environment = { ...process.env };
  delete environment.CIRCUITARIUM_LOGISIM_JAR;
  delete environment.LOGISIM_JAR;
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin.ts", ...arguments_],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
      timeout: 10_000,
    },
  );
}

test("public launcher help exits without starting the server", () => {
  const result = runSourceEntrypoint(["--help"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Circuitarium MCP/u);
  assert.match(result.stdout, /Usage:/u);
  assert.equal(result.stderr, "");
});

test("public launcher version is one parse-friendly line", () => {
  const result = runSourceEntrypoint(["--version"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `circuitarium-mcp ${SERVER_VERSION}\n`);
  assert.equal(result.stderr, "");
});

test("public launcher doctor reports optional Logisim readiness", () => {
  const result = runSourceEntrypoint(["doctor"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^circuitarium-mcp doctor/mu);
  assert.match(result.stdout, /Registered tools: 22/u);
  assert.match(result.stdout, /Logisim static adapter: ready/u);
  assert.match(result.stdout, /optional, not configured/u);
  assert.equal(result.stderr, "");
});

test("public launcher rejects unknown arguments without starting the server", () => {
  const result = runSourceEntrypoint(["--unknown"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unsupported argument/u);
  assert.match(result.stderr, /--help/u);
});
