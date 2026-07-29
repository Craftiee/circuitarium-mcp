import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import { LogisimFormatError, MAX_LOGISIM_CIRC_BYTES } from "./model.js";
import { decodeLogisimCircBytes } from "./parser.js";

export const MAX_LOGISIM_AUXILIARY_BYTES = 4 * 1024 * 1024;
export const MAX_LOGISIM_DIRECTORY_SCAN_ENTRIES = 10_000;
export const MAX_LOGISIM_LISTING_DIGEST_BYTES = 256 * 1024 * 1024;
export const DEFAULT_LOGISIM_AUXILIARY_EXTENSIONS = [".vec", ".txt"] as const;

export class LogisimWorkspacePathDeniedError extends Error {}
export class UnsupportedLogisimPathError extends Error {}
export class LogisimFileTooLargeError extends Error {
	constructor(
		message: string,
		readonly observedBytes?: number,
		readonly observedMtime?: string,
	) {
		super(message);
	}
}
export class LogisimFileChangedDuringReadError extends Error {}
export class LogisimNotAFileError extends Error {}
export class LogisimNotADirectoryError extends Error {}

export function resolveLogisimWorkspaceRoot(
	environment: NodeJS.ProcessEnv = process.env,
	currentWorkingDirectory = process.cwd(),
): string {
	return resolve(
		environment.CIRCUITARIUM_MCP_ROOT ??
			environment.ELECTRONICS_MCP_ROOT ??
			currentWorkingDirectory,
	);
}

export const LOGISIM_WORKSPACE_ROOT = resolveLogisimWorkspaceRoot();

interface WorkspaceOptions {
	root?: string;
}

interface RawReadOptions extends WorkspaceOptions {
	maxBytes: number;
	extensions: readonly string[];
}

export interface LogisimFileSnapshot {
	path: string;
	ref: string;
	bytes: Buffer;
	digest: string;
	size: number;
	/** Last-modified time as an ISO 8601 UTC timestamp. */
	mtime: string;
	/**
	 * Decoded lazily so a caller can compare `digest` before malformed UTF-8 is
	 * parsed. Access performs strict UTF-8 decoding.
	 */
	readonly xml: string;
}

export interface LogisimAuxiliaryFileSnapshot {
	path: string;
	ref: string;
	bytes: Buffer;
	digest: string;
	size: number;
	/** Last-modified time as an ISO 8601 UTC timestamp. */
	mtime: string;
	readonly text: string;
}

export interface LogisimWorkspaceEntry {
	ref: string;
	bytes: number;
	mtime: string;
	digest: string;
}

export interface LogisimWorkspaceListing {
	entries: LogisimWorkspaceEntry[];
	scannedEntries: number;
	scanTruncated: boolean;
	digestBytes: number;
	digestByteLimit: number;
	digestBudgetTruncated: boolean;
}

function absoluteWorkspacePath(path: string, configuredRoot: string): string {
	if (path.includes("\0")) {
		throw new LogisimWorkspacePathDeniedError(
			"Logisim workspace paths must not contain NUL characters",
		);
	}
	return isAbsolute(path) ? resolve(path) : resolve(configuredRoot, path);
}

function relativeIfContained(root: string, target: string): string | undefined {
	const relativePath = relative(root, target);
	if (
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return undefined;
	}
	return relativePath;
}

function requireContained(root: string, target: string): string {
	const relativePath = relativeIfContained(root, target);
	if (relativePath === undefined) {
		throw new LogisimWorkspacePathDeniedError(
			`Path is outside CIRCUITARIUM_MCP_ROOT (${root}): ${target}`,
		);
	}
	return relativePath;
}

/**
 * Accepts the configured spelling of the workspace root or the one spelling
 * returned by realpath. macOS commonly maps /var to /private/var, while
 * Windows can expand an 8.3 root before returning a child path.
 */
function requireContainedRootAlias(
	configuredRoot: string,
	canonicalRoot: string,
	target: string,
): string {
	const relativePath =
		relativeIfContained(configuredRoot, target) ??
		relativeIfContained(canonicalRoot, target);
	if (relativePath === undefined) {
		throw new LogisimWorkspacePathDeniedError(
			`Path is outside CIRCUITARIUM_MCP_ROOT (${configuredRoot}): ${target}`,
		);
	}
	return relativePath;
}

function normalizedRelative(path: string): string {
	const normalized = path.split(sep).join("/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Verifies containment after canonicalization and rejects nested symlink or
 * junction traversal even when it would ultimately point back inside root.
 */
async function requireReadablePath(
	inputPath: string,
	configuredRoot: string,
): Promise<{ root: string; target: string }> {
	const root = await realpath(configuredRoot);
	const absolutePath = absoluteWorkspacePath(inputPath, configuredRoot);
	const lexicalRelative = normalizedRelative(
		requireContainedRootAlias(configuredRoot, root, absolutePath),
	);
	const target = await realpath(absolutePath);
	const canonicalRelative = normalizedRelative(
		requireContained(root, target),
	);
	if (lexicalRelative !== canonicalRelative) {
		throw new LogisimWorkspacePathDeniedError(
			`Refusing a path that traverses a symbolic link or reparse point: ${absolutePath}`,
		);
	}
	const entry = await lstat(absolutePath);
	if (entry.isSymbolicLink()) {
		throw new LogisimWorkspacePathDeniedError(
			`Refusing a symbolic-link file: ${absolutePath}`,
		);
	}
	return { root, target };
}

function normalizedExtensions(extensions: readonly string[]): Set<string> {
	if (extensions.length === 0) {
		throw new RangeError("At least one supported extension is required");
	}
	const normalized = new Set<string>();
	for (const extension of extensions) {
		const value = extension.toLowerCase();
		if (!/^\.[a-z0-9][a-z0-9._-]{0,31}$/u.test(value)) {
			throw new TypeError(
				`Invalid supported Logisim file extension: ${extension}`,
			);
		}
		normalized.add(value);
	}
	return normalized;
}

function requireSupportedExtension(
	path: string,
	extensions: ReadonlySet<string>,
): void {
	if (!extensions.has(extname(path).toLowerCase())) {
		throw new UnsupportedLogisimPathError(
			`Expected ${[...extensions].sort().join(" or ")}; received ${path}`,
		);
	}
}

function checkedByteLimit(maxBytes: number, maximum: number): number {
	const limit = Math.min(maximum, maxBytes);
	if (!Number.isInteger(limit) || limit < 0) {
		throw new RangeError("maxBytes must be a non-negative integer");
	}
	return limit;
}

async function readRawWorkspaceFile(
	path: string,
	options: RawReadOptions,
): Promise<{
	path: string;
	ref: string;
	bytes: Buffer;
	digest: string;
	size: number;
	mtime: string;
}> {
	const configuredRoot = resolve(options.root ?? LOGISIM_WORKSPACE_ROOT);
	const absolutePath = absoluteWorkspacePath(path, configuredRoot);
	const extensions = normalizedExtensions(options.extensions);
	requireSupportedExtension(absolutePath, extensions);
	const safe = await requireReadablePath(path, configuredRoot);
	const noFollow = constants.O_NOFOLLOW ?? 0;
	const handle = await open(safe.target, constants.O_RDONLY | noFollow);
	try {
		const openedFile = await handle.stat();
		if (!openedFile.isFile()) {
			throw new LogisimNotAFileError(`Not a regular file: ${safe.target}`);
		}
		if (openedFile.size > options.maxBytes) {
			throw new LogisimFileTooLargeError(
				`Logisim file is ${openedFile.size} bytes; the read limit is ${options.maxBytes} bytes`,
				openedFile.size,
				openedFile.mtime.toISOString(),
			);
		}

		// Compare two independently opened handle identities. O_NOFOLLOW covers
		// POSIX; this check also fails closed on Windows replacement races. Avoid
		// path stat because it uses a different Windows API that can disagree with
		// fstat about volume identity on virtual/profile disks.
		const currentPath = await realpath(safe.target);
		requireContained(safe.root, currentPath);
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
				throw new LogisimWorkspacePathDeniedError(
					`Logisim path changed while it was being opened: ${safe.target}`,
				);
			}
		} finally {
			await currentHandle.close();
		}

		const chunks: Buffer[] = [];
		let bytesReadTotal = 0;
		while (bytesReadTotal <= options.maxBytes) {
			const remaining = options.maxBytes + 1 - bytesReadTotal;
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
		if (bytesReadTotal > options.maxBytes) {
			throw new LogisimFileTooLargeError(
				`Logisim file exceeds the ${options.maxBytes}-byte read limit`,
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
			throw new LogisimFileChangedDuringReadError(
				`Logisim file changed while it was being read: ${safe.target}`,
			);
		}

		const bytes = Buffer.concat(chunks, bytesReadTotal);
		return {
			path: safe.target,
			ref: workspaceReference(safe.root, safe.target),
			bytes,
			digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
			size: bytes.byteLength,
			mtime: completedFile.mtime.toISOString(),
		};
	} finally {
		await handle.close();
	}
}

export async function readLogisimFile(
	path: string,
	options: WorkspaceOptions & { maxBytes?: number } = {},
): Promise<LogisimFileSnapshot> {
	const maxBytes = checkedByteLimit(
		options.maxBytes ?? MAX_LOGISIM_CIRC_BYTES,
		MAX_LOGISIM_CIRC_BYTES,
	);
	const raw = await readRawWorkspaceFile(path, {
		...(options.root === undefined ? {} : { root: options.root }),
		maxBytes,
		extensions: [".circ"],
	});
	let decodedXml: string | undefined;
	return {
		...raw,
		get xml(): string {
			decodedXml ??= decodeLogisimCircBytes(raw.bytes, { maxBytes });
			return decodedXml;
		},
	};
}

function decodeAuxiliaryText(bytes: Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new LogisimFormatError(
			"Logisim test-vector files must contain valid UTF-8 text",
		);
	}
}

export async function readLogisimAuxiliaryFile(
	path: string,
	extensions: readonly string[] = DEFAULT_LOGISIM_AUXILIARY_EXTENSIONS,
	options: WorkspaceOptions & { maxBytes?: number } = {},
): Promise<LogisimAuxiliaryFileSnapshot> {
	const maxBytes = checkedByteLimit(
		options.maxBytes ?? MAX_LOGISIM_AUXILIARY_BYTES,
		MAX_LOGISIM_AUXILIARY_BYTES,
	);
	const raw = await readRawWorkspaceFile(path, {
		...(options.root === undefined ? {} : { root: options.root }),
		maxBytes,
		extensions,
	});
	let decodedText: string | undefined;
	return {
		...raw,
		get text(): string {
			decodedText ??= decodeAuxiliaryText(raw.bytes);
			return decodedText;
		},
	};
}

export const readLogisimVectorFile = readLogisimAuxiliaryFile;

/**
 * Returns an absolute, canonical, workspace-contained path for the Java
 * subprocess. The file is opened and bounded first; callers needing digest or
 * contents should use `readLogisimAuxiliaryFile` directly.
 */
export async function resolveLogisimAuxiliaryFile(
	path: string,
	extensions: readonly string[] = DEFAULT_LOGISIM_AUXILIARY_EXTENSIONS,
	options: WorkspaceOptions & { maxBytes?: number } = {},
): Promise<string> {
	return (await readLogisimAuxiliaryFile(path, extensions, options)).path;
}

interface Candidate {
	path: string;
	ref: string;
	bytes: number;
}

function workspaceReference(root: string, target: string): string {
	requireContained(root, target);
	const reference = relative(root, target);
	return reference.length === 0 ? "." : reference.split(sep).join("/");
}

export function logisimWorkspaceRef(
	path: string,
	root = LOGISIM_WORKSPACE_ROOT,
): string {
	const configuredRoot = resolve(root);
	const canonicalRoot = realpathSync.native(configuredRoot);
	const absolutePath = absoluteWorkspacePath(path, configuredRoot);
	const lexicalRelative = normalizedRelative(
		requireContainedRootAlias(configuredRoot, canonicalRoot, absolutePath),
	);
	const target = realpathSync.native(absolutePath);
	const canonicalRelative = normalizedRelative(
		requireContained(canonicalRoot, target),
	);
	if (lexicalRelative !== canonicalRelative) {
		throw new LogisimWorkspacePathDeniedError(
			`Refusing a path that traverses a symbolic link or reparse point: ${absolutePath}`,
		);
	}
	return workspaceReference(canonicalRoot, target);
}

export async function listLogisimFiles(
	dir = ".",
	options: WorkspaceOptions & {
		recursive?: boolean;
		scanEntryLimit?: number;
		digestByteLimit?: number;
	} = {},
): Promise<LogisimWorkspaceListing> {
	const recursive = options.recursive ?? true;
	const scanEntryLimit =
		options.scanEntryLimit ?? MAX_LOGISIM_DIRECTORY_SCAN_ENTRIES;
	if (
		!Number.isInteger(scanEntryLimit) ||
		scanEntryLimit < 1 ||
		scanEntryLimit > MAX_LOGISIM_DIRECTORY_SCAN_ENTRIES
	) {
		throw new RangeError(
			`scanEntryLimit must be an integer from 1 to ${MAX_LOGISIM_DIRECTORY_SCAN_ENTRIES}`,
		);
	}
	const digestByteLimit = checkedByteLimit(
		options.digestByteLimit ?? MAX_LOGISIM_LISTING_DIGEST_BYTES,
		MAX_LOGISIM_LISTING_DIGEST_BYTES,
	);
	const configuredRoot = resolve(options.root ?? LOGISIM_WORKSPACE_ROOT);
	const safeStart = await requireReadablePath(dir, configuredRoot);
	if (!(await stat(safeStart.target)).isDirectory()) {
		throw new LogisimNotADirectoryError(`Not a directory: ${safeStart.target}`);
	}

	const pending: string[] = [safeStart.target];
	const candidates: Candidate[] = [];
	let scannedEntries = 0;
	let scanTruncated = false;
	while (pending.length > 0 && !scanTruncated) {
		const current = pending.shift()!;
		const currentEntry = await lstat(current);
		if (currentEntry.isSymbolicLink()) {
			continue;
		}
		const canonicalCurrent = await realpath(current);
		requireContained(safeStart.root, canonicalCurrent);
		const directory = await opendir(canonicalCurrent);
		for await (const dirent of directory) {
			if (scannedEntries >= scanEntryLimit) {
				scanTruncated = true;
				break;
			}
			scannedEntries += 1;
			if (dirent.isSymbolicLink()) {
				continue;
			}
			const absolutePath = join(canonicalCurrent, dirent.name);
			if (dirent.isDirectory()) {
				if (
					recursive &&
					!dirent.name.startsWith(".") &&
					dirent.name !== "node_modules" &&
					dirent.name !== ".git"
				) {
					pending.push(absolutePath);
				}
				continue;
			}
			if (!dirent.isFile() || extname(dirent.name).toLowerCase() !== ".circ") {
				continue;
			}
			const file = await stat(absolutePath);
			candidates.push({
				path: absolutePath,
				ref: workspaceReference(safeStart.root, absolutePath),
				bytes: file.size,
			});
		}
	}
	candidates.sort((left, right) => left.ref.localeCompare(right.ref));

	const entries: LogisimWorkspaceEntry[] = [];
	let digestBytes = 0;
	let digestBudgetTruncated = false;
	for (const candidate of candidates) {
		if (
			candidate.bytes > MAX_LOGISIM_CIRC_BYTES ||
			digestBytes + candidate.bytes > digestByteLimit
		) {
			digestBudgetTruncated = true;
			continue;
		}
		const snapshot = await readLogisimFile(candidate.path, {
			root: configuredRoot,
		});
		digestBytes += snapshot.size;
		entries.push({
			ref: snapshot.ref,
			bytes: snapshot.size,
			mtime: snapshot.mtime,
			digest: snapshot.digest,
		});
	}
	return {
		entries,
		scannedEntries,
		scanTruncated,
		digestBytes,
		digestByteLimit,
		digestBudgetTruncated,
	};
}
