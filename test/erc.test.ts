import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCru } from "../src/adapters/crumb/analyze.js";
import { checkNetlist } from "../src/adapters/crumb/erc.js";
import { buildNetlist } from "../src/adapters/crumb/netlist.js";
import { serializeCru, type CruDocument } from "../src/adapters/crumb/format.js";

const BOARD_GUID = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";

function spliceComponents(xml: string, extraComponentXml: string): string {
  return xml.replace(
    "  </components>",
    `${extraComponentXml}\n  </components>`,
  );
}

function supplyXml(
  guid: string,
  boardGuid: string,
  voltage: number,
  positiveTie: number,
  groundTie: number,
): string {
  return `    <SaveComponent>
      <toolID>7</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${guid}</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="xsd:boolean">true</anyType>
        <anyType xsi:type="xsd:float">${voltage}</anyType>
        <anyType xsi:type="ArrayOfTiePointID">
          <TiePointID><id>${positiveTie}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>
          <TiePointID><id>${groundTie}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>
        </anyType>
      </data>
    </SaveComponent>`;
}

function icXml(
  guid: string,
  boardGuid: string,
  prefabId: number,
  tieIds: number[],
): string {
  const tiePoints = tieIds
    .map(
      (id) =>
        `          <TiePointID><id>${id}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>`,
    )
    .join("\n");
  return `    <SaveComponent>
      <toolID>5</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${guid}</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID">
${tiePoints}
        </anyType>
        <anyType xsi:type="xsd:int">${prefabId}</anyType>
      </data>
    </SaveComponent>`;
}

function twoTerminalComponent(
  toolId: number,
  guid: string,
  boardGuid: string,
  tieA: number,
  tieB: number,
  settings: Array<{ type: "xsd:float" | "xsd:double" | "xsd:int"; value: number }>,
): CruDocument["components"][number] {
  return {
    toolId,
    guid,
    geometry: [
      { x: 0, y: 2, z: 0 },
      { x: 1, y: 2, z: 0 },
    ],
    tiePoints: [
      { id: tieA, parentIdentifier: boardGuid },
      { id: tieB, parentIdentifier: boardGuid },
    ],
    settings,
  };
}

function boardDocument(
  components: CruDocument["components"],
  name: string,
): string {
  return serializeCru({
    name,
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

function ercFor(xml: string) {
  const analysis = analyzeCru(xml);
  const netlist = buildNetlist(analysis);
  return checkNetlist(analysis, netlist);
}

test("a supply short remains visible past a single-group display bound", () => {
  const fillerComponents = Array.from({ length: 70 }, (_, index) =>
    twoTerminalComponent(
      99,
      `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
      BOARD_GUID,
      0,
      1,
      [],
    ),
  );
  const supplyId = "fffffff0-1111-4111-8111-fffffffffff0";
  const xml = spliceComponents(
    boardDocument(fillerComponents, "Oversized Supply Short"),
    supplyXml(supplyId, BOARD_GUID, 5, 2, 3),
  );
  const analysis = analyzeCru(xml);
  const oversizedGroup = analysis.connectivity.groups.find(
    (group) => group.membershipBounds.componentTerminals.truncated,
  );
  assert.ok(oversizedGroup);
  assert.deepEqual(oversizedGroup.membershipBounds.componentTerminals, {
    total: 142,
    returned: 128,
    limit: 128,
    truncated: true,
  });

  const netlist = buildNetlist(analysis);
  const positiveNet = netlist.terminalNetIndex.get(
    `${supplyId}:positive-output`,
  );
  const groundNet = netlist.terminalNetIndex.get(`${supplyId}:ground`);
  assert.ok(positiveNet);
  assert.equal(groundNet, positiveNet);

  const report = checkNetlist(analysis, netlist);
  assert.equal(report.valid, false);
  assert.ok(
    report.findings.some(
      (finding) =>
        finding.ruleId === "supply-net-short" &&
        finding.componentIds.includes(supplyId),
    ),
    JSON.stringify(report.findings),
  );
});

test("a LED straight across the supply rails is an error", () => {
  // Supply: + on row 100 (tie 500), - on row 101 (tie 505).
  // LED bridges rows 100 and 101 directly.
  const base = boardDocument(
    [
      twoTerminalComponent(6, "1f116ff1-e792-474d-b524-82b3b9530eb7", BOARD_GUID, 501, 506, [
        { type: "xsd:double", value: 2.2 },
        { type: "xsd:int", value: 0 },
        { type: "xsd:double", value: 0.03 },
      ]),
    ],
    "LED Across Supply",
  );
  const xml = spliceComponents(
    base,
    supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 505),
  );
  const report = ercFor(xml);

  assert.equal(report.valid, false);
  const finding = report.findings.find(
    (entry) => entry.ruleId === "led-direct-across-supply",
  );
  assert.ok(finding, JSON.stringify(report.findings));
  assert.equal(finding!.severity, "error");
  assert.equal(finding!.basis, "both");
  assert.match(finding!.message, /polarity naming is unverified/);
});

test("a correctly resistored LED passes with no errors", () => {
  // Supply + row 100, - row 101; resistor rows 100->102; LED rows 102->101.
  const base = boardDocument(
    [
      twoTerminalComponent(3, "35f92d9a-cda9-44c7-b416-8c77f301248e", BOARD_GUID, 501, 510, [
        { type: "xsd:float", value: 330 },
        { type: "xsd:float", value: 0.25 },
      ]),
      twoTerminalComponent(6, "1f116ff1-e792-474d-b524-82b3b9530eb7", BOARD_GUID, 511, 506, [
        { type: "xsd:double", value: 2.2 },
        { type: "xsd:int", value: 0 },
        { type: "xsd:double", value: 0.03 },
      ]),
    ],
    "Resistored LED",
  );
  const xml = spliceComponents(
    base,
    supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 505),
  );
  const report = ercFor(xml);

  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.totals.errors, 0);
});

test("supply positive shorted to ground is an error", () => {
  const base = boardDocument([], "Shorted Supply");
  // Both supply terminals on row 100.
  const xml = spliceComponents(
    base,
    supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 501),
  );
  const report = ercFor(xml);

  assert.equal(report.valid, false);
  assert.ok(
    report.findings.some((entry) => entry.ruleId === "supply-net-short"),
  );
});

test("an underrated resistor directly across the supply warns with the math", () => {
  const base = boardDocument(
    [
      twoTerminalComponent(3, "35f92d9a-cda9-44c7-b416-8c77f301248e", BOARD_GUID, 501, 506, [
        { type: "xsd:float", value: 10 },
        { type: "xsd:float", value: 0.25 },
      ]),
    ],
    "Overpower Test",
  );
  const xml = spliceComponents(
    base,
    supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 12, 500, 505),
  );
  const report = ercFor(xml);

  const finding = report.findings.find(
    (entry) => entry.ruleId === "resistor-overpower",
  );
  assert.ok(finding, JSON.stringify(report.findings));
  assert.equal(finding!.severity, "warning");
  assert.match(finding!.message, /14\.400 W/);
  assert.match(finding!.message, /no simulation was run/);
});

test("a component with both terminals on one net is reported as bypassed", () => {
  const xml = boardDocument(
    [
      twoTerminalComponent(3, "35f92d9a-cda9-44c7-b416-8c77f301248e", BOARD_GUID, 500, 501, [
        { type: "xsd:float", value: 1000 },
        { type: "xsd:float", value: 0.25 },
      ]),
    ],
    "Shorted Resistor",
  );
  const report = ercFor(xml);

  assert.ok(
    report.findings.some(
      (entry) => entry.ruleId === "component-terminals-shorted",
    ),
  );
});

test("IC power pins with no other connection warn as floating", () => {
  // LM555 (prefab 0) has 8 pins named GND..Vcc; place every pin on its own
  // otherwise-empty board row, so all pins float.
  const base = boardDocument([], "Floating IC");
  const xml = spliceComponents(
    base,
    icXml(
      "cc33ce70-3333-4a7a-b202-d4467ab10d69",
      BOARD_GUID,
      0,
      [0, 5, 10, 15, 20, 25, 30, 35],
    ),
  );
  const report = ercFor(xml);

  const powerFindings = report.findings.filter(
    (entry) => entry.ruleId === "ic-power-pin-floating",
  );
  assert.equal(powerFindings.length, 2, JSON.stringify(report.findings));
  assert.ok(
    powerFindings.every((entry) => entry.severity === "warning"),
  );
});

test("floating interconnect terminals are informational, passives warn", () => {
  const xml = boardDocument(
    [
      twoTerminalComponent(3, "35f92d9a-cda9-44c7-b416-8c77f301248e", BOARD_GUID, 0, 600, [
        { type: "xsd:float", value: 1000 },
        { type: "xsd:float", value: 0.25 },
      ]),
    ],
    "Floating Passive",
  );
  const report = ercFor(xml);
  const floating = report.findings.filter(
    (entry) => entry.ruleId === "floating-terminal",
  );
  assert.equal(floating.length, 2);
  assert.ok(floating.every((entry) => entry.severity === "warning"));
  assert.equal(report.valid, true);
});

function signalGeneratorXml(
  guid: string,
  boardGuid: string,
  tieA: number,
  tieB: number,
): string {
  return `    <SaveComponent>
      <toolID>24</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${guid}</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="xsd:boolean">true</anyType>
        <anyType xsi:type="ArrayOfTiePointID">
          <TiePointID><id>${tieA}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>
          <TiePointID><id>${tieB}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>
        </anyType>
        <anyType xsi:type="xsd:float">5</anyType>
        <anyType xsi:type="xsd:float">50</anyType>
        <anyType xsi:type="xsd:int">0</anyType>
      </data>
    </SaveComponent>`;
}

function slideSwitchXml(
  guid: string,
  boardGuid: string,
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
          <TiePointID><id>${commonTie}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>
          <TiePointID><id>${throw0Tie}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>
          <TiePointID><id>${throw1Tie}</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>
        </anyType>
        <anyType xsi:type="xsd:int">${positionCode}</anyType>
      </data>
    </SaveComponent>`;
}

test("rails of different supplies are not conflated into a same-supply short", () => {
  // Supply A: + row 100, - row 101. Supply B: + row 102, - row 103.
  // LED bridges A's positive row and B's ground row: two isolated supplies,
  // no same-supply loop, so no error may fire.
  const base = boardDocument(
    [
      twoTerminalComponent(6, "1f116ff1-e792-474d-b524-82b3b9530eb7", BOARD_GUID, 501, 516, [
        { type: "xsd:double", value: 2.2 },
        { type: "xsd:int", value: 0 },
        { type: "xsd:double", value: 0.03 },
      ]),
    ],
    "Split Supply LED",
  );
  const xml = spliceComponents(
    spliceComponents(
      base,
      supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 505),
    ),
    supplyXml("bb22ce70-2222-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 510, 515),
  );
  const report = ercFor(xml);

  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.ok(
    report.findings.every(
      (entry) =>
        entry.ruleId !== "led-direct-across-supply" &&
        entry.ruleId !== "supply-net-short",
    ),
  );
});

test("tying one supply's positive to another's ground is info, not a short", () => {
  // Supply A: + row 100 (tie 500), - row 101. Supply B: + row 102, - also on
  // row 100 (tie 502) — a deliberate series-stack junction.
  const base = boardDocument([], "Stacked Supplies");
  const xml = spliceComponents(
    spliceComponents(
      base,
      supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 505),
    ),
    supplyXml("bb22ce70-2222-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 510, 502),
  );
  const report = ercFor(xml);

  assert.equal(report.valid, true, JSON.stringify(report.findings));
  const tie = report.findings.find(
    (entry) => entry.ruleId === "cross-supply-rail-tie",
  );
  assert.ok(tie, JSON.stringify(report.findings));
  assert.equal(tie!.severity, "info");
  assert.match(tie!.message, /unverified/);
});

test("a signal generator with both terminals on one net is a shorted source", () => {
  const base = boardDocument([], "Shorted Generator");
  const xml = spliceComponents(
    base,
    signalGeneratorXml("cc33ce70-3333-4a7a-b202-d4467ab10d69", BOARD_GUID, 500, 501),
  );
  const report = ercFor(xml);

  assert.equal(report.valid, false);
  assert.ok(
    report.findings.some(
      (entry) => entry.ruleId === "source-terminals-shorted",
    ),
    JSON.stringify(report.findings),
  );
});

test("shorts that exist only through saved switch positions say so", () => {
  // Supply + row 100, - row 101; slide switch common on row 100 (tie 502),
  // throw-1 on row 101 (tie 506), positionCode=1 closes common<->throw-1.
  const base = boardDocument([], "Conditional Short");
  const xml = spliceComponents(
    spliceComponents(
      base,
      supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 505),
    ),
    slideSwitchXml("dd44ce70-4444-4a7a-b202-d4467ab10d69", BOARD_GUID, 1, 502, 610, 506),
  );
  const analysis = analyzeCru(xml);

  const openReport = checkNetlist(analysis, buildNetlist(analysis));
  assert.ok(
    openReport.findings.every((entry) => entry.ruleId !== "supply-net-short"),
    "no short while the switch merge is not applied",
  );

  const closedNetlist = buildNetlist(analysis, { applySwitchStates: true });
  const closedReport = checkNetlist(analysis, closedNetlist);
  const short = closedReport.findings.find(
    (entry) => entry.ruleId === "supply-net-short",
  );
  assert.ok(short, JSON.stringify(closedReport.findings));
  assert.match(short!.message, /conditional on them/);
  assert.doesNotMatch(short!.message, /no intervening component/);
});
