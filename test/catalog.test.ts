import assert from "node:assert/strict";
import test from "node:test";

import {
  getCrumbComponentDefinition,
  listCrumbComponentDefinitions,
} from "../src/adapters/crumb/catalog.js";

test("CRUMB catalog covers every component family observed in the example corpus", () => {
  const definitions = listCrumbComponentDefinitions();
  assert.deepEqual(
    definitions.map((definition) => definition.toolId),
    [...Array.from({ length: 16 }, (_, index) => index), 20, 24],
  );
  assert.equal(new Set(definitions.map((definition) => definition.toolId)).size, 18);

  const power = getCrumbComponentDefinition(7)!;
  assert.equal(power.label, "DC 12V Power Supply");
  assert.deepEqual(power.terminalNames, ["positive-output", "ground"]);
  assert.deepEqual(
    power.parameterFields.map((field) => [field.name, field.unit]),
    [
      ["on", undefined],
      ["dcVoltage", "volt"],
    ],
  );

  const display = getCrumbComponentDefinition(12)!;
  assert.deepEqual(display.terminalNames, [
    "segment-e",
    "segment-d",
    "common-1",
    "segment-c",
    "decimal-point",
    "segment-b",
    "segment-a",
    "common-2",
    "segment-f",
    "segment-g",
  ]);
  assert.deepEqual(
    display.parameterFields.map((field) => field.name),
    ["forwardVoltage", "maxCurrent", "commonAnode"],
  );

  const fourBit = getCrumbComponentDefinition(13)!;
  assert.deepEqual(fourBit.terminalNames, [
    "switch-1-a",
    "switch-2-a",
    "switch-3-a",
    "switch-4-a",
    "switch-4-b",
    "switch-3-b",
    "switch-2-b",
    "switch-1-b",
  ]);
});

test("component catalog lookups return independent deep copies", () => {
  const first = getCrumbComponentDefinition(5)!;
  first.label = "mutated";
  first.expectedDataTypes[0] = "mutated";
  first.alternateDataTypes![0]![0] = "mutated";
  first.parameterFields[0]!.name = "mutated";
  first.notes[0] = "mutated";

  const second = getCrumbComponentDefinition(5)!;
  assert.equal(second.label, "DIP integrated circuit");
  assert.equal(second.expectedDataTypes[0], "guid");
  assert.equal(second.alternateDataTypes?.[0]?.[0], "guid");
  assert.equal(second.parameterFields[0]?.name, "prefabId");
  assert.notEqual(second.notes[0], "mutated");
  assert.equal(getCrumbComponentDefinition(999), undefined);
});
