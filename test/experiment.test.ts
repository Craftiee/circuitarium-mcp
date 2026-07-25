import assert from "node:assert/strict";
import test from "node:test";

import { validateExperiment } from "../src/domain/experiment.js";

const validExperiment = {
  schemaVersion: "0.1",
  id: "counter-lab",
  title: "Four-bit counter",
  components: [
    { id: "clock", kind: "clock", parameters: { frequencyHz: 1 } },
    { id: "counter", kind: "counter-4bit", parameters: {} },
  ],
  nets: [
    {
      id: "clock-net",
      endpoints: [
        { componentId: "clock", pin: "out" },
        { componentId: "counter", pin: "clock" },
      ],
    },
  ],
  firmware: [],
  probes: [
    {
      id: "clock-probe",
      endpoint: { componentId: "clock", pin: "out" },
      quantity: "logic",
    },
  ],
  assertions: [],
  execution: {
    fidelity: "gate-event",
    pacing: "as-fast-as-possible",
    logicalClockHz: 1,
    deterministic: true,
  },
  metadata: {},
};

test("a connected neutral experiment validates", () => {
  const result = validateExperiment(validExperiment);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
});

test("unknown component references are rejected", () => {
  const input = structuredClone(validExperiment);
  input.nets[0]!.endpoints[1]!.componentId = "missing";
  const result = validateExperiment(input);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-component"));
});

test("logical fidelity warns when no logical clock is declared", () => {
  const input = structuredClone(validExperiment) as Record<string, any>;
  delete input.execution.logicalClockHz;
  const result = validateExperiment(input);
  assert.equal(result.valid, true);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "clock-unspecified"));
});
