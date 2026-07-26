import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CRUMB_FIXTURE_KINDS, generateFixture } from "../src/adapters/crumb/fixtures.js";
import {
  CruRoundTripEncodingError,
  CruRoundTripIndexError,
  CruRoundTripPatchError,
  CruUnsupportedEditError,
  decodeCruRoundTrip,
  moveCruComponent as moveCruComponentWithGuard,
  removeCruComponent as removeCruComponentWithGuard,
  renameCruDesign as renameCruDesignWithGuard,
  serializeCruRoundTrip,
  setCruScalar as setCruScalarWithGuard,
  type CruRoundTripDocument,
} from "../src/adapters/crumb/roundtrip.js";

const fixtureBytes = (kind: (typeof CRUMB_FIXTURE_KINDS)[number]): Buffer =>
  readFileSync(new URL(`../fixtures/crumb/${kind}.cru`, import.meta.url));

const guardFor = (document: CruRoundTripDocument) => ({
  expectedSha256: document.sourceSha256,
});

const renameCruDesign = (document: CruRoundTripDocument, name: string) =>
  renameCruDesignWithGuard(document, name, guardFor(document));

const setCruScalar = (
  document: CruRoundTripDocument,
  componentIndex: number,
  valueIndex: number,
  value: string | number | boolean,
) =>
  setCruScalarWithGuard(
    document,
    componentIndex,
    valueIndex,
    value,
    guardFor(document),
  );

const moveCruComponent = (
  document: CruRoundTripDocument,
  componentIndex: number,
  next: Parameters<typeof moveCruComponentWithGuard>[2],
) =>
  moveCruComponentWithGuard(
    document,
    componentIndex,
    next,
    guardFor(document),
  );

const removeCruComponent = (
  document: CruRoundTripDocument,
  componentIndex: number,
) =>
  removeCruComponentWithGuard(
    document,
    componentIndex,
    guardFor(document),
  );

function withUnknownPayload(xml: string): string {
  return xml.replace(
    "      </data>",
    [
      '        <anyType custom:flag="keep &amp; preserve" xmlns:custom="urn:test" xsi:type="custom:ArduinoPayload">',
      "          <!-- source mentions <!ENTITY fake> but is not a declaration -->",
      '          <custom:Source language="c++"><![CDATA[const html = "<!DOCTYPE html>"; if (a < b) { Serial.println("x"); }]]></custom:Source>',
      "          <custom:Metadata><custom:Value> A &amp; B </custom:Value></custom:Metadata>",
      "        </anyType>",
      "      </data>",
    ].join("\n"),
  );
}

test("every checked-in fixture round-trips byte-identically", () => {
  for (const kind of CRUMB_FIXTURE_KINDS) {
    const source = fixtureBytes(kind);
    const document = decodeCruRoundTrip(source);
    assert.deepEqual(serializeCruRoundTrip(document), source, kind);
    assert.equal(document.syntax.components.length, document.decoded.components.length);
    for (const component of document.syntax.components) {
      assert.equal(
        component.values.length,
        document.decoded.components[component.index]?.values.length,
      );
    }
    assert.equal(Object.isFrozen(document), true);
    assert.equal(Object.isFrozen(document.syntax.components), true);
    assert.equal(Object.isFrozen(document.decoded.components), true);
  }
});

test("unknown nested payload survives an unrelated rename byte-for-byte", () => {
  const markerStart = '<anyType custom:flag="keep &amp; preserve"';
  const markerEnd = "</anyType>";
  const source = Buffer.from(withUnknownPayload(generateFixture("breadboard")), "utf8");
  const document = decodeCruRoundTrip(source);
  const beforeText = source.toString("utf8");
  const start = beforeText.indexOf(markerStart);
  const end = beforeText.indexOf(markerEnd, start) + markerEnd.length;
  const unknownBytes = source.subarray(start, end);

  const renamed = renameCruDesign(document, "Renamed & safe");
  const output = serializeCruRoundTrip(renamed);
  assert.match(output.toString("utf8"), /<name>Renamed &amp; safe<\/name>/);
  assert.notEqual(renamed.sourceSha256, document.sourceSha256);
  assert.equal(output.includes(unknownBytes), true);
  assert.equal(document.syntax.components[0]?.values.at(-1)?.opaque, true);
});

test("BOM, CRLF, attribute quoting, lexical forms, and Unicode retain exact bytes", () => {
  const xml = generateFixture("breadboard-resistor")
    .replaceAll("\n", "\r\n")
    .replace('xsi:type="Vector3S"', "xsi:type='Vector3S'")
    .replace(">1000</anyType>", ">  1E+03  </anyType>")
    .replace("<name>Breadboard + Resistor</name>", "<name>🧪 Breadboard</name>");
  const source = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(xml, "utf8"),
  ]);
  assert.deepEqual(
    serializeCruRoundTrip(decodeCruRoundTrip(source)),
    source,
  );

  const renamed = renameCruDesign(decodeCruRoundTrip(source), "🧪 Updated");
  const output = serializeCruRoundTrip(renamed).toString("utf8");
  assert.match(output, /\r\n/);
  assert.match(output, /xsi:type='Vector3S'/);
  assert.match(output, />  1E\+03  <\/anyType>/);
  assert.match(output, /<name>🧪 Updated<\/name>/);
});

test("same-semantic scalar assignment is an exact no-op", () => {
  const source = Buffer.from(
    generateFixture("breadboard-resistor").replace(
      ">1000</anyType>",
      ">  1E+03  </anyType>",
    ),
    "utf8",
  );
  const document = decodeCruRoundTrip(source);
  const unchanged = setCruScalar(document, 1, 3, 1000);
  assert.equal(unchanged, document);
  assert.deepEqual(serializeCruRoundTrip(unchanged), source);
});

test("changed scalar replaces only its content and uses canonical spelling", () => {
  const source = fixtureBytes("breadboard-resistor");
  const document = decodeCruRoundTrip(source);
  const span = document.syntax.components[1]?.values[3]?.content;
  assert.ok(span);
  const changed = setCruScalar(document, 1, 3, 0.000001);
  const output = serializeCruRoundTrip(changed);

  assert.deepEqual(output.subarray(0, span.start), source.subarray(0, span.start));
  assert.deepEqual(
    output.subarray(span.start, span.start + "0.000001".length),
    Buffer.from("0.000001"),
  );
  assert.deepEqual(
    output.subarray(span.start + "0.000001".length),
    source.subarray(span.end),
  );
});

test("duplicate scalar text edits the indexed occurrence only", () => {
  const source = Buffer.from(
    generateFixture("breadboard-resistor").replace(
      ">0.25</anyType>",
      ">1000</anyType>",
    ),
    "utf8",
  );
  const changed = setCruScalar(decodeCruRoundTrip(source), 1, 4, 2);
  const text = serializeCruRoundTrip(changed).toString("utf8");
  assert.equal((text.match(/>1000<\/anyType>/g) ?? []).length, 1);
  assert.equal((text.match(/>2<\/anyType>/g) ?? []).length, 1);
});

test("unknown scalar mutation is refused instead of rebuilding its payload", () => {
  const document = decodeCruRoundTrip(
    Buffer.from(withUnknownPayload(generateFixture("breadboard")), "utf8"),
  );
  assert.throws(
    () => setCruScalar(document, 0, 3, "replacement"),
    CruUnsupportedEditError,
  );
});

test("structured known scalars are refused instead of losing syntax", () => {
  const fixture = generateFixture("breadboard-resistor");
  const replacements = [
    '<anyType xsi:type="xsd:string" />',
    '<anyType xsi:type="xsd:string"><custom:Payload xmlns:custom="urn:test">keep</custom:Payload></anyType>',
    '<anyType xsi:type="xsd:string">old<!--SECRET--></anyType>',
    '<anyType xsi:type="xsd:string"><![CDATA[old]]></anyType>',
    '<anyType xsi:type="xsd:string">old<?custom keep?></anyType>',
  ];
  for (const replacement of replacements) {
    const source = Buffer.from(
      fixture.replace(
        '<anyType xsi:type="xsd:float">1000</anyType>',
        replacement,
      ),
      "utf8",
    );
    assert.throws(
      () => setCruScalar(decodeCruRoundTrip(source), 1, 3, "replacement"),
      CruUnsupportedEditError,
      replacement,
    );
  }
});

test("structured save names and coordinates are refused instead of losing syntax", () => {
  const fixture = generateFixture("breadboard");
  const structuredName = Buffer.from(
    fixture.replace(
      "<name>MCP Breadboard Fixture</name>",
      "<name>MCP<!--SECRET--> Breadboard Fixture</name>",
    ),
    "utf8",
  );
  assert.throws(
    () => renameCruDesign(decodeCruRoundTrip(structuredName), "Replacement"),
    CruUnsupportedEditError,
  );

  const structuredCoordinate = Buffer.from(
    fixture.replace("<x>0</x>", "<x>0<!--SECRET--></x>"),
    "utf8",
  );
  assert.throws(
    () =>
      moveCruComponent(decodeCruRoundTrip(structuredCoordinate), 0, {
        position: { x: 1, y: 0, z: 0 },
      }),
    CruUnsupportedEditError,
  );
});

test("prototype-named unknown children remain opaque and byte-identical", () => {
  const source = Buffer.from(
    generateFixture("breadboard").replace(
      "      </data>",
      [
        '        <anyType xmlns:custom="urn:test" xsi:type="custom:PrototypeNames">',
        "          <toString>keep</toString>",
        "          <hasOwnProperty>keep</hasOwnProperty>",
        "        </anyType>",
        "      </data>",
      ].join("\n"),
    ),
    "utf8",
  );
  const document = decodeCruRoundTrip(source);
  assert.deepEqual(serializeCruRoundTrip(document), source);
  assert.equal(document.syntax.components[0]?.values.at(-1)?.opaque, true);
});

test("reserved prototype-pollution element names fail closed", () => {
  for (const name of ["constructor", "prototype", "__proto__"]) {
    const source = Buffer.from(
      generateFixture("breadboard").replace(
        "      </data>",
        `        <anyType xmlns:custom="urn:test" xsi:type="custom:Reserved"><${name}>keep</${name}></anyType>\n      </data>`,
      ),
      "utf8",
    );
    assert.throws(() => decodeCruRoundTrip(source), name);
  }
});

test("edits reject values outside finite 32-bit float range", () => {
  const resistor = decodeCruRoundTrip(fixtureBytes("breadboard-resistor"));
  assert.throws(
    () => setCruScalar(resistor, 1, 3, 1e100),
    CruUnsupportedEditError,
  );
  const breadboard = decodeCruRoundTrip(fixtureBytes("breadboard"));
  assert.throws(
    () =>
      moveCruComponent(breadboard, 0, {
        position: { x: 1e100, y: 0, z: 0 },
      }),
    CruUnsupportedEditError,
  );
});

test("string and save-name whitespace remains semantic rather than becoming a no-op", () => {
  const scalarSource = Buffer.from(
    generateFixture("breadboard").replace(
      "      </data>",
      '        <anyType xsi:type="xsd:string">  padded  </anyType>\n      </data>',
    ),
    "utf8",
  );
  const scalarDocument = decodeCruRoundTrip(scalarSource);
  assert.equal(
    scalarDocument.decoded.components[0]?.values[3]?.kind === "string"
      ? scalarDocument.decoded.components[0]?.values[3]?.value
      : undefined,
    "  padded  ",
  );
  const scalarChanged = setCruScalar(scalarDocument, 0, 3, "padded");
  assert.match(
    serializeCruRoundTrip(scalarChanged).toString("utf8"),
    /<anyType xsi:type="xsd:string">padded<\/anyType>/,
  );

  const nameSource = Buffer.from(
    generateFixture("empty").replace(
      "<name>MCP Empty Fixture</name>",
      "<name>  padded  </name>",
    ),
    "utf8",
  );
  const nameDocument = decodeCruRoundTrip(nameSource);
  assert.equal(nameDocument.decoded.name, "  padded  ");
  const nameChanged = renameCruDesign(nameDocument, "padded");
  assert.match(
    serializeCruRoundTrip(nameChanged).toString("utf8"),
    /<name>padded<\/name>/,
  );
});

test("movement refuses ambiguous or signature-mismatched spatial layouts", () => {
  const source = Buffer.from(
    generateFixture("breadboard").replace(
      '        <anyType xsi:type="Vector3S">',
      [
        '        <anyType xsi:type="Vector3S">',
        "          <x>9</x>",
        "          <y>9</y>",
        "          <z>9</z>",
        "        </anyType>",
        '        <anyType xsi:type="Vector3S">',
      ].join("\n"),
    ),
    "utf8",
  );
  assert.throws(
    () =>
      moveCruComponent(decodeCruRoundTrip(source), 0, {
        position: { x: 1, y: 2, z: 3 },
      }),
    CruUnsupportedEditError,
  );
});

test("moving a Unicode-prefixed component patches only spatial scalars", () => {
  const source = Buffer.from(
    generateFixture("breadboard").replace(
      "<name>MCP Breadboard Fixture</name>",
      "<name>🔌🔬 Breadboard</name>",
    ),
    "utf8",
  );
  const moved = moveCruComponent(decodeCruRoundTrip(source), 0, {
    position: { x: 12.5, y: -3, z: 4 },
    rotation: { w: 1, x: 0, y: 0.5, z: 0 },
  });
  const output = serializeCruRoundTrip(moved).toString("utf8");
  assert.match(output, /<name>🔌🔬 Breadboard<\/name>/);
  assert.match(output, /<x>12.5<\/x>\s+<y>-3<\/y>\s+<z>4<\/z>/);
  assert.match(output, /<w>1<\/w>\s+<x>0<\/x>\s+<y>0.5<\/y>\s+<z>0<\/z>/);
});

test("component removal preserves neighboring bytes and reindexes", () => {
  const document = decodeCruRoundTrip(fixtureBytes("breadboard-resistor"));
  const boardGuid = document.decoded.components[0]?.guid;
  const removedGuid = document.decoded.components[1]?.guid;
  const removed = removeCruComponent(document, 1);
  const output = serializeCruRoundTrip(removed).toString("utf8");
  assert.equal(removed.syntax.components.length, 1);
  assert.equal(output.includes(boardGuid ?? "missing"), true);
  assert.equal(output.includes(removedGuid ?? "missing"), false);
});

test("component removal refuses possible opaque GUID references", () => {
  const fixture = generateFixture("breadboard-resistor");
  const baseline = decodeCruRoundTrip(Buffer.from(fixture, "utf8"));
  const targetGuid = baseline.decoded.components[1]?.guid;
  assert.ok(targetGuid);
  const source = Buffer.from(
    fixture.replace(
      "      </data>",
      [
        '        <anyType xmlns:custom="urn:test" xsi:type="custom:Link">',
        `          <custom:TargetGuid>${targetGuid}</custom:TargetGuid>`,
        "        </anyType>",
        "      </data>",
      ].join("\n"),
    ),
    "utf8",
  );
  const document = decodeCruRoundTrip(source);
  assert.throws(
    () => removeCruComponent(document, 1),
    CruUnsupportedEditError,
  );
  assert.deepEqual(serializeCruRoundTrip(document), source);
});

test("serialized bytes are defensive and fabricated documents are rejected", () => {
  const document = decodeCruRoundTrip(fixtureBytes("empty"));
  const forged = { ...document };
  const before = serializeCruRoundTrip(document);
  const copy = serializeCruRoundTrip(document);
  copy[0] = copy[0] === 0 ? 1 : 0;
  assert.deepEqual(serializeCruRoundTrip(document), before);
  assert.throws(
    () => serializeCruRoundTrip(forged),
    CruRoundTripPatchError,
  );
  assert.throws(
    () =>
      renameCruDesignWithGuard(
        forged,
        forged.decoded.name,
        guardFor(forged),
      ),
    CruRoundTripPatchError,
  );
  const scalarDocument = decodeCruRoundTrip(
    fixtureBytes("breadboard-resistor"),
  );
  const forgedScalar = { ...scalarDocument };
  assert.throws(
    () =>
      setCruScalarWithGuard(
        forgedScalar,
        1,
        3,
        1000,
        guardFor(forgedScalar),
      ),
    CruRoundTripPatchError,
  );
  assert.throws(
    () =>
      renameCruDesignWithGuard(document, document.decoded.name, {
        expectedSha256: "sha256:stale",
      }),
    CruRoundTripPatchError,
  );
});

test("malformed XML, DTDs, invalid UTF-8, and non-UTF-8 declarations are rejected", () => {
  assert.throws(
    () => decodeCruRoundTrip(Buffer.from("<SaveData><name>x</SaveData>")),
  );
  assert.throws(
    () =>
      decodeCruRoundTrip(
        Buffer.from(
          '<?xml version="1.0"?><!DOCTYPE SaveData [<!ENTITY x "y">]><SaveData />',
        ),
      ),
  );
  assert.throws(
    () => decodeCruRoundTrip(Buffer.from([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e])),
    CruRoundTripEncodingError,
  );
  assert.throws(
    () =>
      decodeCruRoundTrip(
        Buffer.from(
          generateFixture("empty").replace('version="1.0"', 'version="1.1"'),
        ),
      ),
    /XML 1\.0/i,
  );
  assert.throws(
    () =>
      decodeCruRoundTrip(
        Buffer.from(
          generateFixture("empty").replace(
            'encoding="utf-8"',
            'encoding="utf-16"',
          ),
        ),
      ),
    CruRoundTripEncodingError,
  );
  assert.throws(
    () =>
      decodeCruRoundTrip(
        Buffer.from(
          generateFixture("breadboard-resistor").replace(
            ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
            "",
          ),
        ),
      ),
    /namespace|unbound/i,
  );
  assert.throws(
    () =>
      decodeCruRoundTrip(
        Buffer.from(
          generateFixture("breadboard").replace(
            "  <components>",
            "  <components />\n  <components>",
          ),
        ),
      ),
    /duplicate|exactly one/i,
  );
});

test("round-trip indexing fails closed at the XML depth bound", () => {
  const nested = "<x>".repeat(65) + "</x>".repeat(65);
  assert.throws(
    () =>
      decodeCruRoundTrip(
        Buffer.from(
          generateFixture("breadboard").replace(
            "      </data>",
            `        <anyType xsi:type="custom:deep">${nested}</anyType>\n      </data>`,
          ),
        ),
      ),
    /nesting|level|depth/i,
  );
});

test("invalid post-edit structure produces no replacement document", () => {
  const fixture = generateFixture("breadboard-resistor");
  const baseline = decodeCruRoundTrip(Buffer.from(fixture, "utf8"));
  const boardGuid = baseline.decoded.components[0]?.guid;
  assert.ok(boardGuid);
  const encodedGuid =
    `<![CDATA[${boardGuid.slice(0, 1)}]]>` +
    `<![CDATA[${boardGuid.slice(1)}]]>`;
  const source = Buffer.from(
    fixture.replaceAll(
      `<parentIdentifier>${boardGuid}</parentIdentifier>`,
      `<parentIdentifier>${encodedGuid}</parentIdentifier>`,
    ),
    "utf8",
  );
  const document = decodeCruRoundTrip(source);
  assert.throws(
    () => removeCruComponent(document, 0),
    CruRoundTripPatchError,
  );
  assert.equal(document.decoded.components.length, 2);
});

test("initial round-trip decode rejects semantically invalid CRUMB saves", () => {
  const source = Buffer.from(
    generateFixture("empty").replace(
      "<name>MCP Empty Fixture</name>",
      "<name>   </name>",
    ),
    "utf8",
  );
  assert.throws(() => decodeCruRoundTrip(source), CruRoundTripIndexError);
});
