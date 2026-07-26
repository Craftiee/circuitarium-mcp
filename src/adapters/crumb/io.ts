import { realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MAX_CRU_BYTES = 64 * 1024 * 1024;

/** The path resolves outside the configured workspace root. */
export class WorkspacePathDeniedError extends Error {}

/** The path does not use the .cru extension this backend supports. */
export class UnsupportedCruPathError extends Error {}

/** The file exceeds the fixed byte safety limit. */
export class CruFileTooLargeError extends Error {}

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
): Promise<{ path: string; xml: string; bytes: Buffer }> {
  const absolutePath = absoluteWorkspacePath(path);
  requireCruExtension(absolutePath);
  const safePath = await requireReadablePath(absolutePath);
  const file = await stat(safePath);
  if (!file.isFile()) {
    throw new NotAFileError(`Not a file: ${safePath}`);
  }
  if (file.size > MAX_CRU_BYTES) {
    throw new CruFileTooLargeError(
      `CRUMB file is ${file.size} bytes; the current safety limit is ${MAX_CRU_BYTES} bytes`,
    );
  }
  // The raw bytes travel alongside the decoded text so digests identify the
  // exact file content; hashing the decoded string would let byte-distinct
  // files collide through U+FFFD replacement.
  const bytes = await readFile(safePath);
  return { path: safePath, xml: bytes.toString("utf8"), bytes };
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
  options: { recursive?: boolean } = {},
): Promise<CruWorkspaceListing> {
  const recursive = options.recursive ?? true;
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
    for (const dirent of await readdir(current, { withFileTypes: true })) {
      scannedEntries += 1;
      if (scannedEntries > MAX_DIRECTORY_SCAN_ENTRIES) {
        scanTruncated = true;
        break;
      }
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
