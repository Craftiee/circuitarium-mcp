import { CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR } from "../adapters/crumb/compatibility.js";

export interface AdapterCapability {
  id: string;
  label: string;
  status: "available" | "experimental" | "planned" | "external";
  operations: string[];
  limitations: string[];
}

export interface CompatibilityProfileDescriptor {
  compatibilityProfile: string;
  status: "tested" | "experimental" | "planned";
  product: string;
  productVersion: string;
  distribution: {
    channel: string;
    buildId?: string;
  };
  engine: {
    family: string;
    version?: string;
  };
  evidence: {
    basis:
      | "controlled-installed-build-observation"
      | "official-documentation"
      | "inferred";
    automaticFileFormatDetection: boolean;
    limitation: string;
  };
}

export interface IntegrationFamilyDescriptor {
  id: string;
  label: string;
  expansion: string;
  targetProduct: string;
  scope: string;
  status: "available" | "experimental" | "planned";
}

export interface BackendDescriptor {
  backendId: string;
  label: string;
  availability: "callable" | "external-companion" | "planned";
  locality: "local" | "cloud" | "hybrid";
  sessionScope: "none" | "process" | "remote-service";
  dataLeavesMachine: boolean | "depends";
  formats: string[];
  operations: {
    inspect: boolean;
    validate: boolean;
    build: boolean;
    convert: boolean;
    liveSessions: boolean;
    observeSignals: boolean;
    stimulateInputs: boolean;
  };
  limitations: string[];
  integrationFamily?: IntegrationFamilyDescriptor;
  compatibilityProfiles?: CompatibilityProfileDescriptor[];
}

export interface CallableBackendDescriptor extends BackendDescriptor {
  availability: "callable";
  integrationFamily: IntegrationFamilyDescriptor;
}

export interface WorkflowDescriptor {
  id: string;
  goal: string;
  steps: Array<{
    tool: string;
    reason: string;
    exampleArguments: Record<string, unknown>;
  }>;
}

export const GENERAL_TOOLSET = {
  schemaVersion: "0.1",
  concerns: [
    "components and parameters",
    "electrical nets and named pins",
    "firmware artifacts",
    "stimuli, probes, and assertions",
    "logical simulation time separate from wall-clock pacing",
  ],
  fidelityLevels: [
    "behavioral",
    "rtl-cycle-accurate",
    "gate-event",
    "analog-mixed-signal",
  ],
} as const;

export const ADAPTER_CAPABILITIES: AdapterCapability[] = [
  {
    id: "crumb-file",
    label: "CRUMB .cru files",
    status: "experimental",
    operations: [
      "inspect save metadata and component inventory",
      "validate structural invariants",
      "analyze typed component parameters and terminal attachments",
      "infer CRUMB 1.3.5 breadboard and power-rail connection groups",
      "resolve 21 version-pinned DIP IC variants and ordered pin names",
      "compare controlled baseline and candidate files under crumb.unity/1.3.5 without writing either",
      "generate verified board, rail, resistor, and LED fixtures",
    ],
    limitations: [
      "CRUMB does not currently expose a documented automation API",
      "simulation start/stop/step and live signal reads are unavailable",
      "component tool IDs and positional payloads are version-specific",
      "switch state is recognized but dynamic component behavior is not simulated",
    ],
  },
  {
    id: "wokwi-cli-mcp",
    label: "Wokwi CLI MCP",
    status: "external",
    operations: ["use Wokwi's own MCP server as a companion server"],
    limitations: [
      "provided and versioned by Wokwi",
      "cloud/account behavior follows Wokwi CLI terms and capabilities",
    ],
  },
  {
    id: "logisim-evolution",
    label: "Logisim-evolution",
    status: "planned",
    operations: ["planned circuit import/export adapter", "planned headless test bridge"],
    limitations: ["not implemented in this proof of concept"],
  },
];

export const CALLABLE_BACKENDS: CallableBackendDescriptor[] = [
  {
    backendId: "crumb.file",
    label: "CRUMB save-file adapter",
    availability: "callable",
    locality: "local",
    sessionScope: "none",
    dataLeavesMachine: "depends",
    formats: [".cru"],
    operations: {
      inspect: true,
      validate: true,
      build: false,
      convert: false,
      liveSessions: false,
      observeSignals: false,
      stimulateInputs: false,
    },
    limitations: [
      "Reads and writes files; it does not control a running CRUMB simulation.",
      "The backend runs locally, but returned data may leave the machine through the MCP client or model host.",
      "Five fixed synthetic fixture generators are available; build=false means there is no general circuit builder.",
      "Controlled-save comparison is read-only and does not prove which CRUMB build authored a file.",
      "General semantic editing is not implemented yet.",
      "Board topology is version-pinned to CRUMB 1.3.5.",
    ],
    integrationFamily: {
      id: "crumble",
      label: "CRUMBLE",
      expansion:
        "Circuit Representation & Universal Model Bridge for Laboratory Electronics",
      targetProduct: "CRUMB",
      scope: "CRUMB-specific rulesets, evidence profiles, fixtures, and file integrations.",
      status: "experimental",
    },
    compatibilityProfiles: [
      {
        ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR,
        distribution: { ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR.distribution },
        engine: { ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR.engine },
        evidence: { ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR.evidence },
      },
    ],
  },
];

export const ROADMAP_BACKENDS: BackendDescriptor[] = [
  {
    backendId: "wokwi.cloud",
    label: "Wokwi CLI MCP companion",
    availability: "external-companion",
    locality: "cloud",
    sessionScope: "remote-service",
    dataLeavesMachine: true,
    formats: ["diagram.json", "wokwi.toml"],
    operations: {
      inspect: false,
      validate: false,
      build: false,
      convert: false,
      liveSessions: true,
      observeSignals: true,
      stimulateInputs: true,
    },
    limitations: [
      "Not callable through this server yet.",
      "Requires WOKWI_CLI_TOKEN and uploads project data to Wokwi.",
    ],
  },
  {
    backendId: "logisim.evolution",
    label: "Logisim-evolution",
    availability: "planned",
    locality: "local",
    sessionScope: "none",
    dataLeavesMachine: "depends",
    formats: [".circ"],
    operations: {
      inspect: false,
      validate: false,
      build: false,
      convert: false,
      liveSessions: false,
      observeSignals: false,
      stimulateInputs: false,
    },
    limitations: ["Adapter is not implemented; do not attempt to call it."],
  },
  {
    backendId: "digital.event",
    label: "Deterministic event-driven digital engine",
    availability: "planned",
    locality: "local",
    sessionScope: "process",
    dataLeavesMachine: "depends",
    formats: ["electronics-project/0.2"],
    operations: {
      inspect: false,
      validate: false,
      build: false,
      convert: false,
      liveSessions: false,
      observeSignals: false,
      stimulateInputs: false,
    },
    limitations: ["Architecture is specified but the engine is not implemented."],
  },
];

export const WORKFLOWS: WorkflowDescriptor[] = [
  {
    id: "understand-existing-crumb-design",
    goal: "Recognize an existing CRUMB design without guessing unsupported behavior.",
    steps: [
      {
        tool: "crumb_analyze_design",
        reason: "Start with a bounded semantic summary.",
        exampleArguments: {
          path: "fixtures/crumb/breadboard-resistor.cru",
          view: "summary",
        },
      },
      {
        tool: "crumb_analyze_design",
        reason: "Read a bounded component page when details are needed.",
        exampleArguments: {
          path: "fixtures/crumb/breadboard-resistor.cru",
          view: "components",
          limit: 50,
        },
      },
      {
        tool: "crumb_analyze_design",
        reason: "Read version-pinned electrical connection groups.",
        exampleArguments: {
          path: "fixtures/crumb/breadboard-resistor.cru",
          view: "connections",
          topologyMode: "known-board-v1.3.5",
          limit: 50,
        },
      },
    ],
  },
  {
    id: "compare-controlled-crumb-saves",
    goal: "Explain what changed after a controlled CRUMB 1.3.5 edit or Save As operation.",
    steps: [
      {
        tool: "crumb_compare_designs",
        reason:
          "Start with byte identity, modeled equivalence, coverage, and bounded change counts.",
        exampleArguments: {
          baselinePath: "designs/before-controlled-edit.cru",
          candidatePath: "designs/after-controlled-edit.cru",
          view: "summary",
          compatibilityProfile: "crumb.unity/1.3.5",
        },
      },
      {
        tool: "crumb_compare_designs",
        reason: "Inspect GUID-matched component changes when the summary differs.",
        exampleArguments: {
          baselinePath: "designs/before-controlled-edit.cru",
          candidatePath: "designs/after-controlled-edit.cru",
          view: "components",
          limit: 50,
          compatibilityProfile: "crumb.unity/1.3.5",
        },
      },
    ],
  },
  {
    id: "validate-crumb-design",
    goal: "Check a CRUMB file before opening or sharing it.",
    steps: [
      {
        tool: "crumb_validate_design",
        reason: "Return structural diagnostics without launching the game.",
        exampleArguments: { path: "fixtures/crumb/breadboard.cru" },
      },
    ],
  },
  {
    id: "create-known-crumb-fixture",
    goal: "Create a new, bounded CRUMB example without overwriting a file.",
    steps: [
      {
        tool: "crumb_generate_fixture",
        reason:
          "Write one synthetic, compatibility-tested fixture and return its digest.",
        exampleArguments: {
          kind: "breadboard-led",
          outputPath: "generated/my-led.cru",
        },
      },
    ],
  },
  {
    id: "validate-portable-experiment",
    goal: "Validate the simulator-neutral experiment schema.",
    steps: [
      {
        tool: "electronics_validate_experiment",
        reason: "Get schema and semantic diagnostics without choosing a simulator.",
        exampleArguments: {
          experiment: {
            schemaVersion: "0.1",
            id: "minimal-check",
            title: "Minimal portable experiment",
            components: [],
            nets: [],
            execution: {
              fidelity: "behavioral",
              pacing: "as-fast-as-possible",
            },
          },
        },
      },
    ],
  },
];

export const VOCABULARY = [
  {
    term: "model host",
    meaning: "ChatGPT, Claude, or a local agent that calls this MCP; never a simulator backend.",
  },
  {
    term: "backend",
    meaning: "A circuit file adapter or simulator such as CRUMB, Wokwi, or Logisim.",
  },
  {
    term: "project digest",
    meaning: "An immutable SHA-256 identity used for cross-model handoff and race protection.",
  },
  {
    term: "attachment",
    meaning: "A component terminal seated at one CRUMB parent-component/tie-point address.",
  },
  {
    term: "connection group",
    meaning: "A version-pinned inferred electrical net; its provenance and limits are always returned.",
  },
] as const;
