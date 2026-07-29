import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
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
import {
  KNOWLEDGE_PROMPT_NAMES,
  KNOWLEDGE_RESOURCE_URIS,
} from "../src/domain/knowledge.js";

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
  author?: {
    name?: string;
    url?: string;
  };
  bin?: Record<string, string>;
  bundleDependencies?: string[];
  dependencies?: Record<string, string>;
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

interface ShrinkwrapManifest {
  name?: unknown;
  packages?: Record<
    string,
    {
      bin?: Record<string, string>;
      bundleDependencies?: unknown;
      dependencies?: Record<string, string>;
      name?: unknown;
      version?: unknown;
    }
  >;
  version?: unknown;
}

interface Envelope {
  context?: {
    projectDigest?: string;
  };
  contractVersion?: string;
  data?: {
    circuitName?: string;
    kind?: string;
    planVersion?: string;
    project?: {
      ref?: string;
    };
    provenance?: {
      simulationPerformed?: boolean;
    };
    resolvedNet?: {
      counts?: {
        terminals?: number;
      };
    };
    root?: {
      componentId?: string;
      terminalIndex?: number;
    };
    runtime?: {
      authenticity?: string;
      version?: string;
    };
    runtimeSafety?: {
      safe?: boolean;
    };
    totalWithSubcircuits?: {
      recursiveCount?: number;
      uniqueCount?: number;
    };
    traceVersion?: string;
  };
  ok?: boolean;
}

interface DoctorReport {
  checks?: Array<{
    id?: string;
    status?: string;
  }>;
  ok?: boolean;
  schemaVersion?: string;
  smoke?: {
    cleaned?: boolean;
  };
}

const SDK_VERSION = "1.30.0";
const AUDITED_HONO_VERSION = "2.0.12";
const EXPECTED_TOOL_COUNT = 22;
const MAX_TARBALL_BYTES = 1024 * 1024;
const MAX_UNPACKED_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_FILES = 250;
const MAX_INSTALLED_BYTES = 25 * 1024 * 1024;
const MAX_INSTALLED_FILES = 5_000;
const STARTUP_TIMEOUT_MS = 10_000;
const LOGISIM_SMOKE_TIMEOUT_MS = 30_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = resolve(tmpdir());
const configuredLogisimJarSetting =
  process.env.CIRCUITARIUM_LOGISIM_JAR?.trim();
const configuredLogisimJar =
  configuredLogisimJarSetting === undefined ||
  configuredLogisimJarSetting.length === 0
    ? undefined
    : resolve(repositoryRoot, configuredLogisimJarSetting);
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
  "CITATION.cff",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE",
  "PRIVACY.md",
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

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} bytes)`;
}

function formatMilliseconds(milliseconds: number): string {
  return `${Math.round(milliseconds)} ms`;
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
  for (const directory of stagedDirectories) {
    await cp(
      resolve(repositoryRoot, directory),
      resolve(stagingRoot, directory),
      {
        errorOnExist: true,
        force: false,
        recursive: true,
      },
    );
  }
  for (const file of stagedFiles) {
    await cp(resolve(repositoryRoot, file), resolve(stagingRoot, file), {
      errorOnExist: true,
      force: false,
    });
  }

  runNpm(["run", "build"], stagingRoot);
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

function countDependencyNodes(node: DependencyTree): number {
  return Object.values(node.dependencies ?? {}).reduce(
    (count, dependency) => count + 1 + countDependencyNodes(dependency),
    0,
  );
}

async function measureFileTree(
  directory: string,
): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await measureFileTree(path);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += (await stat(path)).size;
      files += 1;
    }
  }
  return { bytes, files };
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

async function assertMarkdownLinksResolve(
  installedRoot: string,
): Promise<void> {
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

function normalizedEnvironment(
  additions: Record<string, string>,
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return { ...environment, ...additions };
}

function envelopeOf(result: unknown): Envelope {
  const record = result as { structuredContent?: unknown };
  assert.ok(record.structuredContent);
  return record.structuredContent as Envelope;
}

function runInstalledPackageBin(
  arguments_: string[],
  cwd: string,
  timeout = STARTUP_TIMEOUT_MS,
) {
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
        CIRCUITARIUM_LOGISIM_JAR: "",
        LOGISIM_JAR: "",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_loglevel: "error",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout,
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
    "PRIVACY.md",
    "CITATION.cff",
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
    "examples/logisim/full-adder.circ",
    "examples/logisim/full-adder.vec",
    "examples/verification/full-adder-plan.json",
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
      /^node_modules(?:\/|$)/i,
      `package embeds dependency file ${path}; npm must install the shrinkwrapped production tree instead`,
    );
    assert.doesNotMatch(
      path,
      /^docs\/assets(?:\/|$)/i,
      `package includes repository-only media ${path}`,
    );
    assert.doesNotMatch(
      path,
      /\.d\.ts(?:\.map)?$/i,
      `binary-only package exposes a declaration artifact ${path}`,
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
  assert.deepEqual(installedManifest.author, {
    name: "Craftiee",
    url: "https://github.com/Craftiee",
  });
  assert.equal(installedManifest.bin?.["circuitarium-mcp"], "dist/src/bin.js");
  assert.equal(installedManifest.bundleDependencies, undefined);
  assert.equal(
    installedManifest.dependencies?.["@modelcontextprotocol/sdk"],
    SDK_VERSION,
  );
  assert.deepEqual(
    installedManifest.exports,
    {},
    "the public package must remain executable-only",
  );
  assert.equal(installedManifest.main, undefined);
  assert.equal(installedManifest.types, undefined);
  assert.equal(installedManifest.mcpName, "io.github.Craftiee/circuitarium");
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
  assert.equal(
    installedShrinkwrap.packages?.[""]?.bundleDependencies,
    undefined,
    "shrinkwrap must not reintroduce embedded dependencies",
  );
  assert.equal(
    installedShrinkwrap.packages?.[""]?.dependencies?.[
      "@modelcontextprotocol/sdk"
    ],
    SDK_VERSION,
  );
  assertPackageImportsBlocked(consumerDirectory);
  await assertMarkdownLinksResolve(installedRoot);
  const productionDependencyTree = JSON.parse(
    runNpm(["ls", "--omit=dev", "--all", "--json"], consumerDirectory),
  ) as DependencyTree;
  const productionDependencyNodes = countDependencyNodes(
    productionDependencyTree,
  );
  const installedFootprint = await measureFileTree(
    resolve(consumerDirectory, "node_modules"),
  );
  assert.ok(
    installedFootprint.bytes <= MAX_INSTALLED_BYTES,
    `installed production tree ${installedFootprint.bytes} bytes exceeds ${MAX_INSTALLED_BYTES}-byte budget`,
  );
  assert.ok(
    installedFootprint.files <= MAX_INSTALLED_FILES,
    `installed production tree has ${installedFootprint.files} files; budget is ${MAX_INSTALLED_FILES}`,
  );
  const honoNodeServerVersions = new Set<string>();
  collectDependencyVersions(
    productionDependencyTree,
    "@hono/node-server",
    honoNodeServerVersions,
  );
  assert.deepEqual(
    [...honoNodeServerVersions],
    [AUDITED_HONO_VERSION],
    "published shrinkwrap must retain the audited Hono override",
  );
  runNpm(["audit", "--omit=dev", "--audit-level=moderate"], consumerDirectory);

  const installedServer = resolve(installedRoot, "dist", "src", "server.js");
  assert.equal((await stat(installedServer)).isFile(), true);
  const installedEntrypoint = resolve(installedRoot, "dist", "src", "bin.js");
  assert.equal((await stat(installedEntrypoint)).isFile(), true);
  const installedLogisimProject = resolve(
    installedRoot,
    "examples",
    "logisim",
    "full-adder.circ",
  );
  const installedLogisimVector = resolve(
    installedRoot,
    "examples",
    "logisim",
    "full-adder.vec",
  );
  assert.equal((await stat(installedLogisimProject)).isFile(), true);
  assert.equal((await stat(installedLogisimVector)).isFile(), true);
  if (configuredLogisimJar !== undefined) {
    assert.equal(
      (await stat(configuredLogisimJar)).isFile(),
      true,
      "CIRCUITARIUM_LOGISIM_JAR must identify a readable file",
    );
  }
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
  assert.equal(versionResult.stdout, `circuitarium-mcp ${result.version}\n`);
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
    env: normalizedEnvironment({
      CIRCUITARIUM_MCP_ROOT: installedRoot,
      CIRCUITARIUM_LOGISIM_JAR: configuredLogisimJar ?? "",
      LOGISIM_JAR: "",
    }),
    stderr: "pipe",
  });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    serverStderr += Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
  });
  const client = new Client({
    name: "circuitarium-package-smoke",
    version: "1.0.0",
  });
  let initializeMilliseconds = 0;
  let warmInitializeMilliseconds = 0;
  let toolsListMilliseconds = 0;
  let toolCount = 0;
  let resourceCount = 0;
  let promptCount = 0;
  let logisimRuntimeVerified = false;
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
    const resources = await withTimeout(
      client.listResources(),
      STARTUP_TIMEOUT_MS,
      "MCP resources/list",
    );
    resourceCount = resources.resources.length;
    assert.deepEqual(
      resources.resources.map((resource) => resource.uri),
      [...KNOWLEDGE_RESOURCE_URIS],
      "installed server exposes an unexpected knowledge resource surface",
    );
    const prompts = await withTimeout(
      client.listPrompts(),
      STARTUP_TIMEOUT_MS,
      "MCP prompts/list",
    );
    promptCount = prompts.prompts.length;
    assert.deepEqual(
      prompts.prompts.map((prompt) => prompt.name),
      [...KNOWLEDGE_PROMPT_NAMES],
      "installed server exposes an unexpected prompt surface",
    );
    const knowledge = await withTimeout(
      client.readResource({ uri: "circuitarium://capabilities" }),
      STARTUP_TIMEOUT_MS,
      "MCP resources/read",
    );
    assert.equal(knowledge.contents.length, 1);
    assert.equal(knowledge.contents[0]?.mimeType, "application/json");
    const standardLibraryCatalog = await withTimeout(
      client.readResource({
        uri: "circuitarium://catalogs/logisim-evolution/4.1.0/standard-library",
      }),
      STARTUP_TIMEOUT_MS,
      "MCP standard-library resource read",
    );
    assert.equal(
      standardLibraryCatalog.contents[0]?.mimeType,
      "application/json",
    );
    const componentProfileSchema = await withTimeout(
      client.readResource({
        uri: "circuitarium://schemas/component-profile/0.1",
      }),
      STARTUP_TIMEOUT_MS,
      "MCP component-profile schema resource read",
    );
    assert.equal(componentProfileSchema.contents.length, 1);
    const componentProfileSchemaContent = componentProfileSchema.contents[0];
    assert.equal(componentProfileSchemaContent?.mimeType, "application/json");
    assert.ok(
      componentProfileSchemaContent !== undefined &&
        "text" in componentProfileSchemaContent,
      "component-profile schema resource must contain JSON text",
    );
    const componentProfileSchemaPayload = JSON.parse(
      componentProfileSchemaContent.text,
    ) as {
      profileCount?: number;
      profileVersion?: string;
      schemaVersion?: string;
      semanticConstraints?: unknown[];
      validationBoundary?: string;
    };
    assert.equal(
      componentProfileSchemaPayload.schemaVersion,
      "circuitarium.schema-resource/0.1",
    );
    assert.equal(
      componentProfileSchemaPayload.profileVersion,
      "electronics.component-profile/0.1",
    );
    assert.equal(componentProfileSchemaPayload.profileCount, 11);
    assert.equal(componentProfileSchemaPayload.semanticConstraints?.length, 7);
    assert.match(
      componentProfileSchemaPayload.validationBoundary ?? "",
      /also enforce semanticConstraints/u,
    );
    const reviewPrompt = await withTimeout(
      client.getPrompt({
        name: "review-circuit-design",
        arguments: {
          backend: "logisim.evolution",
          projectRef: "examples/logisim/full-adder.circ",
          circuit: "Main",
        },
      }),
      STARTUP_TIMEOUT_MS,
      "MCP prompts/get",
    );
    assert.match(
      reviewPrompt.description ?? "",
      /Circuitarium circuit artifact/u,
    );
    assert.equal(client.getServerVersion()?.version, result.version);

    const planResult = await withTimeout(
      client.callTool({
        name: "electronics_plan_verification",
        arguments: {
          target: {
            backendId: "logisim.evolution",
            projectRef: "examples/logisim/full-adder.circ",
            circuit: "Main",
          },
          claims: [
            {
              id: "package-smoke",
              claimClass: "combinational-behavior",
              objective: "characterize",
              scope: "selected-circuit",
            },
          ],
        },
      }),
      STARTUP_TIMEOUT_MS,
      "packaged MCP electronics_plan_verification",
    );
    const planEnvelope = envelopeOf(planResult);
    assert.equal(planResult.isError ?? false, false);
    assert.equal(
      planEnvelope.data?.planVersion,
      "electronics.verification-plan/0.1",
    );

    const generatedCrumbRef = "release-audit/synthetic-led.cru";
    const generationResult = await withTimeout(
      client.callTool({
        name: "crumb_generate_fixture",
        arguments: {
          kind: "breadboard-led",
          outputPath: generatedCrumbRef,
        },
      }),
      STARTUP_TIMEOUT_MS,
      "packaged MCP crumb_generate_fixture",
    );
    assert.equal(generationResult.isError ?? false, false);
    const generationEnvelope = envelopeOf(generationResult);
    assert.equal(generationEnvelope.data?.kind, "breadboard-led");
    assert.match(
      generationEnvelope.context?.projectDigest ?? "",
      /^sha256:[0-9a-f]{64}$/u,
    );
    const traceResult = await withTimeout(
      client.callTool({
        name: "crumb_trace_net",
        arguments: {
          path: generatedCrumbRef,
          expectedProjectDigest: generationEnvelope.context?.projectDigest,
          componentId: "3d43171c-bf55-44f9-9e95-dfa7cdd8ed38",
          terminalIndex: 0,
        },
      }),
      STARTUP_TIMEOUT_MS,
      "packaged MCP crumb_trace_net",
    );
    assert.equal(traceResult.isError ?? false, false);
    const traceEnvelope = envelopeOf(traceResult);
    assert.equal(traceEnvelope.data?.traceVersion, "crumb.net-trace/0.1");
    assert.equal(
      traceEnvelope.data?.root?.componentId,
      "3d43171c-bf55-44f9-9e95-dfa7cdd8ed38",
    );
    assert.equal(traceEnvelope.data?.root?.terminalIndex, 0);
    assert.ok((traceEnvelope.data?.resolvedNet?.counts?.terminals ?? 0) >= 1);
    assert.equal(traceEnvelope.data?.provenance?.simulationPerformed, false);

    const analyzeResult = await withTimeout(
      client.callTool({
        name: "logisim_analyze_design",
        arguments: { path: "examples/logisim/full-adder.circ" },
      }),
      STARTUP_TIMEOUT_MS,
      "packaged MCP logisim_analyze_design",
    );
    assert.equal(analyzeResult.isError ?? false, false);
    const analyzeEnvelope = envelopeOf(analyzeResult);
    assert.equal(analyzeEnvelope.contractVersion, "electronics.mcp/0.2");
    assert.equal(analyzeEnvelope.ok, true);
    assert.equal(
      analyzeEnvelope.data?.project?.ref,
      "examples/logisim/full-adder.circ",
    );
    assert.equal(analyzeEnvelope.data?.runtimeSafety?.safe, true);

    if (configuredLogisimJar !== undefined) {
      const statisticsResult = await withTimeout(
        client.callTool({
          name: "logisim_component_stats",
          arguments: {
            path: "examples/logisim/full-adder.circ",
            circuit: "Main",
            expectedProjectDigest: analyzeEnvelope.context?.projectDigest,
            timeoutMs: LOGISIM_SMOKE_TIMEOUT_MS,
          },
        }),
        LOGISIM_SMOKE_TIMEOUT_MS + STARTUP_TIMEOUT_MS,
        "packaged MCP logisim_component_stats",
      );
      assert.equal(statisticsResult.isError ?? false, false);
      const statisticsEnvelope = envelopeOf(statisticsResult);
      assert.equal(statisticsEnvelope.contractVersion, "electronics.mcp/0.2");
      assert.equal(statisticsEnvelope.ok, true);
      assert.equal(statisticsEnvelope.data?.circuitName, "Main");
      assert.deepEqual(statisticsEnvelope.data?.totalWithSubcircuits, {
        uniqueCount: 26,
        recursiveCount: 26,
      });
      assert.equal(statisticsEnvelope.data?.runtime?.version, "4.1.0");
      assert.equal(
        statisticsEnvelope.data?.runtime?.authenticity,
        "self-reported-unverified",
      );
      logisimRuntimeVerified = true;
    }
  } finally {
    await client.close();
  }
  assert.equal(
    serverStderr,
    "",
    `piped MCP launch wrote unexpected stderr: ${serverStderr}`,
  );

  const warmTransport = new StdioClientTransport({
    command: bin.command,
    args: bin.args,
    cwd: consumerDirectory,
    env: normalizedEnvironment({
      CIRCUITARIUM_MCP_ROOT: installedRoot,
      CIRCUITARIUM_LOGISIM_JAR: "",
      LOGISIM_JAR: "",
    }),
    stderr: "pipe",
  });
  let warmServerStderr = "";
  warmTransport.stderr?.on("data", (chunk: unknown) => {
    warmServerStderr += Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
  });
  const warmClient = new Client({
    name: "circuitarium-package-warm-startup",
    version: "1.0.0",
  });
  try {
    const warmInitializeStartedAt = performance.now();
    await withTimeout(
      warmClient.connect(warmTransport),
      STARTUP_TIMEOUT_MS,
      "warm MCP initialize",
    );
    warmInitializeMilliseconds =
      performance.now() - warmInitializeStartedAt;
    const warmTools = await withTimeout(
      warmClient.listTools(),
      STARTUP_TIMEOUT_MS,
      "warm MCP tools/list",
    );
    assert.equal(warmTools.tools.length, EXPECTED_TOOL_COUNT);
  } finally {
    await warmClient.close();
  }
  assert.equal(
    warmServerStderr,
    "",
    `warm piped MCP launch wrote unexpected stderr: ${warmServerStderr}`,
  );

  const doctorResult = runInstalledPackageBin(["doctor"], consumerDirectory);
  assert.equal(doctorResult.status, 0);
  assert.match(
    doctorResult.stdout,
    new RegExp(`Registered tools: ${EXPECTED_TOOL_COUNT}`, "u"),
  );
  assert.match(doctorResult.stdout, /optional, not configured/u);
  assert.equal(doctorResult.stderr, "");

  const smokeDoctorResult = runInstalledPackageBin(
    ["doctor", "--smoke", "--json"],
    consumerDirectory,
    30_000,
  );
  assert.equal(smokeDoctorResult.status, 0);
  assert.equal(smokeDoctorResult.stderr, "");
  const doctorReport = JSON.parse(smokeDoctorResult.stdout) as DoctorReport;
  assert.equal(doctorReport.schemaVersion, "circuitarium.doctor/0.1");
  assert.equal(doctorReport.ok, true);
  assert.equal(doctorReport.smoke?.cleaned, true);
  const doctorCheckStatus = new Map(
    (doctorReport.checks ?? []).map((check) => [check.id, check.status]),
  );
  for (const checkId of [
    "stdio-startup",
    "tools-list",
    "crumb-analyze",
    "crumb-erc",
    "smoke-cleanup",
  ]) {
    assert.equal(
      doctorCheckStatus.get(checkId),
      "pass",
      `packaged doctor check ${checkId} must pass`,
    );
  }

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
        `installed_bytes=${installedFootprint.bytes}`,
        `installed_file_count=${installedFootprint.files}`,
        `production_dependency_nodes=${productionDependencyNodes}`,
        `initialize_ms=${Math.round(initializeMilliseconds)}`,
        `warm_initialize_ms=${Math.round(warmInitializeMilliseconds)}`,
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
      `  Installed:     ${formatBytes(installedFootprint.bytes)} in ${installedFootprint.files} file(s)`,
      `  Prod deps:     ${productionDependencyNodes} installed dependency node(s)`,
      `  MCP cold init: ${formatMilliseconds(initializeMilliseconds)} / ${STARTUP_TIMEOUT_MS} ms timeout`,
      `  MCP warm init: ${formatMilliseconds(warmInitializeMilliseconds)} / ${STARTUP_TIMEOUT_MS} ms timeout`,
      `  MCP tools/list ${formatMilliseconds(toolsListMilliseconds)} / ${STARTUP_TIMEOUT_MS} ms timeout`,
      `  Tools:         ${toolCount} / ${EXPECTED_TOOL_COUNT}`,
      `  Resources:     ${resourceCount} / ${KNOWLEDGE_RESOURCE_URIS.length}`,
      `  Prompts:       ${promptCount} / ${KNOWLEDGE_PROMPT_NAMES.length}`,
      `  Logisim:       ${
        logisimRuntimeVerified
          ? "packaged static + 4.1.0 self-reported JAR smoke passed"
          : "packaged static smoke passed; optional JAR not configured"
      }`,
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
