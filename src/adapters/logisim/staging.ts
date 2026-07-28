import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { MAX_LOGISIM_AUXILIARY_BYTES } from "./io.js";
import { MAX_LOGISIM_CIRC_BYTES } from "./model.js";

const STAGING_DIRECTORY_PREFIX = "circuitarium-logisim-stage-";
const STAGED_PROJECT_FILENAME = "project.circ";
const STAGED_VECTOR_FILENAME = "vectors.vec";
const STAGED_RUNTIME_JAR_FILENAME = "runtime.jar";
export const MAX_STAGED_LOGISIM_JAR_BYTES = 256 * 1024 * 1024;

export class LogisimStagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogisimStagingError";
  }
}

export class LogisimStagingInputTooLargeError extends LogisimStagingError {
  constructor(
    readonly artifact: "project" | "vector",
    readonly observedBytes: number,
    readonly limitBytes: number,
  ) {
    super(
      `The Logisim ${artifact} snapshot is ${observedBytes} bytes; the staging limit is ${limitBytes} bytes.`,
    );
    this.name = "LogisimStagingInputTooLargeError";
  }
}

export class LogisimRuntimeJarStagingError extends LogisimStagingError {
  constructor(message: string) {
    super(message);
    this.name = "LogisimRuntimeJarStagingError";
  }
}

export interface LogisimStagingInput {
  projectBytes: Uint8Array;
  vectorBytes?: Uint8Array;
  /**
   * Optional configured JAR to copy under a fixed private name. Test-vector
   * mode uses this so Logisim cannot discover `logisim-defaults` beside the
   * user's configured JAR.
   */
  runtimeJarPath?: string;
}

export interface StagedLogisimArtifacts {
  /** Private absolute path with the fixed basename `project.circ`. */
  projectPath: string;
  /** Private absolute path with the fixed basename `vectors.vec`, when supplied. */
  vectorPath?: string;
  /** Private absolute path with the fixed basename `runtime.jar`, when supplied. */
  runtimeJarPath?: string;
}

function requireByteSnapshot(
  value: Uint8Array,
  artifact: "project" | "vector",
  limitBytes: number,
): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${artifact}Bytes must be a Uint8Array`);
  }
  if (value.byteLength > limitBytes) {
    throw new LogisimStagingInputTooLargeError(
      artifact,
      value.byteLength,
      limitBytes,
    );
  }
  // Copy before the first await so a caller cannot mutate the staged snapshot
  // through a shared Buffer/Uint8Array while files are being created.
  return Buffer.from(value);
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

function requireSafeStagingDirectory(path: string): string {
  const absolutePath = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  if (
    !isAbsolute(absolutePath) ||
    dirname(absolutePath) !== temporaryRoot ||
    !basename(absolutePath).startsWith(STAGING_DIRECTORY_PREFIX) ||
    basename(absolutePath).length <= STAGING_DIRECTORY_PREFIX.length
  ) {
    throw new LogisimStagingError(
      "Refusing to clean up an invalid Logisim staging directory.",
    );
  }
  return absolutePath;
}

async function removeStagingDirectory(path: string): Promise<void> {
  const safePath = requireSafeStagingDirectory(path);
  try {
    await rm(safePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  } catch (error) {
    throw new LogisimStagingError(
      `The private Logisim staging directory could not be removed (${nodeErrorCode(error)}).`,
    );
  }
}

async function stageRuntimeJar(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  if (
    !isAbsolute(sourcePath) ||
    sourcePath.includes("\0") ||
    resolve(sourcePath) === resolve(destinationPath)
  ) {
    throw new LogisimRuntimeJarStagingError(
      "The configured Logisim JAR path is not a valid absolute source path.",
    );
  }
  try {
    const source = await stat(sourcePath);
    if (!source.isFile()) {
      throw new LogisimRuntimeJarStagingError(
        "The configured Logisim JAR is not a regular file.",
      );
    }
    if (source.size > MAX_STAGED_LOGISIM_JAR_BYTES) {
      throw new LogisimRuntimeJarStagingError(
        `The configured Logisim JAR exceeds the ${MAX_STAGED_LOGISIM_JAR_BYTES}-byte isolation limit.`,
      );
    }
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    await chmod(destinationPath, 0o600);
  } catch (error) {
    if (error instanceof LogisimRuntimeJarStagingError) {
      throw error;
    }
    throw new LogisimRuntimeJarStagingError(
      `The configured Logisim JAR could not be copied into the private runtime directory (${nodeErrorCode(error)}).`,
    );
  }
}

/**
 * Materializes exact, already-read snapshots under fixed private filenames,
 * invokes one async operation, then removes the whole staging directory.
 *
 * Caller filenames are intentionally not accepted. Relative library lookups
 * therefore cannot inherit the original project's directory implicitly; the
 * caller must reject or explicitly stage any external dependencies.
 */
export async function withStagedLogisimArtifacts<T>(
  input: LogisimStagingInput,
  operation: (artifacts: Readonly<StagedLogisimArtifacts>) => Promise<T>,
): Promise<T> {
  if (typeof operation !== "function") {
    throw new TypeError("operation must be a function");
  }
  if (!input || typeof input !== "object") {
    throw new TypeError("input must be an object");
  }
  const projectBytes = requireByteSnapshot(
    input.projectBytes,
    "project",
    MAX_LOGISIM_CIRC_BYTES,
  );
  const vectorBytes =
    input.vectorBytes === undefined
      ? undefined
      : requireByteSnapshot(
          input.vectorBytes,
          "vector",
          MAX_LOGISIM_AUXILIARY_BYTES,
        );

  let stagingDirectory: string | undefined;
  let operationStarted = false;
  try {
    stagingDirectory = requireSafeStagingDirectory(
      await mkdtemp(join(tmpdir(), STAGING_DIRECTORY_PREFIX)),
    );
    // POSIX honors these modes; chmod is harmless on Windows and documents the
    // intended private boundary on every platform.
    await chmod(stagingDirectory, 0o700);
    const projectPath = join(stagingDirectory, STAGED_PROJECT_FILENAME);
    await writeFile(projectPath, projectBytes, {
      flag: "wx",
      mode: 0o600,
    });
    let vectorPath: string | undefined;
    if (vectorBytes !== undefined) {
      vectorPath = join(stagingDirectory, STAGED_VECTOR_FILENAME);
      await writeFile(vectorPath, vectorBytes, {
        flag: "wx",
        mode: 0o600,
      });
    }
    let runtimeJarPath: string | undefined;
    if (input.runtimeJarPath !== undefined) {
      runtimeJarPath = join(
        stagingDirectory,
        STAGED_RUNTIME_JAR_FILENAME,
      );
      await stageRuntimeJar(input.runtimeJarPath, runtimeJarPath);
    }

    operationStarted = true;
    return await operation({
      projectPath,
      ...(vectorPath === undefined ? {} : { vectorPath }),
      ...(runtimeJarPath === undefined ? {} : { runtimeJarPath }),
    });
  } catch (error) {
    if (error instanceof LogisimStagingError || operationStarted) {
      throw error;
    }
    throw new LogisimStagingError(
      `The private Logisim staging files could not be created (${nodeErrorCode(error)}).`,
    );
  } finally {
    if (stagingDirectory !== undefined) {
      await removeStagingDirectory(stagingDirectory);
    }
  }
}
