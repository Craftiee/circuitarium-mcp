import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	listLogisimFiles,
	LogisimFileTooLargeError,
	LogisimWorkspacePathDeniedError,
	readLogisimFile,
	readLogisimVectorFile,
	resolveLogisimAuxiliaryFile,
	UnsupportedLogisimPathError,
} from "../src/adapters/logisim/io.js";
import {
	assessLogisimRuntimeSafety,
	LogisimFormatError,
	LogisimXmlLimitError,
	LogisimXmlSecurityError,
	MAX_LOGISIM_XML_DEPTH,
	MAX_LOGISIM_XML_ELEMENTS,
	MAX_LOGISIM_XML_TEXT_NODE_CHARACTERS,
	MAX_LOGISIM_UNKNOWN_CONSTRUCT_SAMPLES,
	summarizeLogisimCircuitIo,
} from "../src/adapters/logisim/model.js";
import {
	decodeLogisimCircBytes,
	logisimProjectToIr,
	parseLogisimCirc,
	parseLogisimCircBytes,
} from "../src/adapters/logisim/parser.js";

const MINIMAL_PROJECT =
	'<?xml version="1.0" encoding="UTF-8"?>' +
	'<project source="4.1.0" version="1.0">' +
	'<lib desc="#Wiring" name="0"/>' +
	'<main name="Main"/>' +
	'<circuit name="Main"/>' +
	"</project>";

test("official 4.1.0-style projects retain components, attributes, wires, and pin bounds", async () => {
	const xml = await readFile("examples/logisim/full-adder.circ", "utf8");
	const project = parseLogisimCirc(xml);

	assert.equal(project.metadata.sourceVersion, "4.1.0");
	assert.equal(project.metadata.compatibility, "version-matched");
	assert.equal(project.metadata.mainCircuitName, "Main");
	assert.equal(project.libraries.length, 9);
	assert.equal(project.circuits.length, 1);

	const circuit = project.circuits[0]!;
	assert.equal(circuit.components.length, 26);
	assert.equal(circuit.wires.length, 18);
	const inputA = circuit.components.find(
		(component) => component.kind === "pin" && component.pin?.label === "A",
	);
	assert.ok(inputA);
	assert.equal(inputA.libraryDescriptor, "#Wiring");
	assert.equal(inputA.pin?.direction, "input");
	assert.equal(inputA.pin?.directionSource, "profile-default");
	assert.equal(inputA.pin?.width, 1);
	assert.deepEqual(
		inputA.attributes.map((attribute) => [attribute.name, attribute.value]),
		[
			["appearance", "NewPins"],
			["label", "A"],
		],
	);

	const summary = summarizeLogisimCircuitIo(project);
	assert.equal(summary.circuitFound, true);
	assert.equal(summary.pinCount, 5);
	assert.equal(summary.inputPinCount, 3);
	assert.equal(summary.outputPinCount, 2);
	assert.equal(summary.inputBitTotal, 3);
	assert.equal(summary.inputBitTotalComplete, true);

	const ir = logisimProjectToIr(project, {
		sourceRef: "examples/logisim/full-adder.circ",
		sourceDigest: "sha256:test",
	});
	assert.equal(ir.backendId, "logisim.evolution");
	assert.equal(ir.compatibilityProfile, "logisim-evolution/4.1.0");
	assert.equal(ir.completeness, "partial");
	assert.equal(ir.circuits[0]?.netlist.topologyMode, "coordinate-endpoints");
	assert.ok(
		ir.losses.some(
			(loss) => loss.code === "logisim-static-ir-is-not-jar-execution",
		),
	);
	assert.ok(
		ir.circuits[0]?.netlist.nets.some((net) =>
			net.members.some((member) => member.componentId === inputA.id),
		),
	);
	assert.deepEqual(assessLogisimRuntimeSafety(project), {
		assessmentVersion: "logisim.runtime-safety/0.1",
		safe: true,
		reasonOccurrenceCount: 0,
		reasons: [],
		reasonBounds: {
			total: 0,
			returned: 0,
			limit: 10,
			truncated: false,
		},
	});
});

test("runtime safety permits explicitly recognized standard project sections", () => {
	const project = parseLogisimCirc(`<?xml version="1.0" encoding="UTF-8"?>
<project source="4.1.0" version="1.0">
  <lib desc="#Wiring" name="0"/>
  <main name="Main"/>
  <options><a name="simlimit" val="1000"/></options>
  <mappings>
    <tool lib="0" map="Button2" name="Pin">
      <a name="label" val="mapped"/>
    </tool>
  </mappings>
  <toolbar><tool lib="0" name="Pin"/><sep/></toolbar>
  <message value="independently authored fixture"/>
  <circuit name="Main">
    <appear><rect fill="#000000" height="20" width="20" x="0" y="0"/></appear>
    <boardmap boardname="demo"><mc key="pin" open="true"/></boardmap>
  </circuit>
</project>`);

	const assessment = assessLogisimRuntimeSafety(project);
	assert.equal(assessment.safe, true);
	assert.deepEqual(assessment.reasons, []);
	assert.ok(project.unknownConstructs.totalCount >= 6);
});

test("runtime safety returns only bounded reason codes and counts", () => {
	const project = parseLogisimCirc(`<?xml version="1.0" encoding="UTF-8"?>
<project source="3.9.0" version="1.0" future="yes">
  <lib desc="file#C:\\private\\other.circ" name="external"/>
  <lib desc="#TCL" name="tcl"/>
  <lib desc="#I/O" name="io"/>
  <lib desc="#Wiring" name="0">
    <tool name="Pin"><a name="filePath" val="local.bin"/></tool>
  </lib>
  <main name="Main"/>
  <vhdl name="Embedded">entity Embedded is end Embedded;</vhdl>
  <circuit name="Main">
    <comp lib="tcl" loc="(10,10)" name="TclGeneric"/>
    <comp lib="io" loc="(20,20)" name="Telnet"/>
    <comp lib="0" loc="(30,30)" name="Pin">
      <a name="resource" val="../secret.bin"/>
    </comp>
    <wire from="bad" to="(30,30)"/>
    <future/>
  </circuit>
</project>`);

	const assessment = assessLogisimRuntimeSafety(project);
	assert.equal(assessment.safe, false);
	assert.equal(assessment.reasonOccurrenceCount, 10);
	assert.deepEqual(
		assessment.reasons.map((reason) => reason.code),
		[
			"source-version-not-matched",
			"external-library-descriptor",
			"vhdl-project-section",
			"unexpected-element",
			"unexpected-attribute",
			"malformed-modeled-element",
			"file-path-attribute",
			"unsafe-path-attribute",
			"forbidden-runtime-library-component",
			"forbidden-telnet-component",
		],
	);
	assert.deepEqual(assessment.reasonBounds, {
		total: 10,
		returned: 10,
		limit: 10,
		truncated: false,
	});
	const serialized = JSON.stringify(assessment);
	for (const secret of [
		"private",
		"other.circ",
		"local.bin",
		"secret.bin",
	]) {
		assert.doesNotMatch(serialized, new RegExp(secret, "u"));
	}
});

test("runtime safety sees opaque filePath attributes and every unknown element", () => {
	const opaque = parseLogisimCirc(`<?xml version="1.0" encoding="UTF-8"?>
<project source="4.1.0" version="1.0">
  <lib desc="#Wiring" name="0"/>
  <main name="Main"/>
  <options><a name="filePath">relative-but-forbidden.bin</a></options>
  <circuit name="Main"/>
</project>`);
	assert.deepEqual(assessLogisimRuntimeSafety(opaque).reasons, [
		{ code: "file-path-attribute", count: 1 },
	]);

	const unknownCount = MAX_LOGISIM_UNKNOWN_CONSTRUCT_SAMPLES + 17;
	const manyUnknown = parseLogisimCirc(
		`<project source="4.1.0" version="1.0">` +
			'<lib desc="#Wiring" name="0"/><main name="Main"/>' +
			`<circuit name="Main">${"<future/>".repeat(unknownCount)}</circuit>` +
			"</project>",
	);
	assert.equal(manyUnknown.unknownConstructs.samplesTruncated, true);
	assert.equal(
		manyUnknown.unknownConstructs.samples.length,
		MAX_LOGISIM_UNKNOWN_CONSTRUCT_SAMPLES,
	);
	const assessment = assessLogisimRuntimeSafety(manyUnknown);
	assert.deepEqual(assessment.reasons, [
		{ code: "unexpected-element", count: unknownCount },
	]);
	assert.equal(assessment.reasonOccurrenceCount, unknownCount);
});

test("runtime safety rejects dangerous path forms and risky built-in components", () => {
	const project = parseLogisimCirc(`<?xml version="1.0" encoding="UTF-8"?>
<project source="4.1.0" version="1.0">
  <lib desc="#Wiring" name="0"/>
  <lib desc="#TCL" name="1"/>
  <lib desc="#HDL-IP" name="2"/>
  <lib desc="#Soc" name="3"/>
  <lib desc="#Input/Output-Extra" name="4"/>
  <lib desc="#I/O" name="5"/>
  <main name="Main"/>
  <circuit name="Main">
    <comp lib="0" loc="(0,0)" name="Pin">
      <a name="resource" val="/etc/passwd"/>
      <a name="src" val="\\\\server\\share"/>
      <a name="href" val="C:\\private\\file.bin"/>
      <a name="url" val="../secret"/>
      <a name="uri" val="file:secret"/>
      <a name="jar" val="jar:plugin"/>
      <a name="resourcePath" val="http://example.invalid/resource"/>
      <a name="libraryPath" val="https://example.invalid/library"/>
      <a name="resource" val="assets/relative-is-safe.bin"/>
    </comp>
    <comp lib="1" loc="(10,10)" name="TclGeneric"/>
    <comp lib="2" loc="(20,20)" name="VHDL Entity"/>
    <comp lib="3" loc="(30,30)" name="Rv32im"/>
    <comp lib="4" loc="(40,40)" name="Extra Component"/>
    <comp lib="5" loc="(50,50)" name="Telnet"/>
  </circuit>
</project>`);

	const assessment = assessLogisimRuntimeSafety(project);
	assert.deepEqual(assessment.reasons, [
		{ code: "unsafe-path-attribute", count: 8 },
		{ code: "forbidden-runtime-library-component", count: 4 },
		{ code: "forbidden-telnet-component", count: 1 },
	]);
});

test("multiline attributes, clocks, subcircuits, and unknown sections remain explicit", () => {
	const project = parseLogisimCirc(`<?xml version="1.0" encoding="UTF-8"?>
<project source="4.1.0" version="1.0" future="yes">
  <lib desc="#Wiring" name="0">
    <tool name="Pin"><a name="label">tool
label</a></tool>
  </lib>
  <main name="Main"/>
  <options><a name="simlimit" val="1000"/></options>
  <circuit name="Child"/>
  <circuit name="Main">
    <a name="description">line one
line two</a>
    <comp lib="0" loc="(10,20)" name="Clock">
      <a name="label" val="CLK"/>
      <a name="highDuration" val="3"/>
      <a name="lowDuration" val="5"/>
    </comp>
    <comp loc="(30,40)" name="Child"/>
    <appear><future-shape/></appear>
    <wire from="(10,20)" to="(30,20)" future="wire"/>
  </circuit>
</project>`);

	assert.equal(
		project.libraries[0]?.tools[0]?.attributes[0]?.value,
		"tool\nlabel",
	);
	assert.equal(project.circuits[1]?.attributes[0]?.value, "line one\nline two");
	assert.equal(project.circuits[1]?.components[0]?.kind, "clock");
	assert.equal(project.circuits[1]?.components[0]?.clock?.highDuration, "3");
	assert.equal(project.circuits[1]?.components[1]?.kind, "subcircuit");
	assert.ok(project.unknownConstructs.totalCount >= 4);
	assert.ok(
		project.unknownConstructs.samples.some(
			(unknown) => unknown.reason === "unsupported-project-section",
		),
	);
	assert.ok(
		project.unknownConstructs.samples.some(
			(unknown) => unknown.reason === "unsupported-circuit-section",
		),
	);
	assert.ok(
		project.unknownConstructs.samples.some(
			(unknown) => unknown.reason === "unsupported-attributes",
		),
	);
});

test("XML declarations, DTDs, entities, namespaces, and malformed documents fail closed", () => {
	assert.throws(
		() =>
			parseLogisimCirc(
				'<!DOCTYPE project [<!ENTITY secret "x">]><project source="4.1.0" version="1.0">&secret;</project>',
			),
		LogisimXmlSecurityError,
	);
	assert.throws(
		() =>
			parseLogisimCirc(
				'<?xml version="1.0" encoding="UTF-16"?><project source="4.1.0" version="1.0"/>',
			),
		/must be UTF-8/u,
	);
	assert.throws(
		() =>
			parseLogisimCirc(
				'<project xmlns="urn:not-logisim" source="4.1.0" version="1.0"/>',
			),
		/empty XML namespace/u,
	);
	assert.throws(
		() => parseLogisimCirc("<not-project/>"),
		/Expected Logisim <project> root/u,
	);
	assert.throws(
		() => parseLogisimCirc('<project source="4.1.0">'),
		LogisimFormatError,
	);
});

test("strict UTF-8 decoding rejects malformed bytes and UTF-16/32 BOMs", () => {
	assert.throws(
		() => decodeLogisimCircBytes(Buffer.from([0xc3, 0x28])),
		/valid UTF-8/u,
	);
	assert.throws(
		() => decodeLogisimCircBytes(Buffer.from([0xff, 0xfe, 0x3c, 0x00])),
		/UTF-16\/UTF-32 BOM/u,
	);

	const bom = Buffer.concat([
		Buffer.from([0xef, 0xbb, 0xbf]),
		Buffer.from(MINIMAL_PROJECT, "utf8"),
	]);
	assert.equal(parseLogisimCircBytes(bom).metadata.sourceVersion, "4.1.0");
});

test("XML parsing enforces depth, element, and text-node limits", () => {
	const nested =
		'<project source="4.1.0" version="1.0">' +
		"<x>".repeat(MAX_LOGISIM_XML_DEPTH) +
		"</x>".repeat(MAX_LOGISIM_XML_DEPTH) +
		"</project>";
	assert.throws(() => parseLogisimCirc(nested), LogisimXmlLimitError);

	const manyElements =
		'<project source="4.1.0" version="1.0">' +
		"<x/>".repeat(MAX_LOGISIM_XML_ELEMENTS) +
		"</project>";
	assert.throws(() => parseLogisimCirc(manyElements), /element parsing limit/u);

	const oversizedText =
		'<project source="4.1.0" version="1.0"><circuit name="Main"><a name="description">' +
		"x".repeat(MAX_LOGISIM_XML_TEXT_NODE_CHARACTERS + 1) +
		"</a></circuit></project>";
	assert.throws(() => parseLogisimCirc(oversizedText), /text .* node limit/u);
});

test("workspace reads expose raw digests and lazy UTF-8 while auxiliary paths are contained", async () => {
	const root = await mkdtemp(join(tmpdir(), "circuitarium-logisim-io-"));
	const outside = await mkdtemp(
		join(tmpdir(), "circuitarium-logisim-outside-"),
	);
	try {
		await mkdir(join(root, "nested"));
		const projectPath = join(root, "nested", "sample.circ");
		const vectorPath = join(root, "sample.vec");
		const outsidePath = join(outside, "outside.circ");
		await writeFile(projectPath, Buffer.from(MINIMAL_PROJECT, "utf8"));
		await writeFile(vectorPath, "A B Y\n0 0 0\n", "utf8");
		await writeFile(outsidePath, MINIMAL_PROJECT, "utf8");

		const snapshot = await readLogisimFile("nested/sample.circ", { root });
		assert.equal(snapshot.ref, "nested/sample.circ");
		assert.equal(
			snapshot.digest,
			`sha256:${createHash("sha256").update(snapshot.bytes).digest("hex")}`,
		);
		assert.equal(parseLogisimCirc(snapshot.xml).circuits.length, 1);

		const vector = await readLogisimVectorFile("sample.vec", undefined, {
			root,
		});
		assert.equal(vector.text, "A B Y\n0 0 0\n");
		assert.equal(
			await resolveLogisimAuxiliaryFile("sample.vec", undefined, { root }),
			vector.path,
		);
		await assert.rejects(
			readLogisimVectorFile("nested/sample.circ", undefined, { root }),
			UnsupportedLogisimPathError,
		);
		await assert.rejects(
			readLogisimFile(outsidePath, { root }),
			LogisimWorkspacePathDeniedError,
		);
		await assert.rejects(
			readLogisimFile("nested/sample.circ", {
				root,
				maxBytes: 1,
			}),
			LogisimFileTooLargeError,
		);
	} finally {
		await rm(root, { recursive: true });
		await rm(outside, { recursive: true });
	}
});

test("workspace discovery hashes .circ files, skips ignored trees, and honors digest budgets", async () => {
	const root = await mkdtemp(join(tmpdir(), "circuitarium-logisim-list-"));
	try {
		await mkdir(join(root, "nested"));
		await mkdir(join(root, ".hidden"));
		await mkdir(join(root, "node_modules"));
		await Promise.all([
			writeFile(join(root, "root.circ"), MINIMAL_PROJECT, "utf8"),
			writeFile(join(root, "nested", "nested.CIRC"), MINIMAL_PROJECT, "utf8"),
			writeFile(join(root, ".hidden", "hidden.circ"), MINIMAL_PROJECT, "utf8"),
			writeFile(
				join(root, "node_modules", "dependency.circ"),
				MINIMAL_PROJECT,
				"utf8",
			),
		]);

		const shallow = await listLogisimFiles(".", {
			root,
			recursive: false,
		});
		assert.deepEqual(
			shallow.entries.map((entry) => entry.ref),
			["root.circ"],
		);
		assert.match(shallow.entries[0]?.digest ?? "", /^sha256:[0-9a-f]{64}$/u);

		const recursive = await listLogisimFiles(".", { root });
		assert.deepEqual(
			recursive.entries.map((entry) => entry.ref),
			["nested/nested.CIRC", "root.circ"],
		);
		assert.equal(recursive.digestBudgetTruncated, false);

		const bounded = await listLogisimFiles(".", {
			root,
			digestByteLimit: 1,
		});
		assert.equal(bounded.entries.length, 0);
		assert.equal(bounded.digestBudgetTruncated, true);
	} finally {
		await rm(root, { recursive: true });
	}
});

test("workspace discovery and direct reads reject symbolic links", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "circuitarium-logisim-link-"));
	const outside = await mkdtemp(
		join(tmpdir(), "circuitarium-logisim-link-outside-"),
	);
	try {
		const outsideFile = join(outside, "outside.circ");
		const outsideDirectory = join(outside, "directory");
		await mkdir(outsideDirectory);
		await writeFile(outsideFile, MINIMAL_PROJECT, "utf8");
		await writeFile(
			join(outsideDirectory, "nested.circ"),
			MINIMAL_PROJECT,
			"utf8",
		);
		try {
			await symlink(
				outsideFile,
				join(root, "linked.circ"),
				process.platform === "win32" ? "file" : undefined,
			);
			await symlink(
				outsideDirectory,
				join(root, "linked-directory"),
				process.platform === "win32" ? "junction" : "dir",
			);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
				context.skip(`Links are unavailable on this runner (${code})`);
				return;
			}
			throw error;
		}

		await assert.rejects(
			readLogisimFile("linked.circ", { root }),
			LogisimWorkspacePathDeniedError,
		);
		const listing = await listLogisimFiles(".", { root });
		assert.equal(listing.entries.length, 0);
	} finally {
		await rm(root, { recursive: true });
		await rm(outside, { recursive: true });
	}
});
