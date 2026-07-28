import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import test from "node:test";

import { MAX_LOGISIM_AUXILIARY_BYTES } from "../src/adapters/logisim/io.js";
import {
  LogisimStagingInputTooLargeError,
  withStagedLogisimArtifacts,
} from "../src/adapters/logisim/staging.js";

test("staging uses fixed private names and preserves exact bytes", async () => {
  const projectBytes = Buffer.from("<project />\n", "utf8");
  const vectorBytes = Buffer.from("A Y\n0 0\n", "utf8");
  const result = await withStagedLogisimArtifacts(
    { projectBytes, vectorBytes },
    async ({ projectPath, vectorPath }) => {
      assert.ok(isAbsolute(projectPath));
      assert.ok(vectorPath);
      assert.ok(isAbsolute(vectorPath));
      assert.equal(basename(projectPath), "project.circ");
      assert.equal(basename(vectorPath), "vectors.vec");
      assert.equal(dirname(projectPath), dirname(vectorPath));
      assert.deepEqual(await readFile(projectPath), projectBytes);
      assert.deepEqual(await readFile(vectorPath), vectorBytes);

      if (process.platform !== "win32") {
        assert.equal((await stat(dirname(projectPath))).mode & 0o777, 0o700);
        assert.equal((await stat(projectPath)).mode & 0o777, 0o600);
        assert.equal((await stat(vectorPath)).mode & 0o777, 0o600);
      }
      return "callback-result";
    },
  );

  assert.equal(result, "callback-result");
});

test("staging omits the vector path when no vector snapshot is supplied", async () => {
  await withStagedLogisimArtifacts(
    { projectBytes: Buffer.from("<project />") },
    async (artifacts) => {
      assert.equal(artifacts.vectorPath, undefined);
    },
  );
});

test("test-vector runtime staging isolates the JAR from sibling defaults", async () => {
  const configuredDirectory = await mkdtemp(
    join(tmpdir(), "circuitarium-configured-runtime-"),
  );
  const configuredJar = join(configuredDirectory, "configured.jar");
  const configuredBytes = Buffer.from("synthetic-jar-bytes");
  const defaultsDirectory = join(configuredDirectory, "logisim-defaults");
  await writeFile(configuredJar, configuredBytes);
  await mkdir(defaultsDirectory);
  await writeFile(
    join(defaultsDirectory, "untrusted.circ"),
    "<project />",
  );

  let stagedJarPath = "";
  try {
    await withStagedLogisimArtifacts(
      {
        projectBytes: Buffer.from("<project />"),
        vectorBytes: Buffer.from("A Y\n0 0\n"),
        runtimeJarPath: configuredJar,
      },
      async ({ projectPath, vectorPath, runtimeJarPath }) => {
        assert.ok(vectorPath);
        assert.ok(runtimeJarPath);
        stagedJarPath = runtimeJarPath;
        assert.equal(basename(runtimeJarPath), "runtime.jar");
        assert.equal(dirname(runtimeJarPath), dirname(projectPath));
        assert.equal(dirname(runtimeJarPath), dirname(vectorPath));
        assert.deepEqual(await readFile(runtimeJarPath), configuredBytes);
        await assert.rejects(
          access(join(dirname(runtimeJarPath), "logisim-defaults")),
          { code: "ENOENT" },
        );
        if (process.platform !== "win32") {
          assert.equal((await stat(runtimeJarPath)).mode & 0o777, 0o600);
        }
      },
    );
    await assert.rejects(access(stagedJarPath), { code: "ENOENT" });
  } finally {
    await rm(configuredDirectory, { recursive: true });
  }
});

test("staging removes private files after success and callback failure", async () => {
  let successfulProjectPath = "";
  await withStagedLogisimArtifacts(
    { projectBytes: Buffer.from("<project />") },
    async ({ projectPath }) => {
      successfulProjectPath = projectPath;
    },
  );
  await assert.rejects(access(successfulProjectPath), { code: "ENOENT" });

  let failedProjectPath = "";
  const callbackError = new Error("callback failed");
  await assert.rejects(
    withStagedLogisimArtifacts(
      { projectBytes: Buffer.from("<project />") },
      async ({ projectPath }) => {
        failedProjectPath = projectPath;
        throw callbackError;
      },
    ),
    (error: unknown) => error === callbackError,
  );
  await assert.rejects(access(failedProjectPath), { code: "ENOENT" });
});

test("staging copies caller-owned bytes before asynchronous work begins", async () => {
  const projectBytes = Buffer.from("original");
  const operation = withStagedLogisimArtifacts(
    { projectBytes },
    async ({ projectPath }) => readFile(projectPath, "utf8"),
  );
  projectBytes.fill(0x78);

  assert.equal(await operation, "original");
});

test("staging rejects oversized vector snapshots before creating files", async () => {
  const vectorBytes = Buffer.alloc(MAX_LOGISIM_AUXILIARY_BYTES + 1);
  let callbackCalled = false;
  await assert.rejects(
    withStagedLogisimArtifacts(
      {
        projectBytes: Buffer.from("<project />"),
        vectorBytes,
      },
      async () => {
        callbackCalled = true;
      },
    ),
    (error: unknown) =>
      error instanceof LogisimStagingInputTooLargeError &&
      error.artifact === "vector" &&
      error.limitBytes === MAX_LOGISIM_AUXILIARY_BYTES,
  );
  assert.equal(callbackCalled, false);
});

test("parallel staging operations receive different private directories", async () => {
  const directories = await Promise.all(
    Array.from({ length: 3 }, () =>
      withStagedLogisimArtifacts(
        { projectBytes: Buffer.from("<project />") },
        async ({ projectPath }) => dirname(projectPath),
      ),
    ),
  );

  assert.equal(new Set(directories).size, directories.length);
});
