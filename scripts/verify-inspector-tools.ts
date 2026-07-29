import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const INSPECTOR_PACKAGE = "@modelcontextprotocol/inspector";
const INSPECTOR_VERSION = "2.0.0";
const LOGISIM_RUNTIME_TOOLS = new Set([
	"logisim_component_stats",
	"logisim_truth_table",
	"logisim_run_test_vector",
]);
const EXPECTED_TOOL_NAMES = [
	"electronics_capabilities",
	"electronics_validate_experiment",
	"electronics_plan_verification",
	"crumb_component_catalog",
	"crumb_analyze_design",
	"crumb_compare_designs",
	"crumb_inspect_design",
	"crumb_validate_design",
	"crumb_generate_fixture",
	"crumb_list_projects",
	"crumb_get_component",
	"crumb_bom",
	"crumb_ic_reference",
	"crumb_export_netlist",
	"crumb_trace_net",
	"crumb_check_design",
	"logisim_list_projects",
	"logisim_analyze_design",
	"logisim_export_netlist",
	"logisim_component_stats",
	"logisim_truth_table",
	"logisim_run_test_vector",
] as const;

type ExpectedToolName = (typeof EXPECTED_TOOL_NAMES)[number];
type ToolLayer =
	| "neutral"
	| "crumb-static"
	| "crumb-synthetic-write"
	| "logisim-static"
	| "logisim-runtime";

interface InspectorOutput {
	result?: {
		tools?: Array<{
			name?: string;
			title?: string;
			annotations?: {
				readOnlyHint?: boolean;
				destructiveHint?: boolean;
			};
		}>;
		structuredContent?: unknown;
	};
}

interface ContractEnvelope {
	contractVersion?: string;
	ok?: boolean;
	summary?: string;
	data?: Record<string, unknown>;
	error?: {
		code?: string;
		message?: string;
	};
}

interface ProcessResult {
	code: number;
	stdout: string;
	stderr: string;
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
	if (child.pid === undefined || child.exitCode !== null) {
		return;
	}

	if (process.platform === "win32") {
		await new Promise<void>((resolveTermination) => {
			const taskkill = spawn(
				"taskkill.exe",
				["/pid", String(child.pid), "/t", "/f"],
				{
					shell: false,
					stdio: "ignore",
					windowsHide: true,
				},
			);
			taskkill.once("error", () => {
				child.kill("SIGKILL");
				resolveTermination();
			});
			taskkill.once("close", () => resolveTermination());
		});
		return;
	}

	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

interface ToolCase {
	name: ExpectedToolName;
	layer: ToolLayer;
	arguments: Record<string, unknown>;
}

interface ToolEvidence {
	name: ExpectedToolName;
	layer: ToolLayer;
	outcome: "passed" | "skipped-runtime-unconfigured";
	contractVersion: string;
	envelopeOk: boolean;
	dataValid?: boolean;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const serverEntry = resolve(repositoryRoot, "dist", "src", "server.js");
const npxCli = resolve(
	dirname(process.execPath),
	"node_modules",
	"npm",
	"bin",
	"npx-cli.js",
);
const npxCommand = process.platform === "win32" ? process.execPath : "npx";
const npxPrefixArguments = process.platform === "win32" ? [npxCli] : [];

function parseArguments(argv: string[]): {
	output?: string;
	requireRuntime: boolean;
} {
	let output: string | undefined;
	let requireRuntime = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--require-runtime") {
			requireRuntime = true;
			continue;
		}
		if (argument === "--output") {
			const value = argv[index + 1];
			assert.ok(value, "--output requires a path");
			output = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	return { ...(output === undefined ? {} : { output }), requireRuntime };
}

function inspectorArguments(
	workspaceRoot: string,
	method: string,
	tool?: Pick<ToolCase, "name" | "arguments">,
): string[] {
	const configuredJar = process.env.CIRCUITARIUM_LOGISIM_JAR?.trim();
	const configuredJava = process.env.CIRCUITARIUM_JAVA?.trim();
	return [
		...npxPrefixArguments,
		"-y",
		`${INSPECTOR_PACKAGE}@${INSPECTOR_VERSION}`,
		"--cli",
		process.execPath,
		serverEntry,
		"-e",
		`CIRCUITARIUM_MCP_ROOT=${workspaceRoot}`,
		...(configuredJar === undefined || configuredJar.length === 0
			? []
			: ["-e", `CIRCUITARIUM_LOGISIM_JAR=${configuredJar}`]),
		...(configuredJava === undefined || configuredJava.length === 0
			? []
			: ["-e", `CIRCUITARIUM_JAVA=${configuredJava}`]),
		"--method",
		method,
		...(tool === undefined
			? []
			: [
					"--tool-name",
					tool.name,
					"--tool-args-json",
					JSON.stringify(tool.arguments),
				]),
		"--connect-timeout",
		"30000",
		"--format",
		"json",
	];
}

async function runInspector(
	workspaceRoot: string,
	method: string,
	tool?: Pick<ToolCase, "name" | "arguments">,
): Promise<ProcessResult> {
	const maximumOutputBytes = 8 * 1024 * 1024;
	const timeoutMs = tool?.name.startsWith("logisim_") ? 180_000 : 90_000;
	return await new Promise<ProcessResult>((resolveProcess, rejectProcess) => {
		const child = spawn(
			npxCommand,
			inspectorArguments(workspaceRoot, method, tool),
			{
				cwd: repositoryRoot,
				env: {
					...process.env,
					MCP_AUTO_OPEN_ENABLED: "false",
					NO_COLOR: "1",
				},
				shell: false,
				detached: process.platform !== "win32",
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		let stdout = "";
		let stderr = "";
		let outputBytes = 0;
		let terminalError: Error | undefined;
		let closeFallback: NodeJS.Timeout | undefined;
		const failAfterTermination = (error: Error): void => {
			if (terminalError !== undefined) {
				return;
			}
			terminalError = error;
			clearTimeout(timer);
			void terminateProcessTree(child).finally(() => {
				closeFallback = setTimeout(() => rejectProcess(error), 5_000);
			});
		};
		const timer = setTimeout(() => {
			failAfterTermination(
				new Error(`Inspector timed out while calling ${tool?.name ?? method}.`),
			);
		}, timeoutMs);

		const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
			if (terminalError !== undefined) {
				return;
			}
			outputBytes += chunk.byteLength;
			if (outputBytes > maximumOutputBytes) {
				failAfterTermination(
					new Error(
						`Inspector output exceeded the bounded capture while calling ${tool?.name ?? method}.`,
					),
				);
				return;
			}
			if (target === "stdout") {
				stdout += chunk.toString("utf8");
			} else {
				stderr += chunk.toString("utf8");
			}
		};
		child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
		child.on("error", (error) => {
			clearTimeout(timer);
			if (closeFallback !== undefined) {
				clearTimeout(closeFallback);
			}
			rejectProcess(terminalError ?? error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (closeFallback !== undefined) {
				clearTimeout(closeFallback);
			}
			if (terminalError !== undefined) {
				rejectProcess(terminalError);
			} else {
				resolveProcess({ code: code ?? 1, stdout, stderr });
			}
		});
	});
}

function parseInspectorOutput(
	result: ProcessResult,
	operation: string,
): InspectorOutput {
	try {
		return JSON.parse(result.stdout.trim()) as InspectorOutput;
	} catch {
		throw new Error(
			`Inspector returned non-JSON output for ${operation} (exit ${result.code}).`,
		);
	}
}

function envelopeFrom(
	output: InspectorOutput,
	toolName: ExpectedToolName,
): ContractEnvelope {
	const envelope = output.result?.structuredContent;
	assert.ok(
		envelope !== null && typeof envelope === "object",
		`${toolName} returned a structured contract envelope`,
	);
	return envelope as ContractEnvelope;
}

function toolLayer(name: ExpectedToolName): ToolLayer {
	if (name.startsWith("electronics_")) {
		return "neutral";
	}
	if (name === "crumb_generate_fixture") {
		return "crumb-synthetic-write";
	}
	if (name.startsWith("crumb_")) {
		return "crumb-static";
	}
	if (LOGISIM_RUNTIME_TOOLS.has(name)) {
		return "logisim-runtime";
	}
	return "logisim-static";
}

function toolCases(): ToolCase[] {
	const crumbLed = "fixtures/crumb/breadboard-led.cru";
	const crumbResistor = "fixtures/crumb/breadboard-resistor.cru";
	const logisimProject = "examples/logisim/full-adder.circ";
	const logisimVector = "examples/logisim/full-adder.vec";
	const calls: Record<ExpectedToolName, Record<string, unknown>> = {
		electronics_capabilities: {},
		electronics_validate_experiment: {
			experiment: {
				schemaVersion: "0.1",
				id: "inspector-minimal-check",
				title: "Inspector minimal portable experiment",
				components: [],
				nets: [],
				execution: {
					fidelity: "behavioral",
					pacing: "as-fast-as-possible",
				},
			},
		},
		electronics_plan_verification: {
			target: {
				backendId: "logisim.evolution",
				projectRef: logisimProject,
				circuit: "Main",
				runtimeStatus: "unknown",
			},
			claims: [
				{
					id: "full-adder-behavior",
					claimClass: "combinational-behavior",
					objective: "verify",
					scope: "selected-circuit",
					statement:
						"All output rows match a separately authored specification.",
				},
			],
			declaredInterface: {
				designIntent: "combinational",
				signals: [
					{ id: "A", direction: "input", width: 1, role: "data" },
					{ id: "B", direction: "input", width: 1, role: "data" },
					{ id: "Cin", direction: "input", width: 1, role: "carry" },
					{ id: "Sum", direction: "output", width: 1, role: "data" },
					{ id: "Cout", direction: "output", width: 1, role: "carry" },
				],
			},
		},
		crumb_component_catalog: { toolId: 6 },
		crumb_analyze_design: { path: crumbLed, view: "summary" },
		crumb_compare_designs: {
			baselinePath: crumbResistor,
			candidatePath: crumbLed,
			view: "summary",
		},
		crumb_inspect_design: { path: crumbLed },
		crumb_validate_design: { path: crumbLed },
		crumb_generate_fixture: {
			kind: "breadboard-led",
			name: "Inspector Synthetic LED",
			outputPath: "generated/inspector-led.cru",
		},
		crumb_list_projects: { dir: "fixtures/crumb" },
		crumb_get_component: {
			path: crumbLed,
			componentId: "3d43171c-bf55-44f9-9e95-dfa7cdd8ed38",
		},
		crumb_bom: { path: crumbLed },
		crumb_ic_reference: { query: "74HC138" },
		crumb_export_netlist: { path: crumbLed },
		crumb_trace_net: {
			path: crumbLed,
			componentId: "3d43171c-bf55-44f9-9e95-dfa7cdd8ed38",
			terminalIndex: 0,
		},
		crumb_check_design: { path: crumbLed },
		logisim_list_projects: { dir: "examples/logisim" },
		logisim_analyze_design: { path: logisimProject, circuit: "Main" },
		logisim_export_netlist: { path: logisimProject, circuit: "Main" },
		logisim_component_stats: { path: logisimProject, circuit: "Main" },
		logisim_truth_table: {
			path: logisimProject,
			circuit: "Main",
			maxInputBits: 8,
			limit: 8,
		},
		logisim_run_test_vector: {
			path: logisimProject,
			circuit: "Main",
			vectorPath: logisimVector,
			maxFailures: 8,
		},
	};
	return EXPECTED_TOOL_NAMES.map((name) => ({
		name,
		layer: toolLayer(name),
		arguments: calls[name],
	}));
}

async function prepareSyntheticWorkspace(workspaceRoot: string): Promise<void> {
	const copies = [
		"fixtures/crumb/breadboard-led.cru",
		"fixtures/crumb/breadboard-resistor.cru",
		"examples/logisim/full-adder.circ",
		"examples/logisim/full-adder.vec",
	];
	for (const projectRef of copies) {
		const source = resolve(repositoryRoot, projectRef);
		const destination = resolve(workspaceRoot, projectRef);
		assert.equal(
			relative(workspaceRoot, destination).startsWith(".."),
			false,
			"synthetic destination remains in the temporary workspace",
		);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(source, destination);
	}
}

async function verifyToolList(workspaceRoot: string): Promise<void> {
	const invocation = await runInspector(workspaceRoot, "tools/list");
	assert.equal(
		invocation.code,
		0,
		"official Inspector CLI tools/list succeeds",
	);
	const output = parseInspectorOutput(invocation, "tools/list");
	const tools = output.result?.tools;
	assert.ok(Array.isArray(tools), "Inspector tools/list returned a tool array");
	assert.deepEqual(
		tools.map((tool) => tool.name),
		EXPECTED_TOOL_NAMES,
		"Inspector sees the exact 22-tool surface",
	);
	for (const tool of tools) {
		assert.ok(tool.title?.trim(), `${tool.name} has a human-readable title`);
		assert.equal(
			typeof tool.annotations?.readOnlyHint,
			"boolean",
			`${tool.name} declares readOnlyHint`,
		);
		if (tool.annotations?.readOnlyHint === false) {
			assert.equal(
				typeof tool.annotations.destructiveHint,
				"boolean",
				`${tool.name} declares destructiveHint`,
			);
		}
	}
}

async function verifyTool(
	workspaceRoot: string,
	tool: ToolCase,
	jarConfigured: boolean,
): Promise<ToolEvidence> {
	const invocation = await runInspector(workspaceRoot, "tools/call", tool);
	const output = parseInspectorOutput(invocation, tool.name);
	const envelope = envelopeFrom(output, tool.name);
	assert.equal(
		envelope.contractVersion,
		"electronics.mcp/0.2",
		`${tool.name} uses the public contract`,
	);

	if (
		LOGISIM_RUNTIME_TOOLS.has(tool.name) &&
		!jarConfigured &&
		invocation.code === 5 &&
		envelope.ok === false &&
		envelope.error?.code === "BACKEND_UNAVAILABLE"
	) {
		return {
			name: tool.name,
			layer: tool.layer,
			outcome: "skipped-runtime-unconfigured",
			contractVersion: envelope.contractVersion,
			envelopeOk: false,
		};
	}

	if (invocation.code !== 0) {
		throw new Error(
			`${tool.name} failed through the official Inspector CLI (exit ${invocation.code}, ${envelope.error?.code ?? "UNKNOWN"}): ${envelope.error?.message ?? "no structured error message"}`,
		);
	}
	assert.equal(envelope.ok, true, `${tool.name} returns ok=true`);
	const dataValid = envelope.data?.valid;
	if (typeof dataValid === "boolean") {
		assert.equal(
			dataValid,
			true,
			`${tool.name} returns a passing data.valid verdict`,
		);
	}
	if (LOGISIM_RUNTIME_TOOLS.has(tool.name)) {
		const runtime = envelope.data?.runtime as { version?: unknown } | undefined;
		assert.equal(
			runtime?.version,
			"4.1.0",
			`${tool.name} returns the version-pinned self-report`,
		);
	}
	if (tool.name === "logisim_truth_table") {
		const rows = envelope.data?.rows as unknown[] | undefined;
		assert.equal(rows?.length, 8, "the full-adder truth table has eight rows");
	}
	if (tool.name === "logisim_run_test_vector") {
		assert.equal(
			envelope.data?.totalVectors,
			8,
			"the full-adder vector run executes all eight cases",
		);
		assert.equal(
			envelope.data?.passedVectors,
			8,
			"the full-adder vector run passes all eight cases",
		);
	}
	return {
		name: tool.name,
		layer: tool.layer,
		outcome: "passed",
		contractVersion: envelope.contractVersion,
		envelopeOk: true,
		...(typeof dataValid === "boolean" ? { dataValid } : {}),
	};
}

function sanitizeMessage(
	message: string,
	workspaceRoot: string | undefined,
): string {
	const replacements = [
		repositoryRoot,
		workspaceRoot,
		process.env.CIRCUITARIUM_LOGISIM_JAR,
		process.env.CIRCUITARIUM_JAVA,
	].filter((value): value is string => value !== undefined && value.length > 0);
	return replacements.reduce(
		(sanitized, value) => sanitized.split(value).join("<local-path>"),
		message,
	);
}

const cli = parseArguments(process.argv.slice(2));
const jarSetting = process.env.CIRCUITARIUM_LOGISIM_JAR?.trim();
const jarConfigured = jarSetting !== undefined && jarSetting.length > 0;
if (cli.requireRuntime && !jarConfigured) {
	throw new Error(
		"--require-runtime needs CIRCUITARIUM_LOGISIM_JAR to identify the separately supplied Logisim-evolution 4.1.0 all-JAR.",
	);
}
await stat(serverEntry).then(
	(entry) => assert.equal(entry.isFile(), true),
	() => {
		throw new Error("Build output is missing. Run npm run build first.");
	},
);

let workspaceRoot: string | undefined;
try {
	workspaceRoot = await mkdtemp(join(tmpdir(), "circuitarium-inspector-"));
	await prepareSyntheticWorkspace(workspaceRoot);
	await verifyToolList(workspaceRoot);

	const tools: ToolEvidence[] = [];
	for (const tool of toolCases()) {
		process.stderr.write(`Inspector: ${tool.name}\n`);
		tools.push(await verifyTool(workspaceRoot, tool, jarConfigured));
	}

	const passed = tools.filter((tool) => tool.outcome === "passed").length;
	const skipped = tools.length - passed;
	if (cli.requireRuntime) {
		assert.equal(skipped, 0, "release QA cannot skip a runtime tool");
	}
	const report = {
		schemaVersion: "circuitarium.inspector-evidence/0.1",
		inspector: {
			package: INSPECTOR_PACKAGE,
			version: INSPECTOR_VERSION,
			mode: "cli",
			transport: "stdio",
		},
		fixtures: {
			provenance: "repository-synthetic-and-independently-authored",
			temporaryWorkspace: true,
			privateArtifactsRead: false,
		},
		boundaries: {
			crumb:
				"Static Unity-era CRUMB 1.3.5 save-file evidence; no live game control or simulation.",
			logisimStatic:
				"Static .circ structure and explicitly partial neutral-IR evidence.",
			logisimRuntime:
				"One-shot configured-JAR project-load, truth-table, and vector evidence; no persistent GUI session.",
			jarRedistributedByCircuitarium: false,
		},
		runtime: {
			logisimJarConfigured: jarConfigured,
			releaseRuntimeRequired: cli.requireRuntime,
			expectedSelfReportedVersion: "4.1.0",
			selfReportedVersionCheckedForRuntimeTools: jarConfigured,
		},
		surface: {
			expectedTools: EXPECTED_TOOL_NAMES.length,
			listedTools: EXPECTED_TOOL_NAMES.length,
			exactNameAndOrderMatch: true,
			titlesAndAnnotationsChecked: true,
		},
		totals: {
			called: tools.length,
			passed,
			skipped,
			failed: 0,
		},
		tools,
	};
	const serialized = `${JSON.stringify(report, null, 2)}\n`;
	if (cli.output !== undefined) {
		const outputPath = resolve(process.cwd(), cli.output);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, serialized, "utf8");
	}
	process.stdout.write(serialized);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(
		`Inspector verification failed: ${sanitizeMessage(message, workspaceRoot)}\n`,
	);
	process.exitCode = 1;
} finally {
	if (workspaceRoot !== undefined) {
		const resolvedTemporaryRoot = resolve(tmpdir());
		const resolvedWorkspace = resolve(workspaceRoot);
		assert.equal(
			resolvedWorkspace.startsWith(`${resolvedTemporaryRoot}${sep}`),
			true,
			"cleanup target remains under the operating-system temporary directory",
		);
		assert.equal(
			basename(resolvedWorkspace).startsWith("circuitarium-inspector-"),
			true,
			"cleanup target has the harness-created prefix",
		);
		await rm(resolvedWorkspace, { recursive: true });
	}
}
