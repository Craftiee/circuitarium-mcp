export type CrumbKnowledgeConfidence =
  | "controlled"
  | "installed-build"
  | "official-example"
  | "inferred"
  | "unknown";

export type CrumbElectricalRole =
  | "structure"
  | "interconnect"
  | "passive"
  | "semiconductor"
  | "programmable"
  | "source"
  | "annotation"
  | "unknown";

export interface CrumbParameterField {
  valueIndex: number;
  name: string;
  unit?: string;
  confidence: CrumbKnowledgeConfidence;
  description?: string;
}

export interface CrumbComponentDefinition {
  toolId: number;
  kind: string;
  label: string;
  role: CrumbElectricalRole;
  confidence: CrumbKnowledgeConfidence;
  expectedDataTypes: string[];
  alternateDataTypes?: string[][];
  readSupport: "full" | "partial";
  writeSupport: "verified-fixture" | "none";
  terminalNames?: string[];
  parameterFields: CrumbParameterField[];
  notes: string[];
}

/**
 * Independently authored catalog entries containing version-pinned
 * interoperability facts. Values marked `installed-build` were manually
 * transcribed from inspection of the tested CRUMB build; no executable,
 * resource, or scene payload from CRUMB is embedded here. Values marked
 * `official-example` came from analyzing developer-published designs that are
 * not redistributed with this repository. See PROVENANCE.md.
 */
const DEFINITIONS: CrumbComponentDefinition[] = [
  {
    toolId: 0,
    kind: "breadboard",
    label: "Solderless breadboard",
    role: "structure",
    confidence: "controlled",
    expectedDataTypes: ["guid", "Vector3S", "QuaternionS"],
    readSupport: "full",
    writeSupport: "verified-fixture",
    parameterFields: [],
    notes: [
      "Controlled CRUMB 1.3.5 save and generated-file reopen.",
      "Internal breadboard bus topology is not encoded directly in the .cru component payload.",
    ],
  },
  {
    toolId: 1,
    kind: "power-rail",
    label: "Detached breadboard power rail",
    role: "structure",
    confidence: "controlled",
    expectedDataTypes: ["guid", "Vector3S", "QuaternionS"],
    readSupport: "full",
    writeSupport: "verified-fixture",
    parameterFields: [],
    notes: ["Generated CRUMB fixture visually reopened as a red/blue power-rail strip."],
  },
  {
    toolId: 2,
    kind: "jumper-wire",
    label: "Jumper wire",
    role: "interconnect",
    confidence: "official-example",
    expectedDataTypes: [
      "guid",
      "ArrayOfVector3S",
      "ArrayOfTiePointID",
      "xsd:int",
      "xsd:float",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: ["endpoint-a", "endpoint-b"],
    parameterFields: [
      {
        valueIndex: 3,
        name: "colorCode",
        confidence: "official-example",
        description: "CRUMB color enum; palette mapping is not yet decoded.",
      },
      {
        valueIndex: 4,
        name: "currentRating",
        unit: "ampere",
        confidence: "official-example",
        description: "Named IRating in the installed CRUMB metadata.",
      },
    ],
    notes: ["Its two tie points are explicitly electrically connected by the wire."],
  },
  {
    toolId: 3,
    kind: "resistor",
    label: "Resistor",
    role: "passive",
    confidence: "controlled",
    expectedDataTypes: [
      "guid",
      "ArrayOfVector3S",
      "ArrayOfTiePointID",
      "xsd:float",
      "xsd:float",
    ],
    readSupport: "full",
    writeSupport: "verified-fixture",
    terminalNames: ["terminal-a", "terminal-b"],
    parameterFields: [
      { valueIndex: 3, name: "resistance", unit: "ohm", confidence: "controlled" },
      { valueIndex: 4, name: "maxPower", unit: "watt", confidence: "controlled" },
    ],
    notes: ["Controlled default: 1000 ohm, 0.25 watt."],
  },
  {
    toolId: 4,
    kind: "capacitor",
    label: "Capacitor",
    role: "passive",
    confidence: "official-example",
    expectedDataTypes: [
      "guid",
      "ArrayOfVector3S",
      "ArrayOfTiePointID",
      "xsd:double",
      "xsd:int",
      "xsd:boolean",
    ],
    readSupport: "partial",
    writeSupport: "none",
    terminalNames: ["terminal-a", "terminal-b"],
    parameterFields: [
      {
        valueIndex: 3,
        name: "capacitance",
        unit: "farad",
        confidence: "official-example",
      },
      {
        valueIndex: 4,
        name: "capacitorTypeCode",
        confidence: "official-example",
      },
      {
        valueIndex: 5,
        name: "trapModel",
        confidence: "official-example",
      },
    ],
    notes: ["Field names are corroborated by installed CRUMB metadata."],
  },
  {
    toolId: 5,
    kind: "integrated-circuit",
    label: "DIP integrated circuit",
    role: "semiconductor",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "xsd:int",
    ],
    alternateDataTypes: [
      [
        "guid",
        "Vector3S",
        "QuaternionS",
        "ArrayOfTiePointID",
        "xsd:base64Binary",
        "xsd:int",
      ],
    ],
    readSupport: "partial",
    writeSupport: "none",
    parameterFields: [
      {
        valueIndex: 4,
        name: "prefabId",
        confidence: "installed-build",
        description:
          "Selects a version-pinned IC package. It is index 4 in the normal signature and fixed index 5 in the prefab-13 EEPROM signature.",
      },
    ],
    notes: [
      "Inspection of the tested CRUMB 1.3.5 build showed tiePointIDs index order matching the prefab pin-array order.",
      "Use the prefabId registry for package label and semantic pin names.",
      "Prefab 13 (28C16 EEPROM) inserts a 2,048-byte EEPROM image immediately before the trailing prefabId.",
    ],
  },
  {
    toolId: 6,
    kind: "led-5mm",
    label: "5 mm LED",
    role: "semiconductor",
    confidence: "controlled",
    expectedDataTypes: [
      "guid",
      "ArrayOfVector3S",
      "ArrayOfTiePointID",
      "xsd:double",
      "xsd:int",
      "xsd:double",
    ],
    readSupport: "full",
    writeSupport: "verified-fixture",
    terminalNames: ["terminal-a", "terminal-b"],
    parameterFields: [
      {
        valueIndex: 3,
        name: "forwardVoltage",
        unit: "volt",
        confidence: "controlled",
      },
      {
        valueIndex: 4,
        name: "colorCode",
        confidence: "controlled",
        description: "Controlled value 0 is red.",
      },
      {
        valueIndex: 5,
        name: "maxCurrent",
        unit: "ampere",
        confidence: "controlled",
      },
    ],
    notes: [
      "Controlled default: red, 2.2 volts, 0.03 amperes.",
      "Serialized terminal order is preserved, but polarity naming is not yet verified.",
    ],
  },
  {
    toolId: 7,
    kind: "dc-power-supply-12v",
    label: "DC 12V Power Supply",
    role: "source",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "xsd:boolean",
      "xsd:float",
      "ArrayOfTiePointID",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: ["positive-output", "ground"],
    parameterFields: [
      {
        valueIndex: 3,
        name: "on",
        confidence: "installed-build",
      },
      {
        valueIndex: 4,
        name: "dcVoltage",
        unit: "volt",
        confidence: "installed-build",
        description: "Adjustable output with an installed-build range of 0 to 12 volts.",
      },
    ],
    notes: [
      "Inspection of the tested build observed terminal 0 used as the variable positive output and terminal 1 as ground.",
      "Installed defaults are off at 5 volts.",
    ],
  },
  {
    toolId: 8,
    kind: "tactile-switch",
    label: "Tactile Switch",
    role: "interconnect",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: ["side-a-1", "side-b-1", "side-a-2", "side-b-2"],
    parameterFields: [],
    notes: [
      "Momentary pressed state is not persisted in the save.",
      "While pressed, native behavior closes terminal pairs 0-2 and 1-3; connection analysis does not apply dynamic switch state.",
    ],
  },
  {
    toolId: 9,
    kind: "slide-switch",
    label: "Slide Switch",
    role: "interconnect",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "xsd:int",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: ["common", "throw-0", "throw-1"],
    parameterFields: [
      {
        valueIndex: 4,
        name: "positionCode",
        confidence: "installed-build",
        description: "0 closes common to throw-0; 1 closes common to throw-1.",
      },
    ],
    notes: [
      "This is a bistable SPDT switch with no electrical polarity.",
      "Connection analysis preserves its terminals as a branch and does not union the selected throw.",
    ],
  },
  {
    toolId: 10,
    kind: "potentiometer",
    label: "Potentiometer",
    role: "passive",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "xsd:float",
      "xsd:double",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: ["wiper", "end-a", "end-b"],
    parameterFields: [
      {
        valueIndex: 4,
        name: "position",
        confidence: "installed-build",
        description: "Normalized 0-to-1 wiper position.",
      },
      {
        valueIndex: 5,
        name: "maxResistance",
        unit: "ohm",
        confidence: "installed-build",
      },
    ],
    notes: [
      "Resistance from wiper to end-a rises with position; wiper to end-b falls.",
      "Installed defaults are position 0.5 and 10,000 ohms.",
    ],
  },
  {
    toolId: 11,
    kind: "label",
    label: "Label",
    role: "annotation",
    confidence: "installed-build",
    expectedDataTypes: ["guid", "Vector3S", "QuaternionS", "xsd:string"],
    readSupport: "full",
    writeSupport: "none",
    parameterFields: [],
    notes: [
      "This is a visual annotation with no electrical terminals.",
      "User-authored text is returned only as untrusted bounded preview metadata.",
    ],
  },
  {
    toolId: 12,
    kind: "seven-segment-display",
    label: "Seven Segment Display",
    role: "semiconductor",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "xsd:double",
      "xsd:double",
      "xsd:boolean",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: [
      "segment-e",
      "segment-d",
      "common-1",
      "segment-c",
      "decimal-point",
      "segment-b",
      "segment-a",
      "common-2",
      "segment-f",
      "segment-g",
    ],
    parameterFields: [
      {
        valueIndex: 4,
        name: "forwardVoltage",
        unit: "volt",
        confidence: "installed-build",
      },
      {
        valueIndex: 5,
        name: "maxCurrent",
        unit: "ampere",
        confidence: "installed-build",
      },
      {
        valueIndex: 6,
        name: "commonAnode",
        confidence: "installed-build",
        description: "false means common cathode; true means common anode.",
      },
    ],
    notes: [
      "Inspection of the tested build observed the serialized segment and common-terminal order listed here.",
      "Package recognition does not simulate segment currents or illumination.",
    ],
  },
  {
    toolId: 13,
    kind: "dip-switch-4",
    label: "4bit DIP Switch",
    role: "interconnect",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "ArrayOfBoolean",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: [
      "switch-1-a",
      "switch-2-a",
      "switch-3-a",
      "switch-4-a",
      "switch-4-b",
      "switch-3-b",
      "switch-2-b",
      "switch-1-b",
    ],
    parameterFields: [
      {
        valueIndex: 4,
        name: "positions",
        confidence: "installed-build",
        description: "Four booleans in switch order; true means ON/closed.",
      },
    ],
    notes: [
      "Switch i connects terminal i to terminal 7-i when its position is true.",
      "Connection analysis reports terminals and state but does not union closed switch pairs.",
    ],
  },
  {
    toolId: 14,
    kind: "dip-switch-8",
    label: "8bit DIP Switch",
    role: "interconnect",
    confidence: "installed-build",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "ArrayOfBoolean",
    ],
    readSupport: "full",
    writeSupport: "none",
    terminalNames: [
      "switch-1-a",
      "switch-2-a",
      "switch-3-a",
      "switch-4-a",
      "switch-5-a",
      "switch-6-a",
      "switch-7-a",
      "switch-8-a",
      "switch-8-b",
      "switch-7-b",
      "switch-6-b",
      "switch-5-b",
      "switch-4-b",
      "switch-3-b",
      "switch-2-b",
      "switch-1-b",
    ],
    parameterFields: [
      {
        valueIndex: 4,
        name: "positions",
        confidence: "installed-build",
        description: "Eight booleans in switch order; true means ON/closed.",
      },
    ],
    notes: [
      "Switch i connects terminal i to terminal 15-i when its position is true.",
      "Connection analysis reports terminals and state but does not union closed switch pairs.",
    ],
  },
  {
    toolId: 15,
    kind: "diode",
    label: "Diode",
    role: "semiconductor",
    confidence: "official-example",
    expectedDataTypes: [
      "guid",
      "ArrayOfVector3S",
      "ArrayOfTiePointID",
      "xsd:int",
      "xsd:double",
      "xsd:double",
      "xsd:double",
      "xsd:double",
    ],
    readSupport: "partial",
    writeSupport: "none",
    terminalNames: ["terminal-a", "terminal-b"],
    parameterFields: [
      { valueIndex: 3, name: "diodeTypeCode", confidence: "official-example" },
      {
        valueIndex: 4,
        name: "forwardVoltage",
        unit: "volt",
        confidence: "official-example",
      },
      {
        valueIndex: 5,
        name: "zenerVoltage",
        unit: "volt",
        confidence: "official-example",
      },
      {
        valueIndex: 6,
        name: "leakageCurrent",
        unit: "ampere",
        confidence: "official-example",
      },
      {
        valueIndex: 7,
        name: "maxCurrent",
        unit: "ampere",
        confidence: "official-example",
      },
    ],
    notes: ["Field names are corroborated by installed CRUMB metadata."],
  },
  {
    toolId: 20,
    kind: "arduino-microcontroller",
    label: "Arduino microcontroller",
    role: "programmable",
    confidence: "official-example",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "xsd:string",
      "xsd:string",
    ],
    readSupport: "partial",
    writeSupport: "none",
    parameterFields: [],
    notes: [
      "The first string contains source code in the developer-published CPU example.",
      "Exact CRUMB UI product name and semantic pin-name mapping are not yet verified.",
    ],
  },
  {
    toolId: 24,
    kind: "signal-generator-12v",
    label: "12V Signal Generator",
    role: "source",
    confidence: "official-example",
    expectedDataTypes: [
      "guid",
      "Vector3S",
      "QuaternionS",
      "xsd:boolean",
      "ArrayOfTiePointID",
      "xsd:float",
      "xsd:float",
      "xsd:int",
    ],
    readSupport: "partial",
    writeSupport: "none",
    terminalNames: ["terminal-a", "terminal-b"],
    parameterFields: [
      {
        valueIndex: 3,
        name: "enabledOrConnected",
        confidence: "inferred",
        description: "Boolean field name remains ambiguous between UI state and connection state.",
      },
      {
        valueIndex: 5,
        name: "voltage",
        unit: "volt",
        confidence: "official-example",
      },
      {
        valueIndex: 6,
        name: "frequency",
        unit: "hertz",
        confidence: "official-example",
      },
      {
        valueIndex: 7,
        name: "waveformCode",
        confidence: "official-example",
      },
    ],
    notes: ["UI catalog label and field names are corroborated by installed CRUMB metadata."],
  },
];

const BY_TOOL_ID = new Map(DEFINITIONS.map((definition) => [definition.toolId, definition]));

function cloneDefinition(
  definition: CrumbComponentDefinition,
): CrumbComponentDefinition {
  return {
    ...definition,
    expectedDataTypes: [...definition.expectedDataTypes],
    ...(definition.alternateDataTypes === undefined
      ? {}
      : {
          alternateDataTypes: definition.alternateDataTypes.map((signature) => [
            ...signature,
          ]),
        }),
    parameterFields: definition.parameterFields.map((field) => ({ ...field })),
    notes: [...definition.notes],
    ...(definition.terminalNames === undefined
      ? {}
      : { terminalNames: [...definition.terminalNames] }),
  };
}

export function getCrumbComponentDefinition(
  toolId: number,
): CrumbComponentDefinition | undefined {
  const definition = BY_TOOL_ID.get(toolId);
  return definition === undefined ? undefined : cloneDefinition(definition);
}

export function listCrumbComponentDefinitions(): CrumbComponentDefinition[] {
  return DEFINITIONS.map(cloneDefinition);
}
