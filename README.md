# Circuitarium MCP

Run the published local MCP server with one command:

```text
npx -y circuitarium-mcp@0.2.1
```

The first run can pause while npm downloads and extracts the package. Once the
server starts in a real terminal, it explains why it remains open:

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

Give Claude, ChatGPT/Codex, or a local MCP-capable model a safe, typed
electronics workbench instead of asking it to guess at opaque circuit files.
Circuitarium MCP currently provides 14 bounded tools for Unity-era CRUMB
`.cru` saves, including controlled-save comparison, netlist export, and
evidence-scoped electrical checks.
Project analysis is read-only; the sole file-writing tool emits only one of
five fixed synthetic fixtures. The longer-term neutral layer is designed to
support additional simulators without making CRUMB the universal data model.

![Circuitarium MCP checks a synthetic LED fixture, builds its BOM, and exports its netlist](https://raw.githubusercontent.com/Craftiee/circuitarium-mcp/main/docs/assets/circuitarium-terminal-demo.gif)

Claude Desktop users can download `circuitarium-mcp-0.2.1.mcpb` from the
matching [GitHub Release](https://github.com/Craftiee/circuitarium-mcp/releases)
and open it for a one-click local installation. The bundle prompts for the
circuit workspace and contains the production Node.js dependencies. The
current boundary is still file analysis: no live CRUMB control, arbitrary
editing, or circuit simulation is claimed.

> [!IMPORTANT]
> Circuitarium MCP and its CRUMBLE integration are independent, unofficial
> community interoperability work. They are not affiliated with, endorsed by,
> or sponsored by CRUMB or its developer. CRUMB and related names, marks, and
> assets belong to their respective owners. This repository contains no CRUMB
> game code, binaries, extracted assets, logos, or bundled third-party circuit
> designs.

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
- A **backend** understands a file format or simulator. Only the local
  CRUMBLE `crumb.file` backend is callable through this server today.
- The portable `electronics_*` namespace is where simulator-neutral circuit
  concepts can grow without making CRUMB the universal data model.

Start with `electronics_capabilities` when a model is unfamiliar with the
server. It returns the callable backend, truthful limitations, vocabulary, and
recommended workflows in machine-readable form.

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
| Future CRUMBLE Godot profile | Not supported yet | Requires separate controlled saves, mapping, and reopen testing |
| Live CRUMB simulation control | Not implemented | Requires a documented or developer-supported bridge |

Support is an interoperability claim about the tested file format, not a claim
of affiliation or behavioral equivalence. See [PROVENANCE.md](PROVENANCE.md)
for the evidence categories used by the project.

## What works now

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

All five generated fixtures were manually opened in the tested CRUMB 1.3.5
build and produced the intended visible components. That controlled observation
and the inferred board topology apply only to the observed **CRUMB 1.3.5
Unity-era format**. It is not behavioral simulation evidence and does not
establish compatibility with a Godot-based release.

This server does **not** control a running CRUMB process, edit arbitrary
circuits, or simulate circuit behavior. CRUMB has no integration contract used
by this project for run, pause, step, stimulus, or signal reads. The honest
boundary today is the save file.

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

Requirements: a supported Node.js release listed in `package.json`.

For a published-package setup, use the pinned `npx` command shown at the top
of this README in one of the
[copyable client configurations](examples/client-configs/README.md). Set
`CIRCUITARIUM_MCP_ROOT` to the smallest directory that should contain the
circuits available to the model.

To develop or verify the server from source:

```powershell
git clone https://github.com/Craftiee/circuitarium-mcp.git
cd circuitarium-mcp
npm ci
npm run check
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
```

Read commands invoke the same registered MCP tools as the stdio server and
print the same result envelopes; only the fixture `generate`/`generate-all`
maintenance commands write directly (they support `--force`, which the MCP
surface never does).

The server confines file operations to its working directory by default. Set
`CIRCUITARIUM_MCP_ROOT` to a different absolute directory if the MCP client
should work with `.cru` files elsewhere. `ELECTRONICS_MCP_ROOT` remains a
compatibility fallback for existing installations; prefer the Circuitarium
name in new configurations.

For a concise model-host footing, use the
[minimal system prompt](examples/model-host/minimal-system-prompt.txt).

## MCP tools

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

All tools have input and output schemas. Successful tool execution and valid
domain data are separate states: a validator can return `ok: true` with
`data.valid: false`. See [the v0.2 tool contract](docs/contract.md).

File tools reject non-`.cru` paths, malformed UTF-8, byte snapshots over
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

## Project map

- `src/domain/experiment.ts` — neutral experiment schema and semantic validation
- `src/domain/contract.ts` — model-neutral v0.2 result and error envelope
- `src/domain/capabilities.ts` — callable backend registry and model workflows
- `src/adapters/crumb/` — `.cru` decoding, catalog, analysis, fixtures, and
  bounded file I/O
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
- `examples/model-host/minimal-system-prompt.txt` — compact, vendor-neutral
  operating rules for a model host
- `mcpb/` — one-click local bundle manifest and packaging notes

## Status

This is an experimental file adapter built from independently authored code,
controlled CRUMB 1.3.5 saves, non-redistributed third-party compatibility
examples, and observations of a lawfully installed version. Keep original
designs backed up, do not infer electrical behavior from unknown payloads, and
revalidate the format after every CRUMB update.

Contributions are welcome under the evidence and licensing rules in
[CONTRIBUTING.md](CONTRIBUTING.md). Report security issues using
[SECURITY.md](SECURITY.md), and use the project support channels described in
[SUPPORT.md](SUPPORT.md). The project is licensed under the
[Apache License 2.0](LICENSE).
