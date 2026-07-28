import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  COMPONENT_PROFILE_VERSION,
  ComponentProfileSchema,
  LOGISIM_410_REVISION,
  LOGISIM_CURATED_COMPONENT_PROFILES,
  componentProfileSchemaResource,
  logisimStandardLibraryCatalogResource,
} from "../src/domain/componentProfiles.js";

interface CatalogComponent {
  componentId: string;
  knowledgeCoverage: "identity-only" | "semantic-profile";
  semanticProfileId?: string;
}

interface CatalogLibrary {
  libraryId: string;
  libraryDescriptor: string;
  identityCount: number;
  hidden: boolean;
  source: { url: string };
  components: CatalogComponent[];
}

interface Catalog {
  counts: {
    libraries: number;
    identities: number;
    semanticProfiles: number;
    identityOnly: number;
  };
  libraries: CatalogLibrary[];
  redistributionBoundary: string;
}

function catalog(): Catalog {
  return logisimStandardLibraryCatalogResource() as Catalog;
}

function profile(profileId: string) {
  const value = LOGISIM_CURATED_COMPONENT_PROFILES.find(
    (candidate) => candidate.profileId === profileId,
  );
  assert.ok(value, `missing profile ${profileId}`);
  return value;
}

test("neutral component profiles are strict, source-cited, and non-equivalent", () => {
  assert.equal(LOGISIM_CURATED_COMPONENT_PROFILES.length, 11);
  for (const profile of LOGISIM_CURATED_COMPONENT_PROFILES) {
    assert.equal(profile.profileVersion, COMPONENT_PROFILE_VERSION);
    assert.equal(ComponentProfileSchema.safeParse(profile).success, true);
    assert.equal(profile.semanticConcept?.equivalenceClaim, "none");
    assert.ok(profile.sources.length > 0);
    for (const source of profile.sources) {
      assert.equal(new URL(source.url).protocol, "https:");
      assert.match(source.url, new RegExp(LOGISIM_410_REVISION, "u"));
    }
    assert.ok(profile.verification.suitableEvidence.length > 0);
    assert.ok(profile.verification.insufficientEvidence.length > 0);
    assert.ok(profile.limitations.length > 0);
  }

  const pin = LOGISIM_CURATED_COMPONENT_PROFILES[0]!;
  assert.equal(
    ComponentProfileSchema.safeParse({ ...pin, unexpected: true }).success,
    false,
  );
  assert.equal(
    ComponentProfileSchema.safeParse({
      ...pin,
      profileId: "Invalid Profile ID",
    }).success,
    false,
  );
});

test("component profile schema rejects ambiguous widths and duplicate semantic keys", () => {
  const pin = profile("logisim.wiring/pin");
  const interfacePort = pin.portGroups[0]!;
  const dataWidth = pin.parameters[0]!;

  const rejectedProfiles = [
    {
      ...pin,
      portGroups: [
        { ...interfacePort, width: { kind: "fixed" } },
        ...pin.portGroups.slice(1),
      ],
    },
    {
      ...pin,
      portGroups: [
        {
          ...interfacePort,
          width: { kind: "fixed", bits: 1, parameter: "data-width" },
        },
        ...pin.portGroups.slice(1),
      ],
    },
    {
      ...pin,
      portGroups: [
        { ...interfacePort, width: { kind: "parameter" } },
        ...pin.portGroups.slice(1),
      ],
    },
    {
      ...pin,
      portGroups: [
        { ...interfacePort, width: { kind: "derived" } },
        ...pin.portGroups.slice(1),
      ],
    },
    {
      ...pin,
      portGroups: [
        {
          ...interfacePort,
          width: { kind: "parameter", parameter: "missing-width" },
        },
        ...pin.portGroups.slice(1),
      ],
    },
    {
      ...pin,
      portGroups: [
        {
          ...interfacePort,
          width: { kind: "parameter", parameter: "direction" },
        },
        ...pin.portGroups.slice(1),
      ],
    },
    { ...pin, portGroups: [...pin.portGroups, interfacePort] },
    { ...pin, parameters: [...pin.parameters, dataWidth] },
    {
      ...pin,
      adapterBindings: [...pin.adapterBindings, pin.adapterBindings[0]!],
    },
    { ...pin, sources: [...pin.sources, pin.sources[0]!] },
    {
      ...pin,
      parameters: [
        {
          ...dataWidth,
          affects: [...dataWidth.affects, dataWidth.affects[0]!],
        },
        ...pin.parameters.slice(1),
      ],
    },
    {
      ...pin,
      sources: [
        {
          ...pin.sources[0]!,
          supports: [...pin.sources[0]!.supports, pin.sources[0]!.supports[0]!],
        },
      ],
    },
  ];

  for (const rejected of rejectedProfiles) {
    assert.equal(ComponentProfileSchema.safeParse(rejected).success, false);
  }
});

test("curated profiles capture pinned Logisim 4.1.0 port and attribute semantics", () => {
  const pin = profile("logisim.wiring/pin");
  assert.deepEqual(
    pin.parameters.map((parameter) => parameter.id),
    ["data-width", "direction", "floating-input-behavior", "reset-value"],
  );

  const clock = profile("logisim.wiring/clock");
  assert.ok(
    clock.parameters.some((parameter) => parameter.id === "phase-offset"),
  );

  for (const profileId of ["logisim.gates/and", "logisim.gates/not"]) {
    const gate = profile(profileId);
    assert.ok(
      gate.parameters.some((parameter) => parameter.id === "output-value"),
    );
    assert.ok(
      gate.portGroups.every(
        (portGroup) => portGroup.activeLevel === "not-applicable",
      ),
    );
  }

  const multiplexer = profile("logisim.plexers/multiplexer");
  assert.equal(
    multiplexer.portGroups.find((portGroup) => portGroup.id === "enable")
      ?.activeLevel,
    "high",
  );
  assert.ok(
    multiplexer.parameters.some(
      (parameter) => parameter.id === "disabled-output",
    ),
  );

  const flipFlop = profile("logisim.memory/d-flip-flop");
  assert.deepEqual(
    flipFlop.portGroups.map((portGroup) => portGroup.id),
    ["data", "clock", "q", "q-complement", "async-reset", "async-set"],
  );
  assert.equal(
    flipFlop.portGroups.find((portGroup) => portGroup.id === "async-reset")
      ?.activeLevel,
    "high",
  );
  assert.equal(
    flipFlop.portGroups.find((portGroup) => portGroup.id === "clock")
      ?.activeLevel,
    "unknown",
  );
  assert.match(flipFlop.portGroups[4]!.notes.join(" "), /priority/u);
  assert.match(
    flipFlop.verification.suitableEvidence.join(" "),
    /changing D during an asserted high\/low level trigger/u,
  );

  const register = profile("logisim.memory/register");
  assert.deepEqual(
    register.portGroups.map((portGroup) => portGroup.id),
    ["data-input", "clock", "data-output", "enable", "async-reset"],
  );
  assert.match(
    register.portGroups.find((portGroup) => portGroup.id === "enable")!
      .notes[0]!,
    /1 or undefined enables/u,
  );
  assert.equal(
    register.portGroups.find((portGroup) => portGroup.id === "async-reset")
      ?.activeLevel,
    "high",
  );
  assert.equal(
    register.portGroups.find((portGroup) => portGroup.id === "clock")
      ?.activeLevel,
    "unknown",
  );
  assert.match(
    register.verification.suitableEvidence.join(" "),
    /data changes while a level remains active/u,
  );

  const led = profile("logisim.io/led");
  assert.match(
    led.verification.suitableEvidence.join(" "),
    /paired with the resolved Active On High instance attribute/u,
  );
});

test("Logisim 4.1.0 catalog has the exact official built-in identity inventory", () => {
  const value = catalog();
  assert.deepEqual(value.counts, {
    libraries: 14,
    identities: 169,
    semanticProfiles: 11,
    identityOnly: 158,
  });
  assert.deepEqual(
    Object.fromEntries(
      value.libraries.map((library) => [
        library.libraryId,
        library.identityCount,
      ]),
    ),
    {
      Base: 1,
      Gates: 13,
      Wiring: 14,
      Plexers: 5,
      Arithmetic: 13,
      FPArithmetic: 17,
      Memory: 11,
      "I/O": 15,
      TTL: 61,
      "HDL-IP": 2,
      TCL: 2,
      "BFH-Praktika": 2,
      "Input/Output-Extra": 5,
      Soc: 8,
    },
  );
  const identities = value.libraries.flatMap((library) =>
    library.components.map(
      (component) => `${library.libraryDescriptor}\0${component.componentId}`,
    ),
  );
  assert.equal(new Set(identities).size, identities.length);
  assert.ok(identities.includes("#Base\0Text"));
  assert.ok(identities.includes("#Gates\0AND Gate"));
  assert.ok(identities.includes("#TTL\u0000747266"));
  assert.equal(
    identities.some((identity) => identity.includes("ProgrammableGenerator")),
    false,
  );
  assert.equal(
    value.libraries.find((library) => library.libraryId === "Base")?.hidden,
    true,
  );
  assert.ok(
    value.libraries.every(
      (library) => library.libraryDescriptor === `#${library.libraryId}`,
    ),
  );

  // The canonical manifest is an ASCII escape-notation stream: each record is
  // "#library\\0component", records are sorted with ECMAScript's default
  // UTF-16 code-unit ordering, and adjacent records are separated by the two
  // characters "\\n" (there are no literal NUL/LF controls or trailing
  // separator). The UTF-8 stream is hashed with SHA-256.
  const canonicalInventory = identities
    .map((identity) => identity.replace("\0", String.raw`\0`))
    .toSorted()
    .join(String.raw`\n`);
  assert.equal(
    createHash("sha256").update(canonicalInventory, "utf8").digest("hex"),
    "cb980e942617e97597d0271de808feadece54b86ce54f3d9911dc1d7c0e3fb02",
  );
});

test("catalog citations are immutable and semantic links resolve", () => {
  const value = catalog();
  const profileIds = new Set(
    LOGISIM_CURATED_COMPONENT_PROFILES.map((profile) => profile.profileId),
  );
  const catalogProfileIds: string[] = [];
  for (const library of value.libraries) {
    assert.equal(new URL(library.source.url).hostname, "github.com");
    assert.match(library.source.url, new RegExp(LOGISIM_410_REVISION, "u"));
    assert.doesNotMatch(
      library.source.url,
      /\/(?:blob|tree)\/(?:main|master)\//u,
    );
    for (const component of library.components) {
      if (component.knowledgeCoverage === "semantic-profile") {
        assert.ok(component.semanticProfileId);
        assert.equal(profileIds.has(component.semanticProfileId), true);
        catalogProfileIds.push(component.semanticProfileId);
      } else {
        assert.equal(component.semanticProfileId, undefined);
      }
    }
  }
  assert.equal(new Set(catalogProfileIds).size, catalogProfileIds.length);
  assert.deepEqual(catalogProfileIds.toSorted(), [...profileIds].toSorted());
  assert.match(
    value.redistributionBoundary,
    /no Logisim-evolution source code/u,
  );
  assert.ok(JSON.stringify(value).length < 256_000);
});

test("component profile schema resource includes draft JSON Schema and examples", () => {
  const resource = componentProfileSchemaResource() as {
    jsonSchema: {
      $schema?: string;
      additionalProperties?: boolean;
    };
    semanticConstraints: Array<{ code: string; rule: string }>;
    validationBoundary: string;
    profileCount: number;
    profiles: unknown[];
    interpretationBoundary: string;
  };
  assert.match(resource.jsonSchema.$schema ?? "", /2020-12/u);
  assert.equal(resource.jsonSchema.additionalProperties, false);
  assert.equal(resource.profileCount, 11);
  assert.equal(resource.profiles.length, resource.profileCount);
  assert.deepEqual(
    resource.semanticConstraints.map((constraint) => constraint.code),
    [
      "unique-port-group-ids",
      "unique-parameter-ids",
      "unique-adapter-bindings",
      "unique-source-ids",
      "unique-parameter-effects",
      "unique-source-support-claims",
      "resolved-width-parameters",
    ],
  );
  assert.ok(
    resource.semanticConstraints.every(
      (constraint) => constraint.rule.length > 0,
    ),
  );
  assert.match(resource.validationBoundary, /structural contract/u);
  assert.match(
    resource.validationBoundary,
    /also enforce semanticConstraints/u,
  );
  assert.match(resource.interpretationBoundary, /does not replace/u);
});
