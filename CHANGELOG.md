# Changelog

All notable changes will be recorded here. The project follows
[Semantic Versioning](https://semver.org/) for its public interfaces while it
remains experimental.

## [Unreleased]

### Added

- Six new read-only CRUMB tools: `crumb_list_projects` (workspace discovery
  with digests), `crumb_get_component` (single-component detail with windowed
  firmware source), `crumb_export_netlist` (jumper-collapsed nets with
  `VCC`/`GND` naming and optional saved-switch-state merges),
  `crumb_check_design` (static electrical rule checks with evidence-tagged
  findings), `crumb_bom` (bill of materials by decoded part identity), and
  `crumb_ic_reference` (IC pinout lookup by prefab id or label query).
- New `review-crumb-design` and `identify-ic-pinout` capability workflows and a
  `net` vocabulary entry.
- Semantic-analysis diagnostics for duplicate component ids and for
  schema-mismatched structural/interconnect components that still shape
  topology inference.
- Experiment validation now rejects one pin appearing on two nets
  (`endpoint-net-conflict`) and warns when a probe targets an endpoint on no
  net (`probe-endpoint-unconnected`).
- A documented error-code table (including the 64 MiB `QUOTA_EXCEEDED`
  mapping) in the contract.
- Adversarial-review hardening: project digests hash the raw file bytes (not
  the decoded text), electrical rules and net naming consult a full
  pre-truncation terminal index so oversized nets cannot hide shorts, ERC
  finding id lists are bounded to the published schema, supply rules are
  evaluated per supply with a separate `cross-supply-rail-tie` info finding,
  shorted signal generators are reported (`source-terminals-shorted`),
  findings on switch-merged nets state their conditionality, per-component
  diagnostics match exact path segments, and workspace-listing digests stop
  at a per-call byte budget (`digest-budget-exhausted`).
- Circuitarium MCP umbrella branding and the CRUMBLE identity for
  CRUMB-specific integrations.
- A CRUMBLE integration guide documenting evidence profiles, stable protocol
  identifiers, and redistribution boundaries.
- Apache-2.0 licensing and public contribution, security, conduct, support, and
  provenance policies.
- Public-repository CI and collaboration templates.
- Explicit unofficial-project and non-redistribution notices.
- Portable MCP client setup examples.
- A non-destructive fixture verification workflow.
- Machine-readable compatibility profiles and evidence vocabulary.
- Explicit truncation metadata for untrusted design names, nested component
  data, connection membership, summaries, and diagnostics.
- Typed `INVALID_ARGUMENT` envelopes for malformed registered-tool calls while
  retaining strict published input schemas.

### Changed

- The CLI's read commands now invoke the same registered MCP tools as the
  stdio server and print identical result envelopes; new `list`, `component`,
  `netlist`, `check`, `bom`, and `ic` commands were added. Only the fixture
  `generate`/`generate-all` maintenance commands still write directly and
  accept `--force`.
- Error classification uses typed error classes instead of message-substring
  matching, so reworded messages can no longer silently downgrade
  `PATH_DENIED`, `UNSUPPORTED_FORMAT`, or `FORMAT_INVALID` to
  `INTERNAL_ERROR`. Oversized files now return `QUOTA_EXCEEDED` instead of an
  internal error, and non-file paths return `NOT_FOUND`.
- `crumb_inspect_design` and `crumb_validate_design` check
  `expectedProjectDigest` before any parse work, matching
  `crumb_analyze_design`.
- Diagnostic truncation is now severity-aware: when more than 200 diagnostics
  exist, errors are retained ahead of earlier warnings.
- Tool results serialize the envelope compactly in text content
  (`structuredContent` is unchanged), roughly halving per-call token cost.
- `serializeCru` validates its own output by default and throws on
  structurally invalid saves.
- The fixture-kind enum is defined once and shared by input and output
  schemas, so an unregistered kind can no longer pass input validation and
  fail after writing a file.
- An invalid 28C16 EEPROM image no longer emits a misleading generic
  payload-schema-mismatch diagnostic; the specific `invalid-eeprom-image`
  diagnostic and an explanatory component note remain.
- Connection-group inference uses an iterative union-find, removing a
  stack-exhaustion risk on adversarial saves.
- `scripts/verify-fixtures.ts` resolves the fixture directory relative to the
  script location instead of the current working directory, and the test glob
  is recursive.
- The primary workspace variable is now `CIRCUITARIUM_MCP_ROOT`;
  `ELECTRONICS_MCP_ROOT` remains a compatibility fallback.
- Existing `electronics_*`, `crumb_*`, and `electronics.mcp/0.2` identifiers
  remain stable across the branding change.
- Compatibility claims now distinguish controlled saves, synthetic fixtures,
  installed-build observations, public electronics knowledge, and
  non-redistributed third-party examples.
- Artifact metadata now uses `adapterTestedCompatibility` so adapter evidence
  cannot be mistaken for an input-file origin claim.
- Local-backend data egress is reported as host-dependent, and fixed fixture
  generation is distinguished from general circuit building.

## [0.2.0] - 2026-07-25

### Added

- Uniform `electronics.mcp/0.2` result envelopes and capability discovery.
- Portable experiment validation.
- CRUMB 1.3.5 Unity-era file inspection, validation, and bounded semantic
  analysis.
- Version-pinned component and IC catalogs.
- Five synthetic CRUMB fixtures.
- Cross-model handoff guards using project digests.
- Default source redaction and bounded handling for EEPROM and annotation data.
