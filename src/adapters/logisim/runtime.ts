import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { isAbsolute, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  type LogisimStatisticsResult,
  type LogisimTestVectorResult,
  type LogisimTruthTableResult,
  LogisimOutputParseError,
  parseLogisimStatistics,
  parseLogisimTestVector,
  parseLogisimTruthTable,
} from "./output.js";

export const DEFAULT_LOGISIM_TIMEOUT_MS = 15_000;
export const DEFAULT_LOGISIM_STDOUT_LIMIT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LOGISIM_STDERR_LIMIT_BYTES = 512 * 1024;
export const SUPPORTED_LOGISIM_RUNTIME_VERSION = "4.1.0";

const MAX_LOGISIM_TIMEOUT_MS = 120_000;
const MAX_LOGISIM_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const JAVA_LOCALE_ARGUMENTS = [
  "-Duser.language=en",
  "-Duser.country=US",
  "-Dfile.encoding=UTF-8",
] as const;
const SAFE_JAVA_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "COMSPEC",
  "FONTCONFIG_PATH",
  "HOME",
  "JAVA_HOME",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "__CF_USER_TEXT_ENCODING",
]);

export type LogisimRuntimeErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "TIMEOUT"
  | "OUTPUT_LIMIT"
  | "PROJECT_INVALID"
  | "TEST_VECTOR_INVALID"
  | "EXECUTION_FAILED"
  | "OUTPUT_INVALID";

export class LogisimRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: LogisimRuntimeErrorCode,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LogisimRuntimeError";
  }
}

export class LogisimBackendUnavailableError extends LogisimRuntimeError {
  constructor(message: string) {
    super(message, "BACKEND_UNAVAILABLE", false);
    this.name = "LogisimBackendUnavailableError";
  }
}

/** The configured JAR reports a version outside the adapter pin. */
export class LogisimRuntimeVersionMismatchError extends LogisimBackendUnavailableError {
  constructor(
    readonly expectedVersion: string,
    readonly reportedVersion: string,
  ) {
    super(
      `This runtime is pinned to Logisim-evolution ${expectedVersion}; the configured JAR reports ${reportedVersion}.`,
    );
    this.name = "LogisimRuntimeVersionMismatchError";
  }
}

export class LogisimTimeoutError extends LogisimRuntimeError {
  constructor(
    message: string,
    readonly timeoutMs: number,
  ) {
    super(message, "TIMEOUT", true);
    this.name = "LogisimTimeoutError";
  }
}

export class LogisimOutputLimitError extends LogisimRuntimeError {
  constructor(
    message: string,
    readonly stream: "stdout" | "stderr",
  ) {
    super(message, "OUTPUT_LIMIT", false);
    this.name = "LogisimOutputLimitError";
  }
}

export class LogisimProjectInvalidError extends LogisimRuntimeError {
  constructor(message: string) {
    super(message, "PROJECT_INVALID", false);
    this.name = "LogisimProjectInvalidError";
  }
}

export class LogisimTestVectorInvalidError extends LogisimRuntimeError {
  constructor(message: string) {
    super(message, "TEST_VECTOR_INVALID", false);
    this.name = "LogisimTestVectorInvalidError";
  }
}

export class LogisimExecutionError extends LogisimRuntimeError {
  constructor(message: string) {
    super(message, "EXECUTION_FAILED", false);
    this.name = "LogisimExecutionError";
  }
}

export class LogisimInvalidOutputError extends LogisimRuntimeError {
  constructor(
    message: string,
    readonly cause: LogisimOutputParseError,
  ) {
    super(message, "OUTPUT_INVALID", false);
    this.name = "LogisimInvalidOutputError";
  }
}

export interface LogisimRuntimeConfig {
  javaCommand: string;
  jarPath: string;
  jarSource: "CIRCUITARIUM_LOGISIM_JAR" | "LOGISIM_JAR" | "explicit";
}

export interface LogisimProcessRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
}

export interface LogisimProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  durationMs: number;
  timedOut: boolean;
  outputLimitExceeded: "stdout" | "stderr" | null;
  spawnError?: NodeJS.ErrnoException;
}

export type LogisimProcessRunner = (
  request: LogisimProcessRequest,
) => Promise<LogisimProcessResult>;

export type LogisimPathKind = "file" | "missing" | "other";
export type LogisimPathInspector = (path: string) => Promise<LogisimPathKind>;

export interface LogisimRuntimeOptions {
  environment?: NodeJS.ProcessEnv;
  currentWorkingDirectory?: string;
  runtime?: LogisimRuntimeConfig;
  timeoutMs?: number;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  runner?: LogisimProcessRunner;
  inspectPath?: LogisimPathInspector;
}

export interface LogisimRuntimeProbe {
  available: true;
  javaCommand: string;
  jarPath: string;
  jarSource: LogisimRuntimeConfig["jarSource"];
  displayName: string;
  logisimVersion: string;
  projectUrl: string;
  buildId: string;
  buildDate: string;
  javaRuntime: string;
  javaVendor: string;
}

export interface LogisimRuntimeExecution<T> {
  runtime: LogisimRuntimeProbe;
  result: T;
}

export interface LogisimProjectRunOptions extends LogisimRuntimeOptions {
  toplevelCircuit?: string;
}

export interface LogisimStatisticsOptions extends LogisimProjectRunOptions {
  maxComponentRows?: number;
}

export interface LogisimTruthTableOptions extends LogisimProjectRunOptions {
  maxRows?: number;
  maxColumns?: number;
}

export interface LogisimTestVectorOptions extends LogisimRuntimeOptions {
  maxFailures?: number;
}

function nonEmptySetting(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function absolutePath(path: string, currentWorkingDirectory: string): string {
  if (path.includes("\0")) {
    throw new TypeError("Logisim paths must not contain NUL characters");
  }
  return isAbsolute(path) ? resolve(path) : resolve(currentWorkingDirectory, path);
}

export function resolveLogisimRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  currentWorkingDirectory = process.cwd(),
): LogisimRuntimeConfig {
  const primaryJar = nonEmptySetting(environment.CIRCUITARIUM_LOGISIM_JAR);
  const legacyJar = nonEmptySetting(environment.LOGISIM_JAR);
  const jarSetting = primaryJar ?? legacyJar;
  if (!jarSetting) {
    throw new LogisimBackendUnavailableError(
      "Logisim Evolution is not configured. Set CIRCUITARIUM_LOGISIM_JAR to the Logisim Evolution all-JAR path.",
    );
  }
  return {
    javaCommand: nonEmptySetting(environment.CIRCUITARIUM_JAVA) ?? "java",
    jarPath: absolutePath(jarSetting, currentWorkingDirectory),
    jarSource: primaryJar ? "CIRCUITARIUM_LOGISIM_JAR" : "LOGISIM_JAR",
  };
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return result;
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  observedBytes: number,
  byteLimit: number,
): void {
  const retainedBytes = Math.min(chunk.byteLength, Math.max(0, byteLimit - observedBytes));
  if (retainedBytes > 0) {
    chunks.push(chunk.subarray(0, retainedBytes));
  }
}

/**
 * Default subprocess seam. It never invokes a shell, never writes stdin, caps
 * both output streams by bytes, and force-terminates a child on timeout or cap.
 */
export const runBoundedLogisimProcess: LogisimProcessRunner = (
  request,
): Promise<LogisimProcessResult> =>
  new Promise((resolveProcess) => {
    const startedAt = performance.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitExceeded: "stdout" | "stderr" | null = null;
    let settled = false;
    let killFallback: NodeJS.Timeout | undefined;

    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      spawnError?: NodeJS.ErrnoException,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (killFallback) {
        clearTimeout(killFallback);
      }
      resolveProcess({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdoutBytes,
        stderrBytes,
        durationMs: Math.max(0, performance.now() - startedAt),
        timedOut,
        outputLimitExceeded,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    const terminate = (): void => {
      child.kill("SIGKILL");
      killFallback ??= setTimeout(() => finish(null, "SIGKILL"), 500);
      killFallback.unref();
    };

    child.stdout.on("data", (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      appendBounded(
        stdoutChunks,
        chunk,
        stdoutBytes,
        request.stdoutLimitBytes,
      );
      stdoutBytes += chunk.byteLength;
      if (
        stdoutBytes > request.stdoutLimitBytes &&
        outputLimitExceeded === null
      ) {
        outputLimitExceeded = "stdout";
        terminate();
      }
    });
    child.stderr.on("data", (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      appendBounded(
        stderrChunks,
        chunk,
        stderrBytes,
        request.stderrLimitBytes,
      );
      stderrBytes += chunk.byteLength;
      if (
        stderrBytes > request.stderrLimitBytes &&
        outputLimitExceeded === null
      ) {
        outputLimitExceeded = "stderr";
        terminate();
      }
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(null, null, error);
    });
    child.once("close", (exitCode, signal) => {
      finish(exitCode, signal);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);
    timeout.unref();
  });

async function inspectRegularFile(path: string): Promise<LogisimPathKind> {
  try {
    return (await stat(path)).isFile() ? "file" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function resolvedRuntime(
  options: LogisimRuntimeOptions,
  currentWorkingDirectory: string,
  environment: NodeJS.ProcessEnv,
): LogisimRuntimeConfig {
  if (!options.runtime) {
    return resolveLogisimRuntimeConfig(environment, currentWorkingDirectory);
  }
  const javaCommand = nonEmptySetting(options.runtime.javaCommand);
  if (!javaCommand) {
    throw new LogisimBackendUnavailableError("The configured Java command is empty.");
  }
  return {
    javaCommand,
    jarPath: absolutePath(options.runtime.jarPath, currentWorkingDirectory),
    jarSource: options.runtime.jarSource,
  };
}

interface PreparedRuntime {
  runtime: LogisimRuntimeConfig;
  currentWorkingDirectory: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  runner: LogisimProcessRunner;
  inspectPath: LogisimPathInspector;
}

function prepareRuntime(options: LogisimRuntimeOptions): PreparedRuntime {
  const currentWorkingDirectory = resolve(
    options.currentWorkingDirectory ?? process.cwd(),
  );
  const environment = options.environment ?? process.env;
  const stableEnvironment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) {
    if (SAFE_JAVA_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      stableEnvironment[key] = value;
    }
  }
  stableEnvironment.LANG = "en_US.UTF-8";
  stableEnvironment.LANGUAGE = "en_US:en";
  stableEnvironment.LC_ALL = "en_US.UTF-8";
  return {
    runtime: resolvedRuntime(options, currentWorkingDirectory, environment),
    currentWorkingDirectory,
    environment: stableEnvironment,
    timeoutMs: boundedPositiveInteger(
      options.timeoutMs,
      DEFAULT_LOGISIM_TIMEOUT_MS,
      MAX_LOGISIM_TIMEOUT_MS,
      "timeoutMs",
    ),
    stdoutLimitBytes: boundedPositiveInteger(
      options.stdoutLimitBytes,
      DEFAULT_LOGISIM_STDOUT_LIMIT_BYTES,
      MAX_LOGISIM_OUTPUT_LIMIT_BYTES,
      "stdoutLimitBytes",
    ),
    stderrLimitBytes: boundedPositiveInteger(
      options.stderrLimitBytes,
      DEFAULT_LOGISIM_STDERR_LIMIT_BYTES,
      MAX_LOGISIM_OUTPUT_LIMIT_BYTES,
      "stderrLimitBytes",
    ),
    runner: options.runner ?? runBoundedLogisimProcess,
    inspectPath: options.inspectPath ?? inspectRegularFile,
  };
}

async function requireRuntimeJar(prepared: PreparedRuntime): Promise<void> {
  let pathKind: LogisimPathKind;
  try {
    pathKind = await prepared.inspectPath(prepared.runtime.jarPath);
  } catch (error) {
    throw new LogisimBackendUnavailableError(
      `The configured Logisim Evolution JAR could not be inspected (${nodeErrorCode(error)}).`,
    );
  }
  if (pathKind !== "file") {
    throw new LogisimBackendUnavailableError(
      `The configured Logisim Evolution JAR is ${pathKind === "missing" ? "missing" : "not a regular file"}.`,
    );
  }
}

async function requireProject(
  path: string,
  prepared: PreparedRuntime,
): Promise<string> {
  const projectPath = absolutePath(path, prepared.currentWorkingDirectory);
  let pathKind: LogisimPathKind;
  try {
    pathKind = await prepared.inspectPath(projectPath);
  } catch (error) {
    throw new LogisimProjectInvalidError(
      `The Logisim project could not be inspected (${nodeErrorCode(error)}).`,
    );
  }
  if (pathKind !== "file") {
    throw new LogisimProjectInvalidError(
      `The Logisim project is ${pathKind === "missing" ? "missing" : "not a regular file"}.`,
    );
  }
  return projectPath;
}

async function requireTestVector(
  path: string,
  prepared: PreparedRuntime,
): Promise<string> {
  const vectorPath = absolutePath(path, prepared.currentWorkingDirectory);
  let pathKind: LogisimPathKind;
  try {
    pathKind = await prepared.inspectPath(vectorPath);
  } catch (error) {
    throw new LogisimTestVectorInvalidError(
      `The Logisim test vector could not be inspected (${nodeErrorCode(error)}).`,
    );
  }
  if (pathKind !== "file") {
    throw new LogisimTestVectorInvalidError(
      `The Logisim test vector is ${pathKind === "missing" ? "missing" : "not a regular file"}.`,
    );
  }
  return vectorPath;
}

function boundedIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.includes("\0")) {
    throw new TypeError(`${label} must contain 1 to 256 non-NUL characters`);
  }
  return trimmed;
}

function nodeErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
  ) {
    return (error as NodeJS.ErrnoException).code ?? "unknown error";
  }
  return "unknown error";
}

function diagnosticSnippet(
  result: LogisimProcessResult,
  sensitivePaths: readonly string[] = [],
): string {
  let rawOutput = `${result.stderr}\n${result.stdout}`;
  const pathVariants = new Set<string>();
  for (const path of sensitivePaths) {
    if (path.length < 3) {
      continue;
    }
    pathVariants.add(path);
    pathVariants.add(path.replaceAll("\\", "/"));
  }
  for (const path of [...pathVariants].sort(
    (left, right) => right.length - left.length,
  )) {
    rawOutput = rawOutput.replaceAll(path, "<local-path>");
  }
  const withoutControls = [...rawOutput]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("");
  const combined = withoutControls
    .replaceAll(/\s+/g, " ")
    .trim();
  if (combined.length === 0) {
    return "No diagnostic output was produced.";
  }
  return combined.length <= 1_000 ? combined : `${combined.slice(0, 1_000)}…`;
}

async function executeLogisim(
  prepared: PreparedRuntime,
  cliArguments: readonly string[],
  policy: {
    headless: boolean;
    forceEnglishPreference: boolean;
  },
): Promise<LogisimProcessResult> {
  const result = await prepared.runner({
    command: prepared.runtime.javaCommand,
    args: [
      ...JAVA_LOCALE_ARGUMENTS,
      ...(policy.headless ? ["-Djava.awt.headless=true"] : []),
      "-jar",
      prepared.runtime.jarPath,
      ...(policy.forceEnglishPreference ? ["--locale", "en"] : []),
      ...cliArguments,
    ],
    cwd: prepared.currentWorkingDirectory,
    env: prepared.environment,
    timeoutMs: prepared.timeoutMs,
    stdoutLimitBytes: prepared.stdoutLimitBytes,
    stderrLimitBytes: prepared.stderrLimitBytes,
  });
  if (result.spawnError) {
    throw new LogisimBackendUnavailableError(
      `Java could not be started (${result.spawnError.code ?? "unknown error"}).`,
    );
  }
  if (result.timedOut) {
    throw new LogisimTimeoutError(
      `Logisim Evolution exceeded the ${prepared.timeoutMs} ms process timeout.`,
      prepared.timeoutMs,
    );
  }
  if (result.outputLimitExceeded) {
    const limit =
      result.outputLimitExceeded === "stdout"
        ? prepared.stdoutLimitBytes
        : prepared.stderrLimitBytes;
    throw new LogisimOutputLimitError(
      `Logisim Evolution exceeded the ${limit}-byte ${result.outputLimitExceeded} limit.`,
      result.outputLimitExceeded,
    );
  }
  return result;
}

function requireSuccessfulProjectRun(
  result: LogisimProcessResult,
  sensitivePaths: readonly string[],
): void {
  if (result.exitCode === 0) {
    return;
  }
  const diagnostic = diagnosticSnippet(result, sensitivePaths);
  if (
    /error loading circuit file|failed to load|could not (?:open|load)|invalid.*(?:xml|circuit)|circuit .*not found/i.test(
      diagnostic,
    )
  ) {
    throw new LogisimProjectInvalidError(
      `Logisim Evolution rejected the project: ${diagnostic}`,
    );
  }
  throw new LogisimExecutionError(
    `Logisim Evolution exited with code ${result.exitCode ?? "none"}: ${diagnostic}`,
  );
}

function parseOutput<T>(operation: string, parser: () => T): T {
  try {
    return parser();
  } catch (error) {
    if (!(error instanceof LogisimOutputParseError)) {
      throw error;
    }
    throw new LogisimInvalidOutputError(
      `Logisim Evolution returned invalid ${operation} output: ${error.message}`,
      error,
    );
  }
}

async function probePreparedRuntime(
  prepared: PreparedRuntime,
): Promise<LogisimRuntimeProbe> {
  const result = await executeLogisim(
    prepared,
    ["--version", "--tty", "stats"],
    {
      headless: true,
      forceEnglishPreference: false,
    },
  );
  if (result.exitCode !== 0) {
    throw new LogisimBackendUnavailableError(
      `The configured JAR did not pass the Logisim Evolution version probe: ${diagnosticSnippet(
        result,
        [
          prepared.currentWorkingDirectory,
          ...(isAbsolute(prepared.runtime.javaCommand)
            ? [prepared.runtime.javaCommand]
            : []),
          prepared.runtime.jarPath,
        ],
      )}`,
    );
  }

  const lines = result.stdout
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 4) {
    throw new LogisimBackendUnavailableError(
      "The configured JAR did not return Logisim Evolution's four-line version response.",
    );
  }
  const displayMatch = lines[0]?.match(
    /^(Logisim-evolution)\s+v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/,
  );
  const buildMatch = lines[2]?.match(/^(.+?)\s+\(([^()]+)\)$/);
  const javaMatch = lines[3]?.match(/^(.+?)\s+\(([^()]+)\)$/);
  if (
    !displayMatch ||
    lines[1] !== "https://github.com/logisim-evolution/" ||
    !buildMatch ||
    !javaMatch
  ) {
    throw new LogisimBackendUnavailableError(
      "The configured JAR's version response does not match the expected Logisim Evolution identity format.",
    );
  }
  const logisimVersion = displayMatch[2] ?? "";
  if (logisimVersion !== SUPPORTED_LOGISIM_RUNTIME_VERSION) {
    throw new LogisimRuntimeVersionMismatchError(
      SUPPORTED_LOGISIM_RUNTIME_VERSION,
      logisimVersion,
    );
  }

  return {
    available: true,
    javaCommand: prepared.runtime.javaCommand,
    jarPath: prepared.runtime.jarPath,
    jarSource: prepared.runtime.jarSource,
    displayName: `${displayMatch[1]} v${displayMatch[2]}`,
    logisimVersion,
    projectUrl: lines[1],
    buildId: buildMatch[1] ?? "",
    buildDate: buildMatch[2] ?? "",
    javaRuntime: javaMatch[1] ?? "",
    javaVendor: javaMatch[2] ?? "",
  };
}

/**
 * Executes the exact Logisim `--version` probe, validates all four lines, and
 * enforces the adapter's 4.1.0 runtime pin.
 */
export async function probeLogisimRuntime(
  options: LogisimRuntimeOptions = {},
): Promise<LogisimRuntimeProbe> {
  const prepared = prepareRuntime(options);
  await requireRuntimeJar(prepared);
  return probePreparedRuntime(prepared);
}

function projectCliArguments(
  projectPath: string,
  ttyFormat: "stats" | "table,csv,binary",
  toplevelCircuit?: string,
): string[] {
  const arguments_: string[] = [projectPath];
  if (toplevelCircuit !== undefined) {
    arguments_.push(
      "--toplevel-circuit",
      boundedIdentifier(toplevelCircuit, "toplevelCircuit"),
    );
  }
  arguments_.push("--tty", ttyFormat);
  return arguments_;
}

/**
 * Runs Logisim's component-statistics mode and returns the exact probe that
 * immediately preceded the operation.
 */
export async function runLogisimStatisticsWithRuntime(
  project: string,
  options: LogisimStatisticsOptions = {},
): Promise<LogisimRuntimeExecution<LogisimStatisticsResult>> {
  const prepared = prepareRuntime(options);
  await requireRuntimeJar(prepared);
  const projectPath = await requireProject(project, prepared);
  const runtime = await probePreparedRuntime(prepared);
  const result = await executeLogisim(
    prepared,
    projectCliArguments(projectPath, "stats", options.toplevelCircuit),
    {
      headless: false,
      forceEnglishPreference: true,
    },
  );
  requireSuccessfulProjectRun(result, [
    prepared.currentWorkingDirectory,
    ...(isAbsolute(prepared.runtime.javaCommand)
      ? [prepared.runtime.javaCommand]
      : []),
    prepared.runtime.jarPath,
    projectPath,
  ]);
  return {
    runtime,
    result: parseOutput("statistics", () =>
      parseLogisimStatistics(result.stdout, {
        ...(options.maxComponentRows === undefined
          ? {}
          : { maxComponentRows: options.maxComponentRows }),
      }),
    ),
  };
}

/** Runs Logisim's component-statistics mode without opening its GUI. */
export async function runLogisimStatistics(
  project: string,
  options: LogisimStatisticsOptions = {},
): Promise<LogisimStatisticsResult> {
  return (await runLogisimStatisticsWithRuntime(project, options)).result;
}

/**
 * Runs the deterministic combinational table mode. CSV and binary flags are
 * always included so parsing never depends on terminal alignment or bus width.
 */
export async function runLogisimTruthTableWithRuntime(
  project: string,
  options: LogisimTruthTableOptions = {},
): Promise<LogisimRuntimeExecution<LogisimTruthTableResult>> {
  const prepared = prepareRuntime(options);
  await requireRuntimeJar(prepared);
  const projectPath = await requireProject(project, prepared);
  const runtime = await probePreparedRuntime(prepared);
  const result = await executeLogisim(
    prepared,
    projectCliArguments(
      projectPath,
      "table,csv,binary",
      options.toplevelCircuit,
    ),
    {
      headless: false,
      forceEnglishPreference: true,
    },
  );
  requireSuccessfulProjectRun(result, [
    prepared.currentWorkingDirectory,
    ...(isAbsolute(prepared.runtime.javaCommand)
      ? [prepared.runtime.javaCommand]
      : []),
    prepared.runtime.jarPath,
    projectPath,
  ]);
  return {
    runtime,
    result: parseOutput("truth-table", () =>
      parseLogisimTruthTable(result.stdout, {
        ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
        ...(options.maxColumns === undefined
          ? {}
          : { maxColumns: options.maxColumns }),
      }),
    ),
  };
}

export async function runLogisimTruthTable(
  project: string,
  options: LogisimTruthTableOptions = {},
): Promise<LogisimTruthTableResult> {
  return (await runLogisimTruthTableWithRuntime(project, options)).result;
}

/**
 * Runs a Logisim text vector through the configured JAR. A circuit mismatch is a successful,
 * structured observation (`passed: false`), distinct from an invalid vector or
 * project execution failure.
 */
export async function runLogisimTestVectorWithRuntime(
  project: string,
  circuitName: string,
  vector: string,
  options: LogisimTestVectorOptions = {},
): Promise<LogisimRuntimeExecution<LogisimTestVectorResult>> {
  const prepared = prepareRuntime(options);
  await requireRuntimeJar(prepared);
  const projectPath = await requireProject(project, prepared);
  const vectorPath = await requireTestVector(vector, prepared);
  const circuit = boundedIdentifier(circuitName, "circuitName");
  const runtime = await probePreparedRuntime(prepared);
  const result = await executeLogisim(
    prepared,
    ["--test-vector", circuit, vectorPath, projectPath],
    {
      headless: false,
      forceEnglishPreference: true,
    },
  );

  const diagnostic = diagnosticSnippet(result, [
    prepared.currentWorkingDirectory,
    ...(isAbsolute(prepared.runtime.javaCommand)
      ? [prepared.runtime.javaCommand]
      : []),
    prepared.runtime.jarPath,
    projectPath,
    vectorPath,
  ]);
  if (
    /error loading circuit file|failed to load.*(?:project|circuit)|invalid.*(?:xml|circuit)/i.test(
      diagnostic,
    )
  ) {
    throw new LogisimProjectInvalidError(
      `Logisim Evolution rejected the project: ${diagnostic}`,
    );
  }
  if (
    /error loading test vector|error preparing test vector|circuit .*not found/i.test(
      diagnostic,
    )
  ) {
    throw new LogisimTestVectorInvalidError(
      `Logisim Evolution rejected the test request: ${diagnostic}`,
    );
  }

  const parsed = parseOutput("test-vector", () =>
    parseLogisimTestVector(result.stdout, result.stderr, {
      ...(options.maxFailures === undefined
        ? {}
        : { maxFailures: options.maxFailures }),
    }),
  );
  if (result.exitCode !== 0 && parsed.failedVectors === 0) {
    throw new LogisimExecutionError(
      `Logisim Evolution exited with code ${result.exitCode ?? "none"}: ${diagnostic}`,
    );
  }
  return { runtime, result: parsed };
}

export async function runLogisimTestVector(
  project: string,
  circuitName: string,
  vector: string,
  options: LogisimTestVectorOptions = {},
): Promise<LogisimTestVectorResult> {
  return (
    await runLogisimTestVectorWithRuntime(
      project,
      circuitName,
      vector,
      options,
    )
  ).result;
}
