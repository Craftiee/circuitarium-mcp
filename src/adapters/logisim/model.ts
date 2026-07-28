import type { IrPortDirection, IrPoint } from "../../domain/project-ir.js";

export const LOGISIM_BACKEND_ID = "logisim.evolution" as const;
/** @deprecated Static reads and JAR execution are operations of one backend. */
export const LOGISIM_STATIC_BACKEND_ID = LOGISIM_BACKEND_ID;
export const LOGISIM_ADAPTER_VERSION = "logisim.evolution/0.1" as const;
export const LOGISIM_COMPATIBILITY_PROFILE = "logisim-evolution/4.1.0" as const;

export const MAX_LOGISIM_CIRC_BYTES = 64 * 1024 * 1024;
export const MAX_LOGISIM_XML_DEPTH = 64;
export const MAX_LOGISIM_XML_ELEMENTS = 200_000;
export const MAX_LOGISIM_XML_ATTRIBUTES = 500_000;
export const MAX_LOGISIM_XML_NAME_CHARACTERS = 256;
export const MAX_LOGISIM_XML_ATTRIBUTE_VALUE_CHARACTERS = 1_048_576;
export const MAX_LOGISIM_XML_TEXT_NODE_CHARACTERS = 1_048_576;
export const MAX_LOGISIM_XML_TEXT_CHARACTERS = 4 * 1024 * 1024;
export const MAX_LOGISIM_UNKNOWN_CONSTRUCT_SAMPLES = 256;
export const MAX_LOGISIM_PIN_WIDTH = 65_536;

export class LogisimFormatError extends Error {}
export class LogisimXmlSecurityError extends LogisimFormatError {}
export class LogisimXmlLimitError extends LogisimFormatError {}

export interface LogisimSourceLocation {
	lexical: string;
	point: IrPoint | null;
}

export interface LogisimNamedAttribute {
	name: string;
	value: string;
	valueSource: "val" | "text";
	/** All XML attributes on the source <a>, including unfamiliar ones. */
	xmlAttributes: Record<string, string>;
	unknownAttributeNames: string[];
}

export interface LogisimLibraryTool {
	name: string;
	libraryId: string | null;
	attributes: LogisimNamedAttribute[];
	xmlAttributes: Record<string, string>;
	unknownAttributeNames: string[];
}

export interface LogisimLibrary {
	id: string;
	descriptor: string;
	tools: LogisimLibraryTool[];
	xmlAttributes: Record<string, string>;
	unknownAttributeNames: string[];
}

export interface LogisimPinSemantics {
	direction: IrPortDirection;
	directionSource:
		| "type-attribute"
		| "legacy-output-attribute"
		| "profile-default"
		| "unrecognized";
	width: number | null;
	widthSource: "width-attribute" | "profile-default" | "invalid";
	label: string | null;
	facing: string | null;
	behavior: string | null;
}

export interface LogisimClockSemantics {
	label: string | null;
	facing: string | null;
	highDuration: string | null;
	lowDuration: string | null;
	phase: string | null;
}

export interface LogisimComponent {
	id: string;
	name: string;
	libraryId: string | null;
	libraryDescriptor: string | null;
	location: LogisimSourceLocation;
	attributes: LogisimNamedAttribute[];
	xmlAttributes: Record<string, string>;
	unknownAttributeNames: string[];
	kind: "pin" | "clock" | "subcircuit" | "component" | "unknown";
	pin: LogisimPinSemantics | null;
	clock: LogisimClockSemantics | null;
}

export interface LogisimWire {
	id: string;
	from: LogisimSourceLocation;
	to: LogisimSourceLocation;
	xmlAttributes: Record<string, string>;
	unknownAttributeNames: string[];
}

export interface LogisimCircuit {
	id: string;
	name: string;
	attributes: LogisimNamedAttribute[];
	components: LogisimComponent[];
	wires: LogisimWire[];
	xmlAttributes: Record<string, string>;
	unknownAttributeNames: string[];
}

export type LogisimUnknownConstructReason =
	| "unsupported-project-section"
	| "unsupported-circuit-section"
	| "unexpected-element"
	| "unexpected-child"
	| "unsupported-attributes"
	| "malformed-modeled-element";

export interface LogisimUnknownConstruct {
	path: string;
	elementName: string;
	reason: LogisimUnknownConstructReason;
	count: number;
}

export interface LogisimUnknownConstructSummary {
	totalCount: number;
	samples: LogisimUnknownConstruct[];
	sampleLimit: number;
	samplesTruncated: boolean;
}

export const LOGISIM_RUNTIME_SAFETY_REASON_CODES = [
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
] as const;

export type LogisimRuntimeSafetyReasonCode =
	(typeof LOGISIM_RUNTIME_SAFETY_REASON_CODES)[number];

export const MAX_LOGISIM_RUNTIME_SAFETY_REASONS =
	LOGISIM_RUNTIME_SAFETY_REASON_CODES.length;

export interface LogisimRuntimeSafetyReason {
	code: LogisimRuntimeSafetyReasonCode;
	count: number;
}

/**
 * Full-stream counters produced while parsing. They contain only fixed reason
 * codes and counts so a denied project cannot disclose an embedded path.
 */
export interface LogisimRuntimeSafetySignals {
	reasons: LogisimRuntimeSafetyReason[];
}

export interface LogisimRuntimeSafetyAssessment {
	assessmentVersion: "logisim.runtime-safety/0.1";
	safe: boolean;
	reasonOccurrenceCount: number;
	reasons: LogisimRuntimeSafetyReason[];
	reasonBounds: {
		total: number;
		returned: number;
		limit: number;
		truncated: boolean;
	};
}

export interface LogisimProjectMetadata {
	sourceVersion: string | null;
	fileFormatVersion: string | null;
	mainCircuitName: string | null;
	compatibilityProfile: typeof LOGISIM_COMPATIBILITY_PROFILE;
	compatibility:
		| "version-matched"
		| "different-logisim-version"
		| "source-version-missing";
	xmlAttributes: Record<string, string>;
	unknownAttributeNames: string[];
}

export interface LogisimProject {
	modelVersion: "logisim.project-model/0.1";
	metadata: LogisimProjectMetadata;
	libraries: LogisimLibrary[];
	circuits: LogisimCircuit[];
	unknownConstructs: LogisimUnknownConstructSummary;
	runtimeSafetySignals: LogisimRuntimeSafetySignals;
}

export interface LogisimCircuitPinSummary {
	circuitName: string;
	circuitFound: boolean;
	pins: Array<{
		componentId: string;
		label: string | null;
		direction: IrPortDirection;
		width: number | null;
		location: IrPoint | null;
	}>;
	pinCount: number;
	inputPinCount: number;
	outputPinCount: number;
	inoutPinCount: number;
	unknownDirectionPinCount: number;
	inputBitTotal: number;
	inputBitTotalComplete: boolean;
}

export function parseLogisimLocation(
	lexical: string | undefined,
): LogisimSourceLocation {
	const source = lexical ?? "";
	const match = /^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/u.exec(source);
	if (match === null) {
		return { lexical: source, point: null };
	}
	const x = Number(match[1]);
	const y = Number(match[2]);
	if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
		return { lexical: source, point: null };
	}
	return { lexical: source, point: { x, y } };
}

/**
 * Logisim applies later duplicate <a> values over earlier values while
 * loading. The model retains every occurrence; this convenience lookup mirrors
 * that effective-value behavior without discarding the duplicates.
 */
export function logisimAttributeValue(
	attributes: readonly LogisimNamedAttribute[],
	name: string,
): string | undefined {
	const normalizedName = name.toLowerCase();
	for (let index = attributes.length - 1; index >= 0; index -= 1) {
		const attribute = attributes[index];
		if (attribute?.name.toLowerCase() === normalizedName) {
			return attribute.value;
		}
	}
	return undefined;
}

function pinDirection(
	attributes: readonly LogisimNamedAttribute[],
): Pick<LogisimPinSemantics, "direction" | "directionSource"> {
	const type = logisimAttributeValue(attributes, "type")?.toLowerCase();
	if (type === "input" || type === "output" || type === "inout") {
		return { direction: type, directionSource: "type-attribute" };
	}
	const legacyOutput = logisimAttributeValue(
		attributes,
		"output",
	)?.toLowerCase();
	if (legacyOutput === "true") {
		return {
			direction: "output",
			directionSource: "legacy-output-attribute",
		};
	}
	if (legacyOutput === "false") {
		return {
			direction: "input",
			directionSource: "legacy-output-attribute",
		};
	}
	if (type === undefined && legacyOutput === undefined) {
		// PinAttributes in the pinned 4.1.0 profile defaults to an input pin.
		return { direction: "input", directionSource: "profile-default" };
	}
	return { direction: "unknown", directionSource: "unrecognized" };
}

function pinWidth(
	attributes: readonly LogisimNamedAttribute[],
): Pick<LogisimPinSemantics, "width" | "widthSource"> {
	const lexical = logisimAttributeValue(attributes, "width");
	if (lexical === undefined) {
		return { width: 1, widthSource: "profile-default" };
	}
	if (!/^\d+$/u.test(lexical)) {
		return { width: null, widthSource: "invalid" };
	}
	const width = Number(lexical);
	if (
		!Number.isSafeInteger(width) ||
		width < 1 ||
		width > MAX_LOGISIM_PIN_WIDTH
	) {
		return { width: null, widthSource: "invalid" };
	}
	return { width, widthSource: "width-attribute" };
}

function classifyComponents(project: LogisimProject): void {
	const libraryById = new Map(
		project.libraries.map((library) => [library.id, library]),
	);
	const circuitNames = new Set(project.circuits.map((circuit) => circuit.name));
	for (const circuit of project.circuits) {
		for (const component of circuit.components) {
			const library =
				component.libraryId === null
					? undefined
					: libraryById.get(component.libraryId);
			component.libraryDescriptor = library?.descriptor ?? null;
			const isWiringLibrary =
				library?.descriptor === "#Wiring" || library?.descriptor === "#Base";
			if (isWiringLibrary && component.name === "Pin") {
				component.kind = "pin";
				component.pin = {
					...pinDirection(component.attributes),
					...pinWidth(component.attributes),
					label: logisimAttributeValue(component.attributes, "label") ?? null,
					facing: logisimAttributeValue(component.attributes, "facing") ?? null,
					behavior:
						logisimAttributeValue(component.attributes, "behavior") ?? null,
				};
				continue;
			}
			if (isWiringLibrary && component.name === "Clock") {
				component.kind = "clock";
				component.clock = {
					label: logisimAttributeValue(component.attributes, "label") ?? null,
					facing: logisimAttributeValue(component.attributes, "facing") ?? null,
					highDuration:
						logisimAttributeValue(component.attributes, "highDuration") ?? null,
					lowDuration:
						logisimAttributeValue(component.attributes, "lowDuration") ?? null,
					phase: logisimAttributeValue(component.attributes, "phase") ?? null,
				};
				continue;
			}
			if (component.libraryId === null && circuitNames.has(component.name)) {
				component.kind = "subcircuit";
				continue;
			}
			component.kind =
				component.libraryId === null || library === undefined
					? "unknown"
					: "component";
		}
	}
}

export function finalizeLogisimProjectModel(project: LogisimProject): void {
	classifyComponents(project);
}

/**
 * Returns a bounded, non-path-leaking verdict for configured-JAR execution.
 *
 * The parser records every relevant occurrence before unknown-construct
 * samples are truncated. This assessor therefore never infers safety from the
 * bounded diagnostic sample list.
 */
export function assessLogisimRuntimeSafety(
	project: LogisimProject,
): LogisimRuntimeSafetyAssessment {
	const counts = new Map<LogisimRuntimeSafetyReasonCode, number>();
	for (const reason of project.runtimeSafetySignals.reasons) {
		if (!Number.isSafeInteger(reason.count) || reason.count < 1) {
			continue;
		}
		counts.set(reason.code, (counts.get(reason.code) ?? 0) + reason.count);
	}
	const allReasons = LOGISIM_RUNTIME_SAFETY_REASON_CODES.flatMap((code) => {
		const count = counts.get(code);
		return count === undefined ? [] : [{ code, count }];
	});
	const reasons = allReasons.slice(0, MAX_LOGISIM_RUNTIME_SAFETY_REASONS);
	return {
		assessmentVersion: "logisim.runtime-safety/0.1",
		safe: allReasons.length === 0,
		reasonOccurrenceCount: allReasons.reduce(
			(total, reason) => total + reason.count,
			0,
		),
		reasons,
		reasonBounds: {
			total: allReasons.length,
			returned: reasons.length,
			limit: MAX_LOGISIM_RUNTIME_SAFETY_REASONS,
			truncated: reasons.length < allReasons.length,
		},
	};
}

/**
 * Summarizes input width without silently treating malformed pin metadata as a
 * safe truth-table bound. `inputBitTotal` is the recognized subtotal;
 * `inputBitTotalComplete=false` means callers must not use it as a full bound.
 */
export function summarizeLogisimCircuitIo(
	project: LogisimProject,
	circuitName = project.metadata.mainCircuitName ??
		project.circuits[0]?.name ??
		"",
): LogisimCircuitPinSummary {
	const circuit = project.circuits.find(
		(candidate) => candidate.name === circuitName,
	);
	if (circuit === undefined) {
		return {
			circuitName,
			circuitFound: false,
			pins: [],
			pinCount: 0,
			inputPinCount: 0,
			outputPinCount: 0,
			inoutPinCount: 0,
			unknownDirectionPinCount: 0,
			inputBitTotal: 0,
			inputBitTotalComplete: false,
		};
	}

	const pins = circuit.components
		.filter(
			(
				component,
			): component is LogisimComponent & {
				pin: LogisimPinSemantics;
			} => component.kind === "pin" && component.pin !== null,
		)
		.map((component) => ({
			componentId: component.id,
			label: component.pin.label,
			direction: component.pin.direction,
			width: component.pin.width,
			location: component.location.point,
		}));
	const inputPins = pins.filter((pin) => pin.direction === "input");
	return {
		circuitName: circuit.name,
		circuitFound: true,
		pins,
		pinCount: pins.length,
		inputPinCount: inputPins.length,
		outputPinCount: pins.filter((pin) => pin.direction === "output").length,
		inoutPinCount: pins.filter((pin) => pin.direction === "inout").length,
		unknownDirectionPinCount: pins.filter((pin) => pin.direction === "unknown")
			.length,
		inputBitTotal: inputPins.reduce(
			(total, pin) => total + (pin.width ?? 0),
			0,
		),
		inputBitTotalComplete: pins.every(
			(pin) => pin.direction !== "unknown" && pin.width !== null,
		),
	};
}
