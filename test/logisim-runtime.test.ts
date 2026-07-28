import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  LogisimBackendUnavailableError,
  LogisimExecutionError,
  LogisimInvalidOutputError,
  LogisimOutputLimitError,
  LogisimProjectInvalidError,
  LogisimRuntimeVersionMismatchError,
  LogisimTestVectorInvalidError,
  LogisimTimeoutError,
  type LogisimProcessRequest,
  type LogisimProcessResult,
  type LogisimProcessRunner,
  probeLogisimRuntime,
  resolveLogisimRuntimeConfig,
  runBoundedLogisimProcess,
  runLogisimStatistics,
  runLogisimStatisticsWithRuntime,
  runLogisimTestVector,
  runLogisimTestVectorWithRuntime,
  runLogisimTruthTable,
  runLogisimTruthTableWithRuntime,
} from "../src/adapters/logisim/runtime.js";
import {
  LogisimOutputParseError,
  parseLogisimStatistics,
  parseLogisimTestVector,
  parseLogisimTruthTable,
} from "../src/adapters/logisim/output.js";

function completedProcess(
  overrides: Partial<LogisimProcessResult> = {},
): LogisimProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    durationMs: 1,
    timedOut: false,
    outputLimitExceeded: null,
    ...overrides,
  };
}

const fakeRuntime = {
  javaCommand: "C:\\Program Files\\Java\\bin\\java.exe",
  jarPath: "vendor/logisim-evolution-4.1.0-all.jar",
  jarSource: "explicit" as const,
};

const everyPathIsAFile = async () => "file" as const;
const officialVersionStdout = [
  "Logisim-evolution v4.1.0",
  "https://github.com/logisim-evolution/",
  "632d66d (2026-02-15T09:36:00Z)",
  "OpenJDK 64-Bit Server VM v21.0.8 (Eclipse Adoptium)",
  "",
].join("\n");

function officialVersionProcess(): LogisimProcessResult {
  return completedProcess({
    stdout: officialVersionStdout,
    stdoutBytes: Buffer.byteLength(officialVersionStdout),
  });
}

function afterPinnedVersion(
  operation: (request: LogisimProcessRequest) => LogisimProcessResult,
): LogisimProcessRunner {
  return async (request) =>
    request.args.includes("--version")
      ? officialVersionProcess()
      : operation(request);
}

test("runtime configuration honors the primary JAR and Java variables", () => {
  const cwd = resolve("workspace");
  const config = resolveLogisimRuntimeConfig(
    {
      CIRCUITARIUM_LOGISIM_JAR: "primary.jar",
      LOGISIM_JAR: "legacy.jar",
      CIRCUITARIUM_JAVA: '"C:\\Program Files\\Java\\bin\\java.exe"',
    },
    cwd,
  );

  assert.equal(config.jarPath, resolve(cwd, "primary.jar"));
  assert.equal(config.jarSource, "CIRCUITARIUM_LOGISIM_JAR");
  assert.equal(config.javaCommand, "C:\\Program Files\\Java\\bin\\java.exe");
});

test("LOGISIM_JAR remains a fallback and missing configuration is explicit", () => {
  const fallback = resolveLogisimRuntimeConfig(
    {
      CIRCUITARIUM_LOGISIM_JAR: " ",
      LOGISIM_JAR: "legacy.jar",
    },
    process.cwd(),
  );
  assert.equal(fallback.jarSource, "LOGISIM_JAR");
  assert.throws(
    () => resolveLogisimRuntimeConfig({}, process.cwd()),
    LogisimBackendUnavailableError,
  );
});

test("the exact version probe validates Logisim and captures its Java runtime", async () => {
  let request: LogisimProcessRequest | undefined;
  const runner: LogisimProcessRunner = async (received) => {
    request = received;
    return officialVersionProcess();
  };

  const probe = await probeLogisimRuntime({
    runtime: fakeRuntime,
    runner,
    inspectPath: everyPathIsAFile,
    currentWorkingDirectory: "C:\\workspace",
    environment: {
      DISPLAY: ":99",
      JAVA_TOOL_OPTIONS: "-Duser.language=fr",
      _JAVA_OPTIONS: "-Duser.country=FR",
      JDK_JAVA_OPTIONS: "-Dfile.encoding=ISO-8859-1",
      NPM_TOKEN: "must-not-reach-the-child",
      XAUTHORITY: "/tmp/circuitarium-xauthority",
    },
  });

  assert.equal(probe.logisimVersion, "4.1.0");
  assert.equal(probe.buildId, "632d66d");
  assert.equal(probe.javaVendor, "Eclipse Adoptium");
  assert.ok(request);
  assert.equal(request.command, fakeRuntime.javaCommand);
  assert.deepEqual(request.args.slice(0, 6), [
    "-Duser.language=en",
    "-Duser.country=US",
    "-Dfile.encoding=UTF-8",
    "-Djava.awt.headless=true",
    "-jar",
    resolve("C:\\workspace", fakeRuntime.jarPath),
  ]);
  assert.deepEqual(request.args.slice(-3), ["--version", "--tty", "stats"]);
  assert.equal(request.args.includes("--locale"), false);
  assert.equal(request.env.LC_ALL, "en_US.UTF-8");
  assert.equal(request.env.DISPLAY, ":99");
  assert.equal(request.env.XAUTHORITY, "/tmp/circuitarium-xauthority");
  assert.equal(request.env.JAVA_TOOL_OPTIONS, undefined);
  assert.equal(request.env._JAVA_OPTIONS, undefined);
  assert.equal(request.env.JDK_JAVA_OPTIONS, undefined);
  assert.equal(request.env.NPM_TOKEN, undefined);
});

test("the version probe rejects an arbitrary Java JAR", async () => {
  await assert.rejects(
    probeLogisimRuntime({
      runtime: fakeRuntime,
      inspectPath: everyPathIsAFile,
      runner: async () =>
        completedProcess({
          stdout: "Different simulator 4.1.0\n",
          stdoutBytes: 26,
        }),
    }),
    LogisimBackendUnavailableError,
  );
});

test("the version probe rejects official Logisim builds outside the 4.1.0 pin", async () => {
  const stdout = officialVersionStdout.replace(
    "Logisim-evolution v4.1.0",
    "Logisim-evolution v4.2.0",
  );
  await assert.rejects(
    probeLogisimRuntime({
      runtime: fakeRuntime,
      inspectPath: everyPathIsAFile,
      runner: async () =>
        completedProcess({
          stdout,
          stdoutBytes: Buffer.byteLength(stdout),
        }),
    }),
    (error: unknown) =>
      error instanceof LogisimRuntimeVersionMismatchError &&
      error.expectedVersion === "4.1.0" &&
      error.reportedVersion === "4.2.0",
  );
});

test("statistics output is structured and component rows are bounded", () => {
  const parsed = parseLogisimStatistics(
    [
      "1\t2\tAND Gate\tGates",
      "3\t4\tPin\tWiring",
      "4\t6\tTOTAL (without project’s sub circuits)",
      "5\t8\tTOTAL (with sub circuits)",
      "",
    ].join("\n"),
    { maxComponentRows: 1 },
  );

  assert.deepEqual(parsed.components, [
    {
      uniqueCount: 1,
      recursiveCount: 2,
      component: "AND Gate",
      library: "Gates",
    },
  ]);
  assert.equal(parsed.componentRowsObserved, 2);
  assert.equal(parsed.componentsTruncated, true);
  assert.deepEqual(parsed.totalWithSubcircuits, {
    uniqueCount: 5,
    recursiveCount: 8,
  });
});

test("statistics runtime uses the documented --tty stats argument array", async () => {
  let request: LogisimProcessRequest | undefined;
  const requests: LogisimProcessRequest[] = [];
  const delegate = afterPinnedVersion((received) => {
    request = received;
    const stdout = [
      "1\t1\tAND Gate\tGates",
      "1\t1\tTOTAL (without project’s sub circuits)",
      "1\t1\tTOTAL (with sub circuits)",
      "",
    ].join("\n");
    return completedProcess({
      stdout,
      stdoutBytes: Buffer.byteLength(stdout),
    });
  });
  const execution = await runLogisimStatisticsWithRuntime("demo.circ", {
    runtime: fakeRuntime,
    runner: async (received) => {
      requests.push(received);
      return delegate(received);
    },
    inspectPath: everyPathIsAFile,
    currentWorkingDirectory: "C:\\workspace",
    toplevelCircuit: "main",
  });
  const result = execution.result;

  assert.equal(execution.runtime.logisimVersion, "4.1.0");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.args.includes("--version"), true);
  assert.equal(result.components[0]?.component, "AND Gate");
  assert.ok(request);
  assert.equal(request.args.includes("--locale"), true);
  assert.deepEqual(request.args.slice(-5), [
    resolve("C:\\workspace", "demo.circ"),
    "--toplevel-circuit",
    "main",
    "--tty",
    "stats",
  ]);
});

test("truth tables parse strict CSV/binary output and truncate returned rows", () => {
  const result = parseLogisimTruthTable(
    ["A,B,Sum", "0,0,0", "0,1,1", "1,0,1", ""].join("\n"),
    { maxRows: 2 },
  );

  assert.deepEqual(result.columns, ["A", "B", "Sum"]);
  assert.deepEqual(result.rows, [
    { values: ["0", "0", "0"] },
    { values: ["0", "1", "1"] },
  ]);
  assert.equal(result.rowCount, 3);
  assert.equal(result.rowsTruncated, true);
  assert.throws(
    () => parseLogisimTruthTable("A,B\n0\n"),
    LogisimOutputParseError,
  );

  const constant = parseLogisimTruthTable("Y\n1\n");
  assert.deepEqual(constant.columns, ["Y"]);
  assert.deepEqual(constant.rows, [{ values: ["1"] }]);
  assert.equal(constant.rowCount, 1);
  assert.equal(constant.rowsTruncated, false);
});

test("truth-table runtime always requests table,csv,binary", async () => {
  let request: LogisimProcessRequest | undefined;
  const requests: LogisimProcessRequest[] = [];
  const delegate = afterPinnedVersion((received) => {
    request = received;
    const stdout = "A,B,Y\n0,0,0\n0,1,0\n1,0,0\n1,1,1\n";
    return completedProcess({
      stdout,
      stdoutBytes: Buffer.byteLength(stdout),
    });
  });
  const execution = await runLogisimTruthTableWithRuntime("and gate.circ", {
    runtime: fakeRuntime,
    runner: async (received) => {
      requests.push(received);
      return delegate(received);
    },
    inspectPath: everyPathIsAFile,
    currentWorkingDirectory: "C:\\workspace",
  });
  const result = execution.result;

  assert.equal(execution.runtime.logisimVersion, "4.1.0");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.args.includes("--version"), true);
  assert.equal(result.rowCount, 4);
  assert.ok(request);
  assert.deepEqual(request.args.slice(-3), [
    resolve("C:\\workspace", "and gate.circ"),
    "--tty",
    "table,csv,binary",
  ]);
});

test("test-vector failures are valid structured evidence despite exit code zero", async () => {
  let request: LogisimProcessRequest | undefined;
  const requests: LogisimProcessRequest[] = [];
  const stdout = [
    "Loading test vector �vectors.txt�…",
    "Running 4 vectors…",
    "1 \r2 \r3 \r",
    "  sum = 0 (expected 1)",
    "4 \r",
    "  carry = 1 (expected 0) oscillating",
    "",
    "Passed: 2, Failed: 2",
    "",
  ].join("\n");
  const stderr = "Error on test vector 3:\nError on test vector 4:\n";
  const delegate = afterPinnedVersion((received) => {
    request = received;
    return completedProcess({
      stdout,
      stderr,
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: Buffer.byteLength(stderr),
    });
  });

  const execution = await runLogisimTestVectorWithRuntime(
    "full-adder.circ",
    "Full Adder",
    "vectors.txt",
    {
      runtime: fakeRuntime,
      runner: async (received) => {
        requests.push(received);
        return delegate(received);
      },
      inspectPath: everyPathIsAFile,
      currentWorkingDirectory: "C:\\workspace",
      environment: {
        DISPLAY: ":99",
        NPM_TOKEN: "must-not-reach-the-child",
        XAUTHORITY: "/tmp/circuitarium-xauthority",
      },
      platform: "linux",
    },
  );
  const result = execution.result;

  assert.equal(execution.runtime.logisimVersion, "4.1.0");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.args.includes("--version"), true);
  assert.equal(result.passed, false);
  assert.equal(result.passedVectors, 2);
  assert.equal(result.failedVectors, 2);
  assert.deepEqual(
    result.failures.map((failure) => failure.vectorIndex),
    [3, 4],
  );
  assert.deepEqual(result.failures[0]?.mismatches[0], {
    vectorIndex: 3,
    signal: "sum",
    observed: "0",
    expected: "1",
    oscillating: false,
  });
  assert.equal(result.failures[1]?.mismatches[0]?.oscillating, true);
  assert.ok(request);
  assert.deepEqual(request.args.slice(-4), [
    "--test-vector",
    "Full Adder",
    resolve("C:\\workspace", "vectors.txt"),
    resolve("C:\\workspace", "full-adder.circ"),
  ]);
  assert.equal(request.env.DISPLAY, ":99");
  assert.equal(request.env.XAUTHORITY, "/tmp/circuitarium-xauthority");
  assert.equal(request.env.NPM_TOKEN, undefined);
});

test("Linux test-vector execution requires an inherited X11 display", async () => {
  let runnerCalls = 0;
  await assert.rejects(
    runLogisimTestVector("full-adder.circ", "Main", "vectors.vec", {
      environment: {},
      inspectPath: everyPathIsAFile,
      platform: "linux",
      runner: async () => {
        runnerCalls += 1;
        return officialVersionProcess();
      },
      runtime: fakeRuntime,
    }),
    (error: unknown) =>
      error instanceof LogisimBackendUnavailableError &&
      error.message.includes("requires an X11 display") &&
      error.message.includes("xvfb-run -a"),
  );
  assert.equal(runnerCalls, 0);
});

test("test-vector process and parser failures include bounded redacted diagnostics", async () => {
  const workspace = "C:\\private\\circuitarium-vector-workspace";
  const absoluteProject = resolve(workspace, "full-adder.circ");
  const absoluteVector = resolve(workspace, "vectors.vec");
  const commonOptions = {
    currentWorkingDirectory: workspace,
    environment: { DISPLAY: ":99" },
    inspectPath: everyPathIsAFile,
    platform: "linux" as const,
    runtime: fakeRuntime,
  };

  await assert.rejects(
    runLogisimTestVector(
      "full-adder.circ",
      "Main",
      "vectors.vec",
      {
        ...commonOptions,
        runner: afterPinnedVersion(() =>
          completedProcess({
            exitCode: 1,
            stderr:
              `java.awt.AWTError: cannot open ${absoluteProject} ` +
              `${absoluteVector}`,
            stderrBytes: 256,
          }),
        ),
      },
    ),
    (error: unknown) =>
      error instanceof LogisimExecutionError &&
      error.message.includes("java.awt.AWTError") &&
      error.message.includes("<local-path>") &&
      !error.message.includes(workspace),
  );

  await assert.rejects(
    runLogisimTestVector(
      "full-adder.circ",
      "Main",
      "vectors.vec",
      {
        ...commonOptions,
        runner: afterPinnedVersion(() =>
          completedProcess({
            stdout: `Loading ${absoluteVector} without a final summary`,
            stdoutBytes: 128,
          }),
        ),
      },
    ),
    (error: unknown) =>
      error instanceof LogisimInvalidOutputError &&
      error.message.includes("did not include a Passed/Failed summary") &&
      error.message.includes("Diagnostic:") &&
      error.message.includes("<local-path>") &&
      !error.message.includes(workspace),
  );
});

test("test-vector summary consistency is validated", () => {
  assert.throws(
    () =>
      parseLogisimTestVector(
        "Running 3 vectors…\n1 \r2 \r\nPassed: 2, Failed: 0\n",
        "",
      ),
    LogisimOutputParseError,
  );
});

test("test-vector failure and mismatch collections remain bounded", () => {
  const mismatchLines = Array.from(
    { length: 513 },
    (_, index) => `  signal${index} = 0 (expected 1)`,
  );
  const parsed = parseLogisimTestVector(
    [
      "Running 2 vectors…",
      "1 \r",
      ...mismatchLines,
      "2 \r",
      "Passed: 0, Failed: 2",
      "",
    ].join("\n"),
    "Error on test vector 1:\nError on test vector 2:\n",
    { maxFailures: 1 },
  );

  assert.equal(parsed.failures.length, 1);
  assert.equal(parsed.failureRowsObserved, 2);
  assert.equal(parsed.failuresTruncated, true);
  assert.equal(parsed.failures[0]?.mismatches.length, 512);
  assert.equal(parsed.failures[0]?.mismatchRowsObserved, 513);
  assert.equal(parsed.failures[0]?.mismatchesTruncated, true);
});

test("missing projects and invalid vectors have distinct errors", async () => {
  let runnerCalls = 0;
  const runner: LogisimProcessRunner = async (request) => {
    runnerCalls += 1;
    if (request.args.includes("--version")) {
      return officialVersionProcess();
    }
    return completedProcess({
      exitCode: 255,
      stderr: "Error loading test vector: invalid header",
      stderrBytes: 41,
    });
  };
  await assert.rejects(
    runLogisimTruthTable("missing.circ", {
      runtime: fakeRuntime,
      runner,
      inspectPath: async (path) =>
        path.endsWith("missing.circ") ? "missing" : "file",
    }),
    LogisimProjectInvalidError,
  );
  assert.equal(runnerCalls, 0);

  await assert.rejects(
    runLogisimTestVector("valid.circ", "main", "bad.txt", {
      environment: { DISPLAY: ":99" },
      runtime: fakeRuntime,
      runner,
      inspectPath: everyPathIsAFile,
    }),
    LogisimTestVectorInvalidError,
  );
  assert.equal(runnerCalls, 2);
});

test("timeout, output-cap, and spawn errors remain distinguishable", async () => {
  await assert.rejects(
    runLogisimStatistics("demo.circ", {
      runtime: fakeRuntime,
      inspectPath: everyPathIsAFile,
      timeoutMs: 25,
      runner: async () =>
        completedProcess({
          exitCode: null,
          signal: "SIGKILL",
          timedOut: true,
        }),
    }),
    (error: unknown) =>
      error instanceof LogisimTimeoutError && error.timeoutMs === 25,
  );
  await assert.rejects(
    runLogisimStatistics("demo.circ", {
      runtime: fakeRuntime,
      inspectPath: everyPathIsAFile,
      stdoutLimitBytes: 100,
      runner: async () =>
        completedProcess({
          exitCode: null,
          signal: "SIGKILL",
          stdout: "x".repeat(100),
          stdoutBytes: 101,
          outputLimitExceeded: "stdout",
        }),
    }),
    (error: unknown) =>
      error instanceof LogisimOutputLimitError && error.stream === "stdout",
  );
  await assert.rejects(
    probeLogisimRuntime({
      runtime: fakeRuntime,
      inspectPath: everyPathIsAFile,
      runner: async () =>
        completedProcess({
          exitCode: null,
          spawnError: Object.assign(new Error("not found"), { code: "ENOENT" }),
        }),
    }),
    LogisimBackendUnavailableError,
  );
});

test("nonzero malformed-project output maps to PROJECT_INVALID", async () => {
  const workspace = "C:\\private\\circuitarium-workspace";
  const absoluteProject = resolve(workspace, "malformed.circ");
  await assert.rejects(
    runLogisimStatistics("malformed.circ", {
      runtime: fakeRuntime,
      inspectPath: everyPathIsAFile,
      currentWorkingDirectory: workspace,
      runner: afterPinnedVersion(() =>
        completedProcess({
          exitCode: 255,
          stderr: `Error loading circuit file: ${absoluteProject}`,
          stderrBytes: Buffer.byteLength(
            `Error loading circuit file: ${absoluteProject}`,
          ),
        }),
      ),
    }),
    (error: unknown) =>
      error instanceof LogisimProjectInvalidError &&
      error.code === "PROJECT_INVALID" &&
      !error.message.includes(workspace) &&
      error.message.includes("<local-path>"),
  );
});

test("the default runner treats shell metacharacters as literal arguments", async () => {
  const literal = "literal & echo shell-was-used";
  const result = await runBoundedLogisimProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.argv[1])", literal],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    stdoutLimitBytes: 1_024,
    stderrLimitBytes: 1_024,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, literal);
  assert.equal(result.outputLimitExceeded, null);
});

test("the default runner kills timeouts and byte-limit violations", async () => {
  const timeoutResult = await runBoundedLogisimProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1_000)"],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 50,
    stdoutLimitBytes: 1_024,
    stderrLimitBytes: 1_024,
  });
  assert.equal(timeoutResult.timedOut, true);
  assert.equal(timeoutResult.signal, "SIGKILL");

  const outputResult = await runBoundedLogisimProcess({
    command: process.execPath,
    args: ["-e", 'process.stdout.write("x".repeat(10_000))'],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    stdoutLimitBytes: 128,
    stderrLimitBytes: 1_024,
  });
  assert.equal(outputResult.outputLimitExceeded, "stdout");
  assert.equal(Buffer.byteLength(outputResult.stdout), 128);
  assert.ok(outputResult.stdoutBytes > 128);
});

test("the default runner reports a missing executable without throwing", async () => {
  const result = await runBoundedLogisimProcess({
    command: join(tmpdir(), "circuitarium-command-that-does-not-exist"),
    args: [],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 1_000,
    stdoutLimitBytes: 128,
    stderrLimitBytes: 128,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.spawnError?.code, "ENOENT");
});
