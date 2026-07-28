import { z } from "zod";

export const COMPONENT_PROFILE_VERSION =
  "electronics.component-profile/0.1" as const;
export const LOGISIM_STANDARD_LIBRARY_CATALOG_VERSION =
  "logisim-evolution.standard-library-catalog/0.1" as const;
export const LOGISIM_410_REVISION =
  "632d66dca880ac089e2c6c2c383ea20d9c707ee2" as const;
export const LOGISIM_410_RELEASE_URL =
  "https://github.com/logisim-evolution/logisim-evolution/releases/tag/v4.1.0" as const;
export const LOGISIM_410_LICENSE_URL =
  "https://github.com/logisim-evolution/logisim-evolution/blob/632d66dca880ac089e2c6c2c383ea20d9c707ee2/LICENSE.md" as const;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(192)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/u);
const BoundedTextSchema = z.string().min(1).max(2_048);
const SourceSchema = z
  .object({
    sourceId: IdentifierSchema,
    kind: z.enum([
      "official-release",
      "official-source",
      "official-manual",
      "manufacturer-datasheet",
      "controlled-observation",
    ]),
    title: z.string().min(1).max(256),
    publisher: z.string().min(1).max(128),
    revision: z.string().min(1).max(128),
    url: z.url().max(2_048),
    supports: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(32)
      .refine((values) => new Set(values).size === values.length, {
        message: "Source support claims must be unique.",
      }),
    license: z.string().min(1).max(128).optional(),
  })
  .strict();

const PortWidthSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fixed"),
      bits: z.number().int().positive().max(65_536),
      description: z.string().min(1).max(256).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("parameter"),
      parameter: IdentifierSchema,
      description: z.string().min(1).max(256).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("derived"),
      description: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unknown"),
      description: z.string().min(1).max(256),
    })
    .strict(),
]);

const PortGroupSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().min(1).max(128),
    direction: z.enum([
      "input",
      "output",
      "inout",
      "passive",
      "power",
      "ground",
      "unknown",
    ]),
    role: z.enum([
      "data",
      "address",
      "select",
      "enable",
      "clock",
      "reset",
      "set",
      "carry",
      "observation",
      "stimulus",
      "power",
      "ground",
      "other",
      "unknown",
    ]),
    multiplicity: z.enum(["one", "configurable", "derived"]),
    width: PortWidthSchema,
    activeLevel: z.enum(["high", "low", "edge", "not-applicable", "unknown"]),
    notes: z.array(z.string().min(1).max(512)).max(8),
  })
  .strict();

const ParameterSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().min(1).max(128),
    valueType: z.enum([
      "boolean",
      "integer",
      "number",
      "string",
      "enum",
      "bit-width",
      "duration",
      "unknown",
    ]),
    required: z.boolean(),
    affects: z
      .array(
        z.enum([
          "identity",
          "ports",
          "behavior",
          "timing",
          "appearance",
          "verification",
        ]),
      )
      .min(1)
      .max(6)
      .refine((values) => new Set(values).size === values.length, {
        message: "Parameter effects must be unique.",
      }),
    description: z.string().min(1).max(512),
  })
  .strict();

const AdapterBindingSchema = z
  .object({
    backendId: z.string().min(1).max(128),
    compatibilityProfile: z.string().min(1).max(128),
    libraryId: z.string().min(1).max(128),
    componentId: z.string().min(1).max(192),
    support: z.enum([
      "identity-only",
      "semantic-profile",
      "static-analysis",
      "runtime-eligible",
      "runtime-forbidden",
    ]),
    notes: z.array(z.string().min(1).max(512)).max(8),
  })
  .strict();

export const ComponentProfileSchema = z
  .object({
    profileVersion: z.literal(COMPONENT_PROFILE_VERSION),
    profileId: IdentifierSchema,
    displayName: z.string().min(1).max(192),
    semanticConcept: z
      .object({
        conceptId: IdentifierSchema,
        relation: z.enum(["instance-of", "similar-to"]),
        equivalenceClaim: z.literal("none"),
      })
      .strict()
      .nullable(),
    domain: z.enum([
      "digital",
      "analog",
      "mixed-signal",
      "power",
      "mechanical",
      "annotation",
      "unknown",
    ]),
    behaviorClass: z.enum([
      "interconnect",
      "source",
      "stimulus",
      "combinational",
      "sequential",
      "memory",
      "observation",
      "transducer",
      "programmable",
      "annotation",
      "unknown",
    ]),
    summary: BoundedTextSchema,
    portGroups: z.array(PortGroupSchema).max(32),
    parameters: z.array(ParameterSchema).max(32),
    verification: z
      .object({
        stateModel: z.enum([
          "stateless",
          "stateful",
          "time-dependent",
          "analog-or-mixed",
          "unknown",
        ]),
        suitableEvidence: z.array(z.string().min(1).max(512)).min(1).max(16),
        insufficientEvidence: z
          .array(z.string().min(1).max(512))
          .min(1)
          .max(16),
      })
      .strict(),
    adapterBindings: z.array(AdapterBindingSchema).min(1).max(16),
    sources: z.array(SourceSchema).min(1).max(16),
    limitations: z.array(z.string().min(1).max(1_024)).min(1).max(16),
  })
  .strict()
  .superRefine((profile, context) => {
    const addDuplicateIssues = (
      values: readonly string[],
      path: (string | number)[],
      label: string,
    ): void => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            message: `${label} must be unique within a component profile.`,
            path: [...path, index],
          });
        }
        seen.add(value);
      }
    };

    addDuplicateIssues(
      profile.portGroups.map((portGroup) => portGroup.id),
      ["portGroups"],
      "Port-group IDs",
    );
    addDuplicateIssues(
      profile.parameters.map((parameter) => parameter.id),
      ["parameters"],
      "Parameter IDs",
    );
    addDuplicateIssues(
      profile.adapterBindings.map(
        (adapterBinding) =>
          `${adapterBinding.backendId}\u0000${adapterBinding.compatibilityProfile}\u0000${adapterBinding.libraryId}\u0000${adapterBinding.componentId}`,
      ),
      ["adapterBindings"],
      "Adapter bindings",
    );
    addDuplicateIssues(
      profile.sources.map((source) => source.sourceId),
      ["sources"],
      "Source IDs",
    );

    const parametersById = new Map(
      profile.parameters.map((parameter) => [parameter.id, parameter]),
    );
    for (const [index, portGroup] of profile.portGroups.entries()) {
      if (portGroup.width.kind !== "parameter") continue;
      const parameter = parametersById.get(portGroup.width.parameter);
      if (parameter === undefined) {
        context.addIssue({
          code: "custom",
          message: "Port width references an undefined parameter.",
          path: ["portGroups", index, "width", "parameter"],
        });
      } else if (parameter.valueType !== "bit-width") {
        context.addIssue({
          code: "custom",
          message: "Port width must reference a bit-width parameter.",
          path: ["portGroups", index, "width", "parameter"],
        });
      }
    }
  });

export type ComponentProfile = z.infer<typeof ComponentProfileSchema>;

interface CatalogIdentity {
  componentId: string;
  semanticProfileId?: string;
}

interface CatalogLibraryDefinition {
  libraryId: string;
  displayName: string;
  hidden: boolean;
  runtimePolicy:
    | "eligible-after-project-preflight"
    | "conditional-component-denials"
    | "forbidden-by-runtime-preflight";
  runtimeNotes: string[];
  sourcePath: string;
  identities: readonly CatalogIdentity[];
}

const sourceUrl = (path: string): string =>
  `https://github.com/logisim-evolution/logisim-evolution/blob/${LOGISIM_410_REVISION}/${path}`;
const manualUrl = (path: string): string =>
  sourceUrl(`src/main/resources/doc/en/html/libs/${path}`);

const ids = (
  entries: ReadonlyArray<
    readonly [componentId: string, semanticProfileId?: string]
  >,
): CatalogIdentity[] =>
  entries.map(([componentId, semanticProfileId]) => ({
    componentId,
    ...(semanticProfileId === undefined ? {} : { semanticProfileId }),
  }));

const LOGISIM_STANDARD_LIBRARIES: readonly CatalogLibraryDefinition[] = [
  {
    libraryId: "Base",
    displayName: "Base",
    hidden: true,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [
      "Text is annotation rather than executable circuit behavior.",
    ],
    sourcePath: "src/main/java/com/cburch/logisim/std/base/BaseLibrary.java",
    identities: ids([["Text"]]),
  },
  {
    libraryId: "Gates",
    displayName: "Gates",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [],
    sourcePath: "src/main/java/com/cburch/logisim/std/gates/GatesLibrary.java",
    identities: ids([
      ["NOT Gate", "logisim.gates/not"],
      ["Buffer"],
      ["AND Gate", "logisim.gates/and"],
      ["OR Gate"],
      ["NAND Gate"],
      ["NOR Gate"],
      ["XOR Gate"],
      ["XNOR Gate"],
      ["Odd Parity"],
      ["Even Parity"],
      ["Controlled Buffer"],
      ["Controlled Inverter"],
      ["PLA"],
    ]),
  },
  {
    libraryId: "Wiring",
    displayName: "Wiring",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [],
    sourcePath:
      "src/main/java/com/cburch/logisim/std/wiring/WiringLibrary.java",
    identities: ids([
      ["Splitter"],
      ["Pin", "logisim.wiring/pin"],
      ["Probe"],
      ["Tunnel"],
      ["Pull Resistor"],
      ["Clock", "logisim.wiring/clock"],
      ["POR"],
      ["Constant", "logisim.wiring/constant"],
      ["Power"],
      ["Ground"],
      ["NoConnect"],
      ["Transistor"],
      ["Transmission Gate"],
      ["Bit Extender"],
    ]),
  },
  {
    libraryId: "Plexers",
    displayName: "Plexers",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [],
    sourcePath:
      "src/main/java/com/cburch/logisim/std/plexers/PlexersLibrary.java",
    identities: ids([
      ["Multiplexer", "logisim.plexers/multiplexer"],
      ["Demultiplexer"],
      ["Decoder"],
      ["Priority Encoder"],
      ["BitSelector"],
    ]),
  },
  {
    libraryId: "Arithmetic",
    displayName: "Arithmetic",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [],
    sourcePath:
      "src/main/java/com/cburch/logisim/std/arith/ArithmeticLibrary.java",
    identities: ids([
      ["Adder", "logisim.arithmetic/adder"],
      ["Subtractor"],
      ["Multiplier"],
      ["Divider"],
      ["Negator"],
      ["Exponentiator"],
      ["SquareRoot"],
      ["Absolute"],
      ["Comparator"],
      ["MinMax"],
      ["Shifter"],
      ["BitAdder"],
      ["BitFinder"],
    ]),
  },
  {
    libraryId: "FPArithmetic",
    displayName: "Floating Point",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [],
    sourcePath:
      "src/main/java/com/cburch/logisim/std/arith/floating/FPArithmeticLibrary.java",
    identities: ids([
      ["FPAdder"],
      ["FPSubtractor"],
      ["FPMultiplier"],
      ["FPDivider"],
      ["FPNegator"],
      ["FPExponentiator"],
      ["FPLogarithm"],
      ["FPSquareRoot"],
      ["FPAbsolute"],
      ["FPComparator"],
      ["FPMinMax"],
      ["FPRound"],
      ["FPTrigonometry"],
      ["FPClassificator"],
      ["FPToFP"],
      ["FPToInt"],
      ["IntToFP"],
    ]),
  },
  {
    libraryId: "Memory",
    displayName: "Memory",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [],
    sourcePath:
      "src/main/java/com/cburch/logisim/std/memory/MemoryLibrary.java",
    identities: ids([
      ["D Flip-Flop", "logisim.memory/d-flip-flop"],
      ["T Flip-Flop"],
      ["J-K Flip-Flop"],
      ["S-R Flip-Flop"],
      ["Register", "logisim.memory/register"],
      ["Counter"],
      ["Shift Register"],
      ["Random"],
      ["RAM", "logisim.memory/ram"],
      ["ROM"],
      ["DualRAM"],
    ]),
  },
  {
    libraryId: "I/O",
    displayName: "Input/Output",
    hidden: false,
    runtimePolicy: "conditional-component-denials",
    runtimeNotes: [
      "Circuitarium runtime preflight rejects the Telnet component.",
      "Other components remain subject to the general deny-by-default project preflight.",
    ],
    sourcePath: "src/main/java/com/cburch/logisim/std/io/IoLibrary.java",
    identities: ids([
      ["Button"],
      ["DipSwitch"],
      ["Joystick"],
      ["Keyboard"],
      ["LED", "logisim.io/led"],
      ["LedBar"],
      ["RGBLED"],
      ["7-Segment Display"],
      ["Hex Digit Display"],
      ["DotMatrix"],
      ["TTY"],
      ["PortIO"],
      ["ReptarLB"],
      ["Telnet"],
      ["RGB Video"],
    ]),
  },
  {
    libraryId: "TTL",
    displayName: "TTL",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [
      "Part numbers are Logisim project identities, not manufacturer datasheet profiles.",
    ],
    sourcePath: "src/main/java/com/cburch/logisim/std/ttl/TtlLibrary.java",
    identities: [
      "7400",
      "7402",
      "7404",
      "7408",
      "7410",
      "7411",
      "7413",
      "7414",
      "7418",
      "7419",
      "7420",
      "7421",
      "7424",
      "7427",
      "7430",
      "7432",
      "7434",
      "7436",
      "7442",
      "7443",
      "7444",
      "7447",
      "7451",
      "7454",
      "7458",
      "7464",
      "7474",
      "7485",
      "7486",
      "7487",
      "74125",
      "74138",
      "74139",
      "74151",
      "74153",
      "74157",
      "74158",
      "74161",
      "74163",
      "74164",
      "74165",
      "74166",
      "74175",
      "74181",
      "74182",
      "74192",
      "74193",
      "74194",
      "74240",
      "74241",
      "74244",
      "74245",
      "74266",
      "74273",
      "74283",
      "74299",
      "74377",
      "74381",
      "74541",
      "74670",
      "747266",
    ].map((componentId) => ({ componentId })),
  },
  {
    libraryId: "HDL-IP",
    displayName: "HDL-IP",
    hidden: false,
    runtimePolicy: "forbidden-by-runtime-preflight",
    runtimeNotes: [
      "Circuitarium runtime preflight rejects HDL-IP because it can reference executable or external HDL behavior.",
    ],
    sourcePath: "src/main/java/com/cburch/logisim/std/hdl/HdlLibrary.java",
    identities: ids([["VHDL Entity"], ["BLIFCircuit"]]),
  },
  {
    libraryId: "TCL",
    displayName: "TCL",
    hidden: false,
    runtimePolicy: "forbidden-by-runtime-preflight",
    runtimeNotes: [
      "Circuitarium runtime preflight rejects Tcl components because they can execute scripts or communicate externally.",
    ],
    sourcePath: "src/main/java/com/cburch/logisim/std/tcl/TclLibrary.java",
    identities: ids([["TclConsoleReds"], ["TclGeneric"]]),
  },
  {
    libraryId: "BFH-Praktika",
    displayName: "BFH-Praktika",
    hidden: false,
    runtimePolicy: "eligible-after-project-preflight",
    runtimeNotes: [],
    sourcePath: "src/main/java/com/cburch/logisim/std/bfh/BfhLibrary.java",
    identities: ids([
      ["Binary_to_BCD_converter"],
      ["BCD_to_7_Segment_decoder"],
    ]),
  },
  {
    libraryId: "Input/Output-Extra",
    displayName: "Input/Output-Extra",
    hidden: false,
    runtimePolicy: "forbidden-by-runtime-preflight",
    runtimeNotes: [
      "Circuitarium runtime preflight rejects this library because components can access host-facing I/O.",
      "The broken, source-commented ProgrammableGenerator is intentionally not cataloged as an exposed component.",
    ],
    sourcePath:
      "src/main/java/com/cburch/logisim/std/io/extra/ExtraIoLibrary.java",
    identities: ids([
      ["Switch"],
      ["Buzzer"],
      ["Slider"],
      ["Digital Oscilloscope"],
      ["PlaRom"],
    ]),
  },
  {
    libraryId: "Soc",
    displayName: "System On Chip components",
    hidden: false,
    runtimePolicy: "forbidden-by-runtime-preflight",
    runtimeNotes: [
      "Circuitarium runtime preflight rejects SoC components because they can expose executable, file, or host-integrated behavior.",
    ],
    sourcePath: "src/main/java/com/cburch/logisim/soc/Soc.java",
    identities: ids([
      ["Rv32im"],
      ["Nios2"],
      ["SocBus"],
      ["Socmem"],
      ["SocPio"],
      ["SocVga"],
      ["SocDma"],
      ["SocJtagUart"],
    ]),
  },
] as const;

function logisimSource(
  sourceId: string,
  kind: "official-source" | "official-manual",
  title: string,
  url: string,
  supports: string[],
): z.infer<typeof SourceSchema> {
  return {
    sourceId,
    kind,
    title,
    publisher: "Logisim-evolution project",
    revision: `v4.1.0 (${LOGISIM_410_REVISION})`,
    url,
    supports,
    license: "GPL-3.0-only upstream documentation/source",
  };
}

function binding(
  libraryId: string,
  componentId: string,
): z.infer<typeof AdapterBindingSchema> {
  return {
    backendId: "logisim.evolution",
    compatibilityProfile: "logisim-evolution/4.1.0",
    libraryId,
    componentId,
    support: "semantic-profile",
    notes: [
      "This neutral profile guides planning; the configured Logisim JAR remains the behavioral authority.",
    ],
  };
}

const configurableWidth = {
  kind: "parameter" as const,
  parameter: "data-width",
};
const fixedOneBit = { kind: "fixed" as const, bits: 1 };

export const LOGISIM_CURATED_COMPONENT_PROFILES: readonly ComponentProfile[] = [
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.wiring/pin",
    displayName: "Logisim Pin",
    semanticConcept: {
      conceptId: "digital.interface-pin",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "interconnect",
    summary:
      "A circuit-interface Pin whose configured direction determines whether the enclosing circuit receives or presents a digital value.",
    portGroups: [
      {
        id: "interface",
        label: "Circuit interface",
        direction: "inout",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [
          "Interpret direction from the concrete project instance; this profile does not guess it.",
        ],
      },
    ],
    parameters: [
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width of the digital interface represented by the Pin.",
      },
      {
        id: "direction",
        label: "Direction",
        valueType: "enum",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description:
          "Whether the Pin is an input or output of the enclosing circuit.",
      },
      {
        id: "floating-input-behavior",
        label: "Floating input behavior",
        valueType: "enum",
        required: false,
        affects: ["behavior", "verification"],
        description:
          "For an input Pin, selects Simple/Tri-state propagation of U or conversion of U by Pull Up or Pull Down.",
      },
      {
        id: "reset-value",
        label: "Reset value",
        valueType: "string",
        required: false,
        affects: ["behavior", "verification"],
        description:
          "For a non-Tri-state input Pin, the hexadecimal value loaded on simulator reset; a Tri-state input resets to all U bits.",
      },
    ],
    verification: {
      stateModel: "stateless",
      suitableEvidence: [
        "Static interface inventory with resolved direction, width, and a unique label.",
        "Runtime truth-table or vector evidence bound to the exact project and circuit.",
      ],
      insufficientEvidence: [
        "A Pin label alone does not establish direction, width, or expected behavior.",
      ],
    },
    adapterBindings: [binding("Wiring", "Pin")],
    sources: [
      logisimSource(
        "logisim-410-manual-wiring-pin",
        "official-manual",
        "Logisim-evolution 4.1.0 Pin manual",
        manualUrl("wiring/pin.html"),
        [
          "identity",
          "direction",
          "width",
          "interface role",
          "floating input behavior",
          "reset value",
        ],
      ),
    ],
    limitations: [
      "The neutral inout group represents a configurable interface; consumers must replace it with the concrete instance direction before verification.",
      "Floating-input behavior and reset value apply conditionally to input Pins and must be read from the concrete instance.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.wiring/clock",
    displayName: "Logisim Clock",
    semanticConcept: {
      conceptId: "digital.clock-source",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "stimulus",
    summary:
      "A periodic one-bit digital stimulus controlled by simulator ticks and instance timing attributes.",
    portGroups: [
      {
        id: "clock-output",
        label: "Clock output",
        direction: "output",
        role: "clock",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "edge",
        notes: [
          "Both edge and level-sensitive consumers require explicit timing tests.",
        ],
      },
    ],
    parameters: [
      {
        id: "high-duration",
        label: "High duration",
        valueType: "duration",
        required: true,
        affects: ["timing", "behavior", "verification"],
        description: "Configured number of ticks in the high phase.",
      },
      {
        id: "low-duration",
        label: "Low duration",
        valueType: "duration",
        required: true,
        affects: ["timing", "behavior", "verification"],
        description: "Configured number of ticks in the low phase.",
      },
      {
        id: "phase-offset",
        label: "Phase offset",
        valueType: "duration",
        required: true,
        affects: ["timing", "behavior", "verification"],
        description:
          "Configured clock phase offset in simulator ticks relative to otherwise identical clocks.",
      },
    ],
    verification: {
      stateModel: "time-dependent",
      suitableEvidence: [
        "A finite vector sequence with explicit sampling phases and enough cycles for the claim.",
      ],
      insufficientEvidence: [
        "A combinational truth table cannot characterize clocked state transitions.",
        "Static presence of a Clock does not prove it is enabled or that consumers sample the intended edge.",
      ],
    },
    adapterBindings: [binding("Wiring", "Clock")],
    sources: [
      logisimSource(
        "logisim-410-manual-wiring-clock",
        "official-manual",
        "Logisim-evolution 4.1.0 Clock manual",
        manualUrl("wiring/clock.html"),
        ["identity", "periodic output", "tick timing", "phase offset"],
      ),
    ],
    limitations: [
      "This profile does not translate simulator ticks into physical frequency or propagation timing.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.wiring/constant",
    displayName: "Logisim Constant",
    semanticConcept: {
      conceptId: "digital.constant-source",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "source",
    summary:
      "A digital source that presents one configured value at one configured width.",
    portGroups: [
      {
        id: "value-output",
        label: "Value output",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
    ],
    parameters: [
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width of the emitted digital value.",
      },
      {
        id: "value",
        label: "Value",
        valueType: "integer",
        required: true,
        affects: ["behavior", "verification"],
        description:
          "Configured digital value, interpreted at the configured width.",
      },
    ],
    verification: {
      stateModel: "stateless",
      suitableEvidence: [
        "Static instance attributes plus runtime observation of the exact project.",
      ],
      insufficientEvidence: [
        "The component identity without its width and value attributes does not establish the emitted bit pattern.",
      ],
    },
    adapterBindings: [binding("Wiring", "Constant")],
    sources: [
      logisimSource(
        "logisim-410-source-wiring-constant",
        "official-source",
        "Logisim-evolution 4.1.0 Constant implementation",
        sourceUrl("src/main/java/com/cburch/logisim/std/wiring/Constant.java"),
        ["identity", "value and width attributes", "output role"],
      ),
    ],
    limitations: [
      "This profile describes digital simulator semantics, not a physical voltage source.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.gates/and",
    displayName: "Logisim AND Gate",
    semanticConcept: {
      conceptId: "digital.and-gate",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "combinational",
    summary:
      "A configurable-input digital AND gate evaluated independently for each configured data bit.",
    portGroups: [
      {
        id: "inputs",
        label: "Inputs",
        direction: "input",
        role: "data",
        multiplicity: "configurable",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [
          "Concrete input count and any negated inputs come from the instance.",
        ],
      },
      {
        id: "output",
        label: "Output",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
    ],
    parameters: [
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width evaluated in parallel.",
      },
      {
        id: "input-count",
        label: "Number of inputs",
        valueType: "integer",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Number of logical operands.",
      },
      {
        id: "output-value",
        label: "Output value mapping",
        valueType: "enum",
        required: true,
        affects: ["behavior", "verification"],
        description:
          "Maps false/true results to 0/1, 0/floating, or floating/1 according to the Output Value attribute.",
      },
    ],
    verification: {
      stateModel: "stateless",
      suitableEvidence: [
        "Exhaustive truth-table evidence when the resolved interface fits the configured input-bit bound.",
        "Targeted vectors covering controlling zero, all-one, and instance negation cases.",
        "Vectors covering U/E inputs under the project's Gate Output When Undefined setting and the instance Output Value mapping.",
      ],
      insufficientEvidence: [
        "Component identity alone does not resolve input count, width, or per-input negation.",
      ],
    },
    adapterBindings: [binding("Gates", "AND Gate")],
    sources: [
      logisimSource(
        "logisim-410-manual-gates-basic",
        "official-manual",
        "Logisim-evolution 4.1.0 basic gates manual",
        manualUrl("gates/basic.html"),
        [
          "identity",
          "combinational function",
          "configurable inputs and width",
          "output value mapping",
          "undefined input behavior",
        ],
      ),
    ],
    limitations: [
      "No physical voltage thresholds, delay, hazards, loading, or power are modeled by this profile.",
      "Project-level Gate Output When Undefined behavior and the instance Output Value mapping must be resolved before interpreting U, E, or floating outputs.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.gates/not",
    displayName: "Logisim NOT Gate",
    semanticConcept: {
      conceptId: "digital.not-gate",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "combinational",
    summary:
      "A digital inverter evaluated independently for each configured data bit.",
    portGroups: [
      {
        id: "input",
        label: "Input",
        direction: "input",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "output",
        label: "Output",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
    ],
    parameters: [
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width inverted in parallel.",
      },
      {
        id: "output-value",
        label: "Output value mapping",
        valueType: "enum",
        required: true,
        affects: ["behavior", "verification"],
        description:
          "Maps false/true results to 0/1, 0/floating, or floating/1 according to the Output Value attribute.",
      },
    ],
    verification: {
      stateModel: "stateless",
      suitableEvidence: [
        "Exhaustive truth-table evidence for the resolved finite interface.",
        "Vectors covering 0, 1, U, and E input values plus the configured Output Value mapping.",
      ],
      insufficientEvidence: [
        "Static identity does not establish physical inversion delay or electrical compatibility.",
      ],
    },
    adapterBindings: [binding("Gates", "NOT Gate")],
    sources: [
      logisimSource(
        "logisim-410-manual-gates-not",
        "official-manual",
        "Logisim-evolution 4.1.0 NOT gate manual",
        manualUrl("gates/not.html"),
        [
          "identity",
          "combinational inversion",
          "configurable width",
          "output value mapping",
          "undefined and error input behavior",
        ],
      ),
    ],
    limitations: [
      "No physical voltage thresholds, delay, hazards, loading, or power are modeled by this profile.",
      "The instance Output Value mapping must be resolved before interpreting a floating output.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.plexers/multiplexer",
    displayName: "Logisim Multiplexer",
    semanticConcept: {
      conceptId: "digital.multiplexer",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "combinational",
    summary:
      "A configurable digital selector that routes one data input to one output according to selector inputs and instance options.",
    portGroups: [
      {
        id: "data-inputs",
        label: "Data inputs",
        direction: "input",
        role: "data",
        multiplicity: "derived",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [
          "Input count is derived from selector width and concrete options.",
        ],
      },
      {
        id: "select",
        label: "Select",
        direction: "input",
        role: "select",
        multiplicity: "one",
        width: { kind: "parameter", parameter: "select-width" },
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "enable",
        label: "Enable",
        direction: "input",
        role: "enable",
        multiplicity: "configurable",
        width: fixedOneBit,
        activeLevel: "high",
        notes: [
          "Present only when Enable Input is yes; 0 disables the component.",
        ],
      },
      {
        id: "output",
        label: "Output",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
    ],
    parameters: [
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width of every data input and the output.",
      },
      {
        id: "select-width",
        label: "Select bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width of the selector and basis for the input count.",
      },
      {
        id: "enable-input",
        label: "Enable input",
        valueType: "boolean",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description:
          "Controls whether the one-bit active-high enable port is present.",
      },
      {
        id: "disabled-output",
        label: "Disabled output",
        valueType: "enum",
        required: true,
        affects: ["behavior", "verification"],
        description:
          "Selects zero or floating for every output bit while the enable input is present and 0.",
      },
    ],
    verification: {
      stateModel: "stateless",
      suitableEvidence: [
        "Vectors covering every selector value and representative data patterns.",
        "When enabled by the instance, vectors covering enable 0/1 and the configured disabled-output mode.",
        "Exhaustive truth-table evidence only when the complete interface fits the bound.",
      ],
      insufficientEvidence: [
        "Testing one selector value does not characterize the other routes.",
      ],
    },
    adapterBindings: [binding("Plexers", "Multiplexer")],
    sources: [
      logisimSource(
        "logisim-410-manual-plexers-mux",
        "official-manual",
        "Logisim-evolution 4.1.0 multiplexer manual",
        manualUrl("plexers/mux.html"),
        [
          "identity",
          "selection behavior",
          "data and selector widths",
          "optional enable input",
          "disabled output mode",
          "floating selector behavior",
        ],
      ),
    ],
    limitations: [
      "Enable-port presence and disabled-output mode must be resolved from the concrete instance.",
      "A selector containing any floating bit produces an all-floating output in Logisim-evolution 4.1.0.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.arithmetic/adder",
    displayName: "Logisim Adder",
    semanticConcept: {
      conceptId: "digital.binary-adder",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "combinational",
    summary:
      "A configurable-width binary adder with two data operands, carry input, sum, and carry output.",
    portGroups: [
      {
        id: "operands",
        label: "Operands",
        direction: "input",
        role: "data",
        multiplicity: "derived",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: ["The group contains the two binary operands."],
      },
      {
        id: "carry-in",
        label: "Carry in",
        direction: "input",
        role: "carry",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "sum",
        label: "Sum",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "carry-out",
        label: "Carry out",
        direction: "output",
        role: "carry",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "not-applicable",
        notes: [],
      },
    ],
    parameters: [
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width of each operand and sum.",
      },
    ],
    verification: {
      stateModel: "stateless",
      suitableEvidence: [
        "Exhaustive truth-table evidence for small widths.",
        "Boundary vectors covering zero, maximum operands, carry-in, and carry-out for larger widths.",
      ],
      insufficientEvidence: [
        "A small sample does not prove all arithmetic inputs or bit widths.",
      ],
    },
    adapterBindings: [binding("Arithmetic", "Adder")],
    sources: [
      logisimSource(
        "logisim-410-manual-arithmetic-adder",
        "official-manual",
        "Logisim-evolution 4.1.0 adder manual",
        manualUrl("arith/adder.html"),
        ["identity", "operand, sum, and carry roles", "configurable width"],
      ),
    ],
    limitations: [
      "This profile does not certify arithmetic equivalence beyond exercised or formally proven cases.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.memory/d-flip-flop",
    displayName: "Logisim D Flip-Flop",
    semanticConcept: {
      conceptId: "digital.d-flip-flop",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "sequential",
    summary:
      "A one-bit state element with fixed Q and complement-Q outputs, configurable clock triggering, and active-high asynchronous set/reset controls.",
    portGroups: [
      {
        id: "data",
        label: "D",
        direction: "input",
        role: "data",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "clock",
        label: "Clock",
        direction: "input",
        role: "clock",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "unknown",
        notes: [
          "The Trigger attribute selects rising edge, falling edge, high level, or low level.",
        ],
      },
      {
        id: "q",
        label: "Q",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "not-applicable",
        notes: ["Outputs the currently stored bit."],
      },
      {
        id: "q-complement",
        label: "Complement Q",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "not-applicable",
        notes: ["Outputs the complement of the currently stored bit."],
      },
      {
        id: "async-reset",
        label: "Asynchronous reset",
        direction: "input",
        role: "reset",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "high",
        notes: [
          "0 or undefined has no effect; 1 pins the stored value to 0 regardless of clock and has priority over asynchronous set.",
        ],
      },
      {
        id: "async-set",
        label: "Asynchronous set",
        direction: "input",
        role: "set",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "high",
        notes: [
          "0 or undefined has no effect; 1 pins the stored value to 1 unless asynchronous reset is also 1.",
        ],
      },
    ],
    parameters: [
      {
        id: "trigger",
        label: "Trigger",
        valueType: "enum",
        required: true,
        affects: ["behavior", "timing", "verification"],
        description: "Configured clock edge or level behavior.",
      },
    ],
    verification: {
      stateModel: "stateful",
      suitableEvidence: [
        "Finite vectors that establish reset or known state, exercise both data values, and sample the configured trigger: around an edge trigger, or while changing D during an asserted high/low level trigger.",
        "Separate tests for asynchronous set, asynchronous reset, their release, and simultaneous assertion proving reset priority.",
      ],
      insufficientEvidence: [
        "A combinational truth table is not a sequential behavior proof.",
        "Passing finite vectors is evidence only for those initial states and sequences.",
      ],
    },
    adapterBindings: [binding("Memory", "D Flip-Flop")],
    sources: [
      logisimSource(
        "logisim-410-manual-memory-flipflops",
        "official-manual",
        "Logisim-evolution 4.1.0 flip-flop manual",
        manualUrl("mem/flipflops.html"),
        [
          "identity",
          "stateful behavior",
          "fixed Q and complement-Q outputs",
          "clock trigger",
          "active-high asynchronous set and reset",
          "reset priority",
        ],
      ),
    ],
    limitations: [
      "The Trigger attribute and initial runtime state must be resolved from the concrete project; the Q, complement-Q, set, and reset ports are fixed for this Logisim-evolution 4.1.0 component.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.memory/register",
    displayName: "Logisim Register",
    semanticConcept: {
      conceptId: "digital.register",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "sequential",
    summary:
      "A configurable-width clocked state element with fixed active-high enable and asynchronous reset inputs.",
    portGroups: [
      {
        id: "data-input",
        label: "Data input",
        direction: "input",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "clock",
        label: "Clock",
        direction: "input",
        role: "clock",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "unknown",
        notes: [
          "The Trigger attribute selects rising edge, falling edge, high level, or low level.",
        ],
      },
      {
        id: "data-output",
        label: "Stored output",
        direction: "output",
        role: "data",
        multiplicity: "one",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "enable",
        label: "Enable",
        direction: "input",
        role: "enable",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "high",
        notes: [
          "0 ignores clock triggers; 1 or undefined enables clock triggers.",
        ],
      },
      {
        id: "async-reset",
        label: "Asynchronous reset",
        direction: "input",
        role: "reset",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "high",
        notes: [
          "0 or undefined has no effect; 1 pins the stored value to all zeroes regardless of clock, data, or enable.",
        ],
      },
    ],
    parameters: [
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width of the stored value.",
      },
      {
        id: "trigger",
        label: "Trigger",
        valueType: "enum",
        required: true,
        affects: ["behavior", "timing", "verification"],
        description: "Configured clock trigger semantics.",
      },
    ],
    verification: {
      stateModel: "stateful",
      suitableEvidence: [
        "Vectors that establish state, load distinct patterns, hold with enable 0, load with enable 1 and undefined, exercise the configured edge or active-level trigger (including data changes while a level remains active), and prove asynchronous reset priority.",
      ],
      insufficientEvidence: [
        "A truth table without state and clock history cannot characterize a register.",
      ],
    },
    adapterBindings: [binding("Memory", "Register")],
    sources: [
      logisimSource(
        "logisim-410-manual-memory-register",
        "official-manual",
        "Logisim-evolution 4.1.0 register manual",
        manualUrl("mem/register.html"),
        [
          "identity",
          "stored data",
          "clock trigger",
          "fixed active-high enable",
          "undefined-enable behavior",
          "fixed active-high asynchronous reset",
          "configurable width",
        ],
      ),
    ],
    limitations: [
      "The Trigger attribute and initial runtime state must be resolved from the concrete project; enable and asynchronous-reset presence and polarity are fixed in Logisim-evolution 4.1.0.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.memory/ram",
    displayName: "Logisim RAM",
    semanticConcept: {
      conceptId: "digital.random-access-memory",
      relation: "instance-of",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "memory",
    summary:
      "A configurable addressed memory whose data-port direction and control behavior depend on the concrete interface and instance attributes.",
    portGroups: [
      {
        id: "address",
        label: "Address",
        direction: "input",
        role: "address",
        multiplicity: "one",
        width: { kind: "parameter", parameter: "address-width" },
        activeLevel: "not-applicable",
        notes: [],
      },
      {
        id: "data",
        label: "Data",
        direction: "inout",
        role: "data",
        multiplicity: "derived",
        width: configurableWidth,
        activeLevel: "not-applicable",
        notes: [
          "Separate or bidirectional data ports depend on the configured interface.",
        ],
      },
      {
        id: "controls",
        label: "Memory controls",
        direction: "input",
        role: "enable",
        multiplicity: "derived",
        width: fixedOneBit,
        activeLevel: "unknown",
        notes: [
          "Write, output, clock, and clear controls are instance-dependent.",
        ],
      },
    ],
    parameters: [
      {
        id: "address-width",
        label: "Address bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Address width and therefore addressable depth.",
      },
      {
        id: "data-width",
        label: "Data bits",
        valueType: "bit-width",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Width of each stored word.",
      },
      {
        id: "interface",
        label: "Data interface",
        valueType: "enum",
        required: true,
        affects: ["ports", "behavior", "verification"],
        description: "Concrete split or bidirectional data-port configuration.",
      },
    ],
    verification: {
      stateModel: "stateful",
      suitableEvidence: [
        "Vectors that initialize or write known words, read them back, cover address boundaries, and exercise control conflicts.",
        "Content-file identity when a claim depends on initial contents.",
      ],
      insufficientEvidence: [
        "A component count or successful project load does not establish memory contents.",
        "Finite vectors do not prove every address when the address space is not exhaustively covered.",
      ],
    },
    adapterBindings: [binding("Memory", "RAM")],
    sources: [
      logisimSource(
        "logisim-410-manual-memory-ram",
        "official-manual",
        "Logisim-evolution 4.1.0 RAM manual",
        manualUrl("mem/ram.html"),
        [
          "identity",
          "address and data roles",
          "control/interface configuration",
        ],
      ),
    ],
    limitations: [
      "This profile intentionally does not guess concrete port layout, initial contents, or asynchronous/synchronous read semantics.",
    ],
  },
  {
    profileVersion: COMPONENT_PROFILE_VERSION,
    profileId: "logisim.io/led",
    displayName: "Logisim LED",
    semanticConcept: {
      conceptId: "digital.visual-indicator",
      relation: "similar-to",
      equivalenceClaim: "none",
    },
    domain: "digital",
    behaviorClass: "observation",
    summary:
      "A one-bit visual indicator that observes a simulator signal; it is not a physical LED electrical model.",
    portGroups: [
      {
        id: "observed-input",
        label: "Observed input",
        direction: "input",
        role: "observation",
        multiplicity: "one",
        width: fixedOneBit,
        activeLevel: "unknown",
        notes: [
          "Active-high versus active-low display behavior is an instance attribute.",
        ],
      },
    ],
    parameters: [
      {
        id: "active-on-high",
        label: "Active on high",
        valueType: "boolean",
        required: true,
        affects: ["behavior", "verification", "appearance"],
        description:
          "Selects whether input 1 or input 0 displays the active color.",
      },
    ],
    verification: {
      stateModel: "stateless",
      suitableEvidence: [
        "Runtime visual observation, or vectors at the signal feeding the LED paired with the resolved Active On High instance attribute.",
      ],
      insufficientEvidence: [
        "LED presence or color does not prove physical current limiting, brightness, voltage, or polarity behavior.",
      ],
    },
    adapterBindings: [binding("I/O", "LED")],
    sources: [
      logisimSource(
        "logisim-410-manual-io-led",
        "official-manual",
        "Logisim-evolution 4.1.0 LED manual",
        manualUrl("io/led.html"),
        ["identity", "one-bit observation role", "active-on-high attribute"],
      ),
    ],
    limitations: [
      "The concrete active level must be read from the instance.",
      "Never use this profile as evidence that a physical LED has a safe resistor, current, power, or polarity.",
    ],
  },
] as const;

for (const profile of LOGISIM_CURATED_COMPONENT_PROFILES) {
  ComponentProfileSchema.parse(profile);
}

export function componentProfileSchemaResource(): unknown {
  return {
    schemaVersion: "circuitarium.schema-resource/0.1",
    profileVersion: COMPONENT_PROFILE_VERSION,
    jsonSchema: z.toJSONSchema(ComponentProfileSchema, {
      target: "draft-2020-12",
    }),
    semanticConstraints: [
      {
        code: "unique-port-group-ids",
        rule: "portGroups[].id values must be unique within one profile.",
      },
      {
        code: "unique-parameter-ids",
        rule: "parameters[].id values must be unique within one profile.",
      },
      {
        code: "unique-adapter-bindings",
        rule: "The backendId, compatibilityProfile, libraryId, and componentId tuple must be unique within one profile.",
      },
      {
        code: "unique-source-ids",
        rule: "sources[].sourceId values must be unique within one profile.",
      },
      {
        code: "unique-parameter-effects",
        rule: "Each parameters[].affects array must contain unique values.",
      },
      {
        code: "unique-source-support-claims",
        rule: "Each sources[].supports array must contain unique values.",
      },
      {
        code: "resolved-width-parameters",
        rule: "A port width with kind=parameter must reference a declared parameter whose valueType is bit-width.",
      },
    ],
    validationBoundary:
      "The JSON Schema enforces the structural contract. Consumers accepting external profiles must also enforce semanticConstraints; every bundled profile is validated against both layers.",
    profileCount: LOGISIM_CURATED_COMPONENT_PROFILES.length,
    profiles: LOGISIM_CURATED_COMPONENT_PROFILES,
    interpretationBoundary:
      "A component profile is source-cited planning knowledge. It does not replace concrete project attributes, simulator execution, manufacturer data, or physical measurement.",
  };
}

export function logisimStandardLibraryCatalogResource(): unknown {
  const libraries = LOGISIM_STANDARD_LIBRARIES.map((library) => ({
    libraryId: library.libraryId,
    libraryDescriptor: `#${library.libraryId}`,
    displayName: library.displayName,
    hidden: library.hidden,
    identityCount: library.identities.length,
    runtimePolicy: library.runtimePolicy,
    runtimeNotes: library.runtimeNotes,
    source: logisimSource(
      `logisim-410-source-library-${library.libraryId
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")}`,
      "official-source",
      `Logisim-evolution 4.1.0 ${library.displayName} registration`,
      sourceUrl(library.sourcePath),
      ["built-in library identity", "exposed component identities"],
    ),
    components: library.identities.map((identity) => ({
      componentId: identity.componentId,
      knowledgeCoverage:
        identity.semanticProfileId === undefined
          ? ("identity-only" as const)
          : ("semantic-profile" as const),
      ...(identity.semanticProfileId === undefined
        ? {}
        : { semanticProfileId: identity.semanticProfileId }),
    })),
  }));
  const identityCount = libraries.reduce(
    (total, library) => total + library.identityCount,
    0,
  );
  return {
    schemaVersion: "circuitarium.logisim-catalog-resource/0.1",
    catalogVersion: LOGISIM_STANDARD_LIBRARY_CATALOG_VERSION,
    compatibilityProfile: "logisim-evolution/4.1.0",
    upstream: {
      release: "v4.1.0",
      revision: LOGISIM_410_REVISION,
      releaseUrl: LOGISIM_410_RELEASE_URL,
      builtinRegistrationUrl: sourceUrl(
        "src/main/java/com/cburch/logisim/std/Builtin.java",
      ),
      license: "GPL-3.0-only",
      licenseUrl: LOGISIM_410_LICENSE_URL,
    },
    counts: {
      libraries: libraries.length,
      identities: identityCount,
      semanticProfiles: LOGISIM_CURATED_COMPONENT_PROFILES.length,
      identityOnly: identityCount - LOGISIM_CURATED_COMPONENT_PROFILES.length,
    },
    libraries,
    evidenceBoundary:
      "Every entry records a project-level component identity exposed by the pinned built-in registration source. Identity-only entries deliberately provide no inferred pins or behavior. Semantic profiles are separately source-cited and remain planning guidance, not simulator output.",
    runtimeBoundary:
      "Catalog membership does not authorize JAR execution. Circuitarium's project preflight remains deny-by-default and can reject an entire library or one unsafe component.",
    redistributionBoundary:
      "This catalog contains independently authored factual identifiers, classifications, citations, and summaries. It includes no Logisim-evolution source code or copied manual prose; upstream source and documentation remain under GPL-3.0-only.",
  };
}
