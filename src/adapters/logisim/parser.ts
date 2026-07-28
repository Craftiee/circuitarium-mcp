import { TextDecoder } from "node:util";

import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from "saxes";

import {
	buildProjectIrNetlist,
	CIRCUIT_PROJECT_IR_VERSION,
	type CircuitProjectIR,
	type IrCircuit,
	type IrComponent,
	type IrLossMarker,
	type IrPort,
	mergeIrLossMarkers,
} from "../../domain/project-ir.js";
import {
	finalizeLogisimProjectModel,
	LOGISIM_ADAPTER_VERSION,
	LOGISIM_BACKEND_ID,
	LOGISIM_COMPATIBILITY_PROFILE,
	logisimAttributeValue,
	LogisimFormatError,
	type LogisimCircuit,
	type LogisimComponent,
	type LogisimLibrary,
	type LogisimLibraryTool,
	type LogisimNamedAttribute,
	type LogisimProject,
	type LogisimRuntimeSafetyReasonCode,
	type LogisimRuntimeSafetySignals,
	type LogisimUnknownConstruct,
	type LogisimUnknownConstructReason,
	LogisimXmlLimitError,
	LogisimXmlSecurityError,
	MAX_LOGISIM_CIRC_BYTES,
	MAX_LOGISIM_UNKNOWN_CONSTRUCT_SAMPLES,
	MAX_LOGISIM_XML_ATTRIBUTES,
	MAX_LOGISIM_XML_ATTRIBUTE_VALUE_CHARACTERS,
	MAX_LOGISIM_XML_DEPTH,
	MAX_LOGISIM_XML_ELEMENTS,
	MAX_LOGISIM_XML_NAME_CHARACTERS,
	MAX_LOGISIM_XML_TEXT_CHARACTERS,
	MAX_LOGISIM_XML_TEXT_NODE_CHARACTERS,
	parseLogisimLocation,
} from "./model.js";

type FrameContext =
	| "project"
	| "library"
	| "library-tool"
	| "main"
	| "circuit"
	| "component"
	| "wire"
	| "named-attribute"
	| "opaque";

type RecognizedOpaqueRole =
	| "options"
	| "mappings"
	| "mapping-tool"
	| "toolbar"
	| "toolbar-tool"
	| "appear"
	| "boardmap"
	| "terminal";

interface Frame {
	context: FrameContext;
	name: string;
	path: string;
	childCounts: Map<string, number>;
	captureText: boolean;
	text: string;
	attributeSink: LogisimNamedAttribute[] | null;
	xmlAttributes: Record<string, string>;
	runtimeNamedAttributeName: string | null;
	recognizedOpaqueRole: RecognizedOpaqueRole | null;
}

interface LogisimIrOptions {
	sourceRef?: string;
	sourceDigest?: string;
}

const PATH_ORIENTED_ATTRIBUTE_NAMES = new Set([
	"file",
	"filename",
	"filepath",
	"href",
	"jar",
	"librarypath",
	"path",
	"resource",
	"resourcepath",
	"src",
	"uri",
	"url",
]);

const FORBIDDEN_RUNTIME_LIBRARY_DESCRIPTORS = new Set([
	"#hdl-ip",
	"#input/output-extra",
	"#soc",
	"#tcl",
]);

const RECOGNIZED_APPEARANCE_ELEMENTS = new Set([
	"circ-anchor",
	"circ-origin",
	"circ-port",
	"ellipse",
	"line",
	"path",
	"polygon",
	"polyline",
	"rect",
	"text",
	"visible-counter",
	"visible-dotmatrix",
	"visible-hexdigit",
	"visible-led",
	"visible-ledbar",
	"visible-probe",
	"visible-register",
	"visible-rgbled",
	"visible-sevensegment",
	"visible-soc-cpu",
	"visible-tty",
	"visible-vga",
]);

function normalizedAttributeName(name: string): string {
	const local = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
	return local.toLowerCase().replaceAll("-", "").replaceAll("_", "");
}

function isPathOrientedAttributeName(name: string): boolean {
	const normalized = normalizedAttributeName(name);
	return (
		PATH_ORIENTED_ATTRIBUTE_NAMES.has(normalized) ||
		normalized.endsWith("filepath") ||
		normalized.endsWith("resourcepath")
	);
}

function hasUnsafePathLexicalForm(value: string): boolean {
	const normalized = value.trim();
	return (
		/^(?:file|jar|https?):/iu.test(normalized) ||
		/^[\\/]/u.test(normalized) ||
		/^[a-z]:[\\/]/iu.test(normalized) ||
		/(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(normalized)
	);
}

class RuntimeSafetyCollector {
	readonly #counts = new Map<LogisimRuntimeSafetyReasonCode, number>();

	add(code: LogisimRuntimeSafetyReasonCode, count = 1): void {
		if (!Number.isSafeInteger(count) || count < 1) {
			throw new RangeError("Runtime safety reason counts must be positive");
		}
		this.#counts.set(code, (this.#counts.get(code) ?? 0) + count);
	}

	inspectXmlAttributes(attributes: Readonly<Record<string, string>>): void {
		for (const [name, value] of Object.entries(attributes)) {
			if (normalizedAttributeName(name) === "filepath") {
				this.add("file-path-attribute");
				continue;
			}
			if (
				isPathOrientedAttributeName(name) &&
				hasUnsafePathLexicalForm(value)
			) {
				this.add("unsafe-path-attribute");
			}
		}
	}

	inspectNamedAttribute(name: string, value: string): void {
		if (normalizedAttributeName(name) === "filepath") {
			this.add("file-path-attribute");
			return;
		}
		if (
			isPathOrientedAttributeName(name) &&
			hasUnsafePathLexicalForm(value)
		) {
			this.add("unsafe-path-attribute");
		}
	}

	summary(): LogisimRuntimeSafetySignals {
		return {
			reasons: [...this.#counts.entries()]
				.map(([code, count]) => ({ code, count }))
				.sort((left, right) => left.code.localeCompare(right.code)),
		};
	}
}

class UnknownCollector {
	readonly #byKey = new Map<string, LogisimUnknownConstruct>();
	readonly #onAdd: (reason: LogisimUnknownConstructReason) => void;
	totalCount = 0;
	samplesTruncated = false;

	constructor(onAdd: (reason: LogisimUnknownConstructReason) => void) {
		this.#onAdd = onAdd;
	}

	add(
		path: string,
		elementName: string,
		reason: LogisimUnknownConstructReason,
	): void {
		this.totalCount += 1;
		this.#onAdd(reason);
		const key = `${path}\u0000${elementName}\u0000${reason}`;
		const current = this.#byKey.get(key);
		if (current !== undefined) {
			current.count += 1;
			return;
		}
		if (this.#byKey.size >= MAX_LOGISIM_UNKNOWN_CONSTRUCT_SAMPLES) {
			this.samplesTruncated = true;
			return;
		}
		this.#byKey.set(key, { path, elementName, reason, count: 1 });
	}

	summary(): LogisimProject["unknownConstructs"] {
		return {
			totalCount: this.totalCount,
			samples: [...this.#byKey.values()].sort((left, right) =>
				`${left.path}:${left.elementName}:${left.reason}`.localeCompare(
					`${right.path}:${right.elementName}:${right.reason}`,
				),
			),
			sampleLimit: MAX_LOGISIM_UNKNOWN_CONSTRUCT_SAMPLES,
			samplesTruncated: this.samplesTruncated,
		};
	}
}

function checkedXmlAttributes(
	tag: SaxesTagNS,
	attributeCounter: { value: number },
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const attribute of Object.values(tag.attributes) as SaxesAttributeNS[]) {
		attributeCounter.value += 1;
		if (attributeCounter.value > MAX_LOGISIM_XML_ATTRIBUTES) {
			throw new LogisimXmlLimitError(
				`Logisim XML exceeds the ${MAX_LOGISIM_XML_ATTRIBUTES}-attribute parsing limit`,
			);
		}
		if (attribute.name.length > MAX_LOGISIM_XML_NAME_CHARACTERS) {
			throw new LogisimXmlLimitError(
				`Logisim XML attribute name exceeds ${MAX_LOGISIM_XML_NAME_CHARACTERS} characters`,
			);
		}
		if (attribute.value.length > MAX_LOGISIM_XML_ATTRIBUTE_VALUE_CHARACTERS) {
			throw new LogisimXmlLimitError(
				`Logisim XML attribute ${attribute.name} exceeds the ${MAX_LOGISIM_XML_ATTRIBUTE_VALUE_CHARACTERS}-character value limit`,
			);
		}
		result[attribute.name] = attribute.value;
	}
	return result;
}

function unknownAttributeNames(
	attributes: Record<string, string>,
	known: ReadonlySet<string>,
): string[] {
	return Object.keys(attributes)
		.filter(
			(name) =>
				!known.has(name) && name !== "xmlns" && !name.startsWith("xmlns:"),
		)
		.sort();
}

function recordUnknownAttributes(
	collector: UnknownCollector,
	path: string,
	elementName: string,
	names: readonly string[],
): void {
	if (names.length > 0) {
		collector.add(path, elementName, "unsupported-attributes");
	}
}

function childPath(parent: Frame | undefined, name: string): string {
	if (parent === undefined) {
		return `/${name}`;
	}
	const occurrence = (parent.childCounts.get(name) ?? 0) + 1;
	parent.childCounts.set(name, occurrence);
	return `${parent.path}/${name}[${occurrence}]`;
}

function recognizedOpaqueChildRole(
	parent: Frame | undefined,
	tag: SaxesTagNS,
): RecognizedOpaqueRole | null {
	if (parent === undefined || tag.uri.length > 0) {
		return null;
	}
	switch (parent.recognizedOpaqueRole) {
		case "options":
			return tag.local === "a" ? "terminal" : null;
		case "mappings":
			return tag.local === "tool" ? "mapping-tool" : null;
		case "mapping-tool":
			return tag.local === "a" ? "terminal" : null;
		case "toolbar":
			if (tag.local === "tool") {
				return "toolbar-tool";
			}
			return tag.local === "sep" ? "terminal" : null;
		case "toolbar-tool":
			return tag.local === "a" ? "terminal" : null;
		case "appear":
			return RECOGNIZED_APPEARANCE_ELEMENTS.has(tag.local)
				? "terminal"
				: null;
		case "boardmap":
			return tag.local === "mc" ? "terminal" : null;
		default:
			return null;
	}
}

function requireUnqualifiedStructuralElement(tag: SaxesTagNS): void {
	if (tag.prefix.length > 0 || tag.uri.length > 0) {
		throw new LogisimFormatError(
			`Logisim structural element <${tag.name}> must use the empty XML namespace`,
		);
	}
}

function projectCompatibility(
	sourceVersion: string | null,
): LogisimProject["metadata"]["compatibility"] {
	if (sourceVersion === null || sourceVersion.length === 0) {
		return "source-version-missing";
	}
	return sourceVersion === "4.1.0"
		? "version-matched"
		: "different-logisim-version";
}

/**
 * Strictly decodes raw `.circ` bytes. This is separate from parsing so callers
 * can compute and compare the raw digest before malformed UTF-8 is inspected.
 */
export function decodeLogisimCircBytes(
	bytes: Uint8Array,
	options: { maxBytes?: number } = {},
): string {
	const maxBytes = Math.min(
		MAX_LOGISIM_CIRC_BYTES,
		options.maxBytes ?? MAX_LOGISIM_CIRC_BYTES,
	);
	if (!Number.isInteger(maxBytes) || maxBytes < 0) {
		throw new RangeError("maxBytes must be a non-negative integer");
	}
	if (bytes.byteLength > maxBytes) {
		throw new LogisimXmlLimitError(
			`Logisim project is ${bytes.byteLength} bytes; the decode limit is ${maxBytes} bytes`,
		);
	}
	if (
		(bytes[0] === 0xff && bytes[1] === 0xfe) ||
		(bytes[0] === 0xfe && bytes[1] === 0xff) ||
		(bytes[0] === 0x00 &&
			bytes[1] === 0x00 &&
			bytes[2] === 0xfe &&
			bytes[3] === 0xff) ||
		(bytes[0] === 0xff &&
			bytes[1] === 0xfe &&
			bytes[2] === 0x00 &&
			bytes[3] === 0x00)
	) {
		throw new LogisimFormatError(
			"Logisim .circ projects must be UTF-8; a UTF-16/UTF-32 BOM was detected",
		);
	}
	try {
		// Keep an optional UTF-8 BOM in the lexical string. XML parsers recognize
		// it, and the raw bytes remain the authority for digest comparison.
		return new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true,
		}).decode(bytes);
	} catch {
		throw new LogisimFormatError(
			"Logisim .circ projects must contain valid UTF-8 text",
		);
	}
}

/** Backward-friendly concise alias for strict byte decoding. */
export const decodeLogisimCirc = decodeLogisimCircBytes;

export function parseLogisimCirc(xml: string): LogisimProject {
	if (Buffer.byteLength(xml, "utf8") > MAX_LOGISIM_CIRC_BYTES) {
		throw new LogisimXmlLimitError(
			`Logisim project exceeds the ${MAX_LOGISIM_CIRC_BYTES}-byte parsing limit`,
		);
	}

	const runtimeSafety = new RuntimeSafetyCollector();
	const collector = new UnknownCollector((reason) => {
		if (reason === "malformed-modeled-element") {
			runtimeSafety.add("malformed-modeled-element");
		} else if (
			reason === "unexpected-element" ||
			reason === "unexpected-child"
		) {
			runtimeSafety.add("unexpected-element");
		} else if (reason === "unsupported-attributes") {
			runtimeSafety.add("unexpected-attribute");
		}
	});
	const libraries: LogisimLibrary[] = [];
	const circuits: LogisimCircuit[] = [];
	const metadata: LogisimProject["metadata"] = {
		sourceVersion: null,
		fileFormatVersion: null,
		mainCircuitName: null,
		compatibilityProfile: LOGISIM_COMPATIBILITY_PROFILE,
		compatibility: "source-version-missing",
		xmlAttributes: {},
		unknownAttributeNames: [],
	};
	const frames: Frame[] = [];
	const parser = new SaxesParser({
		xmlns: true,
		position: true,
		defaultXMLVersion: "1.0",
	});
	const attributeCounter = { value: 0 };
	let elementCount = 0;
	let totalTextCharacters = 0;
	let rootSeen = false;
	let parserFailure: Error | undefined;

	const opaqueFrame = (
		tag: SaxesTagNS,
		path: string,
		attributes: Record<string, string>,
		recognizedOpaqueRole: RecognizedOpaqueRole | null = null,
	): Frame => ({
		context: "opaque",
		name: tag.name,
		path,
		childCounts: new Map(),
		captureText:
			tag.local === "a" &&
			attributes.name !== undefined &&
			attributes.val === undefined,
		text: "",
		attributeSink: null,
		xmlAttributes: attributes,
		runtimeNamedAttributeName:
			tag.local === "a" ? (attributes.name ?? null) : null,
		recognizedOpaqueRole,
	});

	parser.on("error", (error) => {
		parserFailure ??= error;
	});
	parser.on("doctype", () => {
		throw new LogisimXmlSecurityError(
			"Logisim XML must not contain a DOCTYPE or entity declaration",
		);
	});
	parser.on("xmldecl", (declaration) => {
		if (declaration.version !== undefined && declaration.version !== "1.0") {
			throw new LogisimFormatError(
				`Logisim XML version ${declaration.version} is unsupported; expected XML 1.0`,
			);
		}
		const encoding = declaration.encoding?.toLowerCase().replaceAll("-", "");
		if (encoding !== undefined && encoding !== "utf8") {
			throw new LogisimFormatError(
				`Logisim .circ bytes must be UTF-8; declaration uses ${declaration.encoding}`,
			);
		}
	});
	parser.on("comment", (text) => {
		totalTextCharacters += text.length;
		if (totalTextCharacters > MAX_LOGISIM_XML_TEXT_CHARACTERS) {
			throw new LogisimXmlLimitError(
				`Logisim XML exceeds the ${MAX_LOGISIM_XML_TEXT_CHARACTERS}-character text budget`,
			);
		}
	});
	parser.on("processinginstruction", (instruction) => {
		totalTextCharacters += instruction.target.length + instruction.body.length;
		if (totalTextCharacters > MAX_LOGISIM_XML_TEXT_CHARACTERS) {
			throw new LogisimXmlLimitError(
				`Logisim XML exceeds the ${MAX_LOGISIM_XML_TEXT_CHARACTERS}-character text budget`,
			);
		}
	});

	parser.on("opentag", (tag: SaxesTagNS) => {
		elementCount += 1;
		if (elementCount > MAX_LOGISIM_XML_ELEMENTS) {
			throw new LogisimXmlLimitError(
				`Logisim XML exceeds the ${MAX_LOGISIM_XML_ELEMENTS}-element parsing limit`,
			);
		}
		if (frames.length + 1 > MAX_LOGISIM_XML_DEPTH) {
			throw new LogisimXmlLimitError(
				`Logisim XML exceeds the ${MAX_LOGISIM_XML_DEPTH}-level nesting limit`,
			);
		}
		if (tag.name.length > MAX_LOGISIM_XML_NAME_CHARACTERS) {
			throw new LogisimXmlLimitError(
				`Logisim XML element name exceeds ${MAX_LOGISIM_XML_NAME_CHARACTERS} characters`,
			);
		}

		const parent = frames.at(-1);
		const path = childPath(parent, tag.name);
		const attributes = checkedXmlAttributes(tag, attributeCounter);
		runtimeSafety.inspectXmlAttributes(attributes);
		if (
			tag.local === "a" &&
			attributes.name !== undefined &&
			attributes.val !== undefined
		) {
			runtimeSafety.inspectNamedAttribute(
				attributes.name,
				attributes.val,
			);
		}
		const opaqueChildRole = recognizedOpaqueChildRole(parent, tag);
		if (opaqueChildRole !== null) {
			frames.push(opaqueFrame(tag, path, attributes, opaqueChildRole));
			return;
		}
		let frame: Frame;

		if (parent === undefined) {
			if (rootSeen) {
				throw new LogisimFormatError(
					"Logisim XML must contain exactly one project root",
				);
			}
			rootSeen = true;
			requireUnqualifiedStructuralElement(tag);
			if (tag.local !== "project") {
				throw new LogisimFormatError(
					`Expected Logisim <project> root; received <${tag.name}>`,
				);
			}
			const unknown = unknownAttributeNames(
				attributes,
				new Set(["source", "version"]),
			);
			metadata.sourceVersion = attributes.source ?? null;
			metadata.fileFormatVersion = attributes.version ?? null;
			metadata.xmlAttributes = attributes;
			metadata.unknownAttributeNames = unknown;
			metadata.compatibility = projectCompatibility(metadata.sourceVersion);
			if (metadata.compatibility !== "version-matched") {
				runtimeSafety.add("source-version-not-matched");
			}
			recordUnknownAttributes(collector, path, tag.name, unknown);
			frame = {
				context: "project",
				name: tag.name,
				path,
				childCounts: new Map(),
				captureText: false,
				text: "",
				attributeSink: null,
				xmlAttributes: attributes,
				runtimeNamedAttributeName: null,
				recognizedOpaqueRole: null,
			};
			frames.push(frame);
			return;
		}

		if (parent.context === "project" && tag.uri.length === 0) {
			if (tag.local === "lib") {
				const unknown = unknownAttributeNames(
					attributes,
					new Set(["name", "desc"]),
				);
				const library: LogisimLibrary = {
					id: attributes.name ?? "",
					descriptor: attributes.desc ?? "",
					tools: [],
					xmlAttributes: attributes,
					unknownAttributeNames: unknown,
				};
				libraries.push(library);
				if (
					library.descriptor.length > 0 &&
					!library.descriptor.startsWith("#")
				) {
					runtimeSafety.add("external-library-descriptor");
				}
				if (library.id.length === 0 || library.descriptor.length === 0) {
					collector.add(path, tag.name, "malformed-modeled-element");
				}
				recordUnknownAttributes(collector, path, tag.name, unknown);
				frame = {
					context: "library",
					name: tag.name,
					path,
					childCounts: new Map(),
					captureText: false,
					text: "",
					attributeSink: null,
					xmlAttributes: attributes,
					runtimeNamedAttributeName: null,
					recognizedOpaqueRole: null,
				};
				frames.push(frame);
				return;
			}
			if (tag.local === "main") {
				const unknown = unknownAttributeNames(attributes, new Set(["name"]));
				if (metadata.mainCircuitName !== null) {
					collector.add(path, tag.name, "malformed-modeled-element");
				} else {
					metadata.mainCircuitName = attributes.name ?? null;
				}
				if ((attributes.name ?? "").length === 0) {
					collector.add(path, tag.name, "malformed-modeled-element");
				}
				recordUnknownAttributes(collector, path, tag.name, unknown);
				frame = {
					context: "main",
					name: tag.name,
					path,
					childCounts: new Map(),
					captureText: false,
					text: "",
					attributeSink: null,
					xmlAttributes: attributes,
					runtimeNamedAttributeName: null,
					recognizedOpaqueRole: null,
				};
				frames.push(frame);
				return;
			}
			if (tag.local === "circuit") {
				const unknown = unknownAttributeNames(attributes, new Set(["name"]));
				const circuit: LogisimCircuit = {
					id: `circuit-${circuits.length + 1}`,
					name: attributes.name ?? "",
					attributes: [],
					components: [],
					wires: [],
					xmlAttributes: attributes,
					unknownAttributeNames: unknown,
				};
				circuits.push(circuit);
				if (circuit.name.length === 0) {
					collector.add(path, tag.name, "malformed-modeled-element");
				}
				recordUnknownAttributes(collector, path, tag.name, unknown);
				frame = {
					context: "circuit",
					name: tag.name,
					path,
					childCounts: new Map(),
					captureText: false,
					text: "",
					attributeSink: circuit.attributes,
					xmlAttributes: attributes,
					runtimeNamedAttributeName: null,
					recognizedOpaqueRole: null,
				};
				frames.push(frame);
				return;
			}
			if (
				tag.local === "options" ||
				tag.local === "mappings" ||
				tag.local === "toolbar" ||
				tag.local === "vhdl" ||
				tag.local === "message"
			) {
				collector.add(path, tag.name, "unsupported-project-section");
				if (tag.local === "vhdl") {
					runtimeSafety.add("vhdl-project-section");
				}
				const role: RecognizedOpaqueRole =
					tag.local === "options" ||
					tag.local === "mappings" ||
					tag.local === "toolbar"
						? tag.local
						: "terminal";
				frames.push(opaqueFrame(tag, path, attributes, role));
				return;
			}
		}

		if (parent.context === "library" && tag.uri.length === 0) {
			if (tag.local === "tool") {
				const library = libraries.at(-1)!;
				const unknown = unknownAttributeNames(
					attributes,
					new Set(["name", "lib"]),
				);
				const tool: LogisimLibraryTool = {
					name: attributes.name ?? "",
					libraryId: attributes.lib ?? null,
					attributes: [],
					xmlAttributes: attributes,
					unknownAttributeNames: unknown,
				};
				library.tools.push(tool);
				if (tool.name.length === 0) {
					collector.add(path, tag.name, "malformed-modeled-element");
				}
				recordUnknownAttributes(collector, path, tag.name, unknown);
				frame = {
					context: "library-tool",
					name: tag.name,
					path,
					childCounts: new Map(),
					captureText: false,
					text: "",
					attributeSink: tool.attributes,
					xmlAttributes: attributes,
					runtimeNamedAttributeName: null,
					recognizedOpaqueRole: null,
				};
				frames.push(frame);
				return;
			}
		}

		if (parent.context === "circuit" && tag.uri.length === 0) {
			const circuit = circuits.at(-1)!;
			if (tag.local === "comp") {
				const unknown = unknownAttributeNames(
					attributes,
					new Set(["name", "lib", "loc"]),
				);
				const component: LogisimComponent = {
					id: `${circuit.id}/component-${circuit.components.length + 1}`,
					name: attributes.name ?? "",
					libraryId: attributes.lib ?? null,
					libraryDescriptor: null,
					location: parseLogisimLocation(attributes.loc),
					attributes: [],
					xmlAttributes: attributes,
					unknownAttributeNames: unknown,
					kind: "unknown",
					pin: null,
					clock: null,
				};
				circuit.components.push(component);
				if (component.name.length === 0 || component.location.point === null) {
					collector.add(path, tag.name, "malformed-modeled-element");
				}
				recordUnknownAttributes(collector, path, tag.name, unknown);
				frame = {
					context: "component",
					name: tag.name,
					path,
					childCounts: new Map(),
					captureText: false,
					text: "",
					attributeSink: component.attributes,
					xmlAttributes: attributes,
					runtimeNamedAttributeName: null,
					recognizedOpaqueRole: null,
				};
				frames.push(frame);
				return;
			}
			if (tag.local === "wire") {
				const unknown = unknownAttributeNames(
					attributes,
					new Set(["from", "to"]),
				);
				const wire = {
					id: `${circuit.id}/wire-${circuit.wires.length + 1}`,
					from: parseLogisimLocation(attributes.from),
					to: parseLogisimLocation(attributes.to),
					xmlAttributes: attributes,
					unknownAttributeNames: unknown,
				};
				circuit.wires.push(wire);
				if (wire.from.point === null || wire.to.point === null) {
					collector.add(path, tag.name, "malformed-modeled-element");
				}
				recordUnknownAttributes(collector, path, tag.name, unknown);
				frame = {
					context: "wire",
					name: tag.name,
					path,
					childCounts: new Map(),
					captureText: false,
					text: "",
					attributeSink: null,
					xmlAttributes: attributes,
					runtimeNamedAttributeName: null,
					recognizedOpaqueRole: null,
				};
				frames.push(frame);
				return;
			}
			if (tag.local === "appear" || tag.local === "boardmap") {
				collector.add(path, tag.name, "unsupported-circuit-section");
				frames.push(opaqueFrame(tag, path, attributes, tag.local));
				return;
			}
		}

		if (
			(parent.context === "circuit" ||
				parent.context === "component" ||
				parent.context === "library-tool") &&
			tag.uri.length === 0 &&
			tag.local === "a"
		) {
			const unknown = unknownAttributeNames(
				attributes,
				new Set(["name", "val"]),
			);
			recordUnknownAttributes(collector, path, tag.name, unknown);
			frame = {
				context: "named-attribute",
				name: tag.name,
				path,
				childCounts: new Map(),
				captureText: attributes.val === undefined,
				text: "",
				attributeSink: parent.attributeSink,
				xmlAttributes: attributes,
				runtimeNamedAttributeName: attributes.name ?? null,
				recognizedOpaqueRole: null,
			};
			frames.push(frame);
			return;
		}

		const reason: LogisimUnknownConstructReason =
			parent.context === "opaque" ? "unexpected-child" : "unexpected-element";
		collector.add(path, tag.name, reason);
		frames.push(opaqueFrame(tag, path, attributes));
	});

	const appendText = (text: string): void => {
		totalTextCharacters += text.length;
		if (totalTextCharacters > MAX_LOGISIM_XML_TEXT_CHARACTERS) {
			throw new LogisimXmlLimitError(
				`Logisim XML exceeds the ${MAX_LOGISIM_XML_TEXT_CHARACTERS}-character text budget`,
			);
		}
		const frame = frames.at(-1);
		if (frame?.captureText !== true) {
			return;
		}
		if (
			frame.text.length + text.length >
			MAX_LOGISIM_XML_TEXT_NODE_CHARACTERS
		) {
			throw new LogisimXmlLimitError(
				`Logisim XML text at ${frame.path} exceeds the ${MAX_LOGISIM_XML_TEXT_NODE_CHARACTERS}-character node limit`,
			);
		}
		frame.text += text;
	};
	parser.on("text", appendText);
	parser.on("cdata", appendText);

	parser.on("closetag", () => {
		const frame = frames.pop();
		if (frame === undefined) {
			throw new LogisimFormatError(
				"Logisim XML close-tag stack is inconsistent",
			);
		}
		if (
			frame.runtimeNamedAttributeName !== null &&
			frame.xmlAttributes.val === undefined
		) {
			runtimeSafety.inspectNamedAttribute(
				frame.runtimeNamedAttributeName,
				frame.text,
			);
		}
		if (frame.context !== "named-attribute") {
			return;
		}
		const name = frame.xmlAttributes.name ?? "";
		if (name.length === 0 || frame.attributeSink === null) {
			collector.add(frame.path, frame.name, "malformed-modeled-element");
			return;
		}
		const unknown = unknownAttributeNames(
			frame.xmlAttributes,
			new Set(["name", "val"]),
		);
		frame.attributeSink.push({
			name,
			value: frame.xmlAttributes.val ?? frame.text,
			valueSource: frame.xmlAttributes.val === undefined ? "text" : "val",
			xmlAttributes: frame.xmlAttributes,
			unknownAttributeNames: unknown,
		});
	});

	try {
		parser.write(xml).close();
	} catch (error) {
		if (error instanceof LogisimFormatError) {
			throw error;
		}
		throw new LogisimFormatError(
			`Invalid Logisim XML: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (parserFailure !== undefined) {
		throw new LogisimFormatError(
			`Invalid Logisim XML: ${parserFailure.message}`,
		);
	}
	if (!rootSeen) {
		throw new LogisimFormatError(
			"Logisim XML does not contain a <project> root",
		);
	}
	if (frames.length !== 0) {
		throw new LogisimFormatError(
			"Logisim XML ended before all elements were closed",
		);
	}

	const project: LogisimProject = {
		modelVersion: "logisim.project-model/0.1",
		metadata,
		libraries,
		circuits,
		unknownConstructs: collector.summary(),
		runtimeSafetySignals: { reasons: [] },
	};
	finalizeLogisimProjectModel(project);
	for (const circuit of project.circuits) {
		for (const component of circuit.components) {
			const descriptor = component.libraryDescriptor?.toLowerCase() ?? null;
			if (
				descriptor !== null &&
				FORBIDDEN_RUNTIME_LIBRARY_DESCRIPTORS.has(descriptor)
			) {
				runtimeSafety.add("forbidden-runtime-library-component");
			}
			if (
				descriptor === "#i/o" &&
				component.name.toLowerCase() === "telnet"
			) {
				runtimeSafety.add("forbidden-telnet-component");
			}
		}
	}
	project.runtimeSafetySignals = runtimeSafety.summary();
	return project;
}

export function parseLogisimCircBytes(
	bytes: Uint8Array,
	options: { maxBytes?: number } = {},
): LogisimProject {
	return parseLogisimCirc(decodeLogisimCircBytes(bytes, options));
}

function effectiveProperties(
	attributes: readonly LogisimNamedAttribute[],
): Record<string, string> {
	const properties: Record<string, string> = {};
	for (const attribute of attributes) {
		properties[attribute.name] = attribute.value;
	}
	return properties;
}

function duplicateAttributeLosses(
	attributes: readonly LogisimNamedAttribute[],
	path: string,
): IrLossMarker[] {
	const counts = new Map<string, number>();
	for (const attribute of attributes) {
		counts.set(attribute.name, (counts.get(attribute.name) ?? 0) + 1);
	}
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([name, count]) => ({
			code: "duplicate-source-attribute-collapsed",
			path,
			impact: "metadata" as const,
			message: `The neutral IR retains only the effective value for duplicate Logisim attribute ${name}; the parsed source model retains every occurrence.`,
			count: count - 1,
		}));
}

function componentToIr(
	component: LogisimComponent,
	circuitPath: string,
): IrComponent {
	const path = `${circuitPath}.components.${component.id}`;
	const losses: IrLossMarker[] = duplicateAttributeLosses(
		component.attributes,
		path,
	);
	const ports: IrPort[] = [];
	if (component.kind === "pin" && component.pin !== null) {
		ports.push({
			id: "port",
			name: component.pin.label ?? "pin",
			direction: component.pin.direction,
			width: component.pin.width,
			location: component.location.point,
			confidence: "format-inferred",
		});
		if (component.pin.direction === "unknown" || component.pin.width === null) {
			losses.push({
				code: "pin-semantics-incomplete",
				path,
				impact: "topology",
				message:
					"The Pin has an unrecognized direction or width; truth-table bounds and port semantics are incomplete.",
				count: 1,
			});
		}
	} else if (component.kind === "clock") {
		ports.push({
			id: "output",
			name: component.clock?.label ?? "clock",
			direction: "output",
			width: 1,
			location: component.location.point,
			confidence: "format-inferred",
		});
		losses.push({
			code: "clock-behavior-not-modeled",
			path,
			impact: "behavior",
			message:
				"Clock placement and saved attributes are retained, but static IR does not execute its timing behavior.",
			count: 1,
		});
	} else {
		losses.push({
			code: "component-port-geometry-unresolved",
			path,
			impact: "topology",
			message:
				"This static adapter does not infer this component's port coordinates or behavioral model; use the pinned Logisim JAR for authoritative execution.",
			count: 1,
		});
	}
	if (component.location.point === null) {
		losses.push({
			code: "component-location-invalid",
			path,
			impact: "topology",
			message:
				"The component location is missing or invalid and cannot participate in coordinate connectivity.",
			count: 1,
		});
	}
	if (
		component.kind === "unknown" ||
		(component.libraryId !== null && component.libraryDescriptor === null)
	) {
		losses.push({
			code: "component-library-unresolved",
			path,
			impact: "behavior",
			message:
				"The component library could not be resolved from this project; its semantics remain unknown.",
			count: 1,
		});
	}

	return {
		id: component.id,
		type: component.name,
		kind: component.kind,
		label: logisimAttributeValue(component.attributes, "label") ?? null,
		libraryId: component.libraryId,
		libraryDescriptor: component.libraryDescriptor,
		location: component.location.point,
		properties: effectiveProperties(component.attributes),
		ports,
		completeness: losses.length === 0 ? "complete" : "partial",
		losses: mergeIrLossMarkers(losses),
	};
}

function circuitToIr(circuit: LogisimCircuit): IrCircuit {
	const path = `circuits.${circuit.id}`;
	const components = circuit.components.map((component) =>
		componentToIr(component, path),
	);
	const wires = circuit.wires.map((wire) => ({
		id: wire.id,
		from: wire.from.point,
		to: wire.to.point,
		sourceFrom: wire.from.lexical,
		sourceTo: wire.to.lexical,
	}));
	const circuitShape = {
		id: circuit.id,
		name: circuit.name,
		attributes: effectiveProperties(circuit.attributes),
		components,
		wires,
	};
	const netlist = buildProjectIrNetlist(circuitShape);
	const losses: IrLossMarker[] = [
		...duplicateAttributeLosses(circuit.attributes, path),
		...components.flatMap((component) => component.losses),
		...netlist.losses,
	];
	const invalidWireCount = wires.filter(
		(wire) => wire.from === null || wire.to === null,
	).length;
	if (invalidWireCount > 0) {
		losses.push({
			code: "wire-location-invalid",
			path: `${path}.wires`,
			impact: "topology",
			message:
				"One or more wires have a missing or invalid endpoint and were omitted from coordinate connectivity.",
			count: invalidWireCount,
		});
	}
	return {
		...circuitShape,
		netlist,
		completeness: "partial",
		losses: mergeIrLossMarkers(losses),
	};
}

/**
 * Converts the parsed source model to neutral IR. The conversion is always
 * marked partial: `.circ` XML does not itself provide authoritative built-in
 * component behavior or every component's port geometry.
 */
export function logisimProjectToIr(
	project: LogisimProject,
	options: LogisimIrOptions = {},
): CircuitProjectIR {
	const circuits = project.circuits.map(circuitToIr);
	const losses: IrLossMarker[] = circuits.flatMap((circuit) => circuit.losses);
	for (const unknown of project.unknownConstructs.samples) {
		losses.push({
			code: `logisim-${unknown.reason}`,
			path: unknown.path,
			impact:
				unknown.reason === "unsupported-circuit-section"
					? "topology"
					: "metadata",
			message: `Logisim element <${unknown.elementName}> is retained only as an explicit source-model loss marker.`,
			count: unknown.count,
		});
	}
	if (project.unknownConstructs.samplesTruncated) {
		losses.push({
			code: "logisim-unknown-construct-samples-truncated",
			path: "unknownConstructs",
			impact: "metadata",
			message:
				"The source model counted more distinct unknown constructs than its bounded sample list can return.",
			count:
				project.unknownConstructs.totalCount -
				project.unknownConstructs.samples.reduce(
					(total, sample) => total + sample.count,
					0,
				),
		});
	}
	if (project.metadata.compatibility !== "version-matched") {
		losses.push({
			code: "logisim-source-version-unverified",
			path: "metadata.sourceVersion",
			impact: "behavior",
			message: `Static interpretation is pinned to Logisim Evolution 4.1.0; source reports ${project.metadata.sourceVersion ?? "no version"}.`,
			count: 1,
		});
	}
	losses.push({
		code: "logisim-static-ir-is-not-jar-execution",
		path: "project",
		impact: "simulation",
		message:
			"The neutral IR is static XML evidence. Use the pinned Logisim Evolution JAR subprocess for truth tables, test vectors, or simulation claims.",
		count: 1,
	});

	return {
		irVersion: CIRCUIT_PROJECT_IR_VERSION,
		backendId: LOGISIM_BACKEND_ID,
		compatibilityProfile: LOGISIM_COMPATIBILITY_PROFILE,
		sourceFormat: "logisim.circ",
		sourceFormatVersion: project.metadata.fileFormatVersion,
		sourceToolVersion: project.metadata.sourceVersion,
		sourceRef: options.sourceRef ?? null,
		sourceDigest: options.sourceDigest ?? null,
		mainCircuit: project.metadata.mainCircuitName,
		libraries: project.libraries.map((library) => ({
			id: library.id,
			descriptor: library.descriptor.length > 0 ? library.descriptor : null,
			name: null,
			external:
				library.descriptor.length > 0 && !library.descriptor.startsWith("#"),
		})),
		circuits,
		completeness: "partial",
		losses: mergeIrLossMarkers(losses),
	};
}

export const toCircuitProjectIr = logisimProjectToIr;

export const LOGISIM_PARSER_IDENTITY = {
	backendId: LOGISIM_BACKEND_ID,
	adapterVersion: LOGISIM_ADAPTER_VERSION,
	compatibilityProfile: LOGISIM_COMPATIBILITY_PROFILE,
} as const;
