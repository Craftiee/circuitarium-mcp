import assert from "node:assert/strict";
import test from "node:test";

import {
  CRUMB_COMPATIBILITY_PROFILE,
  CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR,
  CRUMB_ENGINE_FAMILY,
  CRUMB_ENGINE_VERSION,
  CRUMB_TESTED_GAME_VERSION,
  CRUMB_TESTED_STEAM_BUILD_ID,
} from "../src/adapters/crumb/compatibility.js";
import {
  CRUMB_1_3_5_IC_CATALOG,
  CRUMB_IC_CATALOG_TARGET,
  CRUMB_TOOL_5_EEPROM_SERIALIZED_PAYLOAD_SIGNATURE,
  CRUMB_TOOL_5_SERIALIZED_PAYLOAD_SIGNATURE,
  getCrumbIcByPrefabId,
  listCrumbIcs,
} from "../src/adapters/crumb/icCatalog.js";

test("CRUMB compatibility evidence has a distinct, machine-readable Unity profile", () => {
  assert.equal(CRUMB_COMPATIBILITY_PROFILE, "crumb.unity/1.3.5");
  assert.equal(CRUMB_TESTED_GAME_VERSION, "1.3.5");
  assert.equal(CRUMB_TESTED_STEAM_BUILD_ID, "17183476");
  assert.equal(CRUMB_ENGINE_FAMILY, "Unity");
  assert.equal(CRUMB_ENGINE_VERSION, "2022.1.16f1");
  assert.deepEqual(CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR, {
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
  });
});

test("CRUMB 1.3.5 IC catalog is version-pinned and covers prefab IDs 0 through 20", () => {
  assert.deepEqual(CRUMB_IC_CATALOG_TARGET, {
    gameVersion: "1.3.5",
    steamBuildId: "17183476",
    engineVersion: "Unity 2022.1.16f1",
    il2CppMetadataVersion: "29.1",
    toolId: 5,
  });

  const definitions = listCrumbIcs();
  assert.deepEqual(
    definitions.map((definition) => definition.prefabId),
    Array.from({ length: 21 }, (_, index) => index),
  );
  assert.equal(new Set(definitions.map((definition) => definition.prefabId)).size, 21);
  assert.equal(new Set(definitions.map((definition) => definition.label)).size, 21);
  assert.deepEqual(
    Object.keys(CRUMB_1_3_5_IC_CATALOG).map(Number),
    Array.from({ length: 21 }, (_, index) => index),
  );
});

test("every IC package has contiguous package pins and internally consistent coverage", () => {
  for (const definition of listCrumbIcs()) {
    assert.equal(definition.packageName, `DIP-${definition.packagePinCount}`);
    assert.equal(definition.pins.length, definition.packagePinCount);
    assert.deepEqual(
      definition.pins.map((pin) => pin.packagePin),
      Array.from({ length: definition.packagePinCount }, (_, index) => index + 1),
    );
    assert.equal(
      definition.pinNameCoverage.resolved,
      definition.pins.filter((pin) => pin.name !== null).length,
    );
    assert.equal(definition.pinNameCoverage.total, definition.packagePinCount);

    if (definition.pinNameCoverage.status === "complete") {
      assert.ok(definition.pins.every((pin) => pin.name !== null));
    } else if (definition.pinNameCoverage.status === "unresolved") {
      assert.ok(definition.pins.every((pin) => pin.name === null));
    } else {
      assert.ok(definition.pins.some((pin) => pin.name === null));
      assert.ok(definition.pins.some((pin) => pin.name !== null));
    }
  }
});

test("known IC pin names retain installed CRUMB ordering", () => {
  assert.deepEqual(
    getCrumbIcByPrefabId(0)?.pins.map((pin) => pin.name),
    ["GND", "TRIG", "Q", "|RST", "CV", "THR", "DIS", "Vcc"],
  );
  assert.deepEqual(
    getCrumbIcByPrefabId(1)?.pins.map((pin) => pin.name),
    [
      "1A",
      "1B",
      "1Y",
      "2A",
      "2B",
      "2Y",
      "GND",
      "3Y",
      "3A",
      "3B",
      "4Y",
      "4A",
      "4B",
      "Vcc",
    ],
  );
  assert.deepEqual(
    getCrumbIcByPrefabId(20)?.pins.map((pin) => pin.name),
    [
      "Qb",
      "Qc",
      "Qd",
      "Qe",
      "Qf",
      "Qg",
      "Qh",
      "GND",
      "Qh'",
      "|SRCLR",
      "SRCLK",
      "RCLK",
      "|OE",
      "SER",
      "Qa",
      "Vcc",
    ],
  );
});

test("ambiguous installed pin labels remain explicit rather than guessed", () => {
  const numericOnly = getCrumbIcByPrefabId(4)!;
  assert.equal(numericOnly.pinNameCoverage.status, "unresolved");
  assert.deepEqual(
    numericOnly.pins.map((pin) => pin.name),
    Array.from({ length: 16 }, () => null),
  );
  assert.deepEqual(
    numericOnly.pins.map((pin) => pin.sourceName),
    Array.from({ length: 16 }, (_, index) => String(index + 1)),
  );

  const lm741 = getCrumbIcByPrefabId(19)!;
  assert.equal(lm741.pinNameCoverage.status, "partial");
  assert.deepEqual(
    lm741.pins.map((pin) => pin.sourceName),
    ["V>null", "I-", "I", "V-", "V>null", "O", "V+", "NC"],
  );
  assert.deepEqual(
    lm741.pins.map((pin) => pin.name),
    [null, "I-", null, "V-", null, "O", "V+", "NC"],
  );
});

test("IC lookups and listings return deep copies", () => {
  const firstLookup = getCrumbIcByPrefabId(0)!;
  firstLookup.label = "mutated";
  firstLookup.pins[0]!.name = "mutated";
  firstLookup.pinNameCoverage.resolved = 0;

  const secondLookup = getCrumbIcByPrefabId(0)!;
  assert.equal(secondLookup.label, "LM555");
  assert.equal(secondLookup.pins[0]?.name, "GND");
  assert.equal(secondLookup.pinNameCoverage.resolved, 8);

  const firstList = listCrumbIcs();
  firstList[1]!.pins[0]!.sourceName = "mutated";
  assert.equal(listCrumbIcs()[1]?.pins[0]?.sourceName, "1A");
});

test("tool 5 payload signature includes the trailing prefabID discriminator", () => {
  assert.deepEqual(CRUMB_TOOL_5_SERIALIZED_PAYLOAD_SIGNATURE.fieldNames, [
    "identifier",
    "position",
    "rotation",
    "tiePointIDs",
    "prefabID",
  ]);
  assert.deepEqual(CRUMB_TOOL_5_SERIALIZED_PAYLOAD_SIGNATURE.dataTypes, [
    "guid",
    "Vector3S",
    "QuaternionS",
    "ArrayOfTiePointID",
    "xsd:int",
  ]);
  assert.equal(CRUMB_TOOL_5_SERIALIZED_PAYLOAD_SIGNATURE.prefabIdValueIndex, 4);
  assert.deepEqual(
    CRUMB_TOOL_5_EEPROM_SERIALIZED_PAYLOAD_SIGNATURE.dataTypes,
    [
      "guid",
      "Vector3S",
      "QuaternionS",
      "ArrayOfTiePointID",
      "xsd:base64Binary",
      "xsd:int",
    ],
  );
  assert.equal(
    CRUMB_TOOL_5_EEPROM_SERIALIZED_PAYLOAD_SIGNATURE.requiredPrefabId,
    13,
  );
  assert.equal(
    CRUMB_TOOL_5_EEPROM_SERIALIZED_PAYLOAD_SIGNATURE.expectedDecodedBytes,
    2048,
  );
  assert.equal(getCrumbIcByPrefabId(-1), undefined);
  assert.equal(getCrumbIcByPrefabId(21), undefined);
});
