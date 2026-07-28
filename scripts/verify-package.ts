import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface PackFile {
  path: string;
  size: number;
}

interface PackResult {
  filename: string;
  files: PackFile[];
  name: string;
  size: number;
  unpackedSize: number;
  version: string;
}

interface PackageManifest {
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  main?: unknown;
  mcpName?: unknown;
  name?: string;
  types?: unknown;
  version?: string;
}

interface DependencyTree {
  dependencies?: Record<string, DependencyTree>;
  version?: string;
}

interface SdkManifest {
  dependencies?: Record<string, string>;
  name?: string;
  version?: string;
}

interface ShrinkwrapManifest {
  name?: unknown;
  packages?: Record<
    string,
    {
      bin?: Record<string, string>;
      name?: unknown;
      version?: unknown;
    }
  >;
  version?: unknown;
}

const SDK_VERSION = "1.29.0";
const UPSTREAM_HONO_RANGE = "^1.19.9";
const AUDITED_HONO_VERSION = "2.0.11";
const EXPECTED_TOOL_COUNT = 14;
const MAX_TARBALL_BYTES = 5 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 20 * 1024 * 1024;
const MAX_PACKAGE_FILES = 4_000;
const STARTUP_TIMEOUT_MS = 10_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = resolve(tmpdir());
const sourceSdkManifestPath = resolve(
  repositoryRoot,
  "node_modules",
  "@modelcontextprotocol",
  "sdk",
  "package.json",
);
const stagedDirectories = [
  "docs",
  "examples",
  "node_modules",
  "scripts",
  "src",
  "test",
] as const;
const stagedFiles = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE",
  "PROVENANCE.md",
  "README.md",
  "ROADMAP.md",
  "SECURITY.md",
  "SUPPORT.md",
  "npm-shrinkwrap.json",
  "package.json",
  "server.json",
  "tsconfig.json",
] as const;
const keepTarball = process.env.CIRCUITARIUM_KEEP_PACKAGE === "1";
let packageTarball: string | undefined;
let packageDirectory: string | undefined;
let packageVerified = false;
let consumerDirectory: string | undefined;
let stagingDirectory: string | undefined;

function runNpm(arguments_: string[], cwd: string): string {
  const npmEntrypoint = process.env.npm_execpath;
  if (!npmEntrypoint) {
    throw new Error("package verification must run through npm");
  }
  const result = spawnSync(process.execPath, [npmEntrypoint, ...arguments_], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_loglevel: "error",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ${arguments_.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function assertPackageImportsBlocked(consumerRoot: string): void {
  for (const specifier of [
    "circuitarium-mcp",
    "circuitarium-mcp/dist/src/bin.js",
    "circuitarium-mcp/dist/src/server.js",
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(specifier)});`,
      ],
      {
        cwd: consumerRoot,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    assert.notEqual(
      result.status,
      0,
      `${specifier} unexpectedly exposed a JavaScript package API`,
    );
    assert.match(
      result.stderr,
      /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
      `${specifier} failed for a reason other than the executable-only export map`,
    );
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} bytes)`;
}

function formatMilliseconds(milliseconds: number): string {
  return `${Math.round(milliseconds)} ms`;
}

function parseSdkManifest(
  content: Uint8Array,
  expectedHonoRange: string,
): SdkManifest {
  const manifest = JSON.parse(Buffer.from(content).toString("utf8")) as SdkManifest;
  assert.equal(manifest.name, "@modelcontextprotocol/sdk");
  assert.equal(manifest.version, SDK_VERSION);
  assert.equal(
    manifest.dependencies?.["@hono/node-server"],
    expectedHonoRange,
    "unexpected MCP SDK @hono/node-server dependency range",
  );
  return manifest;
}

function combineErrors(
  primary: unknown,
  secondary: unknown,
  message: string,
): unknown {
  return primary === undefined
    ? secondary
    : new AggregateError([primary, secondary], message);
}

async function packFromIsolatedStaging(
  stagingRoot: string,
  packDestination: string,
): Promise<string> {
  const sourceManifest = await readFile(sourceSdkManifestPath);
  parseSdkManifest(sourceManifest, UPSTREAM_HONO_RANGE);
  try {
    for (const directory of stagedDirectories) {
      await cp(resolve(repositoryRoot, directory), resolve(stagingRoot, directory), {
        errorOnExist: true,
        force: false,
        recursive: true,
      });
    }
    for (const file of stagedFiles) {
      await cp(resolve(repositoryRoot, file), resolve(stagingRoot, file), {
        errorOnExist: true,
        force: false,
      });
    }

    runNpm(["run", "build"], stagingRoot);
    const stagedSdkManifestPath = resolve(
      stagingRoot,
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
      "package.json",
    );
    const manifest = parseSdkManifest(
      await readFile(stagedSdkManifestPath),
      UPSTREAM_HONO_RANGE,
    );
    assert.ok(manifest.dependencies);
    manifest.dependencies["@hono/node-server"] = AUDITED_HONO_VERSION;
    await writeFile(
      stagedSdkManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    parseSdkManifest(
      await readFile(stagedSdkManifestPath),
      AUDITED_HONO_VERSION,
    );
    return runNpm(
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--silent",
        "--pack-destination",
        packDestination,
      ],
      stagingRoot,
    );
  } finally {
    const unchangedSourceManifest = await readFile(sourceSdkManifestPath);
    assert.equal(
      sha256(unchangedSourceManifest),
      sha256(sourceManifest),
      "isolated packaging changed the source MCP SDK manifest",
    );
  }
}

function assertSafeTarballPath(filename: string, directory: string): string {
  assert.match(filename, /^[a-z0-9][a-z0-9._-]*\.tgz$/i);
  const path = resolve(directory, filename);
  assert.equal(dirname(path), directory);
  return path;
}

function assertSafeTemporaryPath(path: string, expectedPrefix: string): void {
  const relativePath = relative(temporaryRoot, resolve(path));
  assert.ok(relativePath.length > 0 && !relativePath.startsWith(`..${sep}`));
  assert.ok(basename(path).startsWith(expectedPrefix));
}

function collectDependencyVersions(
  node: DependencyTree,
  dependencyName: string,
  versions: Set<string>,
): void {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    if (name === dependencyName && typeof dependency.version === "string") {
      versions.add(dependency.version);
    }
    collectDependencyVersions(dependency, dependencyName, versions);
  }
}

async function collectMarkdownFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const markdownFiles: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === "node_modules") {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      markdownFiles.push(...(await collectMarkdownFiles(root, path)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      markdownFiles.push(path);
    }
  }
  return markdownFiles;
}

async function assertMarkdownLinksResolve(installedRoot: string): Promise<void> {
  for (const markdownPath of await collectMarkdownFiles(installedRoot)) {
    const markdown = await readFile(markdownPath, "utf8");
    for (const match of markdown.matchAll(/\]\(([^)\n]+)\)/g)) {
      let reference = match[1]?.trim();
      if (!reference) {
        continue;
      }
      if (reference.startsWith("<") && reference.endsWith(">")) {
        reference = reference.slice(1, -1);
      }
      const referenceWithoutTitle = reference.split(/\s+["'(]/u, 1)[0];
      if (
        !referenceWithoutTitle ||
        referenceWithoutTitle.startsWith("#") ||
        /^[a-z][a-z+.-]*:/iu.test(referenceWithoutTitle)
      ) {
        continue;
      }
      const pathReference = referenceWithoutTitle.split(/[?#]/u, 1)[0];
      if (!pathReference) {
        continue;
      }
      const target = resolve(
        dirname(markdownPath),
        decodeURIComponent(pathReference),
      );
      const targetRelativeToPackage = relative(installedRoot, target);
      assert.ok(
        targetRelativeToPackage !== ".." &&
          !targetRelativeToPackage.startsWith(`..${sep}`),
        `${relative(installedRoot, markdownPath)} links outside the package: ${reference}`,
      );
      assert.equal(
        (await stat(target)).isFile(),
        true,
        `${relative(installedRoot, markdownPath)} has a broken package link: ${reference}`,
      );
    }
  }
}

function installedBinCommand(consumerRoot: string): {
  args: string[];
  command: string;
  shimPath: string;
} {
  const shimBase = resolve(
    consumerRoot,
    "node_modules",
    ".bin",
    "circuitarium-mcp",
  );
  const shimPath = process.platform === "win32" ? `${shimBase}.cmd` : shimBase;
  return { args: [], command: shimPath, shimPath };
}

function runInstalledPackageBin(arguments_: string[], cwd: string) {
  const npmEntrypoint = process.env.npm_execpath;
  if (!npmEntrypoint) {
    throw new Error("installed binary verification must run through npm");
  }
  const result = spawnSync(
    process.execPath,
    [
      npmEntrypoint,
      "exec",
      "--offline",
      "--",
      "circuitarium-mcp",
      ...arguments_,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_loglevel: "error",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: STARTUP_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  assert.equal(
    result.error,
    undefined,
    `installed binary failed to run: ${result.error?.message}`,
  );
  return result;
}

let verificationError: unknown;
try {
  stagingDirectory = await mkdtemp(
    join(temporaryRoot, "circuitarium-mcp-staging-"),
  );
  assertSafeTemporaryPath(stagingDirectory, "circuitarium-mcp-staging-");
  packageDirectory = await mkdtemp(
    join(temporaryRoot, "circuitarium-mcp-tarball-"),
  );
  assertSafeTemporaryPath(packageDirectory, "circuitarium-mcp-tarball-");
  const packOutput = await packFromIsolatedStaging(
    stagingDirectory,
    packageDirectory,
  );
  const results = JSON.parse(packOutput) as PackResult[];
  assert.equal(results.length, 1);
  const result = results[0];
  assert.ok(result);
  packageTarball = assertSafeTarballPath(result.filename, packageDirectory);
  assert.equal(result.name, "circuitarium-mcp");
  assert.ok(result.size > 0);
  assert.ok(
    result.size <= MAX_TARBALL_BYTES,
    `tarball ${result.size} bytes exceeds ${MAX_TARBALL_BYTES}-byte budget`,
  );
  assert.ok(
    result.unpackedSize <= MAX_UNPACKED_BYTES,
    `unpacked package ${result.unpackedSize} bytes exceeds ${MAX_UNPACKED_BYTES}-byte budget`,
  );
  assert.ok(
    result.files.length <= MAX_PACKAGE_FILES,
    `package has ${result.files.length} files; budget is ${MAX_PACKAGE_FILES}`,
  );

  const includedPaths = new Set(result.files.map((file) => file.path));
  for (const requiredPath of [
    "package.json",
    "server.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "CHANGELOG.md",
    "npm-shrinkwrap.json",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "ROADMAP.md",
    "PROVENANCE.md",
    "SECURITY.md",
    "SUPPORT.md",
    "docs/client-setup.md",
    "examples/model-host/minimal-system-prompt.txt",
    "dist/src/bin.js",
    "dist/src/server.js",
  ]) {
    assert.ok(includedPaths.has(requiredPath), `package omits ${requiredPath}`);
  }
  for (const path of includedPaths) {
    assert.doesNotMatch(
      path,
      /^(?:\.github|fixtures|scripts|src|test)(?:\/|$)|\.cru$/i,
      `package includes repository-only path ${path}`,
    );
    assert.doesNotMatch(
      path,
      /^node_modules\/(?:@biomejs|@types|tsx|typescript)(?:\/|$)/i,
      `package includes development dependency ${path}`,
    );
    assert.doesNotMatch(
      path,
      /^docs\/assets(?:\/|$)/i,
      `package includes repository-only media ${path}`,
    );
  }

  assert.equal((await stat(packageTarball)).isFile(), true);

  consumerDirectory = await mkdtemp(
    join(temporaryRoot, "circuitarium-mcp-consumer-"),
  );
  assertSafeTemporaryPath(consumerDirectory, "circuitarium-mcp-consumer-");
  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      packageTarball,
    ],
    consumerDirectory,
  );

  const installedRoot = resolve(
    consumerDirectory,
    "node_modules",
    "circuitarium-mcp",
  );
  const installedManifest = JSON.parse(
    await readFile(resolve(installedRoot, "package.json"), "utf8"),
  ) as PackageManifest;
  assert.equal(installedManifest.name, result.name);
  assert.equal(installedManifest.version, result.version);
  assert.equal(
    installedManifest.bin?.["circuitarium-mcp"],
    "dist/src/bin.js",
  );
  assert.deepEqual(
    installedManifest.exports,
    {},
    "the first public package must remain executable-only",
  );
  assert.equal(installedManifest.main, undefined);
  assert.equal(installedManifest.types, undefined);
  assert.equal(
    installedManifest.mcpName,
    "io.github.Craftiee/circuitarium",
  );
  const installedShrinkwrap = JSON.parse(
    await readFile(resolve(installedRoot, "npm-shrinkwrap.json"), "utf8"),
  ) as ShrinkwrapManifest;
  assert.equal(installedShrinkwrap.name, installedManifest.name);
  assert.equal(installedShrinkwrap.version, installedManifest.version);
  assert.equal(
    installedShrinkwrap.packages?.[""]?.name,
    installedManifest.name,
  );
  assert.equal(
    installedShrinkwrap.packages?.[""]?.version,
    installedManifest.version,
  );
  assert.equal(
    installedShrinkwrap.packages?.[""]?.bin?.["circuitarium-mcp"],
    installedManifest.bin?.["circuitarium-mcp"],
    "shrinkwrap root bin must match the package manifest",
  );
  assertPackageImportsBlocked(consumerDirectory);
  await assertMarkdownLinksResolve(installedRoot);
  runNpm(["ls", "--omit=dev", "--all"], consumerDirectory);
  const dependencyTree = JSON.parse(
    runNpm(["ls", "@hono/node-server", "--all", "--json"], consumerDirectory),
  ) as DependencyTree;
  const honoNodeServerVersions = new Set<string>();
  collectDependencyVersions(
    dependencyTree,
    "@hono/node-server",
    honoNodeServerVersions,
  );
  assert.deepEqual(
    [...honoNodeServerVersions],
    [AUDITED_HONO_VERSION],
    "published shrinkwrap must retain the audited Hono override",
  );
  runNpm(
    ["audit", "--omit=dev", "--audit-level=moderate"],
    consumerDirectory,
  );

  const installedServer = resolve(installedRoot, "dist", "src", "server.js");
  assert.equal((await stat(installedServer)).isFile(), true);
  const installedEntrypoint = resolve(installedRoot, "dist", "src", "bin.js");
  assert.equal((await stat(installedEntrypoint)).isFile(), true);
  const bin = installedBinCommand(consumerDirectory);
  assert.equal((await stat(bin.shimPath)).isFile(), true);
  const helpResult = runInstalledPackageBin(["--help"], consumerDirectory);
  assert.equal(helpResult.status, 0);
  assert.match(helpResult.stdout, /^Circuitarium MCP/u);
  assert.match(helpResult.stdout, /Usage:/u);
  assert.equal(helpResult.stderr, "");
  const versionResult = runInstalledPackageBin(
    ["--version"],
    consumerDirectory,
  );
  assert.equal(versionResult.status, 0);
  assert.equal(
    versionResult.stdout,
    `circuitarium-mcp ${result.version}\n`,
  );
  assert.equal(versionResult.stderr, "");
  const invalidResult = runInstalledPackageBin(
    ["--unknown"],
    consumerDirectory,
  );
  assert.equal(invalidResult.status, 2);
  assert.equal(invalidResult.stdout, "");
  assert.match(invalidResult.stderr, /Unsupported argument/u);
  assert.match(invalidResult.stderr, /--help/u);
  const transport = new StdioClientTransport({
    command: bin.command,
    args: bin.args,
    cwd: consumerDirectory,
    stderr: "pipe",
  });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    serverStderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  });
  const client = new Client({
    name: "circuitarium-package-smoke",
    version: "1.0.0",
  });
  let initializeMilliseconds = 0;
  let toolsListMilliseconds = 0;
  let toolCount = 0;
  try {
    const initializeStartedAt = performance.now();
    await withTimeout(
      client.connect(transport),
      STARTUP_TIMEOUT_MS,
      "MCP initialize",
    );
    initializeMilliseconds = performance.now() - initializeStartedAt;
    const toolsListStartedAt = performance.now();
    const tools = await withTimeout(
      client.listTools(),
      STARTUP_TIMEOUT_MS,
      "MCP tools/list",
    );
    toolsListMilliseconds = performance.now() - toolsListStartedAt;
    toolCount = tools.tools.length;
    assert.ok(
      tools.tools.some((tool) => tool.name === "electronics_capabilities"),
      "installed server does not expose electronics_capabilities",
    );
    assert.equal(
      toolCount,
      EXPECTED_TOOL_COUNT,
      "installed server exposes an unexpected tool count",
    );
    assert.equal(client.getServerVersion()?.version, result.version);
  } finally {
    await client.close();
  }
  assert.equal(
    serverStderr,
    "",
    `piped MCP launch wrote unexpected stderr: ${serverStderr}`,
  );

  if (keepTarball && process.env.GITHUB_OUTPUT) {
    assert.equal(isAbsolute(packageTarball), true);
    assert.equal((await stat(packageTarball)).isFile(), true);
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `tarball=${packageTarball}`,
        `tarball_bytes=${result.size}`,
        `unpacked_bytes=${result.unpackedSize}`,
        `file_count=${result.files.length}`,
        `initialize_ms=${Math.round(initializeMilliseconds)}`,
        `tools_list_ms=${Math.round(toolsListMilliseconds)}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
  packageVerified = true;
  process.stdout.write(
    [
      "Circuitarium package and startup audit: PASS",
      `  Tarball:       ${formatBytes(result.size)} / ${formatBytes(MAX_TARBALL_BYTES)}`,
      `  Unpacked:      ${formatBytes(result.unpackedSize)} / ${formatBytes(MAX_UNPACKED_BYTES)}`,
      `  Files:         ${result.files.length} / ${MAX_PACKAGE_FILES}`,
      `  MCP initialize ${formatMilliseconds(initializeMilliseconds)} / ${STARTUP_TIMEOUT_MS} ms timeout`,
      `  MCP tools/list ${formatMilliseconds(toolsListMilliseconds)} / ${STARTUP_TIMEOUT_MS} ms timeout`,
      `  Tools:         ${toolCount} / ${EXPECTED_TOOL_COUNT}`,
      "  Piped stderr:  clean",
      ...(keepTarball
        ? [`  Retained at:   ${packageTarball}`]
        : ["  Artifact:      verified in a temporary workspace, then cleaned"]),
      "",
    ].join("\n"),
  );
} catch (error) {
  verificationError = error;
}

let cleanupError: unknown;
if (consumerDirectory !== undefined) {
  try {
    assertSafeTemporaryPath(consumerDirectory, "circuitarium-mcp-consumer-");
    await rm(consumerDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupError = combineErrors(
      cleanupError,
      error,
      "Package verification could not clean its consumer workspace.",
    );
  }
}
if (stagingDirectory !== undefined) {
  try {
    assertSafeTemporaryPath(stagingDirectory, "circuitarium-mcp-staging-");
    await rm(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupError = combineErrors(
      cleanupError,
      error,
      "Package verification could not clean its isolated staging workspace.",
    );
  }
}
if (packageDirectory !== undefined && (!keepTarball || !packageVerified)) {
  try {
    assertSafeTemporaryPath(packageDirectory, "circuitarium-mcp-tarball-");
    await rm(packageDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupError = combineErrors(
      cleanupError,
      error,
      "Package verification could not clean its tarball workspace.",
    );
  }
}
const finalError =
  cleanupError === undefined
    ? verificationError
    : combineErrors(
        verificationError,
        cleanupError,
        "Package verification and cleanup both failed.",
      );
if (finalError !== undefined) {
  throw finalError;
}
