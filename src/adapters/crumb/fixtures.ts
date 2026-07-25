import type { CruDocument } from "./format.js";
import { serializeCru } from "./format.js";

export const CRUMB_FIXTURE_KINDS = [
  "empty",
  "breadboard",
  "breadboard-and-rail",
  "breadboard-resistor",
  "breadboard-led",
] as const;
export type CrumbFixtureKind = (typeof CRUMB_FIXTURE_KINDS)[number];

const IDENTITY_ROTATION = { w: 1, x: 0, y: 0, z: 0 } as const;

export const CRUMB_TOOL_IDS = {
  boardVariantA: 0,
  boardVariantB: 1,
  resistor: 3,
  led5mm: 6,
} as const;

const RESISTOR_GEOMETRY = [
  { x: 55.8799973, y: 2, z: -11.43 },
  { x: 55.8799973, y: 9.7, z: -11.43 },
  { x: 22.86, y: 9.7, z: -11.43 },
  { x: 22.86, y: 2, z: -11.43 },
] as const;

const LED_GEOMETRY = [
  { x: -7.62000275, y: 2, z: -11.43 },
  { x: -7.62000275, y: 9.7, z: -11.43 },
  { x: 2.540001, y: 9.7, z: -11.43 },
  { x: 2.540001, y: 2, z: -11.43 },
] as const;

export function fixtureDocument(kind: CrumbFixtureKind, name?: string): CruDocument {
  switch (kind) {
    case "empty":
      return {
        name: name ?? "MCP Empty Fixture",
        components: [],
      };
    case "breadboard":
      return {
        name: name ?? "MCP Breadboard Fixture",
        components: [
          {
            toolId: CRUMB_TOOL_IDS.boardVariantA,
            guid: "8b634796-a77b-4f6b-a276-53fccd69bc62",
            position: { x: 0, y: 0, z: 0 },
            rotation: IDENTITY_ROTATION,
          },
        ],
      };
    case "breadboard-and-rail":
      return {
        name: name ?? "MCP Breadboard and Power Rail Fixture",
        components: [
          {
            toolId: CRUMB_TOOL_IDS.boardVariantA,
            guid: "da67ded5-59dc-42ae-8ce8-1e9f93739844",
            position: { x: -12, y: 0, z: 0 },
            rotation: IDENTITY_ROTATION,
          },
          {
            toolId: CRUMB_TOOL_IDS.boardVariantB,
            guid: "37494364-d199-47f4-9712-9d205573cf74",
            position: { x: 12, y: 0, z: 0 },
            rotation: IDENTITY_ROTATION,
          },
        ],
      };
    case "breadboard-resistor": {
      const boardGuid = "510eff91-3435-42f7-a80d-af912a3e35be";
      return {
        name: name ?? "MCP Breadboard Resistor Fixture",
        components: [
          {
            toolId: CRUMB_TOOL_IDS.boardVariantA,
            guid: boardGuid,
            position: { x: 0, y: 0, z: 0 },
            rotation: IDENTITY_ROTATION,
          },
          {
            toolId: CRUMB_TOOL_IDS.resistor,
            guid: "a79c6c3e-b687-4c66-89ae-128a02df2de2",
            geometry: [...RESISTOR_GEOMETRY],
            tiePoints: [
              { id: 581, parentIdentifier: boardGuid },
              { id: 516, parentIdentifier: boardGuid },
            ],
            settings: [
              { type: "xsd:float", value: 1000 },
              { type: "xsd:float", value: 0.25 },
            ],
          },
        ],
      };
    }
    case "breadboard-led": {
      const boardGuid = "7f889f69-8140-493a-b1ef-6a519d869b1a";
      return {
        name: name ?? "MCP Breadboard LED Fixture",
        components: [
          {
            toolId: CRUMB_TOOL_IDS.boardVariantA,
            guid: boardGuid,
            position: { x: 0, y: 0, z: 0 },
            rotation: IDENTITY_ROTATION,
          },
          {
            toolId: CRUMB_TOOL_IDS.led5mm,
            guid: "3d43171c-bf55-44f9-9e95-dfa7cdd8ed38",
            geometry: [...LED_GEOMETRY],
            tiePoints: [
              { id: 456, parentIdentifier: boardGuid },
              { id: 476, parentIdentifier: boardGuid },
            ],
            settings: [
              { type: "xsd:double", value: 2.2 },
              { type: "xsd:int", value: 0 },
              { type: "xsd:double", value: 0.03 },
            ],
          },
        ],
      };
    }
  }
}

export function generateFixture(kind: CrumbFixtureKind, name?: string): string {
  return serializeCru(fixtureDocument(kind, name));
}
