# Circuitarium MCP

Local electronics tools for MCP-capable assistants, with support for CRUMB
save files and Logisim-evolution projects.

[![CI](https://github.com/Craftiee/circuitarium-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Craftiee/circuitarium-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/circuitarium-mcp.svg)](https://www.npmjs.com/package/circuitarium-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.Craftiee%2Fcircuitarium-5c4ee5.svg)](https://registry.modelcontextprotocol.io/?q=io.github.Craftiee%2Fcircuitarium)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Circuitarium lets an MCP host inspect circuit files without pretending that
static analysis is a running simulator. It can trace CRUMB nets, build BOMs,
run electrical rule checks, analyze Logisim projects, and optionally ask
Logisim-evolution to produce truth tables or run test vectors.

Release `0.3.1` includes 22 tools, nine read-only Resources, and four workflow
Prompts. The server is model-neutral: Codex, Claude Code/Desktop, VS Code,
LM Studio, Jan, or another local MCP host supplies the model and launches
Circuitarium over stdio. Circuitarium itself needs no OpenAI, Anthropic, or
local-model API key.

## Quick start

You need:

- Node.js 22 or newer;
- an MCP client that can launch a local stdio server; and
- a dedicated folder containing only the circuit files you want the client to
  access.

Windows, macOS, and Linux are covered by CI. CRUMB analysis and the static
Logisim tools need neither simulator nor Java.

### 1. Add Circuitarium to your MCP client

Most clients ask for the same command, arguments, and environment variable:

```text
Command: npx
Arguments: -y circuitarium-mcp@0.3.1
Environment:
  CIRCUITARIUM_MCP_ROOT=/absolute/path/to/circuit-workspace
```

The first launch can take longer while npm downloads the package. Later starts
normally use npm's cache.

Replace the path with the smallest folder that should contain the `.cru`,
`.circ`, `.vec`, and `.txt` files available to the model. Do not point it at
your home directory or a drive root.

Copyable configurations are available for:

- [Codex](examples/client-configs/codex.toml)
- [Claude Code](examples/client-configs/claude-code.md)
- [VS Code](examples/client-configs/vscode-mcp.json)
- [LM Studio](examples/client-configs/lm-studio-mcp.json)
- [Jan](examples/client-configs/jan.md)

See the [client setup guide](docs/client-setup.md) for platform-specific
examples and local-model guidance. The
[starter workspace recipe](examples/starter-workspace/README.md) copies one
synthetic CRUMB fixture plus the full-adder Logisim project into an isolated
folder, so a first test does not require access to the rest of a source
checkout. Restart or reload the client after adding the server.

Claude Desktop users can instead download
[`circuitarium-mcp-0.3.1.mcpb`](https://github.com/Craftiee/circuitarium-mcp/releases/download/v0.3.1/circuitarium-mcp-0.3.1.mcpb)
directly and open it as a local bundle. The installer asks for a circuit
workspace and offers optional Logisim JAR and Java settings. The
[release page](https://github.com/Craftiee/circuitarium-mcp/releases/tag/v0.3.1)
also includes checksums and the matching npm tarball.

### 2. Try a circuit with no simulator installed

Paste this into the connected client:

> Use Circuitarium. Call `electronics_capabilities`. Create the built-in
> `breadboard-led` fixture as `demo/first-led.cru` without overwriting
> anything, analyze it, and run `crumb_check_design`. Explain which findings
> are static inferences rather than simulation results.

Your client may ask you to approve creation of the synthetic file. The tool
refuses to overwrite an existing path; on a repeat run, analyze the existing
file or choose a new name.

A healthy connection creates a small synthetic file, recognizes its
breadboard and LED, and reports two floating-terminal warnings. The fixture is
independently authored and safe to redistribute; it is not a CRUMB asset.

### 3. Check the launcher from a terminal

These commands verify the published launcher without opening a server session:

```text
npx -y circuitarium-mcp@0.3.1 --help
npx -y circuitarium-mcp@0.3.1 --version
npx -y circuitarium-mcp@0.3.1 doctor --smoke
```

If the bare `npx -y circuitarium-mcp@0.3.1` command appears to wait, the server
is working as designed: it is waiting for an MCP host on stdin. Press Ctrl+C
and let the host launch the command itself.

[Watch the terminal demo](https://github.com/Craftiee/circuitarium-mcp/blob/v0.3.1/docs/assets/circuitarium-terminal-demo.gif)
to see the source-checkout command runner inspect a synthetic fixture, build
its BOM, and export its netlist. The public package exposes the MCP server,
help, version, and doctor commands shown above.

[Watch the MCP Inspector demo](https://github.com/Craftiee/circuitarium-mcp/blob/v0.3.1/docs/assets/circuitarium-inspector-demo.gif)
to see the server running in an independent MCP client, or read the
[reproducible 22-tool host verification](https://github.com/Craftiee/circuitarium-mcp/blob/v0.3.1/docs/host-demo.md)
and its sanitized evidence report.

## What you can do

| Area | Current capabilities |
|---|---|
| General electronics | Discover available backends, validate portable experiment descriptions, and plan what evidence is needed to verify circuit claims |
| CRUMBLE / CRUMB | Discover, inspect, validate, and compare Unity-era `.cru` saves; build BOMs and netlists; trace conductive nets; query supported IC pinouts; and run static electrical checks |
| Logisim-evolution | Discover and inspect `.circ` projects, export a deliberately partial neutral netlist, and optionally run component statistics, truth tables, and test vectors |
| Cross-model work | Preserve workspace-relative project references and raw-byte SHA-256 digests so another model can confirm it is reading the same artifact |

**CRUMBLE**—Circuit Representation & Universal Model Bridge for Laboratory
Electronics—is the unofficial CRUMB-specific integration inside Circuitarium.
The simulator-neutral tools keep CRUMB-specific assumptions out of future
adapters.

The current surface breaks down into three neutral `electronics_*` tools,
thirteen `crumb_*` tools, and six `logisim_*` tools. All tool results use the
`electronics.mcp/0.2` result contract, independent of the package version.

### Static analysis versus runtime execution

| Operation | Simulator or Java required? | What it establishes |
|---|---|---|
| All `crumb_*` tools | No | Facts inferred from a saved Unity-era `.cru` file; never live CRUMB behavior |
| `logisim_list_projects`, `logisim_analyze_design`, `logisim_export_netlist` | No | Saved `.circ` structure and an explicitly partial neutral representation |
| `logisim_component_stats` | Java 21 and a user-supplied Logisim 4.1.0 all-JAR | The selected project and circuit loaded in one bounded subprocess |
| `logisim_truth_table`, `logisim_run_test_vector` | Java 21 and a user-supplied Logisim 4.1.0 all-JAR | Bounded behavioral evidence for the exact project digest; not a live GUI session |
| Resources and Prompts | No | Guidance and workflow templates only; they do not read a project or execute a simulator |

## Compatibility and honest limits

| Target | Status | Boundary |
|---|---|---|
| CRUMB 1.3.5, Unity-era `.cru` format | Experimental support | Static, version-pinned file analysis under `crumb.unity/1.3.5` |
| Godot-era CRUMB 2.x | Not supported | Requires a separate evidence profile and controlled-save corpus |
| Live CRUMB control or simulation | Not implemented | No run, pause, step, signal-read, or GUI bridge |
| Arbitrary CRUMB editing | Not implemented | The only public write tool creates one of five fixed synthetic fixtures |
| Logisim-evolution 4.1.0 static analysis | Experimental support | Clean-room `.circ` parsing; neutral netlists remain explicitly partial |
| Logisim-evolution 4.1.0 execution | Optional | Bounded, one-shot JAR subprocesses; no live GUI session |

CRUMB electrical rule checks operate on inferred net connectivity and saved
component values. They can find supply shorts, an LED placed directly across
both rails of one recognized supply, a directly connected resistor whose
saved values imply excessive dissipation, and selected floating terminals or
IC power pins. They do **not** trace series paths, prove polarity, calculate
general circuit behavior, or certify a physical build.

> [!WARNING]
> Circuitarium is experimental educational software, not a safety
> certification tool. Do not rely on its output alone for mains voltage,
> battery charging, medical, automotive, life-safety, high-energy, or
> regulatory work. Use authoritative component documentation, appropriate
> measurements, and qualified engineering review wherever consequences
> matter.

File parsing happens locally, but the MCP host may send returned data to a
cloud model. Embedded firmware source is omitted by default, and binary EEPROM
contents are never returned, but you should still use a narrow workspace with
no secrets. Read the [security policy](SECURITY.md) for the full trust model.

## Optional Logisim runtime

The three static Logisim tools work without Java. To enable component
statistics, truth tables, and test vectors:

1. Install Java 21 or newer.
2. Download the official
   [`logisim-evolution-4.1.0-all.jar`](https://github.com/logisim-evolution/logisim-evolution/releases/tag/v4.1.0).
3. Add the JAR path to the MCP host configuration.

```text
CIRCUITARIUM_LOGISIM_JAR=/absolute/path/to/logisim-evolution-4.1.0-all.jar
CIRCUITARIUM_JAVA=java
```

`CIRCUITARIUM_JAVA` is optional when `java` already resolves to Java 21 or
newer. On a headless Linux machine, test-vector execution also needs a working
X11 display; Xvfb is sufficient.

Use only a trusted JAR. Circuitarium verifies that it self-reports version
4.1.0, but that response does not authenticate the file or its publisher.
Runtime tools may update Logisim's per-user Java preferences and are not an
operating-system sandbox.

The repository includes an independently authored
[full-adder project and vector](examples/logisim/README.md) for a first
runtime test. Circuitarium does not bundle or download Logisim-evolution.
See the [Logisim adapter guide](docs/logisim.md) for setup, Linux notes,
evidence levels, and subprocess safeguards.

## Typical workflows

### Review a CRUMB save

1. Call `electronics_capabilities`.
2. Call `crumb_list_projects` if the path is not known. Projects include a
   digest when requested and within the documented file and aggregate bounds;
   otherwise the result explains why it was omitted.
3. Call `crumb_analyze_design` with `view: "summary"`.
4. Use `crumb_export_netlist`, `crumb_trace_net`, `crumb_check_design`, or
   `crumb_bom` only as the question requires.

Static findings remain file-format inference. Circuitarium does not observe
whether CRUMB is running or how the circuit behaves.

### Verify a Logisim project

1. Call `logisim_list_projects`, then `logisim_analyze_design`.
2. Treat `logisim_export_netlist` as partial static evidence and review its
   conversion-loss markers.
3. If the optional runtime is available, select an exact circuit and call
   `logisim_truth_table` or `logisim_run_test_vector`.
4. Use `electronics_plan_verification` when a claim needs several kinds of
   evidence or an explicit list of remaining gaps.

### Hand work to another model

Keep `projectRef`, `projectDigest`, `backendId`, `adapterVersion`, and
`compatibilityProfile` with the handoff. The receiving model should pass the
recorded digest as `expectedProjectDigest` on its first read. If the bytes have
changed, Circuitarium returns `PROJECT_STATE_CONFLICT` instead of silently
reusing stale conclusions.

See the [cross-model handoff example](examples/cross-model/handoff.md).

## Tool reference

<details>
<summary><strong>All 22 tools</strong></summary>

### Neutral electronics tools

| Tool | Purpose |
|---|---|
| `electronics_capabilities` | Report callable backends, limitations, and recommended workflows |
| `electronics_validate_experiment` | Validate a portable experiment description without claiming it ran |
| `electronics_plan_verification` | Build an evidence plan for explicit circuit claims |

### CRUMBLE tools

| Tool | Purpose |
|---|---|
| `crumb_component_catalog` | Return the version-pinned CRUMB component catalog |
| `crumb_analyze_design` | Read bounded semantic views of a `.cru` save |
| `crumb_compare_designs` | Compare two digest-guarded saves without modifying either |
| `crumb_inspect_design` | Return a compact format-level inventory |
| `crumb_validate_design` | Check XML structure and known invariants |
| `crumb_generate_fixture` | Create one fixed synthetic fixture without overwriting |
| `crumb_list_projects` | Discover workspace `.cru` files and bounded artifact metadata |
| `crumb_get_component` | Fetch one component and optional bounded source window |
| `crumb_bom` | Group recognized components into a bill of materials |
| `crumb_ic_reference` | Query the version-pinned IC package and pin registry |
| `crumb_export_netlist` | Export static, jumper-collapsed inferred nets |
| `crumb_trace_net` | Produce a paged conductive witness for one terminal |
| `crumb_check_design` | Run scoped static electrical rule checks |

### Logisim-evolution tools

| Tool | Purpose |
|---|---|
| `logisim_list_projects` | Discover workspace `.circ` files |
| `logisim_analyze_design` | Inspect static project, circuit, component, Pin, Clock, and wire structure |
| `logisim_export_netlist` | Export an explicitly partial coordinate-based neutral netlist |
| `logisim_component_stats` | Ask the configured JAR to load and inventory a circuit |
| `logisim_truth_table` | Evaluate a bounded combinational truth table |
| `logisim_run_test_vector` | Run a workspace-contained vector and return structured failures |

</details>

The nine Resources provide capability metadata, compatibility profiles,
synthetic-example metadata, electrical-review and digital-testing guidance, a
neutral component-profile schema, and version-pinned component catalogs. The
four user-invoked Prompts are:

- `review-circuit-design`
- `compare-crumb-designs`
- `verify-logisim-design`
- `handoff-circuit-project`

Resources and Prompts do not read a project or run a simulator by themselves.
Clients that do not expose those MCP features can still use all 22 tools. The
[contract reference](docs/contract.md) documents exact resource URIs, Prompt
arguments, result envelopes, errors, output bounds, and tool schemas.

## Contributing

Circuitarium is still early, and small, well-evidenced improvements are useful.
Good starting points include client setup fixes, synthetic test circuits,
source-cited component profiles, parser edge cases, controlled compatibility
observations, and scoped [roadmap](ROADMAP.md) work.

Before changing an adapter or public contract, read the
[contribution guide](CONTRIBUTING.md),
[architecture](docs/architecture.md), and
[provenance policy](PROVENANCE.md). Questions and early design ideas belong in
[Discussions](https://github.com/Craftiee/circuitarium-mcp/discussions);
reproducible bugs, scoped feature requests, and controlled interoperability
evidence belong in the
[issue tracker](https://github.com/Craftiee/circuitarium-mcp/issues/new/choose).

```text
git clone https://github.com/Craftiee/circuitarium-mcp.git
cd circuitarium-mcp
npm ci
npm run lint
npm run check
```

Use `npm run test:coverage` for behavioral changes,
`npm run package:check` for package or launcher changes, and
`npm run logisim:e2e` for Logisim runtime changes. The Logisim E2E test
requires Java 21 and a separately supplied 4.1.0 all-JAR.

Fixtures must be small, synthetic, independently authored, and safe to
redistribute. Do not submit private circuits, firmware, simulator binaries,
extracted assets, or third-party circuit designs. Build a minimal synthetic
reproduction instead. Report vulnerabilities through
[GitHub private vulnerability reporting](SECURITY.md), not a public issue.
All contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Documentation

| Document | Use it for |
|---|---|
| [Client setup](docs/client-setup.md) | Host-specific installation, subscriptions/APIs, and local models |
| [CRUMBLE guide](docs/crumble.md) | Current CRUMB scope and evidence profiles |
| [Logisim guide](docs/logisim.md) | JAR setup, runtime evidence, safety, and Linux notes |
| [MCP contract](docs/contract.md) | Exact tools, Resources, Prompts, envelopes, and limits |
| [Architecture](docs/architecture.md) | Adapter boundaries and simulator-neutral design |
| [Provenance](PROVENANCE.md) | Evidence categories and redistribution rules |
| [Roadmap](ROADMAP.md) | Shipped milestones and planned work |
| [Changelog](CHANGELOG.md) | Release history |

## Privacy Policy

Circuitarium runs locally over stdio, has no telemetry, and does not send
circuit files to a maintainer-controlled service. The MCP host and model
provider you choose may still process tool arguments and results under their
own terms. Read the complete [Privacy Policy](PRIVACY.md) before granting a
host access to a workspace.

## Project status and license

Circuitarium MCP is experimental community software released under the
[Apache License 2.0](LICENSE). Version `0.3.1` is available on
[npm](https://www.npmjs.com/package/circuitarium-mcp/v/0.3.1) and as a
[GitHub release](https://github.com/Craftiee/circuitarium-mcp/releases/tag/v0.3.1),
and its metadata is listed in the
[official MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.Craftiee%2Fcircuitarium).
For help, see [SUPPORT.md](SUPPORT.md). Research and teaching users can cite
the project with [CITATION.cff](CITATION.cff).

Circuitarium MCP, CRUMBLE, and the Logisim-evolution adapter are independent,
unofficial interoperability work. They are not affiliated with, endorsed by,
or sponsored by CRUMB, Logisim-evolution, or their developers. This repository
contains no CRUMB or Logisim-evolution simulator code, binaries, extracted
assets, logos, or bundled third-party circuit designs. Product names and marks
belong to their respective owners.
