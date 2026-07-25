import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { analyzeCru } from "../src/adapters/crumb/analyze.js";
import { generateFixture } from "../src/adapters/crumb/fixtures.js";
import {
  inspectCru,
  serializeCru,
  type CruDocument,
} from "../src/adapters/crumb/format.js";

test("CRUMB analysis recognizes typed resistor and LED parameters", () => {
  const resistor = analyzeCru(generateFixture("breadboard-resistor")).components[1]!;
  assert.equal(resistor.kind, "resistor");
  assert.equal(resistor.recognitionStatus, "recognized");
  assert.deepEqual(resistor.parameters.resistance, {
    value: 1000,
    confidence: "controlled",
    unit: "ohm",
    encoding: {
      payloadIndex: 3,
      xsiType: "xsd:float",
      lexical: "1000",
    },
  });

  const led = analyzeCru(generateFixture("breadboard-led")).components[1]!;
  assert.equal(led.kind, "led-5mm");
  assert.deepEqual(
    led.terminals.map((terminal) => terminal.name),
    ["terminal-a", "terminal-b"],
  );
  assert.equal(led.parameters.forwardVoltage?.value, 2.2);
  assert.equal(led.parameters.maxCurrent?.unit, "ampere");
});

test("known CRUMB 1.3.5 board topology and jumper wires produce bounded nets", () => {
  const boardGuid = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";
  const document: CruDocument = {
    name: "Topology Test",
    components: [
      {
        toolId: 0,
        guid: boardGuid,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
      {
        toolId: 3,
        guid: "35f92d9a-cda9-44c7-b416-8c77f301248e",
        geometry: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        tiePoints: [
          { id: 100, parentIdentifier: boardGuid },
          { id: 105, parentIdentifier: boardGuid },
        ],
        settings: [
          { type: "xsd:float", value: 1000 },
          { type: "xsd:float", value: 0.25 },
        ],
      },
      {
        toolId: 6,
        guid: "1f116ff1-e792-474d-b524-82b3b9530eb7",
        geometry: [
          { x: 2, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
        ],
        tiePoints: [
          { id: 102, parentIdentifier: boardGuid },
          { id: 110, parentIdentifier: boardGuid },
        ],
        settings: [
          { type: "xsd:double", value: 2.2 },
          { type: "xsd:int", value: 0 },
          { type: "xsd:double", value: 0.03 },
        ],
      },
      {
        toolId: 2,
        guid: "ee877d3f-ecba-4407-93a8-40b8644bfa06",
        geometry: [
          { x: 4, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ],
        tiePoints: [
          { id: 105, parentIdentifier: boardGuid },
          { id: 110, parentIdentifier: boardGuid },
        ],
        settings: [
          { type: "xsd:int", value: 1 },
          { type: "xsd:float", value: 3 },
        ],
      },
    ],
  };
  const xml = serializeCru(document);
  const direct = analyzeCru(xml, { topologyMode: "direct-only" });
  const known = analyzeCru(xml, { topologyMode: "known-board-v1.3.5" });

  assert.equal(direct.connectivity.groupCount, 3);
  assert.equal(known.connectivity.groupCount, 2);
  assert.ok(known.connectivity.topologyLinksApplied > 0);
  assert.ok(
    known.connectivity.groups.some(
      (group) =>
        group.componentTerminals.some(
          (terminal) =>
            terminal.componentKind === "resistor" && terminal.terminal === "terminal-a",
        ) &&
        group.componentTerminals.some(
          (terminal) =>
            terminal.componentKind === "led-5mm" && terminal.terminal === "terminal-a",
        ),
    ),
  );
});

test("known tool IDs with a mismatched signature are not positionally guessed", () => {
  const xml = generateFixture("breadboard-resistor").replace(
    'xsi:type="xsd:float">1000',
    'xsi:type="xsd:double">1000',
  );
  const resistor = analyzeCru(xml).components[1]!;
  assert.equal(resistor.kind, "resistor");
  assert.equal(resistor.recognitionStatus, "schema-mismatch");
  assert.deepEqual(resistor.parameters, {});
});

test("tool-5 prefab IDs resolve version-pinned IC labels and ordered pin names", () => {
  const base = serializeCru({ name: "IC Test", components: [] });
  const parentGuid = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";
  const tiePoints = Array.from(
    { length: 8 },
    (_, index) =>
      `<TiePointID><id>${index}</id><parentIdentifier>${parentGuid}</parentIdentifier></TiePointID>`,
  ).join("");
  const componentXml = `<components>
    <SaveComponent>
      <toolID>5</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">72d417b6-62d0-4a7a-b202-d4467ab10d69</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID">${tiePoints}</anyType>
        <anyType xsi:type="xsd:int">0</anyType>
      </data>
    </SaveComponent>
  </components>`;
  const component = analyzeCru(base.replace("<components />", componentXml))
    .components[0]!;

  assert.equal(component.label, "LM555");
  assert.equal(component.variant?.prefabId, 0);
  assert.equal(component.variant?.pinNameCoverage, "complete");
  assert.equal(component.parameters.prefabId?.value, 0);
  assert.deepEqual(
    component.terminals.map((terminal) => terminal.name),
    ["GND", "TRIG", "Q", "|RST", "CV", "THR", "DIS", "Vcc"],
  );
  assert.equal(component.readSupport, "full");
});

test("28C16 EEPROM images use the alternate signature and stay redacted", () => {
  const base = serializeCru({ name: "EEPROM Test", components: [] });
  const bytes = Buffer.alloc(2048);
  bytes[0] = 0x42;
  bytes[2047] = 0xa5;
  const encoded = bytes.toString("base64");
  const componentXml = `<components>
    <SaveComponent>
      <toolID>5</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">72d417b6-62d0-4a7a-b202-d4467ab10d69</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID" />
        <anyType xsi:type="xsd:base64Binary">${encoded}</anyType>
        <anyType xsi:type="xsd:int">13</anyType>
      </data>
    </SaveComponent>
  </components>`;
  const analysis = analyzeCru(base.replace("<components />", componentXml));
  const component = analysis.components[0]!;

  assert.equal(component.recognitionStatus, "recognized");
  assert.equal(component.label, "28C16 EEPROM");
  assert.equal(component.parameters.prefabId?.value, 13);
  assert.equal(component.parameters.prefabId?.encoding.payloadIndex, 5);
  assert.deepEqual(component.embeddedData, {
    role: "eeprom-image",
    present: true,
    encoding: "xsd:base64Binary",
    valid: true,
    expectedBytes: 2048,
    bytes: 2048,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    contentIncluded: false,
  });
  assert.deepEqual(component.unknownPayloads, []);
  assert.equal(JSON.stringify(analysis).includes(encoded), false);
  assert.equal(analysis.summary.embeddedDataComponentCount, 1);
  assert.ok(
    analysis.diagnostics.some(
      (diagnostic) => diagnostic.code === "embedded-eeprom-redacted",
    ),
  );

  const wrongSize = analyzeCru(
    base.replace(
      "<components />",
      componentXml.replace(encoded, Buffer.from([1, 2, 3]).toString("base64")),
    ),
  );
  assert.equal(wrongSize.components[0]?.recognitionStatus, "schema-mismatch");
  assert.ok(
    wrongSize.diagnostics.some(
      (diagnostic) => diagnostic.code === "invalid-eeprom-image",
    ),
  );
});

test("user-authored labels are bounded and marked untrusted", () => {
  const base = serializeCru({ name: "Label Test", components: [] });
  const label = `${"A".repeat(240)}SECRET_TAIL`;
  const componentXml = `<components>
    <SaveComponent>
      <toolID>11</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">72d417b6-62d0-4a7a-b202-d4467ab10d69</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="xsd:string">${label}</anyType>
      </data>
    </SaveComponent>
  </components>`;
  const analysis = analyzeCru(base.replace("<components />", componentXml));
  const component = analysis.components[0]!;

  assert.equal(component.kind, "label");
  assert.deepEqual(component.parameters, {});
  assert.equal(component.annotation?.trust, "untrusted-user-authored");
  assert.equal(component.annotation?.previewCharacters, 160);
  assert.equal(component.annotation?.previewTruncated, true);
  assert.equal(component.annotation?.contentIncluded, false);
  assert.equal(JSON.stringify(analysis).includes("SECRET_TAIL"), false);
  assert.equal(analysis.summary.annotationComponentCount, 1);
});

test("DIP switch state and terminal pair order are decoded without merging nets", () => {
  const base = serializeCru({ name: "DIP Test", components: [] });
  const parentGuid = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";
  const tiePoints = Array.from(
    { length: 8 },
    (_, index) =>
      `<TiePointID><id>${index}</id><parentIdentifier>${parentGuid}</parentIdentifier></TiePointID>`,
  ).join("");
  const componentXml = `<components>
    <SaveComponent>
      <toolID>13</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">72d417b6-62d0-4a7a-b202-d4467ab10d69</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID">${tiePoints}</anyType>
        <anyType xsi:type="ArrayOfBoolean"><boolean>true</boolean><boolean>false</boolean><boolean>true</boolean><boolean>false</boolean></anyType>
      </data>
    </SaveComponent>
  </components>`;
  const analysis = analyzeCru(base.replace("<components />", componentXml));
  const component = analysis.components[0]!;

  assert.equal(component.kind, "dip-switch-4");
  assert.deepEqual(component.parameters.positions?.value, [
    true,
    false,
    true,
    false,
  ]);
  assert.deepEqual(
    component.terminals.map((terminal) => terminal.name),
    [
      "switch-1-a",
      "switch-2-a",
      "switch-3-a",
      "switch-4-a",
      "switch-4-b",
      "switch-3-b",
      "switch-2-b",
      "switch-1-b",
    ],
  );
  assert.equal(analysis.connectivity.groupCount, 8);
});

test("embedded firmware source is redacted unless explicitly requested", () => {
  const base = serializeCru({ name: "Source Test", components: [] });
  const source = "void setup() {}\n// SECRET_SENTINEL";
  const componentXml = `<components>
    <SaveComponent>
      <toolID>20</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">72d417b6-62d0-4a7a-b202-d4467ab10d69</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID" />
        <anyType xsi:type="xsd:string">${source}</anyType>
        <anyType xsi:type="xsd:string"></anyType>
      </data>
    </SaveComponent>
  </components>`;
  const xml = base.replace("<components />", componentXml);

  const redacted = analyzeCru(xml);
  assert.equal(JSON.stringify(redacted).includes("SECRET_SENTINEL"), false);
  assert.equal(redacted.components[0]?.sourceCode?.included, false);
  assert.equal(redacted.components[0]?.sourceCode?.lines, 2);

  const included = analyzeCru(xml, { includeSourceCode: true });
  assert.equal(included.components[0]?.sourceCode?.content, source);
});

test("design names are returned only as bounded untrusted metadata", () => {
  const name = `${"N".repeat(1_000)}PRIVATE_NAME_TAIL`;
  const xml = generateFixture("empty", name);
  const analysis = analyzeCru(xml);
  const inspection = inspectCru(xml);

  assert.equal(analysis.designName, "N".repeat(160));
  assert.equal(analysis.designNameInfo.characters, name.length);
  assert.equal(analysis.designNameInfo.previewCharacters, 160);
  assert.equal(analysis.designNameInfo.previewTruncated, true);
  assert.equal(analysis.designNameInfo.fullContentIncluded, false);
  assert.equal(inspection.name, analysis.designName);
  assert.deepEqual(inspection.nameInfo, analysis.designNameInfo);
  assert.equal(JSON.stringify(analysis).includes("PRIVATE_NAME_TAIL"), false);
  assert.equal(JSON.stringify(inspection).includes("PRIVATE_NAME_TAIL"), false);
  assert.ok(
    analysis.diagnostics.some(
      (diagnostic) => diagnostic.code === "design-name-truncated",
    ),
  );
});

test("component details and connection memberships cannot bypass page bounds", () => {
  const boardGuid = "05fc035f-92bb-4a1f-bf81-1ab25a51bb3a";
  const resistorGuid = "35f92d9a-cda9-44c7-b416-8c77f301248e";
  const dipGuid = "1f116ff1-e792-474d-b524-82b3b9530eb7";
  const base = serializeCru({
    name: "Nested Bounds Test",
    components: [
      {
        toolId: 0,
        guid: boardGuid,
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
      },
    ],
  });
  const geometry = Array.from(
    { length: 150 },
    (_, index) =>
      `<Vector3S><x>${index}</x><y>0</y><z>0</z></Vector3S>`,
  ).join("");
  const tiePoints = Array.from(
    { length: 150 },
    () =>
      `<TiePointID><id>0</id><parentIdentifier>${boardGuid}</parentIdentifier></TiePointID>`,
  ).join("");
  const switchPositions = Array.from(
    { length: 150 },
    (_, index) => `<boolean>${index % 2 === 0}</boolean>`,
  ).join("");
  const extraComponents = `
    <SaveComponent>
      <toolID>3</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${resistorGuid}</anyType>
        <anyType xsi:type="ArrayOfVector3S">${geometry}</anyType>
        <anyType xsi:type="ArrayOfTiePointID">${tiePoints}</anyType>
        <anyType xsi:type="xsd:float">1000</anyType>
        <anyType xsi:type="xsd:float">0.25</anyType>
      </data>
    </SaveComponent>
    <SaveComponent>
      <toolID>13</toolID>
      <data>
        <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">${dipGuid}</anyType>
        <anyType xsi:type="Vector3S"><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="QuaternionS"><w>1</w><x>0</x><y>0</y><z>0</z></anyType>
        <anyType xsi:type="ArrayOfTiePointID" />
        <anyType xsi:type="ArrayOfBoolean">${switchPositions}</anyType>
      </data>
    </SaveComponent>`;
  const xml = base.replace(
    "  </components>",
    `${extraComponents}\n  </components>`,
  );
  const analysis = analyzeCru(xml, { includeGeometry: true });
  const resistor = analysis.components.find(
    (component) => component.id === resistorGuid,
  )!;
  const dipSwitch = analysis.components.find(
    (component) => component.id === dipGuid,
  )!;
  const group = analysis.connectivity.groups[0]!;

  assert.equal(resistor.geometry?.length, 64);
  assert.deepEqual(resistor.geometryBounds, {
    total: 150,
    returned: 64,
    limit: 64,
    truncated: true,
  });
  assert.equal(resistor.terminals.length, 64);
  assert.deepEqual(resistor.terminalBounds, {
    total: 150,
    returned: 64,
    limit: 64,
    truncated: true,
  });
  assert.equal(dipSwitch.parameters.positions?.value instanceof Array, true);
  assert.equal(
    (dipSwitch.parameters.positions?.value as boolean[]).length,
    64,
  );
  assert.deepEqual(dipSwitch.parameters.positions?.collectionBounds, {
    total: 150,
    returned: 64,
    limit: 64,
    truncated: true,
  });
  assert.equal(group.componentTerminals.length, 128);
  assert.deepEqual(group.membershipBounds.componentTerminals, {
    total: 150,
    returned: 128,
    limit: 128,
    truncated: true,
  });
  assert.equal(group.membershipBounds.nonWireComponentTerminals, 150);
  assert.equal(analysis.connectivity.isolatedAttachmentGroupCount, 0);
  assert.ok(
    analysis.diagnostics.some(
      (diagnostic) => diagnostic.code === "component-details-truncated",
    ),
  );
  assert.ok(
    analysis.diagnostics.some(
      (diagnostic) => diagnostic.code === "connection-membership-truncated",
    ),
  );
});

test("DOCTYPE and entity declarations are rejected before XML parsing", () => {
  assert.throws(
    () =>
      analyzeCru(
        '<!DOCTYPE SaveData [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><SaveData />',
      ),
    /DOCTYPE and ENTITY/,
  );
});
