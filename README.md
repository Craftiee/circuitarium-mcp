# Circuitarium MCP

[![CI](https://github.com/Craftiee/circuitarium-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Craftiee/circuitarium-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Give Claude, ChatGPT/Codex, or a local MCP-capable model a safe, typed
electronics workbench instead of asking it to guess at opaque circuit files.
Circuitarium MCP currently provides bounded, read-only analysis of Unity-era
CRUMB `.cru` saves; the longer-term neutral layer is designed to support
netlists, electrical checks, and additional simulators without making CRUMB
the universal data model.

```powershell
git clone https://github.com/Craftiee/circuitarium-mcp.git
cd circuitarium-mcp
npm ci
npm run check
```

Then connect the compiled `dist/src/server.js` stdio entrypoint using the
[model-host setup guide](docs/client-setup.md). The current boundary is file
analysis: no live CRUMB control, arbitrary editing, or circuit simulation is
claimed.

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
**B**ridge for **L**aboratory **E**lectronics. CRUMBLE reads and validates
CRUMB `.cru` save files, recognizes a version-pinned subset of CRUMB
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
  fields instead of growing without bound.
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

```powershell
git clone https://github.com/Craftiee/circuitarium-mcp.git
cd circuitarium-mcp
npm ci
npm run check
node dist/src/server.js
```

The packaged `circuitarium-mcp` command is install-smoke-tested in CI. Until
the first npm release is published, use the source-checkout instructions
above; do not assume the registry package exists yet.

Useful CLI commands:

```powershell
npm run cli -- inspect fixtures/crumb/breadboard.cru
npm run cli -- analyze fixtures/crumb/breadboard-resistor.cru components 50
npm run cli -- validate fixtures/crumb/breadboard-and-rail.cru
npm run cli -- generate breadboard my-design.cru
npm run cli -- validate-experiment examples/experiments/four-bit-counter.json
```

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
| `crumb_analyze_design` | Return bounded semantic summaries, component pages, or inferred connection pages | Reads one file |
| `crumb_inspect_design` | Return a format-level `.cru` inventory | Reads one file |
| `crumb_validate_design` | Check `.cru` structure and known invariants | Reads one file |
| `crumb_generate_fixture` | Write one synthetic, compatibility-tested fixture and return its artifact identity | Optional new file; never overwrites |

All tools have input and output schemas. Successful tool execution and valid
domain data are separate states: a validator can return `ok: true` with
`data.valid: false`. See [the v0.2 tool contract](docs/contract.md).

File tools reject non-`.cru` paths, files over 64 MiB, paths outside the root
selected by `CIRCUITARIUM_MCP_ROOT` (or the legacy fallback), and overwrite
attempts. Artifact references in results are workspace-relative rather than
leaked absolute paths. Artifact metadata uses `adapterTestedCompatibility` to
describe the adapter evidence; it does not claim that an arbitrary input file
was created or tested in that CRUMB build.

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
- `docs/client-setup.md` — ChatGPT/Codex, Claude, API, and local-model routes
- `docs/release-checklist.md` — local and GitHub publication gates
- `ROADMAP.md` — adapter, portable project, simulation, and live-bridge stages
- `CHANGELOG.md` — public interface and release history
- `examples/model-host/minimal-system-prompt.txt` — compact, vendor-neutral
  operating rules for a model host

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
