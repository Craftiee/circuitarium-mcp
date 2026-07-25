import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { generateFixture } from "../src/adapters/crumb/fixtures.js";

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
