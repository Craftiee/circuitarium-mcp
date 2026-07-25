import {
  CRUMB_ENGINE_FAMILY,
  CRUMB_ENGINE_VERSION,
  CRUMB_TESTED_GAME_VERSION,
  CRUMB_TESTED_STEAM_BUILD_ID,
} from "./compatibility.js";

export const CRUMB_IC_CATALOG_TARGET = Object.freeze({
  gameVersion: CRUMB_TESTED_GAME_VERSION,
  steamBuildId: CRUMB_TESTED_STEAM_BUILD_ID,
  engineVersion: `${CRUMB_ENGINE_FAMILY} ${CRUMB_ENGINE_VERSION}`,
  il2CppMetadataVersion: "29.1",
  toolId: 5,
});

/**
 * Positional payload emitted by CRUMB 1.3.5 for tool 5 IC components.
 *
 * The XML namespace prefix on the GUID is generated per document (for example,
 * q1:guid), so consumers should normalize any `*:guid` type to `guid`.
 */
export const CRUMB_TOOL_5_SERIALIZED_PAYLOAD_SIGNATURE = Object.freeze({
  toolId: 5,
  fieldNames: Object.freeze([
    "identifier",
    "position",
    "rotation",
    "tiePointIDs",
    "prefabID",
  ] as const),
  dataTypes: Object.freeze([
    "guid",
    "Vector3S",
    "QuaternionS",
    "ArrayOfTiePointID",
    "xsd:int",
  ] as const),
  prefabIdValueIndex: 4,
});

export const CRUMB_TOOL_5_EEPROM_SERIALIZED_PAYLOAD_SIGNATURE = Object.freeze({
  toolId: 5,
  requiredPrefabId: 13,
  fieldNames: Object.freeze([
    "identifier",
    "position",
    "rotation",
    "tiePointIDs",
    "eepromData",
    "prefabID",
  ] as const),
  dataTypes: Object.freeze([
    "guid",
    "Vector3S",
    "QuaternionS",
    "ArrayOfTiePointID",
    "xsd:base64Binary",
    "xsd:int",
  ] as const),
  eepromDataValueIndex: 4,
  prefabIdValueIndex: 5,
  expectedDecodedBytes: 2048,
});

export type CrumbIcPinNameCoverage = "complete" | "partial" | "unresolved";

/**
 * Contract-v0.2 confidence tags. Here, "extracted" means a factual label or
 * ordering was manually transcribed from an installed-build observation; it
 * does not mean CRUMB assets are distributed by this project.
 */
export type CrumbIcCatalogConfidence =
  | "installed-build-extracted"
  | "installed-build-partial";

export interface CrumbIcPinDefinition {
  /** One-based physical package pin number. */
  packagePin: number;
  /**
   * Usable semantic name, or null when inspection of the tested build did not
   * expose an unambiguous name.
   */
  name: string | null;
  /** Exact transform name observed during inspection of the tested build. */
  sourceName: string;
}

export interface CrumbIcPinCoverage {
  status: CrumbIcPinNameCoverage;
  resolved: number;
  total: number;
}

export interface CrumbIcDefinition {
  prefabId: number;
  label: string;
  packageName: string;
  packagePinCount: number;
  pins: CrumbIcPinDefinition[];
  pinNameCoverage: CrumbIcPinCoverage;
  confidence: CrumbIcCatalogConfidence;
  sourceNote: string;
}

const COMMON_SOURCE_NOTE =
  "Observed in the installed CRUMB 1.3.5 build from scene component labels and " +
  "ordered pin transform names. Inspection of that tested build showed that " +
  "tiePointIDs[i] and the pin transform at index i are read as the same package pin.";

function makeDefinition(
  prefabId: number,
  label: string,
  sourceNames: readonly string[],
  unresolvedPackagePins: readonly number[] = [],
  additionalSourceNote?: string,
): CrumbIcDefinition {
  const unresolved = new Set(unresolvedPackagePins);
  const pins = sourceNames.map((sourceName, index) => {
    const packagePin = index + 1;
    return Object.freeze({
      packagePin,
      name: unresolved.has(packagePin) ? null : sourceName,
      sourceName,
    });
  });
  const resolved = pins.filter((pin) => pin.name !== null).length;
  const status: CrumbIcPinNameCoverage =
    resolved === pins.length ? "complete" : resolved === 0 ? "unresolved" : "partial";
  const coverage = Object.freeze({
    status,
    resolved,
    total: pins.length,
  });
  const definition: CrumbIcDefinition = {
    prefabId,
    label,
    packageName: `DIP-${pins.length}`,
    packagePinCount: pins.length,
    pins,
    pinNameCoverage: coverage,
    confidence:
      status === "complete"
        ? "installed-build-extracted"
        : "installed-build-partial",
    sourceNote:
      additionalSourceNote === undefined
        ? COMMON_SOURCE_NOTE
        : `${COMMON_SOURCE_NOTE} ${additionalSourceNote}`,
  };
  Object.freeze(definition.pins);
  return Object.freeze(definition);
}

/**
 * Version-pinned interoperability facts manually transcribed from inspection
 * of the tested installed build. This table contains no executable code,
 * resource files, scene files, or other asset payloads from CRUMB.
 *
 * These labels and orderings are observations, not a behavioral model of the
 * parts and not a compatibility claim for another CRUMB build. See
 * PROVENANCE.md before extending or regenerating this registry.
 */
const DEFINITIONS = [
  makeDefinition(0, "LM555", [
    "GND",
    "TRIG",
    "Q",
    "|RST",
    "CV",
    "THR",
    "DIS",
    "Vcc",
  ]),
  makeDefinition(1, "74HC00 Quad NAND", [
    "1A",
    "1B",
    "1Y",
    "2A",
    "2B",
    "2Y",
    "GND",
    "3Y",
    "3A",
    "3B",
    "4Y",
    "4A",
    "4B",
    "Vcc",
  ]),
  makeDefinition(2, "74HC161 4bit Counter", [
    "|CLR",
    "CLK",
    "A",
    "B",
    "C",
    "D",
    "ENP",
    "GND",
    "|LOAD",
    "ENT",
    "Qd",
    "Qc",
    "Qb",
    "Qa",
    "RCO",
    "Vcc",
  ]),
  makeDefinition(3, "74HC245 8bit Buffer", [
    "DIR",
    "A0",
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
    "A6",
    "A7",
    "GND",
    "B7",
    "B6",
    "B5",
    "B4",
    "B3",
    "B2",
    "B1",
    "B0",
    "|OE",
    "Vcc",
  ]),
  makeDefinition(
    4,
    "75LS76",
    [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
    ],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    "The installed label is exactly '75LS76', and its transforms contain only " +
      "numeric pin names. Semantic pin names are intentionally unresolved.",
  ),
  makeDefinition(5, "74HC139 Dual 2to4 Decoder", [
    "1|E",
    "1A0",
    "1A1",
    "1|Y0",
    "1|Y1",
    "1|Y2",
    "1|Y3",
    "GND",
    "2|Y3",
    "2|Y2",
    "2|Y1",
    "2|Y0",
    "2A1",
    "2A0",
    "2|E",
    "Vcc",
  ]),
  makeDefinition(
    6,
    "74H02 Quad NOR",
    [
      "1Y",
      "1A",
      "1B",
      "2Y",
      "2A",
      "2B",
      "GND",
      "3A",
      "3B",
      "3Y",
      "4A",
      "4B",
      "4Y",
      "Vcc",
    ],
    [],
    "The installed component label is exactly '74H02 Quad NOR'; the catalog " +
      "does not silently correct it to another part number.",
  ),
  makeDefinition(7, "74HC04 Hex Inverter", [
    "1A",
    "1Y",
    "2A",
    "2Y",
    "3A",
    "3Y",
    "GND",
    "4Y",
    "4A",
    "5Y",
    "5A",
    "6Y",
    "6A",
    "Vcc",
  ]),
  makeDefinition(8, "74HC08 Quad AND", [
    "1A",
    "1B",
    "1Y",
    "2A",
    "2B",
    "2Y",
    "GND",
    "3Y",
    "3A",
    "3B",
    "4Y",
    "4A",
    "4B",
    "Vcc",
  ]),
  makeDefinition(9, "74HC32 Quad OR", [
    "1A",
    "1B",
    "1Y",
    "2A",
    "2B",
    "2Y",
    "GND",
    "3Y",
    "3A",
    "3B",
    "4Y",
    "4A",
    "4B",
    "Vcc",
  ]),
  makeDefinition(10, "74HC86 Quad XOR", [
    "1A",
    "1B",
    "1Y",
    "2A",
    "2B",
    "2Y",
    "GND",
    "3Y",
    "3A",
    "3B",
    "4Y",
    "4A",
    "4B",
    "Vcc",
  ]),
  makeDefinition(11, "74HC107 Dual JK", [
    "1J",
    "1|Q",
    "1Q",
    "1K",
    "2Q",
    "2|Q",
    "GND",
    "2J",
    "2|CP",
    "2|R",
    "2K",
    "1|CP",
    "1|R",
    "Vcc",
  ]),
  makeDefinition(12, "74HC138 3to8 Decoder", [
    "A",
    "B",
    "C",
    "|G2A",
    "|G2B",
    "G1",
    "Y7",
    "GND",
    "Y6",
    "Y5",
    "Y4",
    "Y3",
    "Y2",
    "Y1",
    "Y0",
    "Vcc",
  ]),
  makeDefinition(13, "28C16 EEPROM", [
    "A7",
    "A6",
    "A5",
    "A4",
    "A3",
    "A2",
    "A1",
    "A0",
    "IO0",
    "IO1",
    "IO2",
    "GND",
    "IO3",
    "IO4",
    "IO5",
    "IO6",
    "IO7",
    "|CE",
    "A10",
    "|OE",
    "|WE",
    "A9",
    "A8",
    "Vcc",
  ]),
  makeDefinition(14, "74HC173 Quad D", [
    "|OE",
    "|OE2",
    "Q0",
    "Q1",
    "Q2",
    "Q3",
    "CP",
    "GND",
    "|E1",
    "|E2",
    "D3",
    "D2",
    "D1",
    "D0",
    "MR",
    "Vcc",
  ]),
  makeDefinition(15, "74HC283 4bit Adder", [
    "S1",
    "B1",
    "A1",
    "S0",
    "A0",
    "B0",
    "Cin",
    "GND",
    "Cout",
    "S3",
    "B3",
    "A3",
    "S2",
    "A2",
    "B2",
    "Vcc",
  ]),
  makeDefinition(16, "74HC157 Quad 2-Input Multiplexer", [
    "S",
    "1A",
    "1B",
    "1Y",
    "2A",
    "2B",
    "2Y",
    "GND",
    "3Y",
    "3B",
    "3A",
    "4Y",
    "4B",
    "4A",
    "|E",
    "Vcc",
  ]),
  makeDefinition(17, "74HC273 Octal D Flip Flop", [
    "|CLR",
    "Q0",
    "D0",
    "D1",
    "Q1",
    "Q2",
    "D2",
    "D3",
    "Q3",
    "GND",
    "CLK",
    "Q4",
    "D4",
    "D5",
    "Q5",
    "Q6",
    "D6",
    "D7",
    "Q7",
    "Vcc",
  ]),
  makeDefinition(18, "74F189 64 Bit RAM", [
    "A0",
    "|CS",
    "|WE",
    "D0",
    "|O0",
    "D1",
    "|O1",
    "GND",
    "|O2",
    "D2",
    "|O3",
    "D3",
    "A3",
    "A2",
    "A1",
    "Vcc",
  ]),
  makeDefinition(
    19,
    "LM741",
    ["V>null", "I-", "I", "V-", "V>null", "O", "V+", "NC"],
    [1, 3, 5],
    "Pins 1 and 5 are named 'V>null' and pin 3 is named only 'I' in the " +
      "tested build. Their semantic names are intentionally unresolved.",
  ),
  makeDefinition(20, "74HC595 8bit Shift Register", [
    "Qb",
    "Qc",
    "Qd",
    "Qe",
    "Qf",
    "Qg",
    "Qh",
    "GND",
    "Qh'",
    "|SRCLR",
    "SRCLK",
    "RCLK",
    "|OE",
    "SER",
    "Qa",
    "Vcc",
  ]),
] satisfies CrumbIcDefinition[];

const CATALOG_BY_PREFAB_ID = Object.freeze(
  Object.fromEntries(DEFINITIONS.map((definition) => [definition.prefabId, definition])),
) as Readonly<Record<number, CrumbIcDefinition>>;

/**
 * Frozen, version-pinned observation registry keyed by the serialized trailing
 * prefabID.
 * Prefer the lookup/list functions when a caller needs mutable data.
 */
export const CRUMB_1_3_5_IC_CATALOG = CATALOG_BY_PREFAB_ID;

function cloneDefinition(definition: CrumbIcDefinition): CrumbIcDefinition {
  return {
    ...definition,
    pins: definition.pins.map((pin) => ({ ...pin })),
    pinNameCoverage: { ...definition.pinNameCoverage },
  };
}

export function getCrumbIcByPrefabId(
  prefabId: number,
): CrumbIcDefinition | undefined {
  const definition = CATALOG_BY_PREFAB_ID[prefabId];
  return definition === undefined ? undefined : cloneDefinition(definition);
}

export function listCrumbIcs(): CrumbIcDefinition[] {
  return DEFINITIONS.map(cloneDefinition);
}
