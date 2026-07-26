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
  exports?: {
    "."?: {
      import?: string;
      types?: string;
    };
    "./package.json"?: string;
  };
  name?: string;
  types?: string;
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

const SDK_VERSION = "1.29.0";
const UPSTREAM_HONO_RANGE = "^1.19.9";
const AUDITED_HONO_VERSION = "2.0.11";
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

function runNode(arguments_: string[], cwd: string): string {
  const result = spawnSync(process.execPath, arguments_, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `node ${arguments_.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
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
  assert.ok(result.size < 5 * 1024 * 1024);
  assert.ok(result.unpackedSize < 24 * 1024 * 1024);
  assert.ok(result.files.length < 5_000);

  const includedPaths = new Set(result.files.map((file) => file.path));
  for (const requiredPath of [
    "package.json",
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
    "dist/src/server.js",
  );
  assert.deepEqual(installedManifest.exports?.["."], {
    types: "./dist/src/server.d.ts",
    import: "./dist/src/server.js",
  });
  assert.equal(
    installedManifest.exports?.["./package.json"],
    "./package.json",
  );
  assert.equal(installedManifest.types, "./dist/src/server.d.ts");
  assert.equal(
    runNode(
      [
        "--input-type=module",
        "--eval",
        [
          'import { listRegisteredToolNames } from "circuitarium-mcp";',
          "process.stdout.write(String(listRegisteredToolNames().length));",
        ].join(""),
      ],
      consumerDirectory,
    ),
    "13",
    "installed package import must expose 13 tools without starting stdio",
  );
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
  const bin = installedBinCommand(consumerDirectory);
  assert.equal((await stat(bin.shimPath)).isFile(), true);
  const transport = new StdioClientTransport({
    command: bin.command,
    args: bin.args,
    cwd: consumerDirectory,
    stderr: "pipe",
  });
  const client = new Client({
    name: "circuitarium-package-smoke",
    version: "1.0.0",
  });
  try {
    await withTimeout(client.connect(transport), 10_000, "MCP initialize");
    const tools = await withTimeout(client.listTools(), 10_000, "MCP tools/list");
    assert.ok(
      tools.tools.some((tool) => tool.name === "electronics_capabilities"),
      "installed server does not expose electronics_capabilities",
    );
    assert.equal(client.getServerVersion()?.version, result.version);
  } finally {
    await client.close();
  }

  if (keepTarball && process.env.GITHUB_OUTPUT) {
    assert.equal(isAbsolute(packageTarball), true);
    assert.equal((await stat(packageTarball)).isFile(), true);
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `tarball=${packageTarball}\n`,
      "utf8",
    );
  }
  packageVerified = true;
  process.stdout.write(
    `Verified ${packageTarball}: ${result.files.length} files, ${result.unpackedSize} unpacked bytes, installed MCP bin handshake passed.\n`,
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
