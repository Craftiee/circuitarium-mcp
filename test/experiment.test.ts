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

test("one pin on two different nets is a contradiction", () => {
  const input = structuredClone(validExperiment);
  input.nets.push({
    id: "conflicting-net",
    endpoints: [
      { componentId: "clock", pin: "out" },
      { componentId: "counter", pin: "reset" },
    ],
  });
  const result = validateExperiment(input);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "endpoint-net-conflict",
    ),
  );
});

test("a duplicate endpoint on the same net stays a warning, not a conflict", () => {
  const input = structuredClone(validExperiment);
  input.nets[0]!.endpoints.push({ componentId: "clock", pin: "out" });
  const result = validateExperiment(input);
  assert.equal(result.valid, true);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === "duplicate-endpoint"),
  );
  assert.ok(
    result.diagnostics.every(
      (diagnostic) => diagnostic.code !== "endpoint-net-conflict",
    ),
  );
});

test("probes on endpoints missing from every net warn as unconnected", () => {
  const input = structuredClone(validExperiment);
  input.probes.push({
    id: "floating-probe",
    endpoint: { componentId: "counter", pin: "carry-out" },
    quantity: "logic",
  });
  const result = validateExperiment(input);
  assert.equal(result.valid, true);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "probe-endpoint-unconnected",
    ),
  );
});

test("duplicate ids are rejected for every collection", () => {
  for (const collection of ["components", "nets", "probes", "assertions"] as const) {
    const input = structuredClone(validExperiment) as Record<string, any>;
    if (collection === "assertions") {
      input.assertions = [
        { id: "a1", expression: "true" },
        { id: "a1", expression: "true" },
      ];
    } else {
      input[collection] = [...input[collection], structuredClone(input[collection][0])];
    }
    const result = validateExperiment(input);
    assert.equal(result.valid, false, collection);
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.code === "duplicate-id"),
      collection,
    );
  }
});

test("firmware and probe targets must reference declared components", () => {
  const firmwareInput = structuredClone(validExperiment) as Record<string, any>;
  firmwareInput.firmware = [
    { componentId: "missing-mcu", language: "c", source: "int main() {}" },
  ];
  const firmwareResult = validateExperiment(firmwareInput);
  assert.equal(firmwareResult.valid, false);
  assert.ok(
    firmwareResult.diagnostics.some(
      (diagnostic) => diagnostic.code === "unknown-firmware-target",
    ),
  );

  const probeInput = structuredClone(validExperiment);
  probeInput.probes[0]!.endpoint.componentId = "missing-probe-target";
  const probeResult = validateExperiment(probeInput);
  assert.equal(probeResult.valid, false);
  assert.ok(
    probeResult.diagnostics.some(
      (diagnostic) => diagnostic.code === "unknown-probe-target",
    ),
  );
});

test("wallClockRatio pairs only with fixed-ratio pacing", () => {
  const missingRatio = structuredClone(validExperiment) as Record<string, any>;
  missingRatio.execution.pacing = "fixed-ratio";
  const missingResult = validateExperiment(missingRatio);
  assert.equal(missingResult.valid, false);
  assert.ok(
    missingResult.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("fixed-ratio pacing requires wallClockRatio"),
    ),
  );

  const strayRatio = structuredClone(validExperiment) as Record<string, any>;
  strayRatio.execution.wallClockRatio = 2;
  const strayResult = validateExperiment(strayRatio);
  assert.equal(strayResult.valid, false);
  assert.ok(
    strayResult.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("only meaningful with fixed-ratio pacing"),
    ),
  );
});
