import {
  SERVER_DISPLAY_NAME,
  SERVER_NAME,
  SERVER_VERSION,
} from "./identity.js";

const SETUP_URL =
  "https://github.com/Craftiee/circuitarium-mcp/blob/main/docs/client-setup.md";
const PANEL_DEFAULT_COLUMNS = 78;
const PANEL_BOX_MIN_COLUMNS = 48;

export type ServerCommandAction =
  | { kind: "doctor" }
  | { kind: "help" }
  | { kind: "serve" }
  | { kind: "version" }
  | { arguments: readonly string[]; kind: "invalid" };

export interface TerminalState {
  stderrIsTTY?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

export interface ServerCommandIo extends TerminalState {
  stderrColumns?: number;
  writeStderr: (text: string) => void;
  writeStdout: (text: string) => void;
}

export interface DoctorCommandResult {
  exitCode: number;
  text: string;
}

export function parseServerCommand(
  arguments_: readonly string[],
): ServerCommandAction {
  if (arguments_.length === 0) {
    return { kind: "serve" };
  }
  if (arguments_.length === 1) {
    switch (arguments_[0]) {
      case "help":
      case "-h":
      case "--help":
        return { kind: "help" };
      case "version":
      case "-v":
      case "-V":
      case "--version":
        return { kind: "version" };
      case "doctor":
      case "--doctor":
        return { kind: "doctor" };
    }
  }
  return { arguments: [...arguments_], kind: "invalid" };
}

export function shouldShowTerminalPanel(state: TerminalState): boolean {
  return (
    state.stdinIsTTY === true &&
    state.stdoutIsTTY === true &&
    state.stderrIsTTY === true
  );
}

function wrapWords(text: string, width: number): string[] {
  if (text.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/u)) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.flatMap((line) => {
    if (line.length <= width) {
      return [line];
    }
    const chunks: string[] = [];
    for (let offset = 0; offset < line.length; offset += width) {
      chunks.push(line.slice(offset, offset + width));
    }
    return chunks;
  });
}

export function renderTerminalPanel(
  toolCount: number,
  columns = PANEL_DEFAULT_COLUMNS,
): string {
  const availableColumns =
    Number.isFinite(columns) && columns >= 1
      ? Math.floor(columns)
      : PANEL_DEFAULT_COLUMNS;
  if (availableColumns < PANEL_BOX_MIN_COLUMNS) {
    const compactLines = [
      `${SERVER_DISPLAY_NAME} v${SERVER_VERSION}`,
      `${toolCount} electronics tools; CRUMBLE + Logisim; no live GUI session.`,
      "DIRECT TERMINAL RUN: no MCP host is connected.",
      "Press Ctrl+C, then configure your MCP host to launch this command.",
      `Help: ${SERVER_NAME} --help`,
    ];
    return `${compactLines
      .flatMap((line) => wrapWords(line, availableColumns))
      .join("\n")}\n`;
  }
  const boxWidth = Math.min(
    PANEL_DEFAULT_COLUMNS,
    availableColumns,
  );
  const contentWidth = boxWidth - 4;
  const border = `+${"-".repeat(boxWidth - 2)}+`;
  const row = (text: string): string =>
    `| ${text.padEnd(contentWidth, " ")} |`;
  const rows: string[] = [];
  const addWrapped = (text: string): void => {
    rows.push(...wrapWords(text, contentWidth).map(row));
  };

  rows.push(border);
  addWrapped(
    `o---[R]---|>|---o  ${SERVER_DISPLAY_NAME.toUpperCase()} v${SERVER_VERSION}`,
  );
  addWrapped(
    `${toolCount} bounded electronics tools | CRUMBLE + Logisim | no live GUI session`,
  );
  rows.push(border);
  addWrapped("DIRECT RUN  No MCP host is connected to this process.");
  rows.push(row(""));
  addWrapped("Press Ctrl+C, then configure your MCP host to launch this command.");
  rows.push(row(""));
  addWrapped(`Inspector and setup: ${SERVER_NAME} --help`);
  rows.push(border);
  return `${rows.join("\n")}\n`;
}

export function renderServerHelp(): string {
  return `${SERVER_DISPLAY_NAME} ${SERVER_VERSION}

Usage:
  ${SERVER_NAME} [options]
  npx -y ${SERVER_NAME}@${SERVER_VERSION} [options]

Starts a local stdio MCP server for MCP-capable clients. It is not an
interactive shell. Your MCP host must launch this command so it can connect
over stdin/stdout; starting it separately does not attach it to a host.
A first npx run may pause while npm downloads and extracts the package.

Options:
  -h, --help           Show this help
  -v, -V, --version    Print the installed version
  doctor, --doctor     Check package and optional Logisim runtime readiness

Environment:
  CIRCUITARIUM_MCP_ROOT
      Smallest directory containing the .cru/.circ/.vec files the server may access.
      Defaults to the current working directory.

  CIRCUITARIUM_LOGISIM_JAR
      Optional absolute path to the official Logisim-evolution 4.1.0 all-JAR.
      Enables component stats, truth tables, and test-vector execution.

  CIRCUITARIUM_JAVA
      Optional Java 21 executable. Defaults to "java".

Try it with MCP Inspector:
  npx -y @modelcontextprotocol/inspector npx -y ${SERVER_NAME}@${SERVER_VERSION}

Setup guide:
  ${SETUP_URL}

First MCP tool:
  electronics_capabilities
`;
}

function displayArgument(argument: string): string {
  const sanitized = Array.from(argument, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? "?" : character;
  }).join("");
  return JSON.stringify(sanitized);
}

export function renderInvalidArguments(
  arguments_: readonly string[],
): string {
  const rendered = arguments_.map(displayArgument).join(" ");
  return `Unsupported argument(s): ${rendered}\nRun "${SERVER_NAME} --help" for usage.\n`;
}

export async function executeServerCommand(
  arguments_: readonly string[],
  startServer: () => Promise<number>,
  io: ServerCommandIo,
  runDoctor: () => Promise<DoctorCommandResult> = async () => ({
    exitCode: 0,
    text: "Doctor checks are unavailable from this entrypoint.\n",
  }),
): Promise<number> {
  const action = parseServerCommand(arguments_);
  switch (action.kind) {
    case "help":
      io.writeStdout(renderServerHelp());
      return 0;
    case "version":
      io.writeStdout(`${SERVER_NAME} ${SERVER_VERSION}\n`);
      return 0;
    case "doctor": {
      const report = await runDoctor();
      io.writeStdout(report.text);
      return report.exitCode;
    }
    case "invalid":
      io.writeStderr(renderInvalidArguments(action.arguments));
      return 2;
    case "serve": {
      const toolCount = await startServer();
      if (shouldShowTerminalPanel(io)) {
        io.writeStderr(
          renderTerminalPanel(toolCount, io.stderrColumns ?? PANEL_DEFAULT_COLUMNS),
        );
      }
      return 0;
    }
  }
}

export function processCommandIo(): ServerCommandIo {
  return {
    stderrColumns: process.stderr.columns ?? PANEL_DEFAULT_COLUMNS,
    stderrIsTTY: process.stderr.isTTY === true,
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    writeStderr: (text) => process.stderr.write(text),
    writeStdout: (text) => process.stdout.write(text),
  };
}
