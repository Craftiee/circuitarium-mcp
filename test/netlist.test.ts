import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCru } from "../src/adapters/crumb/analyze.js";
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

function ledDocumentXml(): string {
  // Rows: 100 (ids 500-504), 101 (505-509), 102 (510-514), 122 (610-614).
  const document: CruDocument = {
    name: "Netlist Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      twoTerminalComponent(3, "35f92d9a-cda9-44c7-b416-8c77f301248e", BOARD_GUID, 501, 510, [
        { type: "xsd:float", value: 330 },
        { type: "xsd:float", value: 0.25 },
      ]),
      twoTerminalComponent(6, "1f116ff1-e792-474d-b524-82b3b9530eb7", BOARD_GUID, 511, 506, [
        { type: "xsd:double", value: 2.2 },
        { type: "xsd:int", value: 0 },
        { type: "xsd:double", value: 0.03 },
      ]),
      twoTerminalComponent(2, "ee877d3f-ecba-4407-93a8-40b8644bfa06", BOARD_GUID, 512, 610, [
        { type: "xsd:int", value: 1 },
        { type: "xsd:float", value: 3 },
      ]),
    ],
  };
  return spliceComponents(
    serializeCru(document),
    supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 505),
  );
}

test("netlist collapses jumpers, names supply nets, and keeps provenance", () => {
  const xml = ledDocumentXml();
  const netlist = buildNetlist(analyzeCru(xml));

  assert.equal(netlist.netlistVersion, "crumb.netlist/0.1");
  assert.equal(netlist.provenance.topologyConfidence, "version-pinned");
  assert.equal(netlist.provenance.switchSemanticsApplied, false);
  assert.equal(netlist.stats.supplyCount, 1);
  assert.equal(netlist.stats.wireCount, 1);

  const vcc = netlist.nets.find((net) => net.name === "VCC");
  const gnd = netlist.nets.find((net) => net.name === "GND");
  assert.ok(vcc, "VCC net exists");
  assert.ok(gnd, "GND net exists");
  assert.equal(vcc!.nameSource, "dc-power-supply-terminal");
  assert.ok(
    vcc!.members.some(
      (member) => member.componentKind === "resistor" && member.terminal === "terminal-a",
    ),
    "resistor terminal-a shares the VCC net",
  );
  assert.ok(
    gnd!.members.some(
      (member) => member.componentKind === "led-5mm" && member.terminal === "terminal-b",
    ),
    "LED terminal-b shares the GND net",
  );

  const middle = netlist.nets.find((net) =>
    net.members.some(
      (member) => member.componentKind === "resistor" && member.terminal === "terminal-b",
    ),
  );
  assert.ok(middle, "middle net exists");
  assert.ok(
    middle!.members.every((member) => member.componentKind !== "jumper-wire"),
    "jumper wires are not net members",
  );
  assert.equal(middle!.wireIds.length, 1, "the jumper survives as wire provenance");
});

test("saved slide-switch positions merge nets only on request, with provenance", () => {
  // Switch: common row 0 (tie 0), throw-0 row 5 (tie 25), throw-1 row 10 (tie 50).
  const base = serializeCru({
    name: "Switch Merge Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      twoTerminalComponent(3, "35f92d9a-cda9-44c7-b416-8c77f301248e", BOARD_GUID, 1, 26, [
        { type: "xsd:float", value: 1000 },
        { type: "xsd:float", value: 0.25 },
      ]),
      twoTerminalComponent(3, "1f116ff1-e792-474d-b524-82b3b9530eb7", BOARD_GUID, 2, 51, [
        { type: "xsd:float", value: 1000 },
        { type: "xsd:float", value: 0.25 },
      ]),
    ],
  });
  const xml = spliceComponents(
    base,
    slideSwitchXml("bb22ce70-2222-4a7a-b202-d4467ab10d69", BOARD_GUID, 1, 0, 25, 50),
  );
  const analysis = analyzeCru(xml);

  const withoutStates = buildNetlist(analysis);
  const withStates = buildNetlist(analysis, { applySwitchStates: true });

  assert.equal(withoutStates.stats.switchMergesApplied, 0);
  assert.equal(withStates.stats.switchMergesApplied, 1);
  assert.equal(
    withStates.stats.netCount,
    withoutStates.stats.netCount - 1,
    "positionCode=1 merges common with throw-1",
  );
  assert.equal(withStates.provenance.switchSemanticsConfidence, "installed-build");
  const merged = withStates.nets.find((net) => net.mergedBySwitches.length > 0);
  assert.ok(merged, "the merged net records its switch provenance");
  assert.match(merged!.mergedBySwitches[0]!.closedPath, /common<->throw-1/);
  assert.ok(
    merged!.members.some(
      (member) => member.terminal === "common",
    ) &&
      merged!.members.some((member) => member.terminal === "throw-1"),
    "common and throw-1 share the merged net",
  );
});

test("later switch unions retain every earlier closure on the final net", () => {
  const base = serializeCru({
    name: "Switch Provenance Chain",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const firstSwitchId = "ff22ce70-2222-4a7a-b202-d4467ab10d69";
  const secondSwitchId = "0022ce70-2222-4a7a-b202-d4467ab10d69";
  const xml = spliceComponents(
    spliceComponents(
      base,
      slideSwitchXml(firstSwitchId, BOARD_GUID, 1, 25, 75, 50),
    ),
    slideSwitchXml(secondSwitchId, BOARD_GUID, 1, 0, 100, 25),
  );
  const analysis = analyzeCru(xml);
  const netlist = buildNetlist(analysis, { applySwitchStates: true });
  const merged = netlist.nets.find(
    (net) => net.switchMergeBounds.total === 2,
  );

  assert.equal(netlist.stats.switchMergesApplied, 2);
  assert.ok(merged, JSON.stringify(netlist.nets));
  assert.deepEqual(
    merged.mergedBySwitches.map((entry) => entry.componentId).sort(),
    [firstSwitchId, secondSwitchId].sort(),
  );
  assert.deepEqual(merged.switchMergeBounds, {
    total: 2,
    returned: 2,
    limit: 128,
    truncated: false,
  });
});

test("switch provenance is response-bounded without violating the net schema", () => {
  const base = serializeCru({
    name: "Switch Provenance Bound",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const switches = Array.from({ length: 129 }, (_, index) =>
    slideSwitchXml(
      `${index.toString(16).padStart(8, "0")}-2222-4a7a-b202-d4467ab10d69`,
      BOARD_GUID,
      1,
      0,
      10,
      5,
    ),
  ).join("\n");
  const xml = base.replace(
    "  </components>",
    `${switches}\n  </components>`,
  );
  const netlist = buildNetlist(analyzeCru(xml), { applySwitchStates: true });
  const merged = netlist.nets.find(
    (net) => net.switchMergeBounds.truncated,
  );

  assert.ok(merged);
  assert.equal(merged.mergedBySwitches.length, 128);
  assert.deepEqual(merged.switchMergeBounds, {
    total: 129,
    returned: 128,
    limit: 128,
    truncated: true,
  });
});

test("single-terminal nets are reported as floating terminals", () => {
  const xml = serializeCru({
    name: "Floating Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      twoTerminalComponent(3, "35f92d9a-cda9-44c7-b416-8c77f301248e", BOARD_GUID, 0, 600, [
        { type: "xsd:float", value: 1000 },
        { type: "xsd:float", value: 0.25 },
      ]),
    ],
  });
  const netlist = buildNetlist(analyzeCru(xml));
  assert.equal(netlist.stats.floatingTerminalCount, 2);
  assert.ok(
    netlist.floatingTerminals.every(
      (terminal) => terminal.componentKind === "resistor",
    ),
  );
});

test("a supply with both terminals on one net stays unnamed with a diagnostic", () => {
  const base = serializeCru({
    name: "Shorted Supply Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  // Both supply terminals on row 100 (ids 500 and 501).
  const xml = spliceComponents(
    base,
    supplyXml("aa11ce70-1111-4a7a-b202-d4467ab10d69", BOARD_GUID, 5, 500, 501),
  );
  const netlist = buildNetlist(analyzeCru(xml));
  assert.ok(
    netlist.diagnostics.some(
      (diagnostic) => diagnostic.code === "supply-terminals-share-net",
    ),
  );
  assert.ok(netlist.nets.every((net) => net.name === undefined));
});

test("mixed supply-terminal roles stay unnamed regardless of component order", () => {
  const base = serializeCru({
    name: "Stacked Supply Naming",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const supplyA = "aa11ce70-1111-4a7a-b202-d4467ab10d69";
  const supplyB = "bb22ce70-2222-4a7a-b202-d4467ab10d69";
  const supplyAXml = supplyXml(supplyA, BOARD_GUID, 5, 0, 5);
  const supplyBXml = supplyXml(supplyB, BOARD_GUID, 5, 10, 1);

  for (const xml of [
    spliceComponents(spliceComponents(base, supplyAXml), supplyBXml),
    spliceComponents(spliceComponents(base, supplyBXml), supplyAXml),
  ]) {
    const netlist = buildNetlist(analyzeCru(xml));
    const mixedNetId = netlist.terminalNetIndex.get(
      `${supplyA}:positive-output`,
    );
    assert.ok(mixedNetId);
    assert.equal(
      netlist.terminalNetIndex.get(`${supplyB}:ground`),
      mixedNetId,
    );
    assert.equal(
      netlist.nets.find((net) => net.id === mixedNetId)?.name,
      undefined,
    );
    assert.ok(
      netlist.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "mixed-supply-terminal-net-unnamed",
      ),
    );
  }
});

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

test("analysis-bounded groups surface net-membership-incomplete", () => {
  const base = serializeCru({
    name: "Oversized Group Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const xml = spliceComponents(
    base,
    manyTerminalComponentXml("ee55ce70-5555-4a7a-b202-d4467ab10d69", 0, 150),
  );
  const netlist = buildNetlist(analyzeCru(xml));

  assert.ok(
    netlist.diagnostics.some(
      (diagnostic) => diagnostic.code === "net-membership-incomplete",
    ),
    JSON.stringify(netlist.diagnostics),
  );
});

test("switch-merged nets keep every terminal in the full index past the display bound", () => {
  // Two ~101-member groups (rows 0 and 1) merge through a closed slide
  // switch: the serialized members are display-bounded at 128, but the full
  // terminal index must keep all of them so ERC never goes blind.
  const base = serializeCru({
    name: "Merged Oversize Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const xml = spliceComponents(
    spliceComponents(
      spliceComponents(
        base,
        manyTerminalComponentXml("ee55ce70-5555-4a7a-b202-d4467ab10d69", 0, 100),
      ),
      manyTerminalComponentXml("ff66ce70-6666-4a7a-b202-d4467ab10d69", 5, 100),
    ),
    slideSwitchXml("bb22ce70-2222-4a7a-b202-d4467ab10d69", BOARD_GUID, 1, 1, 610, 6),
  );
  const netlist = buildNetlist(analyzeCru(xml), { applySwitchStates: true });

  const merged = netlist.nets.find((net) => net.memberBounds.truncated);
  assert.ok(merged, "the merged net exceeds the display bound");
  assert.ok(merged!.memberBounds.total > 128);
  assert.equal(merged!.members.length, 128);
  assert.equal(
    netlist.terminalNetIndex.get(
      "ff66ce70-6666-4a7a-b202-d4467ab10d69:terminal-100",
    ),
    merged!.id,
    "a terminal past the display bound still resolves through the full index",
  );
});
