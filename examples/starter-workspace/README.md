# Starter circuit workspace

Use a dedicated workspace for the first Circuitarium session. It gives the MCP
host access to a few synthetic examples without exposing a home directory,
source tree, simulator installation, or unrelated circuit files.

The recipe uses existing independently authored project assets:

- the repository's `fixtures/crumb/breadboard-led.cru` fixture;
- [`full-adder.circ`](../logisim/full-adder.circ); and
- [`full-adder.vec`](../logisim/full-adder.vec).

The resulting directory is:

```text
circuitarium-workspace/
|-- crumb/
|   `-- breadboard-led.cru
`-- logisim/
    |-- full-adder.circ
    `-- full-adder.vec
```

## Build it from a source checkout

Run one of these from the repository root. The workspace is created beside the
checkout so `CIRCUITARIUM_MCP_ROOT` does not need to cover the repository.

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force '..\circuitarium-workspace\crumb', '..\circuitarium-workspace\logisim'
Copy-Item '.\fixtures\crumb\breadboard-led.cru' '..\circuitarium-workspace\crumb\'
Copy-Item '.\examples\logisim\full-adder.circ', '.\examples\logisim\full-adder.vec' '..\circuitarium-workspace\logisim\'
Resolve-Path '..\circuitarium-workspace'
```

### macOS or Linux

```bash
mkdir -p ../circuitarium-workspace/crumb ../circuitarium-workspace/logisim
cp fixtures/crumb/breadboard-led.cru ../circuitarium-workspace/crumb/
cp examples/logisim/full-adder.circ examples/logisim/full-adder.vec \
  ../circuitarium-workspace/logisim/
realpath ../circuitarium-workspace
```

Use the absolute path printed by the final command as
`CIRCUITARIUM_MCP_ROOT`. Keep the workspace separate after the first test:
add only files that the selected MCP host and model are allowed to inspect.

## Build it without cloning the repository

1. Create an empty `circuitarium-workspace` directory and configure it as
   `CIRCUITARIUM_MCP_ROOT`.
2. Connect Circuitarium and ask the model to call `crumb_generate_fixture`
   with fixture `breadboard-led` and output path
   `crumb/breadboard-led.cru`. The tool creates this fixed synthetic fixture
   and refuses to overwrite an existing file.
3. If you want the Logisim example, download the repository's
   [full-adder project](https://github.com/Craftiee/circuitarium-mcp/blob/v0.3.1/examples/logisim/full-adder.circ)
   and
   [test vector](https://github.com/Craftiee/circuitarium-mcp/blob/v0.3.1/examples/logisim/full-adder.vec),
   then save them under the workspace's `logisim` directory.

The npm package and MCPB include documentation and the Logisim examples, but
Circuitarium does not automatically copy examples into the selected workspace.
Do not widen the workspace root to an npm cache or MCPB installation just to
reach packaged files.

## First static review

After the client reconnects with the new root, paste:

> Call `electronics_capabilities`, then list the CRUMB and Logisim projects in
> this workspace. Analyze `crumb/breadboard-led.cru` and
> `logisim/full-adder.circ`. Run `crumb_check_design` on the CRUMB fixture and
> `logisim_export_netlist` for circuit `Main`. Preserve each returned project
> digest and clearly separate saved-file inference from runtime evidence.

This path needs neither simulator nor Java. The CRUMB fixture should produce
two floating-terminal warnings. The Logisim analysis should recognize the
`Main` circuit and return static structure plus an explicitly partial neutral
representation. Neither result proves live circuit behavior.

## Optional Logisim runtime check

Install Java 21 and configure a separately downloaded official
Logisim-evolution 4.1.0 all-JAR as described in the
[adapter guide](../../docs/logisim.md). Then ask:

> For `logisim/full-adder.circ`, use circuit `Main`. Run the bounded truth
> table, then execute `logisim/full-adder.vec`. Confirm the project and vector
> digests and report the truth-table row bound plus the vector verdict.

The expected demo result is an eight-row combinational truth table and 8/8
passing vectors. These calls are isolated JAR subprocesses against exact file
snapshots. They do not open or control a live Logisim GUI.

Circuitarium does not bundle CRUMB, Logisim-evolution, or Java. Its CRUMB
findings are static Unity-era file inference; only the three documented
Logisim runtime tools execute a simulator process.
