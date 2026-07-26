import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

export const MAX_CRU_BYTES = 3 * 1024 * 1024;
export const MAX_CRU_COMPARISON_BYTES = 5 * 1024 * 1024;

export function requireCruComparisonSize(
  baselineBytes: number,
  candidateBytes: number,
): void {
  const total = baselineBytes + candidateBytes;
  if (total > MAX_CRU_COMPARISON_BYTES) {
    throw new Error(
      `Combined CRUMB comparison input is ${total} bytes; the current safety limit is ${MAX_CRU_COMPARISON_BYTES} bytes`,
    );
  }
}

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
    throw new Error(`Expected a .cru path; received ${path}`);
  }
}

function requireContained(root: string, target: string): void {
  const relativePath = relative(root, target);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
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
        throw new Error(`Refusing to overwrite a symbolic link: ${absolutePath}`);
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
): Promise<{ path: string; xml: string; bytes: number; digest: string }> {
  const absolutePath = absoluteWorkspacePath(path);
  requireCruExtension(absolutePath);
  const safePath = await requireReadablePath(absolutePath);
  const file = await stat(safePath);
  if (!file.isFile()) {
    throw new Error(`Not a file: ${safePath}`);
  }
  if (file.size > MAX_CRU_BYTES) {
    throw new Error(
      `CRUMB file is ${file.size} bytes; the current safety limit is ${MAX_CRU_BYTES} bytes`,
    );
  }
  const fileBytes = await readFile(safePath);
  if (fileBytes.byteLength > MAX_CRU_BYTES) {
    throw new Error(
      `CRUMB file is ${fileBytes.byteLength} bytes after reading; the current safety limit is ${MAX_CRU_BYTES} bytes`,
    );
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(fileBytes);
  } catch {
    throw new Error("CRUMB files must contain valid UTF-8 text");
  }
  return {
    path: safePath,
    xml,
    bytes: fileBytes.byteLength,
    digest: `sha256:${createHash("sha256").update(fileBytes).digest("hex")}`,
  };
}

export async function writeCruFile(
  path: string,
  xml: string,
  options: { overwrite?: boolean; createParent?: boolean } = {},
): Promise<string> {
  const absolutePath = absoluteWorkspacePath(path);
  requireCruExtension(absolutePath);
  if (Buffer.byteLength(xml, "utf8") > MAX_CRU_BYTES) {
    throw new Error(`Generated CRUMB file exceeds the ${MAX_CRU_BYTES}-byte safety limit`);
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

export function workspaceRef(path: string): string {
  const absolutePath = absoluteWorkspacePath(path);
  const root = realpathSync(CIRCUITARIUM_MCP_ROOT);
  const target = realpathSync(absolutePath);
  requireContained(root, target);
  const reference = relative(root, target);
  return reference.length === 0 ? "." : reference.split(sep).join("/");
}
