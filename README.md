# Circuitarium MCP

Run the latest published local MCP server with one command:

```text
npx -y circuitarium-mcp@0.2.1
```

Version `0.2.1` is the prior 14-tool CRUMBLE release; it does not contain the
Logisim adapter under development in this source tree. The first run can pause
while npm downloads and extracts the package. Once the published server starts
in a real terminal, it explains why it remains open:

```text
+--------------------------------------------------------------------+
| o---[R]---|>|---o CIRCUITARIUM MCP v0.2.1                          |
| 14 bounded electronics tools | CRUMBLE file analysis | no live     |
| simulation                                                         |
+--------------------------------------------------------------------+
| DIRECT RUN No MCP host is connected to this process.               |
|                                                                    |
| Press Ctrl+C, then configure your MCP host to launch this command. |
|                                                                    |
| Inspector and setup: circuitarium-mcp --help                       |
+--------------------------------------------------------------------+
```

Check an installation without starting the server:

```text
npx -y circuitarium-mcp@0.2.1 --help
npx -y circuitarium-mcp@0.2.1 --version
```

Starting the command in a separate terminal does not connect it to a host. An
MCP host must launch the command itself with piped stdio; in that mode the
decorative panel is suppressed and stdout remains protocol-only. Copy a
ready-to-use setup for [Codex, Claude Code, VS Code, LM Studio, or Jan](examples/client-configs/README.md),
choose a narrow circuit workspace, then ask the model to call
`electronics_capabilities`.

[![CI](https://github.com/Craftiee/circuitarium-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Craftiee/circuitarium-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/circuitarium-mcp.svg)](https://www.npmjs.com/package/circuitarium-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Give Claude, ChatGPT/Codex, or a local MCP-capable model a bounded, typed
electronics workbench instead of asking it to guess at opaque circuit files.
The **Unreleased 0.3.0 source tree** provides 20 bounded tools, seven read-only
knowledge resources, and four reusable workflow prompts: Unity-era CRUMB
`.cru` analysis plus version-pinned Logisim-evolution `.circ` analysis, partial
neutral IR, optional configured-JAR truth tables and test vectors, and
on-demand guidance for electrical review and digital-logic testing. Until
0.3.0 is actually published, use a source checkout to test that expanded MCP
surface; `npx ...@0.2.1` continues to install the prior 14-tool release.
Project analysis never modifies an input circuit; the sole Circuitarium
artifact-writing tool emits only one of five fixed synthetic fixtures.
JAR-backed Logisim execution may update Logisim's per-user Java preferences
and therefore advertises `readOnlyHint: false`. The longer-term neutral layer is designed to
support additional simulators without making CRUMB the universal data model.

> [!WARNING]
> Circuitarium MCP provides experimental educational analysis, not physical
> safety certification or approval to energize hardware. Static ERC, inferred
> connectivity, Logisim results, and model-written explanations can all be
> incomplete or wrong. Do not rely on them alone for mains voltage, battery
> charging, medical, automotive, life-safety, high-energy, or regulatory work.
> Use authoritative manufacturer documentation, appropriate physical
> measurements, and qualified engineering review wherever consequences matter.

![Circuitarium MCP checks a synthetic LED fixture, builds its BOM, and exports its netlist](https://raw.githubusercontent.com/Craftiee/circuitarium-mcp/main/docs/assets/circuitarium-terminal-demo.gif)

Claude Desktop users can download `circuitarium-mcp-0.2.1.mcpb` from the
matching [GitHub Release](https://github.com/Craftiee/circuitarium-mcp/releases)
and open it for a one-click local installation. The bundle prompts for the
circuit workspace, contains the production Node.js dependencies, and exposes
the same 14 CRUMBLE tools as npm version 0.2.1. The Unreleased 0.3.0 source
manifest adds optional Logisim JAR and Java selectors, but no 0.3.0 MCPB is a
published download yet.

> [!IMPORTANT]
> Circuitarium MCP, CRUMBLE, and the Logisim-evolution adapter are independent,
> unofficial
> community interoperability work. They are not affiliated with, endorsed by,
> or sponsored by CRUMB, Logisim-evolution, or their developers. Product names,
> marks, and assets belong to their respective owners. This repository contains
> no simulator code, binaries, extracted assets, logos, or bundled third-party
> circuit designs.

[Circuitarium MCP](https://github.com/Craftiee/circuitarium-mcp) is an
experimental, model-neutral electronics tool server with
application-specific integrations. Its first integration family is
**CRUMBLE** — **C**ircuit **R**epresentation & **U**niversal **M**odel
**B**ridge for **L**aboratory **E**lectronics. CRUMBLE reads, validates, and
compares CRUMB `.cru` save files, recognizes a version-pinned subset of CRUMB
components, and generates a small set of independently authored synthetic
fixtures. A separately licensed installation of CRUMB is needed only when a
user chooses to test those files in the game; CRUMB itself is not included.

The separation is deliberate:

- A **model host** is ChatGPT, Codex, Claude, or a local agent runtime.
- **Circuitarium MCP** is the simulator-neutral umbrella and gives compatible
  hosts one typed electronics contract.
- **CRUMBLE** is the unofficial CRUMB-specific ruleset and integration family.
- A **backend** understands a file format or simulator. The local
  `crumb.file` and `logisim.evolution` backends are callable through this
  server.
- The portable `electronics_*` namespace is where simulator-neutral circuit
  concepts can grow without making CRUMB the universal data model.

Start with `electronics_capabilities` when a model is unfamiliar with the
server. It returns the callable backends, truthful limitations, vocabulary, and
recommended workflows in machine-readable form. MCP clients that support
Resources can attach only the relevant profile, catalog, or review guide
instead of spending a tool call or injecting the entire knowledge set into
every conversation. Clients that support Prompts can explicitly invoke the
packaged review, comparison, Logisim verification, or handoff workflow.

The public names do not replace established protocol identifiers.
`electronics_*` remains the neutral tool namespace, `crumb_*` remains the
CRUMB-specific tool namespace, and `electronics.mcp/0.2` remains the result
contract. Keeping these descriptive identifiers stable prevents a branding
change from breaking existing MCP clients, prompts, handoffs, or saved
automation. See the [CRUMBLE integration guide](docs/crumble.md).

## Compatibility

| Target | Status | Evidence boundary |
|---|---|---|
| Neutral experiment validation | Callable | Independently authored schema and validator |
| CRUMBLE profile `crumb.unity/1.3.5` | Experimental support | Controlled saves, synthetic fixtures, and version-pinned CRUMB observations |
| Logisim profile `logisim-evolution/4.1.0` | Experimental support | Hardened `.circ` reader plus configured-JAR project-load, truth-table, and vector checks; CI separately verifies the official v4.1.0 asset SHA-256 |
| Future CRUMBLE Godot profile | Not supported yet | Requires separate controlled saves, mapping, and reopen testing |
| Live CRUMB simulation control | Not implemented | Requires a documented or developer-supported bridge |
| Live Logisim GUI control | Not implemented | Current JAR calls are bounded one-shot subprocesses; Linux test vectors use host-provided X11 or Xvfb without GUI automation |

Support is an interoperability claim about the tested file format, not a claim
of affiliation or behavioral equivalence. See [PROVENANCE.md](PROVENANCE.md)
for the evidence categories used by the project.

## What works now

- Expose seven deterministic, read-only MCP Resources for capability
  orientation, both compatibility profiles, the bounded CRUMBLE catalog,
  synthetic examples, low-voltage electrical review, and digital-logic test
  planning.
- Expose four user-invoked MCP Prompts for circuit review, controlled CRUMB
  comparison, Logisim verification, and digest-guarded cross-model handoff.
- Inspect and structurally validate CRUMB `.cru` files.
- Analyze 18 known CRUMB tool-ID schemas: boards, jumpers, passives, ICs, LEDs,
  power supplies, tactile/slide/DIP switches, potentiometers, labels,
  seven-segment displays, diodes, an Arduino/code component, and a signal
  generator.
- Resolve tool-5 DIP parts through 21 version-pinned prefab variants, including
  package labels and ordered semantic pin names observed in the tested build.
  Unresolved and partial pin naming remains explicit.
- Decode settings and serialized terminal order observed in the tested build
  for tools `7..14`, without pretending those saved settings execute device
  behavior.
- Infer attachment groups using either explicit connections only or the
  version-pinned CRUMB 1.3.5 breadboard topology.
- Compare a controlled baseline and candidate `.cru` under the explicitly
  selected Unity compatibility profile without writing either file. The
  comparison distinguishes byte identity, modeled equivalence,
  parameter-value changes, lexical-only rewrites, attachments, geometry, and
  unverified payload signatures while binding pagination to both digests.
  Unknown XML fields, attributes, mixed content, namespace bindings used by
  content, or subtrees force partial, inconclusive coverage and are represented
  only by content-safe fingerprints. Unused, well-formed namespace
  declarations are representation-neutral.
- Export jumper-collapsed electrical nets with `VCC`/`GND` names on
  unambiguous DC-supply rails, leave mixed positive/ground supply roles
  explicitly unnamed, apply optional saved-switch-state merges with bounded
  provenance, and page large designs.
- Run static electrical rule checks over the inferred nets: supply shorts,
  LEDs directly across the rails, bypassed two-terminal parts, resistors above
  their power rating, floating IC power pins, and floating terminals — each
  finding tagged with evidence confidence and rule basis, without claiming any
  simulation ran.
- Group components into a bill of materials keyed by decoded part identity,
  with saved state (switch positions, supply on/off) deliberately excluded.
- Discover workspace `.cru` files with digests, and answer IC pinout questions
  from the version-pinned prefab registry.
- Page through component and connection details without placing an entire large
  design in one model response. Continue by copying `data.page.nextCursor`
  unchanged into the next request's `cursor`; it is opaque and bound to that
  project digest and view.
- Redact embedded source code by default while returning useful metadata and a
  digest; source is included only when explicitly requested.
- Keep 28C16 EEPROM images metadata-only after validating their exact 2,048-byte
  size. Treat user labels as untrusted and return at most a 160-character
  preview plus size and digest metadata.
- Treat the save name as untrusted too: return only a 160-character preview
  with size, digest, and truncation metadata. Nested component and connection
  collections carry explicit `total`, `returned`, `limit`, and `truncated`
  fields instead of growing without bound. Unknown payload observations return
  at most 64 child-key names in aggregate for one component.
- Validate a simulator-neutral circuit experiment.
- Generate five synthetic CRUMB save fixtures:
  - blank workspace
  - solderless breadboard
  - solderless breadboard plus detached power rail
  - breadboard-mounted 1 kΩ resistor
  - breadboard-mounted red LED
- Return a uniform `electronics.mcp/0.2` result envelope, typed diagnostics,
  recovery hints, an explicit `crumb.unity/1.3.5` compatibility profile, and a
  SHA-256 project digest suitable for cross-model handoff.
- Return the same typed `INVALID_ARGUMENT` envelope for malformed calls to
  registered tools while preserving strict input schemas for MCP clients.
- Guard continued reads with `expectedProjectDigest`; if the shared artifact
  changed, the tool stops with `PROJECT_STATE_CONFLICT` instead of analyzing
  stale handoff state.
- Preserve valid CRUMB files byte-for-byte through an internal, guarded
  round-trip core, including unknown nested payloads and original XML lexical
  forms. This is the safety foundation for future mutation tools, not a claim
  that arbitrary editing is exposed today.
- Discover and parse Logisim-evolution `.circ` projects with strict UTF-8,
  DTD/entity rejection, XML work limits, raw-byte digests, and explicit
  unknown-construct samples.
- Convert Logisim circuits to `circuitarium.project-ir/0.1` and a deliberately
  partial coordinate-endpoint netlist. Every missing port-geometry or behavior
  assumption remains a machine-readable loss marker.
- Invoke a configured, user-supplied JAR that self-reports Logisim-evolution
  4.1.0 through shell-free, timeout- and output-bounded subprocesses for
  project-load statistics, combinational truth tables, and test vectors. The
  self-report is not binary or publisher authentication.
- Distinguish static file evidence, JAR project-load evidence, and actual
  non-interactive truth-table/test-vector evidence in every result. Logisim
  4.1.0 test-vector mode requires an X11 display on Linux; use Xvfb on a
  display-less host. See the
  [Logisim-evolution adapter guide](docs/logisim.md).
- Ship an independently authored one-bit full-adder `.circ` project and an
  8/8 passing vector as a reproducible first-run example.

All five generated fixtures were manually opened in the tested CRUMB 1.3.5
build and produced the intended visible components. That controlled observation
and the inferred board topology apply only to the observed **CRUMB 1.3.5
Unity-era format**. It is not behavioral simulation evidence and does not
establish compatibility with a Godot-based release.

This server does **not** control a running CRUMB process or edit arbitrary
circuits. CRUMB has no integration contract used by this project for run,
pause, step, stimulus, or signal reads; its honest boundary remains the save
file. Logisim behavior is available only through bounded, one-shot documented
CLI modes. No persistent or live GUI session is controlled.

## Non-redistributed compatibility observations

During development, two developer-published CRUMB designs were used locally to
exercise the semantic analyzer beyond the synthetic fixtures:

| Design | Recognition | Inferred groups | Bounded/redacted data |
|---|---:|---:|---|
| 8-bit CPU | 764/764 components | 362 | 5 EEPROM images redacted; 32 labels bounded |
| Bridge Rectifier | 20/20 components | 6 | — |

Those third-party files are not included in this repository. These results are
external compatibility observations, not part of the public test suite or a
service-level target. Their official publication links, acquisition date, and
SHA-256 identities are recorded in [PROVENANCE.md](PROVENANCE.md). Connection
counts use `known-board-v1.3.5`, and recognition does not mean the circuits were
simulated or validated as electrically correct.

## Quick start

Requirements: a supported Node.js release listed in `package.json`. The
published 0.2.1 package needs no Logisim installation because it contains only
the 14-tool CRUMBLE surface. In the Unreleased 0.3.0 source tree, the three
Logisim runtime tools additionally need Java 21 and a trusted, user-supplied
JAR that self-reports 4.1.0; the three static Logisim tools do not. The
recommended download is the upstream official v4.1.0 all-JAR.

For the published 14-tool 0.2.1 setup, use the pinned `npx` command shown at the
top of this README in one of the
[copyable client configurations](examples/client-configs/README.md). Set
`CIRCUITARIUM_MCP_ROOT` to the smallest directory that should contain the
circuits available to the model.

To develop or verify the Unreleased 0.3.0 server and its 20-tool Logisim
surface from source:

```powershell
git clone https://github.com/Craftiee/circuitarium-mcp.git
cd circuitarium-mcp
npm ci
npm run check
node dist/src/bin.js doctor
node dist/src/bin.js
```

The packaged `circuitarium-mcp` command and the one-click `.mcpb` bundle are
install-smoke-tested before publication. Directly running either stdio
entrypoint waits for an MCP client by design. Run `npm run package:audit` to
build the exact installable tarball in isolation and report its compressed
size, unpacked size, file count, MCP initialization time, tool-list time, tool
count, and piped-stderr cleanliness against release budgets.

Useful CLI commands:

```powershell
npm run cli -- list
npm run cli -- inspect fixtures/crumb/breadboard.cru
npm run cli -- analyze fixtures/crumb/breadboard-resistor.cru components 50
npm run cli -- compare baseline.cru candidate.cru components 50
npm run cli -- netlist fixtures/crumb/breadboard-led.cru
npm run cli -- check fixtures/crumb/breadboard-led.cru
npm run cli -- bom fixtures/crumb/breadboard-led.cru
npm run cli -- ic 74HC138
npm run cli -- validate fixtures/crumb/breadboard-and-rail.cru
npm run cli -- generate breadboard my-design.cru
npm run cli -- validate-experiment examples/experiments/four-bit-counter.json
npm run cli -- logisim-list examples/logisim
npm run cli -- logisim-analyze examples/logisim/full-adder.circ
npm run cli -- logisim-netlist examples/logisim/full-adder.circ Main
npm run cli -- logisim-stats examples/logisim/full-adder.circ Main
npm run cli -- logisim-table examples/logisim/full-adder.circ Main 8
npm run cli -- logisim-test examples/logisim/full-adder.circ examples/logisim/full-adder.vec Main
```

Read commands invoke the same registered MCP tools as the stdio server and
print the same result envelopes; only the fixture `generate`/`generate-all`
maintenance commands write directly (they support `--force`, which the MCP
surface never does).

The server confines file operations to its working directory by default. Set
`CIRCUITARIUM_MCP_ROOT` to a different absolute directory if the MCP client
should work with `.cru`, `.circ`, or vector files elsewhere.
`ELECTRONICS_MCP_ROOT` remains a
compatibility fallback for existing installations; prefer the Circuitarium
name in new configurations.

For the Unreleased 0.3.0 source server, set `CIRCUITARIUM_LOGISIM_JAR` to a
trusted Logisim-evolution JAR that self-reports 4.1.0 to enable the three
runtime tools. The upstream official v4.1.0 all-JAR is recommended. The runtime
does not authenticate the configured JAR by publisher or digest. Set
`CIRCUITARIUM_JAVA` only when Java 21 is not available as `java` on `PATH`.

For a concise model-host footing, use the
[minimal system prompt](examples/model-host/minimal-system-prompt.txt).

## MCP tools

The table below describes the 20 tools in the Unreleased 0.3.0 source tree.
The published 0.2.1 package contains the first 14 entries only and ends with
`crumb_generate_fixture`.

| Tool | Purpose | Side effect |
|---|---|---|
| `electronics_capabilities` | Discover callable backends, limitations, vocabulary, and workflows | None |
| `electronics_validate_experiment` | Validate portable circuit schema and semantics | None |
| `crumb_component_catalog` | List 18 recognized CRUMB 1.3.5 schemas, 21 tool-5 DIP variants, pin-name coverage, and machine-readable evidence meanings | None |
| `crumb_ic_reference` | Answer IC pinout questions ("74HC138") from the version-pinned prefab registry | None |
| `crumb_list_projects` | Discover workspace `.cru` files with sizes, timestamps, and digests | Reads listed files |
| `crumb_analyze_design` | Return bounded semantic summaries, component pages, or inferred connection pages | Reads one file |
| `crumb_compare_designs` | Compare two `.cru` files under `crumb.unity/1.3.5` with digest-guarded, bounded root and component changes | Reads two files |
| `crumb_get_component` | Fetch one component with parameters, terminals, connection groups, and windowed firmware source | Reads one file |
| `crumb_export_netlist` | Promote connection groups to electrical nets with jumper collapse, unambiguous supply naming, and optional switch-state merges | Reads one file |
| `crumb_check_design` | Run static electrical rule checks (supply shorts, LED series resistance, floating pins, power ratings) | Reads one file |
| `crumb_bom` | Group components into a bill of materials by part identity | Reads one file |
| `crumb_inspect_design` | Return a format-level `.cru` inventory | Reads one file |
| `crumb_validate_design` | Check `.cru` structure and known invariants | Reads one file |
| `crumb_generate_fixture` | Write one synthetic, compatibility-tested fixture and return its artifact identity | Optional new file; never overwrites |
| `logisim_list_projects` | Discover workspace `.circ` projects with stable raw-byte digests | Reads listed files |
| `logisim_analyze_design` | Summarize project structure, circuits, Pins, Clocks, component types, and conversion losses | Reads one file |
| `logisim_export_netlist` | Export bounded, explicitly partial coordinate-endpoint neutral nets | Reads one file |
| `logisim_component_stats` | Ask the configured JAR that self-reports 4.1.0 to load and inventory one circuit | Reads one file; stages its exact bytes privately; launches Java, which may update Logisim preferences |
| `logisim_truth_table` | Run bounded CSV/binary combinational evaluation in the configured JAR that self-reports 4.1.0 | Reads one file; stages its exact bytes privately; launches Java, which may update Logisim preferences |
| `logisim_run_test_vector` | Run a workspace `.vec`/`.txt` file and return structured pass/fail evidence | Reads two files; stages their exact bytes privately; launches Java, which may update Logisim preferences; requires X11 or Xvfb on Linux |

All tools have input and output schemas. Successful tool execution and valid
domain data are separate states: a validator can return `ok: true` with
`data.valid: false`. See [the v0.2 tool contract](docs/contract.md).

## MCP knowledge resources and prompts

Resources are deterministic, bounded, read-only reference payloads. They do
not inspect the workspace and never contain CRUMB binaries/assets or
third-party circuit files. Use a Tool when the model needs live artifact or
runtime evidence; use a Resource when the host only needs stable context.

| Resource URI | Contents |
|---|---|
| `circuitarium://capabilities` | Static backend, workflow, vocabulary, resource, and prompt index |
| `circuitarium://profiles/crumb.unity/1.3.5` | Unity-era CRUMBLE evidence boundary |
| `circuitarium://profiles/logisim-evolution/4.1.0` | Logisim static/JAR evidence boundary |
| `circuitarium://catalogs/crumb.unity/1.3.5/components` | 18 component schemas, 21 IC observations, and evidence meanings |
| `circuitarium://examples/synthetic` | Redistributable CRUMB fixture kinds and Logisim full-adder example |
| `circuitarium://knowledge/electrical-review/0.1` | Low-voltage design-review checklist and safety boundary |
| `circuitarium://knowledge/digital-logic-testing/0.1` | Combinational/sequential test-planning guidance |

The canonical backend IDs carried in tool envelopes and cross-model handoffs
are `crumb.file` and `logisim.evolution`. The `review-circuit-design` Prompt
uses the shorter selector `backend: "crumb"` or `backend: "logisim"` only as a
Prompt argument; do not persist those aliases as `context.backendId`.

Prompt arguments identify artifacts, but the receiving model must map them to
the exact Tool input names:

| Prompt | Exact Tool-argument mapping |
|---|---|
| `review-circuit-design` | `projectRef` -> `path`; `projectDigest` -> `expectedProjectDigest`; `circuit` -> `circuit` for Logisim |
| `compare-crumb-designs` | `baselineRef` -> `baselinePath`; `candidateRef` -> `candidatePath`; `baselineDigest` -> `expectedBaselineDigest`; `candidateDigest` -> `expectedCandidateDigest`; `topologyMode` -> `topologyMode` |
| `verify-logisim-design` | `projectRef` -> `path`; `projectDigest` -> `expectedProjectDigest`; `circuit` -> `circuit`; `vectorRef` -> `vectorPath`; `vectorDigest` -> `expectedVectorDigest` |
| `handoff-circuit-project` | `projectRef` -> `path`; `projectDigest` -> `expectedProjectDigest`; optional `circuit` -> `circuit`; `backend` already uses a canonical backend ID |

Always inspect the envelope-level `ok` first. On Logisim analysis, runtime
preflight is `data.runtimeSafety.safe` and neutral conversion evidence is under
`data.neutralIr.completeness`, `data.neutralIr.losses`, and
`data.neutralIr.lossBounds`. Truth tables have no pass/fail `data.valid`; check
`data.rowBounds.truncated` before describing returned coverage. Test-vector
assertions use `data.valid`, `data.failures`, and `data.failureBounds`. CRUMB
comparison coverage and verdicts are under `data.equivalence.coverage` and
`data.equivalence.assessment`; CRUMB ERC uses `data.valid`.

The four prompts are `review-circuit-design`, `compare-crumb-designs`,
`verify-logisim-design`, and `handoff-circuit-project`. Prompts package an
explicit workflow for the user to invoke; they do not sample a model, execute
tools, or grant write access by themselves. Core artifact workflows remain
available through `electronics_capabilities` and the 20 Tools when a host does
not expose Resources or Prompts; the two longer review guides are optional
host-attached context.

The synthetic-example Resource is a catalog, not a file installer. The source
tree and npm/MCPB artifacts carry the independently authored Logisim
full-adder, but Tool access remains confined to `CIRCUITARIUM_MCP_ROOT`. Copy
`full-adder.circ` and `full-adder.vec` into that configured workspace before
calling a Logisim Tool, then use their workspace-relative refs. Likewise,
repository-only `fixtures/crumb/...` paths in static workflow examples are
illustrative; an installed server should use a user project or
`crumb_generate_fixture`. See the
[example-specific instructions](examples/logisim/README.md).

CRUMB file tools reject non-`.cru` paths, malformed UTF-8, byte snapshots over
64 MiB, paths outside the root selected by `CIRCUITARIUM_MCP_ROOT` (or the
legacy fallback), and overwrite attempts. Semantic XML decoding has a separate
3,145,728-character document bound, and a comparison pair is additionally
capped at 5 MiB combined. SHA-256 artifact identities cover the exact file
bytes, including an optional UTF-8 BOM. Artifact references in results are
workspace-relative rather than leaked absolute paths. Artifact metadata uses
`adapterTestedCompatibility` to describe the adapter evidence; it does not
claim that an arbitrary input file was created or tested in that CRUMB build.

The Unity decoder accepts XML 1.0 represented as UTF-8, enforces namespace
well-formedness and strict typed scalar forms, and caps each parsed XML text
node at 1 MiB. See the [format notes](docs/crumb-format.md) for the exact
declaration, numeric, base64, namespace, and structural-limit rules.

Logisim project tools similarly cap `.circ` snapshots at 64 MiB, reject
malformed UTF-8, DTDs/entities, hostile XML depth/breadth/text, and paths that
traverse symlinks or reparse points. Vector files are limited to 4 MiB.
Before any runtime call, a full-stream safety preflight defaults to denial for
external file/JAR libraries, VHDL, unsafe or path-bearing runtime features, and
unknown or malformed constructs. Accepted project and vector byte snapshots
are staged exactly in a private temporary directory with fixed internal names
and removed after success or failure. Test-vector calls also copy the
configured JAR into that private directory before probing and execution, so
Logisim cannot auto-load a sibling `logisim-defaults` directory. Runtime
subprocesses use argument arrays with no shell, an allowlisted environment,
and separate time and stdout/stderr byte limits. Public Logisim strings are
limited to 4,096 characters, and the
aggregate serialized result envelope is limited to 2 MiB. These controls
reduce project-driven risk; they are not an operating-system sandbox or a
security boundary against a malicious configured JAR. See
[docs/logisim.md](docs/logisim.md).

The file backend runs locally, but its capability reports
`dataLeavesMachine: "depends"` because a cloud-backed MCP client or model host
may receive tool results. Its `build` capability is `false`: the five fixed
fixture generators are a compatibility aid, not a general circuit builder.

## Passing work between models

Each stdio client normally launches its own MCP server process. Those processes
do not share an in-memory session, even if one is launched by Claude and another
by Codex. The CRUMB backend itself has no live session.

Models can still collaborate safely through the same workspace:

1. Model A analyzes a `.cru` file and records its workspace-relative project
   reference plus SHA-256 digest.
2. The handoff note passes that identity, compatibility profile, requested
   topology mode, findings, and next intended operation.
3. Model B passes that digest as `expectedProjectDigest` on its first read. A
   changed file returns `ok: false` with `PROJECT_STATE_CONFLICT`; otherwise the
   analysis is known to match the handed-off bytes.

See the [cross-model handoff example](examples/cross-model/handoff.md).
The same `projectRef`/`projectDigest` handoff applies to Logisim `.circ`
projects; test-vector calls can additionally guard `expectedVectorDigest`.

## Project map

- `src/domain/experiment.ts` — neutral experiment schema and semantic validation
- `src/domain/contract.ts` — model-neutral v0.2 result and error envelope
- `src/domain/capabilities.ts` — callable backend registry and model workflows
- `src/domain/knowledge.ts` — bounded MCP Resources and reusable workflow
  Prompts
- `src/domain/project-ir.ts` — small simulator-neutral project/netlist IR and
  explicit conversion-loss vocabulary
- `src/adapters/crumb/` — `.cru` decoding, catalog, analysis, fixtures, and
  bounded file I/O
- `src/adapters/logisim/` — hardened `.circ` parsing, contained file I/O,
  neutral IR conversion, default-deny runtime preflight, exact-byte private
  staging, bounded JAR execution, and output parsers
- `src/adapters/crumb/compatibility.ts` — the exact Unity-era interpretation
  profile and tested-build metadata
- `src/adapters/crumb/compare.ts` — digest-guarded controlled-save comparison
  with bounded, content-safe change reports
- `src/adapters/crumb/icCatalog.ts` — CRUMB 1.3.5 tool-5 prefab and ordered-pin
  evidence
- `src/server.ts` — local stdio MCP server
- `src/cli.ts` — local inspection/generation CLI
- `fixtures/crumb/` — generated, CRUMB 1.3.5-tested `.cru` saves
- `PROVENANCE.md` — evidence classes, compatibility scope, and clean-room rules
- `docs/contract.md` — tool semantics and cross-model rules
- `docs/crumble.md` — CRUMBLE scope, evidence profiles, and stable identifiers
- `docs/logisim.md` — Logisim-evolution setup, tools, evidence boundaries, and
  subprocess safety
- `docs/crumb-format.md` — observed, version-pinned CRUMB schema notes
- `docs/wokwi-audit.md` — official Wokwi CLI/MCP audit
- `docs/architecture.md` — current boundary and scalable simulator roadmap
- `docs/unity-adapter-plan.md` — Unity-first comparison, editing, and writer
  acceptance gates
- `docs/client-setup.md` — ChatGPT/Codex, Claude, API, and local-model routes
- `docs/release-checklist.md` — local and GitHub publication gates
- `ROADMAP.md` — adapter, portable project, simulation, and live-bridge stages
- `CHANGELOG.md` — public interface and release history
- `examples/client-configs/` — copyable setup for five MCP hosts
- `examples/logisim/` — independently authored 1-bit full-adder project and
  8/8 passing vector
- `examples/model-host/minimal-system-prompt.txt` — compact, vendor-neutral
  operating rules for a model host
- `mcpb/` — one-click local bundle manifest and packaging notes

## Status

This is experimental interoperability code built from independently authored
parsers and fixtures, controlled CRUMB 1.3.5 saves, official Logisim-evolution
documentation/CLI behavior, non-redistributed third-party compatibility
examples, and observations of lawfully installed software. Keep original
designs backed up, do not infer electrical behavior from static or unknown
payloads, and revalidate every pinned profile after simulator updates.

Contributions are welcome under the evidence and licensing rules in
[CONTRIBUTING.md](CONTRIBUTING.md). Report security issues using
[SECURITY.md](SECURITY.md), and use the project support channels described in
[SUPPORT.md](SUPPORT.md). The project is licensed under the
[Apache License 2.0](LICENSE).
