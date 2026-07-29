# Logisim-evolution full-adder demo

`full-adder.circ` is an independently authored Logisim-evolution 4.1.0
project. `full-adder.vec` exercises all eight combinations of its three
one-bit inputs.

The example is intentionally small enough to inspect statically and to run
through Logisim-evolution's non-interactive truth-table and test-vector
interfaces.
Circuitarium MCP does not bundle Logisim-evolution; point it at an official
fat JAR with `CIRCUITARIUM_LOGISIM_JAR`.

The MCP server cannot read these files merely because they ship in the source
tree, npm package, or MCPB. Copy both files into the directory selected by
`CIRCUITARIUM_MCP_ROOT`, then call the tools with workspace-relative refs:

```text
path: full-adder.circ
vectorPath: full-adder.vec
circuit: Main
```

In a source checkout whose repository root is intentionally the configured
workspace, the existing `examples/logisim/...` refs already satisfy that rule.
For a narrower first-run setup containing both CRUMB and Logisim examples, use
the [starter workspace recipe](../starter-workspace/README.md).
