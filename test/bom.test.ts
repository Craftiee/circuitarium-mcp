import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCru } from "../src/adapters/crumb/analyze.js";
import { buildBom } from "../src/adapters/crumb/bom.js";
import { serializeCru, type CruDocument } from "../src/adapters/crumb/format.js";

const BOARD_GUID = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";

function resistor(
  guid: string,
  tieA: number,
  tieB: number,
  ohms: number,
): CruDocument["components"][number] {
  return {
    toolId: 3,
    guid,
    geometry: [
      { x: 0, y: 2, z: 0 },
      { x: 1, y: 2, z: 0 },
    ],
    tiePoints: [
      { id: tieA, parentIdentifier: BOARD_GUID },
      { id: tieB, parentIdentifier: BOARD_GUID },
    ],
    settings: [
      { type: "xsd:float", value: ohms },
      { type: "xsd:float", value: 0.25 },
    ],
  };
}

function slideSwitchXml(guid: string, positionCode: number, baseTie: number): string {
  return `    <SaveComponent>
      <toolID>9</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${guid}</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID">
          <TiePointID><id>${baseTie}</id><parentIdentifier>${BOARD_GUID}</parentIdentifier></TiePointID>
          <TiePointID><id>${baseTie + 5}</id><parentIdentifier>${BOARD_GUID}</parentIdentifier></TiePointID>
          <TiePointID><id>${baseTie + 10}</id><parentIdentifier>${BOARD_GUID}</parentIdentifier></TiePointID>
        </anyType>
        <anyType xsi:type="xsd:int">${positionCode}</anyType>
      </data>
    </SaveComponent>`;
}

test("identical part values group into one BOM line; different values split", () => {
  const xml = serializeCru({
    name: "BOM Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      resistor("35f92d9a-cda9-44c7-b416-8c77f301248e", 0, 10, 1000),
      resistor("1f116ff1-e792-474d-b524-82b3b9530eb7", 20, 30, 1000),
      resistor("ee877d3f-ecba-4407-93a8-40b8644bfa06", 40, 50, 4700),
    ],
  });
  const bom = buildBom(analyzeCru(xml), 100);

  assert.equal(bom.totals.components, 4);
  assert.equal(bom.totals.distinctLines, 3);
  const kiloOhm = bom.lines.find(
    (line) => line.kind === "resistor" && line.identity.resistance?.value === 1000,
  );
  assert.ok(kiloOhm);
  assert.equal(kiloOhm!.quantity, 2);
  assert.equal(kiloOhm!.identity.resistance?.unit, "ohm");
  assert.equal(kiloOhm!.componentIdSample.length, 2);
  const spare = bom.lines.find(
    (line) => line.kind === "resistor" && line.identity.resistance?.value === 4700,
  );
  assert.ok(spare);
  assert.equal(spare!.quantity, 1);
});

test("state values such as switch position do not split BOM lines", () => {
  const base = serializeCru({
    name: "Switch BOM Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const xml = base.replace(
    "  </components>",
    `${slideSwitchXml("bb22ce70-2222-4a7a-b202-d4467ab10d69", 0, 0)}\n` +
      `${slideSwitchXml("cc33ce70-3333-4a7a-b202-d4467ab10d69", 1, 100)}\n  </components>`,
  );
  const bom = buildBom(analyzeCru(xml), 100);

  const switches = bom.lines.find((line) => line.kind === "slide-switch");
  assert.ok(switches);
  assert.equal(switches!.quantity, 2, JSON.stringify(bom.lines));
  assert.equal("positionCode" in switches!.identity, false);
});

test("BOM lines are bounded with explicit truncation state", () => {
  const xml = serializeCru({
    name: "Bounded BOM Test",
    components: [
      {
        toolId: 0,
        guid: BOARD_GUID,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      resistor("35f92d9a-cda9-44c7-b416-8c77f301248e", 0, 10, 1000),
      resistor("1f116ff1-e792-474d-b524-82b3b9530eb7", 20, 30, 2200),
      resistor("ee877d3f-ecba-4407-93a8-40b8644bfa06", 40, 50, 4700),
    ],
  });
  const bom = buildBom(analyzeCru(xml), 2);

  assert.equal(bom.lineBounds.total, 4);
  assert.equal(bom.lineBounds.returned, 2);
  assert.equal(bom.lineBounds.truncated, true);
  assert.equal(bom.totals.distinctLines, 4);
});
