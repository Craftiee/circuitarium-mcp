import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { generateFixture } from "../src/adapters/crumb/fixtures.js";
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

test("stdio MCP exposes a bounded, model-neutral CRUMB v0.2 contract", async (context) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/server.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "circuitarium-mcp-test", version: "0.2.0" });
  const generatedDirectory = await mkdtemp(join(process.cwd(), "mcp-output-test-"));
  const generatedRef = relative(process.cwd(), generatedDirectory)
    .split("\\")
    .join("/");
  const outsideDirectory = await mkdtemp(join(tmpdir(), "circuitarium-mcp-outside-"));
  const outsidePath = join(outsideDirectory, "outside.cru");
  await writeFile(outsidePath, "<SaveData />", "utf8");
  const privateNameTail = "PRIVATE_NAME_TAIL";
  const longNameRef = `${generatedRef}/long-name.cru`;
  await writeFile(
    join(generatedDirectory, "long-name.cru"),
    generateFixture("empty", `${"N".repeat(1_000)}${privateNameTail}`),
    "utf8",
  );
  const comparisonBaselineRef = `${generatedRef}/comparison-baseline.cru`;
  const comparisonCandidateRef = `${generatedRef}/comparison-candidate.cru`;
  const comparisonBaselineXml = generateFixture("breadboard-resistor");
  const comparisonCandidateXml = comparisonBaselineXml.replace(
    '<anyType xsi:type="xsd:float">1000</anyType>',
    '<anyType xsi:type="xsd:float">2200</anyType>',
  );
  await writeFile(
    join(generatedDirectory, "comparison-baseline.cru"),
    comparisonBaselineXml,
    "utf8",
  );
  await writeFile(
    join(generatedDirectory, "comparison-candidate.cru"),
    comparisonCandidateXml,
    "utf8",
  );

  context.after(async () => {
    await client.close();
    assert.equal(generatedDirectory.startsWith(process.cwd()), true);
    await rm(generatedDirectory, { recursive: true });
    await rm(outsideDirectory, { recursive: true });
  });
  await client.connect(transport);

  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "electronics_capabilities",
    "electronics_validate_experiment",
    "crumb_component_catalog",
    "crumb_analyze_design",
    "crumb_compare_designs",
    "crumb_inspect_design",
    "crumb_validate_design",
    "crumb_generate_fixture",
  ]);
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
    definitions?: Record<string, Record<string, unknown>>;
  };
  assert.deepEqual(experimentInputSchema.required, ["experiment"]);
  assert.equal(
    experimentInputSchema.properties?.experiment?.$ref,
    "#/definitions/__schema0",
  );
  assert.ok(
    Array.isArray(experimentInputSchema.definitions?.__schema0?.anyOf),
    "the neutral validator continues to advertise arbitrary JSON input",
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
  assert.equal(compareInputSchema.properties?.baselinePath?.maxLength, 4096);
  assert.equal(compareInputSchema.properties?.candidatePath?.maxLength, 4096);
  assert.equal(
    compareInputSchema.properties?.expectedBaselineDigest?.maxLength,
    71,
  );
  assert.equal(
    compareInputSchema.properties?.expectedCandidateDigest?.maxLength,
    71,
  );
  assert.equal(compareInputSchema.properties?.view?.default, "summary");
  assert.equal(compareInputSchema.properties?.limit?.default, 50);
  assert.equal(
    compareInputSchema.properties?.compatibilityProfile?.default,
    "crumb.unity/1.3.5",
  );

  const fixtureInputSchema = listed.tools.find(
    (tool) => tool.name === "crumb_generate_fixture",
  )?.inputSchema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  assert.deepEqual(fixtureInputSchema.required, ["kind"]);
  assert.equal(fixtureInputSchema.properties?.name?.maxLength, 256);
  assert.equal(fixtureInputSchema.properties?.outputPath?.maxLength, 4096);

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
      assert.ok(toolNames.includes(step.tool), `workflow tool is registered: ${step.tool}`);
    }
  }
  const callableBackends = capabilities.callableBackends as Array<{
    backendId: string;
    dataLeavesMachine: boolean | "depends";
    operations: { build: boolean; liveSessions: boolean };
    limitations: string[];
    integrationFamily: {
      id: string;
      label: string;
      expansion: string;
      targetProduct: string;
      scope: string;
      status: string;
    };
    compatibilityProfiles?: Array<{
      compatibilityProfile: string;
      status: string;
      productVersion: string;
      distribution: { channel: string; buildId?: string };
      engine: { family: string; version?: string };
      evidence: {
        basis: string;
        automaticFileFormatDetection: boolean;
        limitation: string;
      };
    }>;
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

  const missingExperimentResult = await client.callTool({
    name: "electronics_validate_experiment",
  });
  const missingExperimentEnvelope = envelopeOf(missingExperimentResult);
  assert.equal(missingExperimentResult.isError, true);
  assert.equal(missingExperimentEnvelope.ok, false);
  assert.equal(missingExperimentEnvelope.error?.code, "INVALID_ARGUMENT");
  assert.equal(
    missingExperimentEnvelope.error?.argumentPath,
    "experiment",
  );
  assert.ok(
    (missingExperimentEnvelope.error?.recovery as unknown[] | undefined)
      ?.length,
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

  const missingCrumbArgumentResult = await client.callTool({
    name: "crumb_inspect_design",
  });
  const missingCrumbArgumentEnvelope = envelopeOf(
    missingCrumbArgumentResult,
  );
  assertCrumbCompatibilityContext(missingCrumbArgumentResult);
  assert.equal(missingCrumbArgumentResult.isError, true);
  assert.equal(missingCrumbArgumentEnvelope.ok, false);
  assert.equal(
    missingCrumbArgumentEnvelope.error?.code,
    "INVALID_ARGUMENT",
  );
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
  ];
  for (const invalidCall of otherInvalidCrumbCalls) {
    const invalidResult = await client.callTool({
      name: invalidCall.name,
      arguments: invalidCall.arguments,
    });
    const invalidEnvelope = envelopeOf(invalidResult);
    assertCrumbCompatibilityContext(invalidResult);
    assert.equal(invalidResult.isError, true);
    assert.equal(invalidEnvelope.ok, false);
    assert.equal(invalidEnvelope.error?.code, "INVALID_ARGUMENT");
    assert.equal(
      invalidEnvelope.error?.argumentPath,
      invalidCall.argumentPath,
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
  assert.match(
    unknownToolContent[0]?.text ?? "",
    /not registered/i,
  );

  const catalogResult = await client.callTool({
    name: "crumb_component_catalog",
    arguments: { toolId: 5 },
  });
  assertCrumbCompatibilityContext(catalogResult);
  const catalog = dataOf(catalogResult);
  assert.equal(catalog.matched, true);
  const evidenceVocabulary = catalog.evidenceVocabulary as Array<{
    confidence: string;
    label: string;
    meaning: string;
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
    unknownPayloadKeysPerComponent: 64,
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
    cruTextNodeCharacters: 1_048_576,
    cruMarkupDelimiters: 100_000,
    cruDocumentCharacters: 3 * 1024 * 1024,
  });

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
  assert.equal(
    comparisonSummaryEnvelope.nextActions.some(
      (action) =>
        action.tool === "crumb_compare_designs" &&
        action.arguments.view === "components",
    ),
    true,
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
  leakedComponent.componentChanges[0]!.candidate.rawXml =
    "SENSITIVE_RAW_XML";
  assert.equal(
    CrumbComparisonDataSchema.safeParse(leakedComponent).success,
    false,
  );
  const leakedSource = structuredClone(comparisonComponents) as {
    componentChanges: Array<{
      candidate: Record<string, unknown>;
    }>;
  };
  leakedSource.componentChanges[0]!.candidate.sourceCode = {
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
  oversizedAnnotation.componentChanges[0]!.candidate.annotation = {
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
  const continuedComparison = dataOf(continuedComparisonResult);
  assert.equal(
    (continuedComparison.page as { returned: number }).returned,
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

  const validationResult = await client.callTool({
    name: "crumb_validate_design",
    arguments: { path: "fixtures/crumb/breadboard-resistor.cru" },
  });
  assertCrumbCompatibilityContext(validationResult);
  const validation = dataOf(validationResult);
  assert.equal(validation.valid, true);

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
