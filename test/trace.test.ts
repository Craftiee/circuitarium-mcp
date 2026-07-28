import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCru,
  fullAnalyzedComponentTerminals,
} from "../src/adapters/crumb/analyze.js";
import { generateFixture } from "../src/adapters/crumb/fixtures.js";
import {
  serializeCru,
  type CruDocument,
} from "../src/adapters/crumb/format.js";
import { buildNetlist } from "../src/adapters/crumb/netlist.js";
import {
  CrumbTraceSelectionError,
  buildCrumbNetTrace,
} from "../src/adapters/crumb/trace.js";

const BOARD_GUID = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";

function spliceComponents(xml: string, extraComponentXml: string): string {
  return xml.replace(
    "  </components>",
    `${extraComponentXml}\n  </components>`,
  );
}

function twoTerminalComponent(
  toolId: number,
  guid: string,
  tieA: number,
  tieB: number,
): CruDocument["components"][number] {
  return {
    toolId,
    guid,
    geometry: [
      { x: 0, y: 2, z: 0 },
      { x: 1, y: 2, z: 0 },
    ],
    tiePoints: [
      { id: tieA, parentIdentifier: BOARD_GUID },
      { id: tieB, parentIdentifier: BOARD_GUID },
    ],
    settings:
      toolId === 2
        ? [
            { type: "xsd:int", value: 1 },
            { type: "xsd:float", value: 3 },
          ]
        : [
            { type: "xsd:float", value: 1_000 },
            { type: "xsd:float", value: 0.25 },
          ],
  };
}

function boardDocument(components: CruDocument["components"]): string {
  return serializeCru({
    name: "Trace Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      ...components,
    ],
  });
}

function manyTerminalComponentXml(
  guid: string,
  tieId: number,
  terminalCount: number,
): string {
  const tiePoints = Array.from(
    { length: terminalCount },
    () =>
      `          <TiePointID><id>${tieId}</id><parentIdentifier>${BOARD_GUID}</parentIdentifier></TiePointID>`,
  ).join("\n");
  return `    <SaveComponent>
      <toolID>99</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${guid}</anyType>
        <anyType xsi:type="ArrayOfTiePointID">
${tiePoints}
        </anyType>
      </data>
    </SaveComponent>`;
}

function slideSwitchXml(
  guid: string,
  positionCode: number,
  commonTie: number,
  throw0Tie: number,
  throw1Tie: number,
): string {
  return `    <SaveComponent>
      <toolID>9</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${guid}</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID">
          <TiePointID><id>${commonTie}</id><parentIdentifier>${BOARD_GUID}</parentIdentifier></TiePointID>
          <TiePointID><id>${throw0Tie}</id><parentIdentifier>${BOARD_GUID}</parentIdentifier></TiePointID>
          <TiePointID><id>${throw1Tie}</id><parentIdentifier>${BOARD_GUID}</parentIdentifier></TiePointID>
        </anyType>
        <anyType xsi:type="xsd:int">${positionCode}</anyType>
      </data>
    </SaveComponent>`;
}

function terminalVisits(
  trace: ReturnType<typeof buildCrumbNetTrace>,
): Array<Extract<(typeof trace.visits)[number]["node"], { kind: "terminal" }>> {
  return trace.visits.flatMap((visit) =>
    visit.node.kind === "terminal" ? [visit.node] : [],
  );
}

function assertTerminalPartition(
  trace: ReturnType<typeof buildCrumbNetTrace>,
  netlist: ReturnType<typeof buildNetlist>,
): void {
  for (const terminal of terminalVisits(trace)) {
    assert.equal(
      netlist.terminalIndexNetIndex.get(
        `${terminal.componentId.toLowerCase()}:${terminal.terminalIndex}`,
      ),
      trace.resolvedNet.id,
      `visited terminal ${terminal.componentId}:${terminal.terminalIndex} must belong to ${trace.resolvedNet.id}`,
    );
  }
}

test("trace returns a deterministic static witness with earlier parents", () => {
  const analysis = analyzeCru(generateFixture("breadboard-led"));
  const led = analysis.components.find(
    (component) => component.kind === "led-5mm",
  );
  assert.ok(led);
  const netlist = buildNetlist(analysis);
  const first = buildCrumbNetTrace(analysis, netlist, {
    componentId: led.id,
    terminalIndex: 0,
    expectedTerminalName: led.terminals[0]!.name,
  });
  const second = buildCrumbNetTrace(analysis, netlist, {
    componentId: led.id.toUpperCase(),
    terminalIndex: 0,
  });

  assert.deepEqual(first, second);
  assertTerminalPartition(first, netlist);
  assert.equal(first.traceVersion, "crumb.net-trace/0.1");
  assert.equal(first.provenance.simulationPerformed, false);
  assert.equal(first.provenance.liveStateObserved, false);
  assert.equal(first.provenance.allPathsEnumerated, false);
  assert.equal(first.provenance.componentBodiesTraversed, false);
  assert.match(first.provenance.limitation, /establishes no current, voltage/u);
  assert.equal(
    first.witness.witnessEdgeCount,
    first.witness.reachableNodeCount - 1,
  );
  const ordinalByNode = new Map(
    first.visits.map((visit) => [visit.node.id, visit.ordinal]),
  );
  for (const visit of first.visits.slice(1)) {
    assert.ok(visit.parentNodeId);
    assert.ok(visit.via);
    assert.ok(ordinalByNode.get(visit.parentNodeId!)! < visit.ordinal);
    assert.ok(
      [visit.via!.fromNodeId, visit.via!.toNodeId].includes(visit.node.id),
    );
  }
});

test("known board topology observes breadboard row boundaries", () => {
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const xml = boardDocument([
    twoTerminalComponent(3, firstId, 0, 4),
    twoTerminalComponent(3, secondId, 4, 5),
  ]);

  const knownAnalysis = analyzeCru(xml, {
    topologyMode: "known-board-v1.3.5",
  });
  const known = buildCrumbNetTrace(knownAnalysis, buildNetlist(knownAnalysis), {
    componentId: firstId,
    terminalIndex: 0,
  });
  const knownTerminals = terminalVisits(known);
  assert.ok(
    knownTerminals.some(
      (terminal) =>
        terminal.componentId === secondId && terminal.terminalIndex === 0,
    ),
  );
  assert.equal(
    knownTerminals.some(
      (terminal) =>
        terminal.componentId === secondId && terminal.terminalIndex === 1,
    ),
    false,
  );

  const directAnalysis = analyzeCru(xml, { topologyMode: "direct-only" });
  const direct = buildCrumbNetTrace(
    directAnalysis,
    buildNetlist(directAnalysis),
    { componentId: firstId, terminalIndex: 0 },
  );
  assert.equal(terminalVisits(direct).length, 1);
});

test("terminal-index selection reaches terminals beyond public display bounds", () => {
  const componentId = "33333333-3333-4333-8333-333333333333";
  const xml = spliceComponents(
    boardDocument([]),
    manyTerminalComponentXml(componentId, 0, 150),
  );
  const analysis = analyzeCru(xml);
  const component = analysis.components.find(
    (candidate) => candidate.id === componentId,
  );
  assert.ok(component);
  assert.equal(component.terminals.length, 64);
  assert.equal(component.terminalBounds.total, 150);
  assert.equal(fullAnalyzedComponentTerminals(component).length, 150);

  const trace = buildCrumbNetTrace(analysis, buildNetlist(analysis), {
    componentId,
    terminalIndex: 149,
  });
  assert.equal(trace.root.terminalIndex, 149);
  assert.equal(trace.resolvedNet.counts.terminals, 150);
  assert.equal(
    terminalVisits(trace).some((terminal) => terminal.terminalIndex === 149),
    true,
  );
});

test("jumper endpoints are valid roots and retain structured wire provenance", () => {
  const jumperId = "44444444-4444-4444-8444-444444444444";
  const resistorId = "55555555-5555-4555-8555-555555555555";
  const analysis = analyzeCru(
    boardDocument([
      twoTerminalComponent(2, jumperId, 0, 10),
      twoTerminalComponent(3, resistorId, 11, 20),
    ]),
  );
  const netlist = buildNetlist(analysis);
  assert.ok(netlist.terminalIndexNetIndex.get(`${jumperId}:0`));
  const trace = buildCrumbNetTrace(analysis, netlist, {
    componentId: jumperId,
    terminalIndex: 0,
  });

  assert.equal(trace.resolvedNet.counts.explicitWires, 1);
  const wireEdge = trace.visits
    .map((visit) => visit.via)
    .find((edge) => edge?.kind === "jumper-wire");
  assert.ok(wireEdge);
  assert.equal(wireEdge.kind, "jumper-wire");
  assert.equal(wireEdge.source.componentId, jumperId);
  assert.deepEqual(wireEdge.source.endpointTerminalIndices, [0, 1]);
});

test("saved switch closures are opt-in, conditional, and not live state", () => {
  const commonPartId = "66666666-6666-4666-8666-666666666666";
  const throwPartId = "77777777-7777-4777-8777-777777777777";
  const switchId = "88888888-8888-4888-8888-888888888888";
  const unrelatedSwitchId = "99999999-9999-4999-8999-999999999999";
  const base = boardDocument([
    twoTerminalComponent(3, commonPartId, 1, 100),
    twoTerminalComponent(3, throwPartId, 6, 105),
  ]);
  const xml = spliceComponents(
    base,
    [
      slideSwitchXml(switchId, 1, 0, 20, 5),
      slideSwitchXml(unrelatedSwitchId, 1, 30, 40, 35),
    ].join("\n"),
  );
  const analysis = analyzeCru(xml);
  const withoutStates = buildCrumbNetTrace(analysis, buildNetlist(analysis), {
    componentId: commonPartId,
    terminalIndex: 0,
  });
  const withStatesNetlist = buildNetlist(analysis, {
    applySwitchStates: true,
  });
  const withStates = buildCrumbNetTrace(
    analysis,
    withStatesNetlist,
    { componentId: commonPartId, terminalIndex: 0 },
    { applySwitchStates: true },
  );

  assert.equal(
    terminalVisits(withoutStates).some(
      (terminal) => terminal.componentId === throwPartId,
    ),
    false,
  );
  assert.equal(
    terminalVisits(withStates).some(
      (terminal) => terminal.componentId === throwPartId,
    ),
    true,
  );
  assert.equal(withStates.provenance.liveStateObserved, false);
  assert.equal(
    withStates.provenance.savedSwitchSemantics,
    "installed-build-conditional",
  );
  const switchEdge = withStates.visits
    .map((visit) => visit.via)
    .find((edge) => edge?.kind === "saved-switch-state");
  assert.ok(switchEdge);
  assert.equal(switchEdge.conditional, true);
  assert.equal(switchEdge.source.componentId, switchId);
  assert.equal(switchEdge.source.savedField, "positionCode");
  assert.equal(switchEdge.source.savedValue, 1);
  assert.equal(withStates.resolvedNet.counts.savedSwitchClosures, 1);
  assert.equal(withStates.witness.closedSwitchPathCount, 1);
  assert.equal(withStates.witness.netChangingSwitchEdgeCount, 1);
  assert.equal(withStates.witness.redundantClosedSwitchPathCount, 0);
  assertTerminalPartition(withStates, withStatesNetlist);
});

test("trace rejects a netlist built for a different topology mode", () => {
  const componentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const xml = boardDocument([twoTerminalComponent(3, componentId, 0, 5)]);
  const directAnalysis = analyzeCru(xml, { topologyMode: "direct-only" });
  const knownAnalysis = analyzeCru(xml, {
    topologyMode: "known-board-v1.3.5",
  });
  const directNetlist = buildNetlist(directAnalysis);

  assert.throws(
    () =>
      buildCrumbNetTrace(knownAnalysis, directNetlist, {
        componentId,
        terminalIndex: 0,
      }),
    (error: unknown) =>
      error instanceof CrumbTraceSelectionError &&
      error.kind === "netlist-configuration-mismatch" &&
      error.details.mismatch === "topologyMode" &&
      error.details.analysisTopologyMode === "known-board-v1.3.5" &&
      error.details.netlistTopologyMode === "direct-only" &&
      /rebuild the netlist from this analysis/u.test(error.message),
  );
});

test("trace rejects netlist and trace switch-semantics mismatches", () => {
  const componentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const analysis = analyzeCru(
    boardDocument([twoTerminalComponent(3, componentId, 0, 5)]),
  );

  for (const [netlistSwitchSemanticsApplied, requestedApplySwitchStates] of [
    [false, true],
    [true, false],
  ] as const) {
    const netlist = buildNetlist(analysis, {
      applySwitchStates: netlistSwitchSemanticsApplied,
    });
    assert.throws(
      () =>
        buildCrumbNetTrace(
          analysis,
          netlist,
          { componentId, terminalIndex: 0 },
          { applySwitchStates: requestedApplySwitchStates },
        ),
      (error: unknown) =>
        error instanceof CrumbTraceSelectionError &&
        error.kind === "netlist-configuration-mismatch" &&
        error.details.mismatch === "switchSemanticsApplied" &&
        error.details.netlistSwitchSemanticsApplied ===
          netlistSwitchSemanticsApplied &&
        error.details.requestedApplySwitchStates ===
          requestedApplySwitchStates &&
        /rebuild the netlist with matching switch semantics/u.test(
          error.message,
        ),
    );
  }
});

test("selector guards and graph work caps fail closed", () => {
  const analysis = analyzeCru(generateFixture("breadboard-led"));
  const led = analysis.components.find(
    (component) => component.kind === "led-5mm",
  )!;
  const netlist = buildNetlist(analysis);
  assert.throws(
    () =>
      buildCrumbNetTrace(analysis, netlist, {
        componentId: led.id,
        terminalIndex: 2,
      }),
    (error: unknown) =>
      error instanceof CrumbTraceSelectionError &&
      error.kind === "terminal-not-found" &&
      error.details.terminalCount === 2,
  );
  assert.throws(
    () =>
      buildCrumbNetTrace(analysis, netlist, {
        componentId: led.id,
        terminalIndex: 0,
        expectedTerminalName: "not-the-terminal",
      }),
    (error: unknown) =>
      error instanceof CrumbTraceSelectionError &&
      error.kind === "terminal-name-mismatch",
  );
  assert.throws(
    () =>
      buildCrumbNetTrace(
        analysis,
        netlist,
        { componentId: led.id, terminalIndex: 0 },
        { maxNodes: 1 },
      ),
    (error: unknown) =>
      error instanceof CrumbTraceSelectionError &&
      error.kind === "graph-quota-exceeded",
  );
  assert.throws(
    () =>
      buildCrumbNetTrace(
        analysis,
        netlist,
        { componentId: led.id, terminalIndex: 0 },
        { maxEdges: 1 },
      ),
    (error: unknown) =>
      error instanceof CrumbTraceSelectionError &&
      error.kind === "graph-quota-exceeded",
  );
});
