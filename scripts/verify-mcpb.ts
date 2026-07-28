import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

interface PackageManifest {
	name?: string;
	version?: string;
}

interface BundleManifest {
	manifest_version?: string;
	name?: string;
	server?: {
		entry_point?: string;
		mcp_config?: {
			args?: string[];
			command?: string;
			env?: Record<string, string>;
		};
		type?: string;
	};
	version?: string;
}

interface Envelope {
	contractVersion?: string;
	context?: {
		projectDigest?: string;
	};
	data?: {
		circuitName?: string;
		project?: {
			ref?: string;
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
		valid?: boolean;
	};
	ok?: boolean;
}

const MCPB_PACKAGE = "@anthropic-ai/mcpb@2.1.2";
const EXPECTED_TOOL_COUNT = 20;
const BUNDLE_ENTRY_ARGUMENT = "$" + "{__dirname}/server/dist/src/server.js";
const WORKSPACE_CONFIG_REFERENCE = "$" + "{user_config.workspace}";
const LOGISIM_JAR_CONFIG_REFERENCE = "$" + "{user_config.logisim_jar}";
const JAVA_CONFIG_REFERENCE = "$" + "{user_config.java}";
const LOGISIM_SMOKE_TIMEOUT_MS = 30_000;
const SEMVER_PATTERN =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = resolve(tmpdir());
const configuredLogisimJarSetting =
	process.env.CIRCUITARIUM_LOGISIM_JAR?.trim();
const configuredLogisimJar =
	configuredLogisimJarSetting === undefined ||
	configuredLogisimJarSetting.length === 0
		? undefined
		: resolve(repositoryRoot, configuredLogisimJarSetting);
const keepBundle = process.env.CIRCUITARIUM_KEEP_MCPB === "1";
const suppliedPackageTarball = process.env.CIRCUITARIUM_PACKAGE_TARBALL;

let bundleDirectory: string | undefined;
let bundlePath: string | undefined;
let packageOutputFile: string | undefined;
let packageTarball: string | undefined;
let packageTarballOwned = false;
let unpackDirectory: string | undefined;
let workspaceDirectory: string | undefined;
let verified = false;

function run(
	command: string,
	arguments_: string[],
	cwd: string,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const result = spawnSync(command, arguments_, {
		cwd,
		encoding: "utf8",
		env: environment,
		maxBuffer: 32 * 1024 * 1024,
		shell: false,
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${arguments_.join(" ")} failed:\n${
				result.stderr || result.stdout
			}`,
		);
	}
	return result.stdout;
}

function runNpm(
	arguments_: string[],
	cwd: string,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const npmEntrypoint = process.env.npm_execpath;
	if (!npmEntrypoint) {
		throw new Error("MCPB verification must run through npm");
	}
	return run(process.execPath, [npmEntrypoint, ...arguments_], cwd, {
		...environment,
		npm_config_audit: "false",
		npm_config_fund: "false",
		npm_config_loglevel: "error",
	});
}

function runMcpb(arguments_: string[], cwd: string): string {
	return runNpm(
		["exec", "--yes", `--package=${MCPB_PACKAGE}`, "--", "mcpb", ...arguments_],
		cwd,
	);
}

function assertSafeTemporaryPath(path: string, expectedPrefix: string): void {
	const resolved = resolve(path);
	const relativePath = relative(temporaryRoot, resolved);
	assert.ok(relativePath.length > 0 && !relativePath.startsWith(`..${sep}`));
	assert.ok(basename(resolved).startsWith(expectedPrefix));
}

function assertValidSemVer(version: string, label: string): void {
	assert.match(version, SEMVER_PATTERN, `${label} must be valid SemVer`);
}

function assertSemVerValidationCases(): void {
	for (const valid of [
		"0.3.0",
		"0.3.0-rc.1",
		"1.2.3-alpha",
		"1.2.3-alpha.1+build.5",
	]) {
		assertValidSemVer(valid, `SemVer validation fixture ${valid}`);
	}
	for (const invalid of [
		"v1.2.3",
		"1.2",
		"01.2.3",
		"1.2.3-01",
		"1.2.3-",
	]) {
		assert.doesNotMatch(
			invalid,
			SEMVER_PATTERN,
			`invalid SemVer validation fixture ${invalid} was accepted`,
		);
	}
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

async function locateVerifiedPackageTarball(): Promise<string> {
	if (suppliedPackageTarball !== undefined) {
		assert.equal(
			isAbsolute(suppliedPackageTarball),
			true,
			"CIRCUITARIUM_PACKAGE_TARBALL must be absolute",
		);
		const supplied = resolve(suppliedPackageTarball);
		assert.equal((await stat(supplied)).isFile(), true);
		assert.match(supplied, /\.tgz$/i);
		return supplied;
	}

	packageOutputFile = join(
		await mkdtemp(join(temporaryRoot, "circuitarium-mcp-package-output-")),
		"github-output.txt",
	);
	assertSafeTemporaryPath(
		dirname(packageOutputFile),
		"circuitarium-mcp-package-output-",
	);
	runNpm(["run", "package:check"], repositoryRoot, {
		...process.env,
		CIRCUITARIUM_KEEP_PACKAGE: "1",
		GITHUB_OUTPUT: packageOutputFile,
	});
	const output = await readFile(packageOutputFile, "utf8");
	const values = output
		.split(/\r?\n/u)
		.filter((line) => line.startsWith("tarball="))
		.map((line) => line.slice("tarball=".length));
	assert.equal(values.length, 1, "package verifier did not expose one tarball");
	const generated = resolve(values[0] ?? "");
	assert.equal(isAbsolute(generated), true);
	assert.equal((await stat(generated)).isFile(), true);
	assert.match(generated, /\.tgz$/i);
	assertSafeTemporaryPath(dirname(generated), "circuitarium-mcp-tarball-");
	packageTarballOwned = true;
	return generated;
}

function envelopeOf(result: unknown): Envelope {
	const record = result as { structuredContent?: unknown };
	assert.ok(record.structuredContent);
	return record.structuredContent as Envelope;
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

let verificationError: unknown;
try {
	assertSemVerValidationCases();
	const packageManifest = JSON.parse(
		await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
	) as PackageManifest;
	assert.equal(packageManifest.name, "circuitarium-mcp");
	assertValidSemVer(packageManifest.version ?? "", "package version");

	const sourceBundleManifestPath = resolve(
		repositoryRoot,
		"mcpb",
		"manifest.json",
	);
	const sourceBundleManifest = JSON.parse(
		await readFile(sourceBundleManifestPath, "utf8"),
	) as BundleManifest;
	assert.equal(sourceBundleManifest.manifest_version, "0.3");
	assert.equal(sourceBundleManifest.name, packageManifest.name);
	assert.equal(sourceBundleManifest.version, packageManifest.version);
	assertValidSemVer(
		sourceBundleManifest.version ?? "",
		"MCPB manifest version",
	);
	assert.equal(sourceBundleManifest.server?.type, "node");
	assert.equal(
		sourceBundleManifest.server?.entry_point,
		"server/dist/src/server.js",
	);
	assert.equal(sourceBundleManifest.server?.mcp_config?.command, "node");
	assert.deepEqual(sourceBundleManifest.server?.mcp_config?.args, [
		BUNDLE_ENTRY_ARGUMENT,
	]);
	assert.equal(
		sourceBundleManifest.server?.mcp_config?.env?.CIRCUITARIUM_MCP_ROOT,
		WORKSPACE_CONFIG_REFERENCE,
	);
	assert.equal(
		sourceBundleManifest.server?.mcp_config?.env?.CIRCUITARIUM_LOGISIM_JAR,
		LOGISIM_JAR_CONFIG_REFERENCE,
	);
	assert.equal(
		sourceBundleManifest.server?.mcp_config?.env?.CIRCUITARIUM_JAVA,
		JAVA_CONFIG_REFERENCE,
	);

	packageTarball = await locateVerifiedPackageTarball();
	bundleDirectory = await mkdtemp(
		join(temporaryRoot, "circuitarium-mcp-bundle-"),
	);
	assertSafeTemporaryPath(bundleDirectory, "circuitarium-mcp-bundle-");
	const stagingRoot = resolve(bundleDirectory, "staging");
	const consumerRoot = resolve(bundleDirectory, "consumer");

	runNpm(
		[
			"install",
			"--ignore-scripts",
			"--omit=dev",
			"--no-audit",
			"--no-fund",
			"--prefix",
			consumerRoot,
			packageTarball,
		],
		bundleDirectory,
	);

	const installedRoot = resolve(
		consumerRoot,
		"node_modules",
		"circuitarium-mcp",
	);
	assert.equal(
		(await stat(resolve(installedRoot, "dist", "src", "server.js"))).isFile(),
		true,
	);
	await cp(sourceBundleManifestPath, resolve(stagingRoot, "manifest.json"), {
		recursive: false,
	});
	await cp(installedRoot, resolve(stagingRoot, "server"), {
		recursive: true,
	});

	runNpm(
		["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"],
		resolve(stagingRoot, "server"),
	);

	runMcpb(["validate", resolve(stagingRoot, "manifest.json")], repositoryRoot);
	bundlePath = resolve(
		bundleDirectory,
		`circuitarium-mcp-${packageManifest.version}.mcpb`,
	);
	runMcpb(["pack", stagingRoot, bundlePath], repositoryRoot);
	assert.equal((await stat(bundlePath)).isFile(), true);
	assert.ok((await stat(bundlePath)).size > 0);
	assert.ok((await stat(bundlePath)).size < 24 * 1024 * 1024);
	runMcpb(["info", bundlePath], repositoryRoot);

	unpackDirectory = await mkdtemp(
		join(temporaryRoot, "circuitarium-mcp-unpacked-"),
	);
	assertSafeTemporaryPath(unpackDirectory, "circuitarium-mcp-unpacked-");
	runMcpb(["unpack", bundlePath, unpackDirectory], repositoryRoot);

	const unpackedServer = resolve(
		unpackDirectory,
		"server",
		"dist",
		"src",
		"server.js",
	);
	assert.equal((await stat(unpackedServer)).isFile(), true);
	const unpackedLogisimProject = resolve(
		unpackDirectory,
		"server",
		"examples",
		"logisim",
		"full-adder.circ",
	);
	const unpackedLogisimVector = resolve(
		unpackDirectory,
		"server",
		"examples",
		"logisim",
		"full-adder.vec",
	);
	assert.equal((await stat(unpackedLogisimProject)).isFile(), true);
	assert.equal((await stat(unpackedLogisimVector)).isFile(), true);
	if (configuredLogisimJar !== undefined) {
		assert.equal(
			(await stat(configuredLogisimJar)).isFile(),
			true,
			"CIRCUITARIUM_LOGISIM_JAR must identify a readable file",
		);
	}
	assert.equal(
		(
			await stat(
				resolve(
					unpackDirectory,
					"server",
					"node_modules",
					"@modelcontextprotocol",
					"sdk",
					"package.json",
				),
			)
		).isFile(),
		true,
	);

	workspaceDirectory = await mkdtemp(
		join(temporaryRoot, "circuitarium-mcp-mcpb-workspace-"),
	);
	assertSafeTemporaryPath(
		workspaceDirectory,
		"circuitarium-mcp-mcpb-workspace-",
	);
	await cp(
		resolve(repositoryRoot, "fixtures", "crumb", "breadboard-led.cru"),
		resolve(workspaceDirectory, "synthetic-led.cru"),
	);
	await cp(
		unpackedLogisimProject,
		resolve(workspaceDirectory, "full-adder.circ"),
	);
	await cp(
		unpackedLogisimVector,
		resolve(workspaceDirectory, "full-adder.vec"),
	);

	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [unpackedServer],
		cwd: workspaceDirectory,
		env: normalizedEnvironment({
			CIRCUITARIUM_MCP_ROOT: workspaceDirectory,
			CIRCUITARIUM_LOGISIM_JAR: configuredLogisimJar ?? "",
			LOGISIM_JAR: "",
		}),
		stderr: "pipe",
	});
	const client = new Client({
		name: "circuitarium-mcpb-smoke",
		version: packageManifest.version ?? "0.0.0",
	});
	try {
		await withTimeout(client.connect(transport), 10_000, "MCPB initialize");
		const tools = await withTimeout(
			client.listTools(),
			10_000,
			"MCPB tools/list",
		);
		assert.equal(tools.tools.length, EXPECTED_TOOL_COUNT);
		assert.ok(
			tools.tools.some((tool) => tool.name === "electronics_capabilities"),
		);
		assert.ok(tools.tools.some((tool) => tool.name === "crumb_check_design"));
		assert.equal(client.getServerVersion()?.version, packageManifest.version);

		const checkResult = await withTimeout(
			client.callTool({
				name: "crumb_check_design",
				arguments: { path: "synthetic-led.cru" },
			}),
			10_000,
			"MCPB crumb_check_design",
		);
		assert.equal(checkResult.isError ?? false, false);
		const envelope = envelopeOf(checkResult);
		assert.equal(envelope.contractVersion, "electronics.mcp/0.2");
		assert.equal(envelope.ok, true);
		assert.equal(envelope.data?.valid, true);

		const analyzeResult = await withTimeout(
			client.callTool({
				name: "logisim_analyze_design",
				arguments: { path: "full-adder.circ" },
			}),
			10_000,
			"MCPB logisim_analyze_design",
		);
		assert.equal(analyzeResult.isError ?? false, false);
		const analyzeEnvelope = envelopeOf(analyzeResult);
		assert.equal(analyzeEnvelope.contractVersion, "electronics.mcp/0.2");
		assert.equal(analyzeEnvelope.ok, true);
		assert.equal(analyzeEnvelope.data?.project?.ref, "full-adder.circ");
		assert.equal(analyzeEnvelope.data?.runtimeSafety?.safe, true);

		if (configuredLogisimJar !== undefined) {
			const statisticsResult = await withTimeout(
				client.callTool({
					name: "logisim_component_stats",
					arguments: {
						path: "full-adder.circ",
						circuit: "Main",
						expectedProjectDigest:
							analyzeEnvelope.context?.projectDigest,
						timeoutMs: LOGISIM_SMOKE_TIMEOUT_MS,
					},
				}),
				LOGISIM_SMOKE_TIMEOUT_MS + 10_000,
				"MCPB logisim_component_stats",
			);
			assert.equal(statisticsResult.isError ?? false, false);
			const statisticsEnvelope = envelopeOf(statisticsResult);
			assert.equal(
				statisticsEnvelope.contractVersion,
				"electronics.mcp/0.2",
			);
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
		}
	} finally {
		await client.close();
	}

	if (keepBundle && process.env.GITHUB_OUTPUT) {
		assert.equal(isAbsolute(bundlePath), true);
		await appendFile(
			process.env.GITHUB_OUTPUT,
			`bundle=${bundlePath}\n`,
			"utf8",
		);
	}
	verified = true;
	const logisimSummary =
		configuredLogisimJar === undefined
			? "packaged static Logisim smoke passed; optional JAR not configured"
			: "packaged static and 4.1.0 self-reported JAR smoke passed";
	process.stdout.write(
		`Verified ${bundlePath}: manifest v0.3, ${EXPECTED_TOOL_COUNT} tools, synthetic ERC smoke test passed; ${logisimSummary}.\n`,
	);
} catch (error) {
	verificationError = error;
}

let cleanupError: unknown;
for (const [path, prefix] of [
	[workspaceDirectory, "circuitarium-mcp-mcpb-workspace-"],
	[unpackDirectory, "circuitarium-mcp-unpacked-"],
	[
		packageOutputFile === undefined ? undefined : dirname(packageOutputFile),
		"circuitarium-mcp-package-output-",
	],
	[
		packageTarballOwned && packageTarball !== undefined
			? dirname(packageTarball)
			: undefined,
		"circuitarium-mcp-tarball-",
	],
	[
		bundleDirectory !== undefined && (!keepBundle || !verified)
			? bundleDirectory
			: undefined,
		"circuitarium-mcp-bundle-",
	],
] as const) {
	if (path === undefined) {
		continue;
	}
	try {
		assertSafeTemporaryPath(path, prefix);
		await rm(path, { force: true, recursive: true });
	} catch (error) {
		cleanupError =
			cleanupError === undefined
				? error
				: new AggregateError(
						[cleanupError, error],
						"MCPB verification cleanup failed",
					);
	}
}

const finalError =
	cleanupError === undefined
		? verificationError
		: verificationError === undefined
			? cleanupError
			: new AggregateError(
					[verificationError, cleanupError],
					"MCPB verification and cleanup both failed",
				);
if (finalError !== undefined) {
	throw finalError;
}
