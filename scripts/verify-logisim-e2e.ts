import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  probeLogisimRuntime,
  runLogisimStatistics,
  runLogisimTestVector,
  runLogisimTruthTable,
} from "../src/adapters/logisim/runtime.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const projectPath = resolve(
  repositoryRoot,
  "examples",
  "logisim",
  "full-adder.circ",
);
const vectorPath = resolve(
  repositoryRoot,
  "examples",
  "logisim",
  "full-adder.vec",
);

const probe = await probeLogisimRuntime({
  currentWorkingDirectory: repositoryRoot,
});
assert.equal(
  probe.logisimVersion,
  "4.1.0",
  "the version-pinned end-to-end check requires Logisim-evolution 4.1.0",
);

const statistics = await runLogisimStatistics(projectPath, {
  currentWorkingDirectory: repositoryRoot,
  toplevelCircuit: "Main",
});
assert.deepEqual(statistics.totalWithoutSubcircuits, {
  uniqueCount: 26,
  recursiveCount: 26,
});
assert.deepEqual(statistics.totalWithSubcircuits, {
  uniqueCount: 26,
  recursiveCount: 26,
});

const truthTable = await runLogisimTruthTable(projectPath, {
  currentWorkingDirectory: repositoryRoot,
  toplevelCircuit: "Main",
  maxRows: 8,
});
assert.deepEqual(truthTable.columns, ["A", "B", "Cin", "Sum", "Cout"]);
assert.deepEqual(
  truthTable.rows.map((row) => row.values),
  [
    ["0", "0", "0", "0", "0"],
    ["0", "0", "1", "1", "0"],
    ["0", "1", "0", "1", "0"],
    ["0", "1", "1", "0", "1"],
    ["1", "0", "0", "1", "0"],
    ["1", "0", "1", "0", "1"],
    ["1", "1", "0", "0", "1"],
    ["1", "1", "1", "1", "1"],
  ],
);

const vectors = await runLogisimTestVector(
  projectPath,
  "Main",
  vectorPath,
  { currentWorkingDirectory: repositoryRoot },
);
assert.equal(vectors.passed, true);
assert.equal(vectors.passedVectors, 8);
assert.equal(vectors.failedVectors, 0);

const { callToolLocally } = await import("../src/server.js");
const capabilities = await callToolLocally("electronics_capabilities", {});
assert.equal(capabilities.isError, false);
assert.equal(capabilities.envelope.ok, true);
const logisimCapability = (
  capabilities.envelope.data as {
    callableBackends?: Array<{
      backendId: string;
      runtime?: {
        status: string;
        detected?: { simulatorVersion: string };
      };
    }>;
  }
).callableBackends?.find(
  (backend) => backend.backendId === "logisim.evolution",
);
assert.equal(logisimCapability?.runtime?.status, "available");
assert.equal(
  logisimCapability?.runtime?.detected?.simulatorVersion,
  "4.1.0",
);

const toolCalls = [
  [
    "logisim_list_projects",
    { dir: "examples/logisim" },
  ],
  [
    "logisim_analyze_design",
    { path: "examples/logisim/full-adder.circ" },
  ],
  [
    "logisim_export_netlist",
    { path: "examples/logisim/full-adder.circ" },
  ],
  [
    "logisim_component_stats",
    { path: "examples/logisim/full-adder.circ" },
  ],
  [
    "logisim_truth_table",
    { path: "examples/logisim/full-adder.circ" },
  ],
  [
    "logisim_run_test_vector",
    {
      path: "examples/logisim/full-adder.circ",
      vectorPath: "examples/logisim/full-adder.vec",
    },
  ],
] as const;
for (const [tool, arguments_] of toolCalls) {
  const result = await callToolLocally(tool, arguments_);
  assert.equal(result.isError, false, `${tool} returned an MCP tool error`);
  assert.equal(result.envelope.ok, true, `${tool} returned ok=false`);
  assert.equal(
    (result.envelope.context as { backendId?: string }).backendId,
    "logisim.evolution",
  );
}

process.stdout.write(
  `Verified Logisim-evolution ${probe.logisimVersion}: six MCP tools, project load, 8-row truth table, and 8/8 vectors passed.\n`,
);
