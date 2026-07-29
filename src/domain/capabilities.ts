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
  runtime?: {
    status: "available" | "unconfigured" | "unavailable" | "version-mismatch";
    requiredForTools: string[];
    configuration: {
      jarEnvironment: string;
      javaEnvironment: string;
      javaRequirement: string;
    };
    detected?: {
      simulatorVersion: string;
      javaRuntime?: string;
      javaVendor?: string;
    };
  };
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
      "list workspace .cru projects with digests",
      "fetch one component in full bounded detail",
      "export jumper-collapsed electrical nets with supply naming",
      "trace one terminal's full inferred net with paged structured provenance",
      "run static electrical rule checks over inferred nets",
      "group components into a bill of materials",
      "look up version-pinned IC packages and pinouts",
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
    status: "experimental",
    operations: [
      "discover and statically parse .circ projects",
      "export an explicitly partial simulator-neutral coordinate netlist",
      "load projects and count components through a configured JAR that self-reports 4.1.0",
      "run bounded truth tables through a configured JAR that self-reports 4.1.0",
      "run workspace-contained test vectors through a configured JAR that self-reports 4.1.0",
    ],
    limitations: [
      "Circuitarium does not bundle Logisim-evolution or Java",
      "runtime tools require Java 21 and a trusted user-supplied JAR that self-reports 4.1.0",
      "the configured JAR is not authenticated by publisher or digest; its version response is self-reported",
      "JAR-backed project execution may update Logisim's per-user Java preferences and is not annotated read-only",
      "runtime safety preflight defaults to denial for external libraries, VHDL, unsafe paths/features, and unknown or malformed constructs",
      "accepted runtime inputs use exact-byte private temporary staging with cleanup after success or failure",
      "public Logisim strings are limited to 4,096 characters and the aggregate serialized result envelope to 2 MiB",
      "the runtime controls reduce project-driven risk but are not an operating-system sandbox or malicious-JAR boundary",
      "static XML recognition is not behavioral simulation evidence",
      "no live GUI session or arbitrary editing is implemented",
    ],
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
      "Netlists and electrical rule checks are static file inference; no circuit is simulated.",
    ],
    integrationFamily: {
      id: "crumble",
      label: "CRUMBLE",
      expansion:
        "Circuit Representation & Universal Model Bridge for Laboratory Electronics",
      targetProduct: "CRUMB",
      scope:
        "CRUMB-specific rulesets, evidence profiles, fixtures, and file integrations.",
      status: "experimental",
    },
    compatibilityProfiles: [
      {
        ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR,
        distribution: {
          ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR.distribution,
        },
        engine: { ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR.engine },
        evidence: { ...CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR.evidence },
      },
    ],
  },
  {
    backendId: "logisim.evolution",
    label: "Logisim-evolution file and configured-JAR adapter",
    availability: "callable",
    locality: "local",
    sessionScope: "process",
    dataLeavesMachine: "depends",
    formats: [".circ", ".vec", ".txt"],
    operations: {
      inspect: true,
      validate: true,
      build: false,
      convert: false,
      liveSessions: false,
      observeSignals: true,
      stimulateInputs: true,
    },
    limitations: [
      "Static .circ parsing and coordinate netlists are partial and are never labeled as simulation.",
      "Truth tables and test vectors launch a configured user-supplied JAR that self-reports Logisim-evolution 4.1.0 as a bounded local subprocess.",
      "A JAR version response is self-reported and does not authenticate the configured file by publisher or digest.",
      "Runtime preflight defaults to denial for external libraries, VHDL, unsafe paths/features, and unknown or malformed constructs.",
      "Accepted runtime inputs use exact-byte private temporary staging and cleanup.",
      "Public Logisim strings are limited to 4,096 characters and the aggregate serialized result envelope to 2 MiB.",
      "The runtime controls are not an operating-system sandbox or a security boundary against a malicious configured JAR.",
      "Runtime tools return BACKEND_UNAVAILABLE until CIRCUITARIUM_LOGISIM_JAR and Java 21 are available.",
      "On Linux, Logisim 4.1.0 test-vector execution additionally requires a trusted X11 DISPLAY; Xvfb is sufficient on a display-less host.",
      "The JAR is not bundled, downloaded, linked, or redistributed by Circuitarium MCP.",
      "No persistent or live Logisim GUI session is controlled.",
      "The backend runs locally, but returned data may leave the machine through the MCP client or model host.",
    ],
    integrationFamily: {
      id: "logisim-evolution",
      label: "Logisim-evolution adapter",
      expansion: "Circuitarium Logisim-evolution interoperability adapter",
      targetProduct: "Logisim-evolution",
      scope:
        "Version-pinned .circ structure, neutral IR conversion, and bounded configured-JAR non-interactive execution.",
      status: "experimental",
    },
    compatibilityProfiles: [
      {
        compatibilityProfile: "logisim-evolution/4.1.0",
        status: "tested",
        product: "Logisim-evolution",
        productVersion: "4.1.0",
        distribution: {
          channel: "official GitHub release",
          buildId: "main/499134ec",
        },
        engine: {
          family: "Java",
          version: "21+",
        },
        evidence: {
          basis: "official-documentation",
          automaticFileFormatDetection: false,
          limitation:
            "The adapter checks declared source metadata and a self-reported configured-JAR version, but neither authenticates file authorship, the runtime publisher, or behavioral equivalence; only CI verifies the official v4.1.0 release asset SHA-256.",
        },
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
    limitations: [
      "Architecture is specified but the engine is not implemented.",
    ],
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
        reason:
          "Inspect GUID-matched component changes when the summary differs.",
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
    id: "review-crumb-design",
    goal: "Give genuine electrical feedback on an existing CRUMB breadboard design.",
    steps: [
      {
        tool: "crumb_list_projects",
        reason: "Discover .cru projects in the workspace with their digests.",
        exampleArguments: {},
      },
      {
        tool: "crumb_analyze_design",
        reason: "Understand recognized components and connectivity.",
        exampleArguments: {
          path: "fixtures/crumb/breadboard-led.cru",
          view: "summary",
        },
      },
      {
        tool: "crumb_export_netlist",
        reason: "Promote connection groups to named electrical nets.",
        exampleArguments: { path: "fixtures/crumb/breadboard-led.cru" },
      },
      {
        tool: "crumb_trace_net",
        reason:
          "Follow one selected terminal through attachment, board, jumper, and optional saved-switch evidence without claiming simulation.",
        exampleArguments: {
          path: "fixtures/crumb/breadboard-led.cru",
          componentId: "component-guid-from-analysis",
          terminalIndex: 0,
        },
      },
      {
        tool: "crumb_check_design",
        reason: "Run static electrical rule checks and report findings.",
        exampleArguments: { path: "fixtures/crumb/breadboard-led.cru" },
      },
    ],
  },
  {
    id: "identify-ic-pinout",
    goal: "Answer pinout questions about version-pinned CRUMB DIP ICs.",
    steps: [
      {
        tool: "crumb_ic_reference",
        reason: "Find the package by label or package-name substring.",
        exampleArguments: { query: "74HC138" },
      },
    ],
  },
  {
    id: "understand-logisim-design",
    goal: "Recognize a Logisim-evolution project without confusing static XML evidence with simulation.",
    steps: [
      {
        tool: "logisim_list_projects",
        reason: "Discover workspace .circ projects and raw-byte digests.",
        exampleArguments: { dir: "examples/logisim" },
      },
      {
        tool: "logisim_analyze_design",
        reason:
          "Read circuit, component, pin, and explicit conversion-loss summaries.",
        exampleArguments: {
          path: "examples/logisim/full-adder.circ",
        },
      },
      {
        tool: "logisim_export_netlist",
        reason:
          "Export the deliberately partial coordinate netlist with loss markers.",
        exampleArguments: {
          path: "examples/logisim/full-adder.circ",
          circuit: "Main",
        },
      },
    ],
  },
  {
    id: "simulate-logisim-design",
    goal: "Obtain bounded behavioral evidence from a configured user-supplied JAR that self-reports Logisim-evolution 4.1.0.",
    steps: [
      {
        tool: "logisim_component_stats",
        reason:
          "Confirm the configured JAR can load and inventory the project without treating its self-reported version as authentication.",
        exampleArguments: {
          path: "examples/logisim/full-adder.circ",
          circuit: "Main",
        },
      },
      {
        tool: "logisim_truth_table",
        reason: "Run bounded combinational truth-table evaluation.",
        exampleArguments: {
          path: "examples/logisim/full-adder.circ",
          circuit: "Main",
          maxInputBits: 8,
        },
      },
      {
        tool: "logisim_run_test_vector",
        reason:
          "Execute explicit regression vectors and return structured failures.",
        exampleArguments: {
          path: "examples/logisim/full-adder.circ",
          circuit: "Main",
          vectorPath: "examples/logisim/full-adder.vec",
        },
      },
    ],
  },
  {
    id: "plan-verification-evidence",
    goal: "Turn explicit circuit claims into a bounded verification plan without treating reported evidence as certification.",
    steps: [
      {
        tool: "electronics_plan_verification",
        reason:
          "Choose static, runtime, simulation, and external evidence steps appropriate to each claim and backend.",
        exampleArguments: {
          target: {
            backendId: "logisim.evolution",
            projectRef: "examples/logisim/full-adder.circ",
            circuit: "Main",
          },
          claims: [
            {
              id: "full-adder-behavior",
              claimClass: "combinational-behavior",
              objective: "verify",
              scope: "selected-circuit",
            },
          ],
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
        reason:
          "Get schema and semantic diagnostics without choosing a simulator.",
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
  {
    id: "validate-universal-run-record",
    goal: "Validate and integrity-seal a portable engineering process snapshot without implying that its recorded work was executed or authenticated.",
    steps: [
      {
        tool: "electronics_validate_run_record",
        reason:
          "Normalize the neutral core, check semantic references and evidence authority, and compute separate evidence and whole-record digests.",
        exampleArguments: {
          record: {
            schemaVersion: "electronics.run-record/0.1",
            recordId: "minimal-run",
            recordType: "run",
            recordStatus: "open",
            content: {
              intent: {
                title: "Minimal engineering run",
                summary:
                  "Capture design intent before any implementation is attempted.",
              },
              stages: [
                {
                  id: "intent",
                  sequence: 1,
                  kind: "intent-architecture",
                  title: "Define intent",
                  status: "planned",
                },
              ],
              disclosure: {
                rawCommandsIncluded: false,
                environmentValuesIncluded: false,
                absolutePathsIncluded: false,
                rawPayloadsIncluded: false,
                userAuthoredTextMayContainSensitiveData: true,
              },
              completeness: {
                status: "partial",
                reasons: ["No execution evidence has been recorded yet."],
              },
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
    meaning:
      "ChatGPT, Claude, or a local agent that calls this MCP; never a simulator backend.",
  },
  {
    term: "backend",
    meaning:
      "A circuit file adapter or simulator such as CRUMB, Wokwi, or Logisim.",
  },
  {
    term: "project digest",
    meaning:
      "An immutable SHA-256 identity used for cross-model handoff and race protection.",
  },
  {
    term: "run record",
    meaning:
      "A bounded, simulator-neutral snapshot of intent, stages, immutable artifacts, activities, claims, evidence, unresolved risks, and scoped signoffs. Its hashes provide portable identity, not authorship or certification.",
  },
  {
    term: "attachment",
    meaning:
      "A component terminal seated at one CRUMB parent-component/tie-point address.",
  },
  {
    term: "connection group",
    meaning:
      "A version-pinned inferred electrical net; its provenance and limits are always returned.",
  },
  {
    term: "net",
    meaning:
      "A jumper-collapsed electrical node built from connection groups; a static file inference, never simulation output.",
  },
  {
    term: "project-load evidence",
    meaning:
      "The configured simulator accepted and inventoried an artifact; this is stronger than static parsing but does not prove circuit outputs.",
  },
  {
    term: "non-interactive simulation evidence",
    meaning:
      "Bounded truth-table or test-vector output produced without a user-controlled GUI session for one exact project digest; Logisim 4.1.0 test-vector mode still needs X11 or Xvfb on Linux.",
  },
  {
    term: "component profile",
    meaning:
      "A source-cited neutral planning description bound to one simulator component identity; it never implies cross-simulator behavioral equivalence.",
  },
  {
    term: "verification plan",
    meaning:
      "A deterministic sequence of evidence requests for explicit claims; receipts bind to exact artifact/topology/circuit loci but remain caller-reported, unauthenticated, and non-certifying.",
  },
  {
    term: "connectivity witness",
    meaning:
      "A deterministic spanning tree through one inferred conductive net with structured provenance; it is not current flow, signal direction, or enumeration of every path.",
  },
] as const;
