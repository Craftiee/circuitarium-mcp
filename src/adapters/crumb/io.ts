import { constants, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import { CruFormatError } from "./format.js";

export const MAX_CRU_BYTES = 64 * 1024 * 1024;

/** The path resolves outside the configured workspace root. */
export class WorkspacePathDeniedError extends Error {}

/** The path does not use the .cru extension this backend supports. */
export class UnsupportedCruPathError extends Error {}

/** The file exceeds the fixed byte safety limit. */
export class CruFileTooLargeError extends Error {
  constructor(
    message: string,
    readonly observedBytes?: number,
    readonly observedMtime?: string,
  ) {
    super(message);
  }
}

/** The file changed while one supposedly coherent snapshot was being read. */
export class CruFileChangedDuringReadError extends Error {}

/** The path exists but is not a regular file. */
export class NotAFileError extends Error {}

/** The path exists but is not a directory. */
export class NotADirectoryError extends Error {}

export function resolveCircuitariumMcpRoot(
  environment: NodeJS.ProcessEnv = process.env,
  currentWorkingDirectory = process.cwd(),
): string {
  return resolve(
    environment.CIRCUITARIUM_MCP_ROOT ??
      environment.ELECTRONICS_MCP_ROOT ??
      currentWorkingDirectory,
  );
}

export const CIRCUITARIUM_MCP_ROOT = resolveCircuitariumMcpRoot();
/** @deprecated Use CIRCUITARIUM_MCP_ROOT. */
export const ELECTRONICS_MCP_ROOT = CIRCUITARIUM_MCP_ROOT;

function absoluteWorkspacePath(path: string): string {
  return isAbsolute(path)
    ? resolve(path)
    : resolve(CIRCUITARIUM_MCP_ROOT, path);
}

function requireCruExtension(path: string): void {
  if (extname(path).toLowerCase() !== ".cru") {
    throw new UnsupportedCruPathError(`Expected a .cru path; received ${path}`);
  }
}

function requireContained(root: string, target: string): void {
  const relativePath = relative(root, target);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new WorkspacePathDeniedError(
      `Path is outside CIRCUITARIUM_MCP_ROOT (${CIRCUITARIUM_MCP_ROOT}): ${target}`,
    );
  }
}

async function requireReadablePath(absolutePath: string): Promise<string> {
  const root = await realpath(CIRCUITARIUM_MCP_ROOT);
  const target = await realpath(absolutePath);
  requireContained(root, target);
  return target;
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      const entry = await stat(current);
      if (!entry.isDirectory()) {
        throw new Error(`Expected a directory: ${current}`);
      }
      return current;
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(`No existing parent directory for ${path}`);
      }
      current = parent;
    }
  }
}

async function requireWritablePath(
  absolutePath: string,
  createParent: boolean,
  overwrite: boolean,
): Promise<void> {
  const root = await realpath(CIRCUITARIUM_MCP_ROOT);
  requireContained(CIRCUITARIUM_MCP_ROOT, absolutePath);

  const targetParent = dirname(absolutePath);
  const existingParent = await nearestExistingDirectory(targetParent);
  requireContained(root, await realpath(existingParent));
  if (createParent) {
    await mkdir(targetParent, { recursive: true });
  }
  requireContained(root, await realpath(targetParent));

  if (overwrite) {
    try {
      const target = await lstat(absolutePath);
      if (target.isSymbolicLink()) {
        throw new WorkspacePathDeniedError(
          `Refusing to overwrite a symbolic link: ${absolutePath}`,
        );
      }
      requireContained(root, await realpath(absolutePath));
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }
}

export async function readCruFile(
  path: string,
  options: { maxBytes?: number } = {},
): Promise<{ path: string; xml: string; bytes: Buffer; mtime: string }> {
  const absolutePath = absoluteWorkspacePath(path);
  requireCruExtension(absolutePath);
  const safePath = await requireReadablePath(absolutePath);
  const root = await realpath(CIRCUITARIUM_MCP_ROOT);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(safePath, constants.O_RDONLY | noFollow);
  try {
    const openedFile = await handle.stat();
    const byteLimit = Math.min(
      MAX_CRU_BYTES,
      options.maxBytes ?? MAX_CRU_BYTES,
    );
    if (!Number.isInteger(byteLimit) || byteLimit < 0) {
      throw new RangeError("maxBytes must be a non-negative integer");
    }
    if (!openedFile.isFile()) {
      throw new NotAFileError(`Not a file: ${safePath}`);
    }
    if (openedFile.size > byteLimit) {
      throw new CruFileTooLargeError(
        `CRUMB file is ${openedFile.size} bytes; the current read limit is ${byteLimit} bytes`,
        openedFile.size,
        openedFile.mtime.toISOString(),
      );
    }

    // Windows does not expose O_NOFOLLOW through Node. Re-resolve the opened
    // pathname and compare two independently opened handle identities so a
    // static symlink or ordinary replacement race fails closed everywhere.
    // Avoid comparing fstat with path stat: those use different Windows APIs
    // and can report inconsistent volume identities on virtual/profile disks.
    const currentPath = await realpath(safePath);
    requireContained(root, currentPath);
    const openedIdentity = await handle.stat({ bigint: true });
    const currentHandle = await open(
      currentPath,
      constants.O_RDONLY | noFollow,
    );
    try {
      const currentIdentity = await currentHandle.stat({ bigint: true });
      if (
        openedIdentity.dev !== currentIdentity.dev ||
        openedIdentity.ino !== currentIdentity.ino
      ) {
        throw new WorkspacePathDeniedError(
          `Path changed while it was being opened: ${safePath}`,
        );
      }
    } finally {
      await currentHandle.close();
    }

    const chunks: Buffer[] = [];
    let bytesReadTotal = 0;
    while (bytesReadTotal <= byteLimit) {
      const remaining = byteLimit + 1 - bytesReadTotal;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(
        chunk,
        0,
        chunk.byteLength,
        bytesReadTotal,
      );
      if (bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      bytesReadTotal += bytesRead;
    }
    if (bytesReadTotal > byteLimit) {
      throw new CruFileTooLargeError(
        `CRUMB file exceeds the ${byteLimit}-byte read limit`,
        bytesReadTotal,
        openedFile.mtime.toISOString(),
      );
    }
    const completedFile = await handle.stat();
    if (
      completedFile.size !== openedFile.size ||
      completedFile.mtimeMs !== openedFile.mtimeMs ||
      completedFile.size !== bytesReadTotal
    ) {
      throw new CruFileChangedDuringReadError(
        `CRUMB file changed while it was being read: ${safePath}`,
      );
    }

    // The raw bytes travel alongside the decoded text so digests identify the
    // exact file content; hashing the decoded string would let byte-distinct
    // files collide through U+FFFD replacement.
    const bytes = Buffer.concat(chunks, bytesReadTotal);
    let decodedXml: string | undefined;
    return {
      path: safePath,
      // Decode only when semantic parsing actually begins. Callers can hash
      // and compare exact bytes first, preserving stale-digest guard ordering
      // even when the file contains malformed UTF-8.
      get xml(): string {
        if (decodedXml !== undefined) {
          return decodedXml;
        }
        try {
          // Keep a BOM in the lexical string because it participates in exact
          // representation comparison.
          decodedXml = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
          return decodedXml;
        } catch {
          throw new CruFormatError("CRUMB files must contain valid UTF-8 text");
        }
      },
      bytes,
      mtime: completedFile.mtime.toISOString(),
    };
  } finally {
    await handle.close();
  }
}

export async function writeCruFile(
  path: string,
  xml: string,
  options: { overwrite?: boolean; createParent?: boolean } = {},
): Promise<string> {
  const absolutePath = absoluteWorkspacePath(path);
  requireCruExtension(absolutePath);
  if (Buffer.byteLength(xml, "utf8") > MAX_CRU_BYTES) {
    throw new CruFileTooLargeError(
      `Generated CRUMB file exceeds the ${MAX_CRU_BYTES}-byte safety limit`,
    );
  }
  await requireWritablePath(
    absolutePath,
    options.createParent ?? false,
    options.overwrite ?? false,
  );
  await writeFile(absolutePath, xml, {
    encoding: "utf8",
    flag: options.overwrite ? "w" : "wx",
  });
  return absolutePath;
}

export interface CruWorkspaceEntry {
  ref: string;
  bytes: number;
  /** Last-modified time as an ISO 8601 UTC timestamp. */
  mtime: string;
}

export interface CruWorkspaceListing {
  entries: CruWorkspaceEntry[];
  scannedEntries: number;
  scanTruncated: boolean;
}

const MAX_DIRECTORY_SCAN_ENTRIES = 10_000;

/**
 * Enumerates .cru files under one workspace directory. Dot-directories,
 * node_modules, and symbolic links are skipped, and the walk stops after a
 * fixed number of directory entries so hostile trees cannot stall the server.
 */
export async function listCruFiles(
  dir = ".",
  options: { recursive?: boolean; scanEntryLimit?: number } = {},
): Promise<CruWorkspaceListing> {
  const recursive = options.recursive ?? true;
  const scanEntryLimit =
    options.scanEntryLimit ?? MAX_DIRECTORY_SCAN_ENTRIES;
  if (
    !Number.isInteger(scanEntryLimit) ||
    scanEntryLimit < 1 ||
    scanEntryLimit > MAX_DIRECTORY_SCAN_ENTRIES
  ) {
    throw new RangeError(
      `scanEntryLimit must be an integer from 1 to ${MAX_DIRECTORY_SCAN_ENTRIES}`,
    );
  }
  const root = await realpath(CIRCUITARIUM_MCP_ROOT);
  const start = await realpath(absoluteWorkspacePath(dir));
  requireContained(root, start);
  if (!(await stat(start)).isDirectory()) {
    throw new NotADirectoryError(`Not a directory: ${start}`);
  }

  const entries: CruWorkspaceEntry[] = [];
  const pending: string[] = [start];
  let scannedEntries = 0;
  let scanTruncated = false;
  while (pending.length > 0 && !scanTruncated) {
    const current = pending.shift()!;
    const directory = await opendir(current);
    for await (const dirent of directory) {
      if (scannedEntries >= scanEntryLimit) {
        scanTruncated = true;
        break;
      }
      scannedEntries += 1;
      if (dirent.isSymbolicLink()) {
        continue;
      }
      const absolutePath = join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (
          recursive &&
          !dirent.name.startsWith(".") &&
          dirent.name !== "node_modules"
        ) {
          pending.push(absolutePath);
        }
        continue;
      }
      if (!dirent.isFile() || extname(dirent.name).toLowerCase() !== ".cru") {
        continue;
      }
      const file = await stat(absolutePath);
      entries.push({
        ref: workspaceRef(absolutePath),
        bytes: file.size,
        mtime: file.mtime.toISOString(),
      });
    }
  }
  entries.sort((left, right) => left.ref.localeCompare(right.ref));
  return { entries, scannedEntries, scanTruncated };
}

export function workspaceRef(path: string): string {
  const absolutePath = absoluteWorkspacePath(path);
  const root = realpathSync(CIRCUITARIUM_MCP_ROOT);
  const target = realpathSync(absolutePath);
  requireContained(root, target);
  const reference = relative(root, target);
  return reference.length === 0 ? "." : reference.split(sep).join("/");
}
