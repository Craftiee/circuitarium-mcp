import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import test, { after, before } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { generateFixture } from "../src/adapters/crumb/fixtures.js";
import {
  serializeCru,
  type CruDocument,
} from "../src/adapters/crumb/format.js";
import { CrumbComparisonDataSchema } from "../src/domain/toolSchemas.js";

interface Envelope {
  contractVersion: string;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  diagnostics: Array<Record<string, unknown>>;
  context: Record<string, unknown>;
  nextActions: Array<{
    tool: string;
    arguments: Record<string, unknown>;
  }>;
  error?: Record<string, unknown>;
}

const EXPECTED_TOOL_NAMES = [
  "electronics_capabilities",
  "electronics_validate_experiment",
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
  "crumb_check_design",
];

function envelopeOf(result: unknown): Envelope {
  const record = result as { structuredContent?: unknown };
  assert.ok(record.structuredContent);
  return record.structuredContent as Envelope;
}

function dataOf(result: unknown): Record<string, unknown> {
  const envelope = envelopeOf(result);
  assert.equal(envelope.contractVersion, "electronics.mcp/0.2");
  assert.equal(envelope.ok, true);
  assert.ok(envelope.data);
  return envelope.data;
}

function assertCrumbCompatibilityContext(result: unknown): void {
  const context = envelopeOf(result).context;
  assert.equal(context.backendId, "crumb.file");
  assert.equal(context.adapterVersion, "crumb.file/0.2");
  assert.equal(context.compatibilityProfile, "crumb.unity/1.3.5");
}

let client: Client;
let generatedDirectory: string;
let generatedRef: string;
let outsideDirectory: string;
let outsidePath: string;
let longNameRef: string;
let comparisonBaselineRef: string;
let comparisonCandidateRef: string;
const privateNameTail = "PRIVATE_NAME_TAIL";

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/server.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  client = new Client({ name: "circuitarium-mcp-test", version: "0.2.0" });
  generatedDirectory = await mkdtemp(join(process.cwd(), "mcp-output-test-"));
  generatedRef = relative(process.cwd(), generatedDirectory)
    .split("\\")
    .join("/");
  outsideDirectory = await mkdtemp(join(tmpdir(), "circuitarium-mcp-outside-"));
  outsidePath = join(outsideDirectory, "outside.cru");
  await writeFile(outsidePath, "<SaveData />", "utf8");
  longNameRef = `${generatedRef}/long-name.cru`;
  await writeFile(
    join(generatedDirectory, "long-name.cru"),
    generateFixture("empty", `${"N".repeat(1_000)}${privateNameTail}`),
    "utf8",
  );
  await writeFile(
    join(generatedDirectory, "led.cru"),
    generateFixture("breadboard-led"),
    "utf8",
  );
  comparisonBaselineRef = `${generatedRef}/comparison-baseline.cru`;
  comparisonCandidateRef = `${generatedRef}/comparison-candidate.cru`;
  const comparisonBaseline = generateFixture("breadboard-resistor");
  const comparisonCandidate = comparisonBaseline.replace(
    ">1000</anyType>",
    ">2200</anyType>",
  );
  assert.notEqual(comparisonCandidate, comparisonBaseline);
  await Promise.all([
    writeFile(
      join(generatedDirectory, "comparison-baseline.cru"),
      comparisonBaseline,
      "utf8",
    ),
    writeFile(
      join(generatedDirectory, "comparison-candidate.cru"),
      comparisonCandidate,
      "utf8",
    ),
  ]);
  await client.connect(transport);
});

after(async () => {
  await client.close();
  assert.equal(generatedDirectory.startsWith(process.cwd()), true);
  await rm(generatedDirectory, { recursive: true });
  await rm(outsideDirectory, { recursive: true });
});

test("tools/list exposes every envelope tool with input and output schemas", async () => {
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, EXPECTED_TOOL_NAMES);
  assert.ok(listed.tools.every((tool) => tool.outputSchema !== undefined));
  for (const tool of listed.tools) {
    const schema = tool.outputSchema as {
      properties?: Record<string, unknown>;
    };
    assert.ok(schema.properties?.contractVersion, `${tool.name} has contractVersion`);
    assert.ok(schema.properties?.ok, `${tool.name} has ok`);
    assert.ok(schema.properties?.diagnostics, `${tool.name} has diagnostics`);
    assert.ok(schema.properties?.context, `${tool.name} has context`);
    assert.ok(schema.properties?.nextActions, `${tool.name} has nextActions`);
  }

  const experimentInputSchema = listed.tools.find(
    (tool) => tool.name === "electronics_validate_experiment",
  )?.inputSchema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  assert.deepEqual(experimentInputSchema.required, ["experiment"]);
  assert.ok(
    experimentInputSchema.properties?.experiment,
    "the neutral validator continues to advertise its experiment input",
  );

  const analyzeInputSchema = listed.tools.find(
    (tool) => tool.name === "crumb_analyze_design",
  )?.inputSchema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  assert.deepEqual(analyzeInputSchema.required, ["path"]);
  assert.equal(analyzeInputSchema.properties?.path?.type, "string");
  assert.equal(analyzeInputSchema.properties?.path?.maxLength, 4096);
  assert.equal(
    analyzeInputSchema.properties?.expectedProjectDigest?.maxLength,
    71,
  );
  assert.equal(analyzeInputSchema.properties?.cursor?.maxLength, 2048);
  assert.equal(analyzeInputSchema.properties?.limit?.type, "integer");
  assert.equal(analyzeInputSchema.properties?.limit?.default, 50);

  const compareInputSchema = listed.tools.find(
    (tool) => tool.name === "crumb_compare_designs",
  )?.inputSchema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  assert.deepEqual(compareInputSchema.required, [
    "baselinePath",
    "candidatePath",
  ]);
  assert.equal(
    compareInputSchema.properties?.baselinePath?.maxLength,
    4096,
  );
  assert.equal(
    compareInputSchema.properties?.candidatePath?.maxLength,
    4096,
  );
  assert.equal(
    compareInputSchema.properties?.expectedBaselineDigest?.maxLength,
    71,
  );
  assert.equal(
    compareInputSchema.properties?.expectedCandidateDigest?.maxLength,
    71,
  );
  assert.equal(
    compareInputSchema.properties?.compatibilityProfile?.default,
    "crumb.unity/1.3.5",
  );
  assert.equal(compareInputSchema.properties?.view?.default, "summary");
  assert.equal(compareInputSchema.properties?.limit?.default, 50);

  const fixtureInputSchema = listed.tools.find(
    (tool) => tool.name === "crumb_generate_fixture",
  )?.inputSchema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  assert.deepEqual(fixtureInputSchema.required, ["kind"]);
  assert.equal(fixtureInputSchema.properties?.name?.maxLength, 256);
  assert.equal(fixtureInputSchema.properties?.outputPath?.maxLength, 4096);
});

test("electronics_capabilities orients a model without leaking paths", async () => {
  const capabilitiesResult = await client.callTool({
    name: "electronics_capabilities",
    arguments: {},
  });
  const capabilities = dataOf(capabilitiesResult);
  const serverCapability = capabilities.server as {
    name: string;
    contractVersion: string;
  };
  assert.equal(serverCapability.name, "circuitarium-mcp");
  assert.equal(serverCapability.contractVersion, "electronics.mcp/0.2");
  assert.equal(JSON.stringify(capabilitiesResult).includes(process.cwd()), false);
  assert.ok(JSON.stringify(capabilitiesResult).length < 50_000);
  const workflows = capabilities.workflows as Array<{
    steps: Array<{ tool: string }>;
  }>;
  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      assert.ok(
        EXPECTED_TOOL_NAMES.includes(step.tool),
        `workflow tool is registered: ${step.tool}`,
      );
    }
  }
  const callableBackends = capabilities.callableBackends as Array<{
    backendId: string;
    dataLeavesMachine: boolean | "depends";
    operations: { build: boolean; liveSessions: boolean };
    limitations: string[];
    integrationFamily: Record<string, unknown>;
    compatibilityProfiles?: Array<Record<string, unknown>>;
  }>;
  assert.deepEqual(
    callableBackends.map((backend) => backend.backendId),
    ["crumb.file"],
  );
  assert.equal(callableBackends[0]?.dataLeavesMachine, "depends");
  assert.equal(callableBackends[0]?.operations.build, false);
  assert.equal(callableBackends[0]?.operations.liveSessions, false);
  assert.match(
    callableBackends[0]?.limitations.join(" ") ?? "",
    /model host/i,
  );
  assert.deepEqual(callableBackends[0]?.integrationFamily, {
    id: "crumble",
    label: "CRUMBLE",
    expansion:
      "Circuit Representation & Universal Model Bridge for Laboratory Electronics",
    targetProduct: "CRUMB",
    scope:
      "CRUMB-specific rulesets, evidence profiles, fixtures, and file integrations.",
    status: "experimental",
  });
  assert.deepEqual(callableBackends[0]?.compatibilityProfiles, [
    {
      compatibilityProfile: "crumb.unity/1.3.5",
      status: "tested",
      product: "CRUMB",
      productVersion: "1.3.5",
      distribution: {
        channel: "Steam",
        buildId: "17183476",
      },
      engine: {
        family: "Unity",
        version: "2022.1.16f1",
      },
      evidence: {
        basis: "controlled-installed-build-observation",
        automaticFileFormatDetection: false,
        limitation:
          "Selects the interpretation evidence applied to .cru data; it does not detect a file's originating build and must not be applied to Godot builds without separate evidence.",
      },
    },
  ]);
});

test("experiment validation separates tool failure from invalid data", async () => {
  const missingExperimentResult = await client.callTool({
    name: "electronics_validate_experiment",
  });
  const missingExperimentEnvelope = envelopeOf(missingExperimentResult);
  assert.equal(missingExperimentResult.isError, true);
  assert.equal(missingExperimentEnvelope.ok, false);
  assert.equal(missingExperimentEnvelope.error?.code, "INVALID_ARGUMENT");
  assert.equal(missingExperimentEnvelope.error?.argumentPath, "experiment");
  assert.ok(
    (missingExperimentEnvelope.error?.recovery as unknown[] | undefined)?.length,
  );
  assert.equal(
    "compatibilityProfile" in missingExperimentEnvelope.context,
    false,
  );

  const scalarExperimentResult = await client.callTool({
    name: "electronics_validate_experiment",
    arguments: { experiment: 42 },
  });
  const scalarExperimentEnvelope = envelopeOf(scalarExperimentResult);
  assert.equal(scalarExperimentResult.isError ?? false, false);
  assert.equal(scalarExperimentEnvelope.ok, true);
  assert.equal(scalarExperimentEnvelope.data?.valid, false);

  const malformedExperimentResult = await client.callTool({
    name: "electronics_validate_experiment",
    arguments: { experiment: { schemaVersion: "wrong" } },
  });
  const malformedExperimentEnvelope = envelopeOf(malformedExperimentResult);
  assert.equal(malformedExperimentResult.isError ?? false, false);
  assert.equal(malformedExperimentEnvelope.ok, true);
  assert.equal(malformedExperimentEnvelope.data?.valid, false);
  assert.ok(malformedExperimentEnvelope.diagnostics.length > 0);
});

test("malformed arguments return typed INVALID_ARGUMENT envelopes", async () => {
  const missingCrumbArgumentResult = await client.callTool({
    name: "crumb_inspect_design",
  });
  const missingCrumbArgumentEnvelope = envelopeOf(missingCrumbArgumentResult);
  assertCrumbCompatibilityContext(missingCrumbArgumentResult);
  assert.equal(missingCrumbArgumentResult.isError, true);
  assert.equal(missingCrumbArgumentEnvelope.ok, false);
  assert.equal(missingCrumbArgumentEnvelope.error?.code, "INVALID_ARGUMENT");
  assert.equal(missingCrumbArgumentEnvelope.error?.argumentPath, "path");

  const otherInvalidCrumbCalls = [
    {
      name: "crumb_component_catalog",
      arguments: { toolId: "5" },
      argumentPath: "toolId",
    },
    {
      name: "crumb_analyze_design",
      arguments: {},
      argumentPath: "path",
    },
    {
      name: "crumb_compare_designs",
      arguments: {},
      argumentPath: "baselinePath",
    },
    {
      name: "crumb_validate_design",
      arguments: {},
      argumentPath: "path",
    },
    {
      name: "crumb_generate_fixture",
      arguments: {},
      argumentPath: "kind",
    },
    {
      name: "crumb_get_component",
      arguments: { path: "fixtures/crumb/breadboard-led.cru" },
      argumentPath: "componentId",
    },
    {
      name: "crumb_export_netlist",
      arguments: {},
      argumentPath: "path",
    },
    {
      name: "crumb_check_design",
      arguments: {},
      argumentPath: "path",
    },
    {
      name: "crumb_bom",
      arguments: {},
      argumentPath: "path",
    },
    {
      name: "crumb_list_projects",
      arguments: { limit: 0 },
      argumentPath: "limit",
    },
  ];
  for (const invalidCall of otherInvalidCrumbCalls) {
    const invalidResult = await client.callTool({
      name: invalidCall.name,
      arguments: invalidCall.arguments,
    });
    const invalidEnvelope = envelopeOf(invalidResult);
    assertCrumbCompatibilityContext(invalidResult);
    assert.equal(invalidResult.isError, true, invalidCall.name);
    assert.equal(invalidEnvelope.ok, false, invalidCall.name);
    assert.equal(invalidEnvelope.error?.code, "INVALID_ARGUMENT", invalidCall.name);
    assert.equal(
      invalidEnvelope.error?.argumentPath,
      invalidCall.argumentPath,
      invalidCall.name,
    );
  }

  const wrongCrumbArgumentResult = await client.callTool({
    name: "crumb_inspect_design",
    arguments: { path: 42 },
  });
  const wrongCrumbArgumentEnvelope = envelopeOf(wrongCrumbArgumentResult);
  assertCrumbCompatibilityContext(wrongCrumbArgumentResult);
  assert.equal(wrongCrumbArgumentResult.isError, true);
  assert.equal(wrongCrumbArgumentEnvelope.ok, false);
  assert.equal(wrongCrumbArgumentEnvelope.error?.code, "INVALID_ARGUMENT");
  assert.equal(wrongCrumbArgumentEnvelope.error?.argumentPath, "path");

  const oversizedCrumbArgumentResult = await client.callTool({
    name: "crumb_inspect_design",
    arguments: { path: "x".repeat(5000) },
  });
  const oversizedCrumbArgumentEnvelope = envelopeOf(
    oversizedCrumbArgumentResult,
  );
  assertCrumbCompatibilityContext(oversizedCrumbArgumentResult);
  assert.equal(oversizedCrumbArgumentEnvelope.error?.code, "INVALID_ARGUMENT");
  assert.equal(oversizedCrumbArgumentEnvelope.error?.argumentPath, "path");
  assert.ok(JSON.stringify(oversizedCrumbArgumentResult).length < 10_000);

  const unknownToolResult = await client.callTool({
    name: "not-a-registered-tool",
    arguments: {},
  });
  assert.equal(unknownToolResult.isError, true);
  assert.equal("structuredContent" in unknownToolResult, false);
  const unknownToolContent = (
    unknownToolResult as {
      content: Array<{ type: string; text: string }>;
    }
  ).content;
  assert.match(unknownToolContent[0]?.text ?? "", /not registered/i);
});

test("component catalog returns evidence vocabulary and IC variants", async () => {
  const catalogResult = await client.callTool({
    name: "crumb_component_catalog",
    arguments: { toolId: 5 },
  });
  assertCrumbCompatibilityContext(catalogResult);
  const catalog = dataOf(catalogResult);
  assert.equal(catalog.matched, true);
  const evidenceVocabulary = catalog.evidenceVocabulary as Array<{
    confidence: string;
    sourceAndRedistributionBoundary: string;
    limitation: string;
  }>;
  assert.deepEqual(
    evidenceVocabulary.map((entry) => entry.confidence),
    [
      "controlled",
      "installed-build",
      "official-example",
      "inferred",
      "unknown",
      "installed-build-extracted",
      "installed-build-partial",
    ],
  );
  assert.match(
    evidenceVocabulary.find((entry) => entry.confidence === "official-example")!
      .sourceAndRedistributionBoundary,
    /not redistributed/i,
  );
  assert.match(
    evidenceVocabulary.find(
      (entry) => entry.confidence === "installed-build-partial",
    )!.limitation,
    /must remain unresolved/i,
  );
  const icVariants = catalog.icVariants as Array<{
    prefabId: number;
    label: string;
    pins: Array<{ packagePin: number; name: string | null }>;
  }>;
  assert.equal(icVariants.length, 21);
  assert.equal(icVariants[0]?.label, "LM555");
  assert.deepEqual(
    icVariants[0]?.pins.map((pin) => pin.name),
    ["GND", "TRIG", "Q", "|RST", "CV", "THR", "DIS", "Vcc"],
  );
});

test("analysis summaries stay bounded and never leak untrusted names", async () => {
  const summaryResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      view: "summary",
    },
  });
  const summaryEnvelope = envelopeOf(summaryResult);
  assertCrumbCompatibilityContext(summaryResult);
  const summary = dataOf(summaryResult);
  const summaryDigest = summaryEnvelope.context.projectDigest as string;
  assert.match(summaryDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(summary.view, "summary");
  assert.equal("components" in summary, false);
  assert.equal("connections" in summary, false);
  assert.equal("page" in summary, false);
  const summaryProject = summary.project as Record<string, unknown>;
  assert.deepEqual(summaryProject.adapterTestedCompatibility, [
    "CRUMB 1.3.5 (Unity save format)",
  ]);
  assert.equal("testedCompatibility" in summaryProject, false);
  assert.ok(JSON.stringify(summaryResult).length < 25_000);
  assert.equal(JSON.stringify(summaryResult).includes(process.cwd()), false);
  const disclosure = summary.disclosure as {
    limits: Record<string, number>;
  };
  assert.deepEqual(disclosure.limits, {
    designNamePreviewCharacters: 160,
    componentGeometryPoints: 64,
    componentTerminals: 64,
    componentPayloadEntries: 64,
    parameterCollectionItems: 64,
    connectionGroupMembersPerField: 128,
    kindCounts: 64,
    diagnostics: 200,
    diagnosticCodeCharacters: 128,
    diagnosticPathCharacters: 512,
    diagnosticMessageCharacters: 1024,
    cruXsiTypeCharacters: 256,
    cruNumericLexicalCharacters: 1024,
    cruGuidTokenCharacters: 64,
    cruXmlNameCharacters: 256,
    cruXmlElements: 200_000,
    cruXmlDepth: 64,
    cruComponents: 10_000,
    cruDataValuesPerComponent: 256,
  });

  const longNameResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: longNameRef,
      view: "summary",
    },
  });
  const longNameEnvelope = envelopeOf(longNameResult);
  const longNameData = dataOf(longNameResult);
  const designNameInfo = longNameData.designNameInfo as {
    characters: number;
    previewCharacters: number;
    previewTruncated: boolean;
    fullContentIncluded: boolean;
    sha256: string;
  };
  assert.equal((longNameData.designName as string).length, 160);
  assert.equal(designNameInfo.characters, 1_000 + privateNameTail.length);
  assert.equal(designNameInfo.previewCharacters, 160);
  assert.equal(designNameInfo.previewTruncated, true);
  assert.equal(designNameInfo.fullContentIncluded, false);
  assert.match(designNameInfo.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.ok(
    longNameEnvelope.diagnostics.some(
      (diagnostic) => diagnostic.code === "design-name-truncated",
    ),
  );
  assert.equal(JSON.stringify(longNameResult).includes(privateNameTail), false);
  assert.ok(JSON.stringify(longNameResult).length < 25_000);
});

test("comparison reports bounded semantic changes with schema-safe pagination", async () => {
  const comparisonSummaryResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: comparisonBaselineRef,
      candidatePath: comparisonCandidateRef,
      view: "summary",
      includeGeometry: true,
    },
  });
  assertCrumbCompatibilityContext(comparisonSummaryResult);
  const comparisonSummaryEnvelope = envelopeOf(comparisonSummaryResult);
  const comparisonSummary = dataOf(comparisonSummaryResult);
  const comparisonBaseline = comparisonSummary.baseline as {
    ref: string;
    digest: string;
  };
  const comparisonCandidate = comparisonSummary.candidate as {
    ref: string;
    digest: string;
  };
  assert.equal(comparisonSummary.comparisonVersion, "crumb.compare/0.1");
  assert.equal(comparisonSummary.view, "summary");
  assert.equal(
    comparisonSummary.compatibilityProfile,
    "crumb.unity/1.3.5",
  );
  assert.equal(comparisonBaseline.ref, comparisonBaselineRef);
  assert.equal(comparisonCandidate.ref, comparisonCandidateRef);
  assert.match(comparisonBaseline.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(comparisonCandidate.digest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(comparisonBaseline.digest, comparisonCandidate.digest);
  assert.equal(
    comparisonSummaryEnvelope.context.projectRef,
    comparisonCandidateRef,
  );
  assert.equal(
    comparisonSummaryEnvelope.context.projectDigest,
    comparisonCandidate.digest,
  );
  assert.deepEqual(comparisonSummary.equivalence, {
    byteEquivalent: false,
    modeledContentEquivalent: false,
    modeledRepresentationEquivalent: false,
    coverage: "complete",
    assessment: "changed",
  });
  assert.equal(
    (comparisonSummary.summary as { modifiedComponentCount: number })
      .modifiedComponentCount,
    1,
  );
  assert.equal("root" in comparisonSummary, false);
  assert.equal("componentChanges" in comparisonSummary, false);
  assert.equal("page" in comparisonSummary, false);
  assert.equal(
    (comparisonSummary.disclosure as { geometryIncluded: boolean })
      .geometryIncluded,
    false,
  );
  assert.equal(
    JSON.stringify(comparisonSummaryResult).includes(process.cwd()),
    false,
  );
  assert.ok(
    comparisonSummaryEnvelope.nextActions.some(
      (action) =>
        action.tool === "crumb_compare_designs" &&
        action.arguments.view === "components",
    ),
  );

  const comparisonRootResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: "fixtures/crumb/breadboard-resistor.cru",
      candidatePath: "fixtures/crumb/breadboard-led.cru",
      view: "root",
      includeGeometry: true,
    },
  });
  const comparisonRoot = dataOf(comparisonRootResult);
  assert.equal(comparisonRoot.view, "root");
  assert.deepEqual(
    (comparisonRoot.root as { changedFields: string[] }).changedFields,
    ["name"],
  );
  assert.equal("componentChanges" in comparisonRoot, false);
  assert.equal(
    (comparisonRoot.disclosure as { geometryIncluded: boolean })
      .geometryIncluded,
    false,
  );

  const comparisonComponentsResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: comparisonBaselineRef,
      candidatePath: comparisonCandidateRef,
      expectedBaselineDigest: comparisonBaseline.digest,
      expectedCandidateDigest: comparisonCandidate.digest,
      view: "components",
      limit: 1,
    },
  });
  const comparisonComponents = dataOf(comparisonComponentsResult);
  const comparisonChanges = comparisonComponents.componentChanges as Array<{
    changedFields: string[];
    baseline?: { parameters: Record<string, { value: unknown }> };
    candidate?: { parameters: Record<string, { value: unknown }> };
  }>;
  assert.equal(comparisonChanges.length, 1);
  assert.deepEqual(comparisonChanges[0]?.changedFields, ["parameters"]);
  assert.equal(
    comparisonChanges[0]?.baseline?.parameters.resistance?.value,
    1000,
  );
  assert.equal(
    comparisonChanges[0]?.candidate?.parameters.resistance?.value,
    2200,
  );
  assert.deepEqual(comparisonComponents.page, {
    returned: 1,
    total: 1,
    limit: 1,
  });
  assert.deepEqual(comparisonComponents.disclosure, {
    rawXmlIncluded: false,
    sourceCodeIncluded: false,
    embeddedBinaryIncluded: false,
    thumbnailIncluded: false,
    opaquePayloadContentIncluded: false,
    userTextMode: "untrusted-bounded-preview-and-digest",
    geometryIncluded: false,
  });
  assert.equal(
    CrumbComparisonDataSchema.safeParse(comparisonComponents).success,
    true,
  );
  assert.equal(
    CrumbComparisonDataSchema.safeParse({
      ...comparisonComponents,
      rawXml: "SENSITIVE_RAW_XML",
    }).success,
    false,
  );
  const leakedComponent = structuredClone(comparisonComponents) as {
    componentChanges: Array<{
      candidate: Record<string, unknown>;
    }>;
  };
  const leakedCandidate = leakedComponent.componentChanges[0]?.candidate;
  assert.ok(leakedCandidate);
  leakedCandidate.rawXml = "SENSITIVE_RAW_XML";
  assert.equal(
    CrumbComparisonDataSchema.safeParse(leakedComponent).success,
    false,
  );
  const leakedSource = structuredClone(comparisonComponents) as {
    componentChanges: Array<{
      candidate: Record<string, unknown>;
    }>;
  };
  const sourceCandidate = leakedSource.componentChanges[0]?.candidate;
  assert.ok(sourceCandidate);
  sourceCandidate.sourceCode = {
    present: true,
    characters: 17,
    bytes: 17,
    lines: 1,
    sha256: `sha256:${"0".repeat(64)}`,
    languageHint: "c-cpp-or-arduino",
    included: false,
    returnedCharacters: 0,
    contentTruncated: false,
    secondaryStringLength: 0,
    content: "SENSITIVE_SOURCE",
  };
  assert.equal(
    CrumbComparisonDataSchema.safeParse(leakedSource).success,
    false,
  );
  const oversizedAnnotation = structuredClone(comparisonComponents) as {
    componentChanges: Array<{
      candidate: Record<string, unknown>;
    }>;
  };
  const annotationCandidate =
    oversizedAnnotation.componentChanges[0]?.candidate;
  assert.ok(annotationCandidate);
  annotationCandidate.annotation = {
    present: true,
    characters: 161,
    bytes: 161,
    sha256: `sha256:${"0".repeat(64)}`,
    trust: "untrusted-user-authored",
    preview: "A".repeat(161),
    previewCharacters: 161,
    previewTruncated: false,
    contentIncluded: false,
  };
  assert.equal(
    CrumbComparisonDataSchema.safeParse(oversizedAnnotation).success,
    false,
  );

  const pagedComparisonResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: "fixtures/crumb/breadboard-resistor.cru",
      candidatePath: "fixtures/crumb/breadboard-led.cru",
      view: "components",
      limit: 1,
    },
  });
  const pagedComparison = dataOf(pagedComparisonResult);
  const pagedComparisonInfo = pagedComparison.page as {
    returned: number;
    total: number;
    nextCursor?: string;
  };
  assert.equal(pagedComparisonInfo.returned, 1);
  assert.equal(pagedComparisonInfo.total, 4);
  assert.ok(pagedComparisonInfo.nextCursor);

  const continuedComparisonResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: "fixtures/crumb/breadboard-resistor.cru",
      candidatePath: "fixtures/crumb/breadboard-led.cru",
      view: "components",
      limit: 1,
      cursor: pagedComparisonInfo.nextCursor,
    },
  });
  assert.equal(
    (dataOf(continuedComparisonResult).page as { returned: number }).returned,
    1,
  );

  const changedComparisonCursorResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: "fixtures/crumb/breadboard-resistor.cru",
      candidatePath: "fixtures/crumb/breadboard.cru",
      view: "components",
      limit: 1,
      cursor: pagedComparisonInfo.nextCursor,
    },
  });
  const changedComparisonCursorEnvelope = envelopeOf(
    changedComparisonCursorResult,
  );
  assert.equal(changedComparisonCursorResult.isError, true);
  assert.equal(
    changedComparisonCursorEnvelope.error?.code,
    "INVALID_ARGUMENT",
  );
  assert.equal(
    changedComparisonCursorEnvelope.error?.argumentPath,
    "cursor",
  );
});

test("comparison guards identities and maps failures to the correct side", async () => {
  const staleComparisonResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: comparisonBaselineRef,
      candidatePath: comparisonCandidateRef,
      expectedBaselineDigest: `sha256:${"0".repeat(64)}`,
    },
  });
  const staleComparisonEnvelope = envelopeOf(staleComparisonResult);
  assert.equal(staleComparisonResult.isError, true);
  assert.equal(staleComparisonEnvelope.error?.code, "PROJECT_STATE_CONFLICT");
  assert.equal(
    staleComparisonEnvelope.error?.argumentPath,
    "expectedBaselineDigest",
  );
  assert.equal(
    staleComparisonEnvelope.context.projectRef,
    comparisonBaselineRef,
  );
  assert.ok(
    (staleComparisonEnvelope.error?.recovery as string[]).some(
      (entry) => entry.includes("without expectedBaselineDigest"),
    ),
  );

  const invalidComparisonCursorResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: comparisonBaselineRef,
      candidatePath: comparisonCandidateRef,
      view: "components",
      cursor: "not-a-comparison-cursor",
    },
  });
  const invalidComparisonCursorEnvelope = envelopeOf(
    invalidComparisonCursorResult,
  );
  assert.equal(invalidComparisonCursorResult.isError, true);
  assert.equal(
    invalidComparisonCursorEnvelope.error?.code,
    "INVALID_ARGUMENT",
  );
  assert.equal(
    invalidComparisonCursorEnvelope.error?.argumentPath,
    "cursor",
  );

  const wrongComparisonProfileResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: comparisonBaselineRef,
      candidatePath: comparisonCandidateRef,
      compatibilityProfile: "crumb.godot/unverified",
    },
  });
  const wrongComparisonProfileEnvelope = envelopeOf(
    wrongComparisonProfileResult,
  );
  assert.equal(wrongComparisonProfileResult.isError, true);
  assert.equal(
    wrongComparisonProfileEnvelope.error?.code,
    "INVALID_ARGUMENT",
  );
  assert.equal(
    wrongComparisonProfileEnvelope.error?.argumentPath,
    "compatibilityProfile",
  );

  const outsideComparisonResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: comparisonBaselineRef,
      candidatePath: outsidePath,
    },
  });
  const outsideComparisonEnvelope = envelopeOf(outsideComparisonResult);
  assert.equal(outsideComparisonResult.isError, true);
  assert.equal(outsideComparisonEnvelope.error?.code, "PATH_DENIED");
  assert.equal(
    outsideComparisonEnvelope.error?.argumentPath,
    "candidatePath",
  );
  assert.equal(
    JSON.stringify(outsideComparisonResult).includes(outsideDirectory),
    false,
  );

  const unsupportedBaselineResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: "fixtures/crumb/breadboard.txt",
      candidatePath: comparisonCandidateRef,
    },
  });
  const unsupportedBaselineEnvelope = envelopeOf(
    unsupportedBaselineResult,
  );
  assert.equal(unsupportedBaselineResult.isError, true);
  assert.equal(
    unsupportedBaselineEnvelope.error?.code,
    "UNSUPPORTED_FORMAT",
  );
  assert.equal(
    unsupportedBaselineEnvelope.error?.argumentPath,
    "baselinePath",
  );

  const missingCandidateResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: comparisonBaselineRef,
      candidatePath: `${generatedRef}/missing.cru`,
    },
  });
  const missingCandidateEnvelope = envelopeOf(missingCandidateResult);
  assert.equal(missingCandidateResult.isError, true);
  assert.equal(missingCandidateEnvelope.error?.code, "NOT_FOUND");
  assert.equal(
    missingCandidateEnvelope.error?.argumentPath,
    "candidatePath",
  );

  const budgetBaselineRef = `${generatedRef}/budget-baseline.cru`;
  const budgetCandidateRef = `${generatedRef}/budget-candidate.cru`;
  await Promise.all([
    writeFile(
      join(generatedDirectory, "budget-baseline.cru"),
      Buffer.alloc(3 * 1024 * 1024, 0x20),
    ),
    writeFile(
      join(generatedDirectory, "budget-candidate.cru"),
      Buffer.alloc(3 * 1024 * 1024, 0x20),
    ),
  ]);
  const overBudgetResult = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: budgetBaselineRef,
      candidatePath: budgetCandidateRef,
    },
  });
  const overBudgetEnvelope = envelopeOf(overBudgetResult);
  assert.equal(overBudgetResult.isError, true);
  assert.equal(overBudgetEnvelope.error?.code, "QUOTA_EXCEEDED");
  assert.equal(
    overBudgetEnvelope.error?.argumentPath,
    "candidatePath",
  );
  assert.match(
    String(overBudgetEnvelope.error?.message),
    /combined comparison limit/,
  );
  assert.ok(JSON.stringify(overBudgetResult).length < 10_000);
});

test("pagination cursors and digest guards protect continued reads", async () => {
  const summaryResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      view: "summary",
    },
  });
  const summaryDigest = envelopeOf(summaryResult).context
    .projectDigest as string;

  const inspectionResult = await client.callTool({
    name: "crumb_inspect_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      expectedProjectDigest: summaryDigest,
    },
  });
  assertCrumbCompatibilityContext(inspectionResult);

  const firstPageResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      expectedProjectDigest: summaryDigest,
      view: "components",
      limit: 1,
    },
  });
  const firstPage = dataOf(firstPageResult);
  const firstComponents = firstPage.components as Array<{ id: string }>;
  const firstPageInfo = firstPage.page as {
    returned: number;
    total: number;
    nextCursor?: string;
  };
  assert.equal(firstPageInfo.returned, 1);
  assert.equal(firstPageInfo.total, 2);
  assert.ok(firstPageInfo.nextCursor);

  const secondPageResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      view: "components",
      limit: 1,
      cursor: firstPageInfo.nextCursor,
    },
  });
  const secondPage = dataOf(secondPageResult);
  const secondComponents = secondPage.components as Array<{ id: string }>;
  assert.equal(secondComponents.length, 1);
  assert.notEqual(secondComponents[0]?.id, firstComponents[0]?.id);
  assert.equal(
    (secondPage.page as { nextCursor?: string }).nextCursor,
    undefined,
  );

  const changedAnalysisOptions = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      view: "components",
      limit: 1,
      includeGeometry: true,
      cursor: firstPageInfo.nextCursor,
    },
  });
  assert.equal(
    envelopeOf(changedAnalysisOptions).error?.code,
    "INVALID_ARGUMENT",
    "analysis cursors are bound to response-shaping options",
  );

  const invalidCursorResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      view: "components",
      cursor: "not-a-valid-cursor",
    },
  });
  const invalidCursorEnvelope = envelopeOf(invalidCursorResult);
  assertCrumbCompatibilityContext(invalidCursorResult);
  assert.equal(invalidCursorResult.isError, true);
  assert.equal(invalidCursorEnvelope.ok, false);
  assert.equal(invalidCursorEnvelope.error?.code, "INVALID_ARGUMENT");

  const staleDigestResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-resistor.cru",
      expectedProjectDigest: `sha256:${"0".repeat(64)}`,
      view: "summary",
    },
  });
  const staleDigestEnvelope = envelopeOf(staleDigestResult);
  assertCrumbCompatibilityContext(staleDigestResult);
  assert.equal(staleDigestResult.isError, true);
  assert.equal(staleDigestEnvelope.ok, false);
  assert.equal(staleDigestEnvelope.error?.code, "PROJECT_STATE_CONFLICT");
  assert.equal(staleDigestEnvelope.context.projectDigest, summaryDigest);
  assert.equal(staleDigestEnvelope.nextActions[0]?.tool, "crumb_analyze_design");
  assert.equal(
    "expectedProjectDigest" in
      (staleDigestEnvelope.nextActions[0]?.arguments ?? {}),
    false,
  );
});

test("digests identify raw bytes and stale guards run before parsing", async () => {
  const invalidA = Buffer.from([0x80]);
  const invalidB = Buffer.from([0x81]);
  assert.equal(invalidA.toString("utf8"), invalidB.toString("utf8"));
  const invalidARef = `${generatedRef}/invalid-byte-a.cru`;
  const invalidBRef = `${generatedRef}/invalid-byte-b.cru`;
  const malformedRef = `${generatedRef}/malformed-guard.cru`;
  await Promise.all([
    writeFile(join(generatedDirectory, "invalid-byte-a.cru"), invalidA),
    writeFile(join(generatedDirectory, "invalid-byte-b.cru"), invalidB),
    writeFile(
      join(generatedDirectory, "malformed-guard.cru"),
      "<SaveData><name>broken</SaveData>",
      "utf8",
    ),
  ]);

  const rawDigests: string[] = [];
  for (const path of [invalidARef, invalidBRef]) {
    const result = await client.callTool({
      name: "crumb_validate_design",
      arguments: { path },
    });
    rawDigests.push(envelopeOf(result).context.projectDigest as string);
  }
  assert.match(rawDigests[0] ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.match(rawDigests[1] ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(
    rawDigests[0],
    rawDigests[1],
    "byte-distinct invalid UTF-8 files must never share a decoded-text digest",
  );

  const staleDigest = `sha256:${"0".repeat(64)}`;
  const guardedCalls = [
    { name: "crumb_analyze_design", arguments: { view: "summary" } },
    { name: "crumb_inspect_design", arguments: {} },
    { name: "crumb_validate_design", arguments: {} },
    {
      name: "crumb_get_component",
      arguments: { componentId: "missing" },
    },
    { name: "crumb_bom", arguments: {} },
    { name: "crumb_export_netlist", arguments: {} },
    { name: "crumb_check_design", arguments: {} },
  ];
  for (const guarded of guardedCalls) {
    const result = await client.callTool({
      name: guarded.name,
      arguments: {
        path: malformedRef,
        expectedProjectDigest: staleDigest,
        ...guarded.arguments,
      },
    });
    assert.equal(
      envelopeOf(result).error?.code,
      "PROJECT_STATE_CONFLICT",
      `${guarded.name} must check the digest before parsing malformed XML`,
    );
  }

  const guardedComparison = await client.callTool({
    name: "crumb_compare_designs",
    arguments: {
      baselinePath: malformedRef,
      candidatePath: comparisonCandidateRef,
      expectedBaselineDigest: staleDigest,
    },
  });
  const guardedComparisonEnvelope = envelopeOf(guardedComparison);
  assert.equal(
    guardedComparisonEnvelope.error?.code,
    "PROJECT_STATE_CONFLICT",
    "comparison must check the raw baseline digest before parsing malformed XML",
  );
  assert.equal(
    guardedComparisonEnvelope.error?.argumentPath,
    "expectedBaselineDigest",
  );
});

test("validation reports invalid designs as data, and analysis refuses them", async () => {
  const validationResult = await client.callTool({
    name: "crumb_validate_design",
    arguments: { path: "fixtures/crumb/breadboard-resistor.cru" },
  });
  assertCrumbCompatibilityContext(validationResult);
  const validation = dataOf(validationResult);
  assert.equal(validation.valid, true);

  const invalidRef = `${generatedRef}/invalid.cru`;
  await writeFile(
    join(generatedDirectory, "invalid.cru"),
    "<SaveData><name>Invalid fixture</name><components /></SaveData>",
    "utf8",
  );
  const invalidValidationResult = await client.callTool({
    name: "crumb_validate_design",
    arguments: { path: invalidRef },
  });
  const invalidValidationEnvelope = envelopeOf(invalidValidationResult);
  assertCrumbCompatibilityContext(invalidValidationResult);
  assert.equal(invalidValidationResult.isError ?? false, false);
  assert.equal(invalidValidationEnvelope.ok, true);
  assert.equal(invalidValidationEnvelope.data?.valid, false);
  assert.ok(invalidValidationEnvelope.diagnostics.length > 0);

  const invalidAnalysisResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: { path: invalidRef, view: "summary" },
  });
  const invalidAnalysisEnvelope = envelopeOf(invalidAnalysisResult);
  assertCrumbCompatibilityContext(invalidAnalysisResult);
  assert.equal(invalidAnalysisResult.isError, true);
  assert.equal(invalidAnalysisEnvelope.error?.code, "PROJECT_INVALID");
  assert.equal(
    invalidAnalysisEnvelope.nextActions[0]?.tool,
    "crumb_validate_design",
  );

  const invalidErcResult = await client.callTool({
    name: "crumb_check_design",
    arguments: { path: invalidRef },
  });
  assert.equal(envelopeOf(invalidErcResult).error?.code, "PROJECT_INVALID");
});

test("file access stays inside the workspace root", async () => {
  const outsideResult = await client.callTool({
    name: "crumb_inspect_design",
    arguments: { path: outsidePath },
  });
  const outsideEnvelope = envelopeOf(outsideResult);
  assertCrumbCompatibilityContext(outsideResult);
  assert.equal(outsideResult.isError, true);
  assert.equal(outsideEnvelope.ok, false);
  assert.equal(outsideEnvelope.error?.code, "PATH_DENIED");
  assert.equal(JSON.stringify(outsideResult).includes(outsideDirectory), false);
});

test("fixture generation writes once and refuses to overwrite", async () => {
  const outputRef = `${generatedRef}/${basename(generatedDirectory)}.cru`;
  const generationResult = await client.callTool({
    name: "crumb_generate_fixture",
    arguments: {
      kind: "breadboard-led",
      outputPath: outputRef,
    },
  });
  assertCrumbCompatibilityContext(generationResult);
  const generation = dataOf(generationResult);
  assert.equal("xml" in generation, false);
  assert.equal(generation.valid, true);
  const generatedProject = generation.project as {
    ref: string;
    digest: string;
  };
  assert.equal(generatedProject.ref, outputRef);
  assert.match(generatedProject.digest, /^sha256:[0-9a-f]{64}$/);

  const overwriteResult = await client.callTool({
    name: "crumb_generate_fixture",
    arguments: {
      kind: "breadboard-led",
      outputPath: outputRef,
    },
  });
  const overwriteEnvelope = envelopeOf(overwriteResult);
  assertCrumbCompatibilityContext(overwriteResult);
  assert.equal(overwriteResult.isError, true);
  assert.equal(overwriteEnvelope.error?.code, "ALREADY_EXISTS");
});

test("workspace listing discovers projects with digests and containment", async () => {
  const listingResult = await client.callTool({
    name: "crumb_list_projects",
    arguments: { dir: generatedRef },
  });
  assertCrumbCompatibilityContext(listingResult);
  const listing = dataOf(listingResult);
  assert.equal(listing.listingVersion, "crumb.workspace/0.1");
  const entries = listing.entries as Array<{
    ref: string;
    bytes: number;
    mtime: string;
    digest?: string;
  }>;
  assert.ok(entries.length >= 2);
  assert.ok(entries.every((entry) => entry.ref.endsWith(".cru")));
  assert.ok(entries.every((entry) => entry.ref.startsWith(generatedRef)));
  assert.ok(
    entries.every((entry) => /^sha256:[0-9a-f]{64}$/.test(entry.digest ?? "")),
  );
  assert.ok(
    entries.every((entry) => !Number.isNaN(Date.parse(entry.mtime))),
  );
  const nextAction = envelopeOf(listingResult).nextActions[0];
  assert.equal(nextAction?.tool, "crumb_analyze_design");

  const outsideListing = await client.callTool({
    name: "crumb_list_projects",
    arguments: { dir: outsideDirectory },
  });
  assert.equal(envelopeOf(outsideListing).error?.code, "PATH_DENIED");

  const notADirectory = await client.callTool({
    name: "crumb_list_projects",
    arguments: { dir: "fixtures/crumb/breadboard.cru" },
  });
  const notADirectoryEnvelope = envelopeOf(notADirectory);
  assert.equal(notADirectoryEnvelope.error?.code, "INVALID_ARGUMENT");
  assert.equal(notADirectoryEnvelope.error?.argumentPath, "dir");
});

test("single-component fetch returns detail, connections, and typed NOT_FOUND", async () => {
  const analysisResult = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-led.cru",
      view: "components",
      limit: 10,
    },
  });
  const components = dataOf(analysisResult).components as Array<{
    id: string;
    kind: string;
  }>;
  const led = components.find((component) => component.kind === "led-5mm");
  assert.ok(led);

  const detailResult = await client.callTool({
    name: "crumb_get_component",
    arguments: {
      path: "fixtures/crumb/breadboard-led.cru",
      componentId: led!.id.toUpperCase(),
    },
  });
  assertCrumbCompatibilityContext(detailResult);
  const detail = dataOf(detailResult);
  assert.equal(detail.detailVersion, "crumb.component/0.1");
  const component = detail.component as {
    id: string;
    kind: string;
    parameters: Record<string, { value: unknown }>;
    geometry?: unknown[];
  };
  assert.equal(component.kind, "led-5mm");
  assert.equal(component.parameters.forwardVoltage?.value, 2.2);
  assert.ok(Array.isArray(component.geometry), "geometry included by default");
  const connections = detail.connections as unknown[];
  assert.equal(connections.length, 2);

  const missingResult = await client.callTool({
    name: "crumb_get_component",
    arguments: {
      path: "fixtures/crumb/breadboard-led.cru",
      componentId: "00000000-0000-4000-8000-000000000000",
    },
  });
  const missingEnvelope = envelopeOf(missingResult);
  assert.equal(missingResult.isError, true);
  assert.equal(missingEnvelope.error?.code, "NOT_FOUND");
  assert.equal(missingEnvelope.error?.argumentPath, "componentId");
});

test("single-component fetch focuses membership past connection display bounds", async () => {
  const boardId = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";
  const requestedId = "fffffff0-1111-4111-8111-fffffffffff0";
  const connected = (guid: string): CruDocument["components"][number] => ({
    toolId: 99,
    guid,
    geometry: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    tiePoints: [
      { id: 0, parentIdentifier: boardId },
      { id: 1, parentIdentifier: boardId },
    ],
    settings: [],
  });
  const xml = serializeCru({
    name: "Focused Oversized Membership",
    components: [
      {
        toolId: 0,
        guid: boardId,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      ...Array.from({ length: 70 }, (_, index) =>
        connected(
          `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
        ),
      ),
      connected(requestedId),
    ],
  });
  const ref = `${generatedRef}/focused-oversized.cru`;
  await writeFile(
    join(generatedDirectory, "focused-oversized.cru"),
    xml,
    "utf8",
  );

  const result = await client.callTool({
    name: "crumb_get_component",
    arguments: { path: ref, componentId: requestedId },
  });
  const envelope = envelopeOf(result);
  const detail = dataOf(result);
  const connections = detail.connections as Array<{
    componentTerminals: Array<{ componentId: string }>;
  }>;
  assert.equal(connections.length, 1);
  assert.ok(
    connections[0]?.componentTerminals.some(
      (terminal) => terminal.componentId === requestedId,
    ),
  );
  assert.ok(
    envelope.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "connection-membership-truncated",
    ),
  );
});

test("BOM groups parts and keeps totals with bounded lines", async () => {
  const bomResult = await client.callTool({
    name: "crumb_bom",
    arguments: { path: "fixtures/crumb/breadboard-led.cru" },
  });
  assertCrumbCompatibilityContext(bomResult);
  const bom = dataOf(bomResult);
  assert.equal(bom.bomVersion, "crumb.bom/0.1");
  const totals = bom.totals as { components: number; distinctLines: number };
  assert.equal(totals.components, 2);
  assert.equal(totals.distinctLines, 2);
  const lines = bom.lines as Array<{
    kind: string;
    quantity: number;
    identity: Record<string, { value: unknown; unit?: string }>;
  }>;
  const ledLine = lines.find((line) => line.kind === "led-5mm");
  assert.ok(ledLine);
  assert.equal(ledLine!.quantity, 1);
  assert.equal(ledLine!.identity.forwardVoltage?.value, 2.2);
  assert.equal(ledLine!.identity.forwardVoltage?.unit, "volt");
});

test("netlist export pages nets and reports floating terminals", async () => {
  const netlistResult = await client.callTool({
    name: "crumb_export_netlist",
    arguments: { path: "fixtures/crumb/breadboard-led.cru", limit: 1 },
  });
  assertCrumbCompatibilityContext(netlistResult);
  const netlist = dataOf(netlistResult);
  assert.equal(netlist.netlistVersion, "crumb.netlist/0.1");
  const stats = netlist.stats as {
    netCount: number;
    floatingTerminalCount: number;
  };
  assert.equal(stats.netCount, 2);
  assert.equal(stats.floatingTerminalCount, 2);
  const page = netlist.page as { returned: number; total: number; nextCursor?: string };
  assert.equal(page.returned, 1);
  assert.equal(page.total, 2);
  assert.ok(page.nextCursor);

  const secondPageResult = await client.callTool({
    name: "crumb_export_netlist",
    arguments: {
      path: "fixtures/crumb/breadboard-led.cru",
      limit: 1,
      cursor: page.nextCursor,
    },
  });
  const secondPage = dataOf(secondPageResult);
  const secondNets = secondPage.nets as Array<{ id: string }>;
  assert.equal(secondNets.length, 1);
  const firstNets = netlist.nets as Array<{ id: string }>;
  assert.notEqual(secondNets[0]?.id, firstNets[0]?.id);

  const crossToolCursor = await client.callTool({
    name: "crumb_analyze_design",
    arguments: {
      path: "fixtures/crumb/breadboard-led.cru",
      view: "components",
      cursor: page.nextCursor,
    },
  });
  assert.equal(
    envelopeOf(crossToolCursor).error?.code,
    "INVALID_ARGUMENT",
    "netlist cursors are not valid for analyze views",
  );

  for (const changedOptions of [
    { topologyMode: "direct-only" },
    { applySwitchStates: true },
  ]) {
    const changedNetlistOptions = await client.callTool({
      name: "crumb_export_netlist",
      arguments: {
        path: "fixtures/crumb/breadboard-led.cru",
        limit: 1,
        cursor: page.nextCursor,
        ...changedOptions,
      },
    });
    assert.equal(
      envelopeOf(changedNetlistOptions).error?.code,
      "INVALID_ARGUMENT",
      "netlist cursors are bound to topology and saved-switch options",
    );
  }
});

test("electrical rule check returns findings as data with evidence tags", async () => {
  const checkResult = await client.callTool({
    name: "crumb_check_design",
    arguments: { path: "fixtures/crumb/breadboard-led.cru" },
  });
  assertCrumbCompatibilityContext(checkResult);
  const checkEnvelope = envelopeOf(checkResult);
  assert.equal(checkResult.isError ?? false, false);
  const check = dataOf(checkResult);
  assert.equal(check.ercVersion, "crumb.erc/0.1");
  assert.equal(check.valid, true);
  const findings = check.findings as Array<{
    ruleId: string;
    severity: string;
    confidence: string;
    basis: string;
  }>;
  assert.ok(findings.length >= 2);
  assert.ok(findings.every((finding) => finding.ruleId === "floating-terminal"));
  assert.ok(
    findings.every((finding) =>
      ["public-electronics-knowledge", "version-pinned-crumb-observation", "both"].includes(
        finding.basis,
      ),
    ),
  );
  assert.ok((check.limitations as string[]).length > 0);
  assert.ok(
    checkEnvelope.nextActions.some(
      (action) => action.tool === "crumb_export_netlist",
    ),
  );
});

test("IC reference answers pinout queries and stays honest on misses", async () => {
  const hitResult = await client.callTool({
    name: "crumb_ic_reference",
    arguments: { query: "74HC138" },
  });
  assertCrumbCompatibilityContext(hitResult);
  const hit = dataOf(hitResult);
  assert.equal(hit.matched, true);
  const variants = hit.variants as Array<{
    label: string;
    pins: Array<{ name: string | null }>;
  }>;
  assert.equal(variants.length, 1);
  assert.match(variants[0]!.label, /74HC138/);
  assert.ok(variants[0]!.pins.length > 0);

  const missResult = await client.callTool({
    name: "crumb_ic_reference",
    arguments: { query: "definitely-not-an-ic" },
  });
  const miss = dataOf(missResult);
  assert.equal(miss.matched, false);
  assert.ok(
    envelopeOf(missResult).diagnostics.some(
      (diagnostic) => diagnostic.code === "unsupported-component",
    ),
  );

  const byPrefab = await client.callTool({
    name: "crumb_ic_reference",
    arguments: { prefabId: 0 },
  });
  const prefabData = dataOf(byPrefab);
  const prefabVariants = prefabData.variants as Array<{ label: string }>;
  assert.equal(prefabVariants[0]?.label, "LM555");
});
