# Changelog

All notable changes will be recorded here. The project follows
[Semantic Versioning](https://semver.org/) for its public interfaces while it
remains experimental.

## [Unreleased]

### Added

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
- Read-only `crumb_compare_designs` support for digest-guarded, bounded
  comparison of controlled baseline and candidate `.cru` files under the
  `crumb.unity/1.3.5` compatibility profile.
- A Unity-first adapter plan with comparison, lossless-editing, and
  component-writer acceptance gates.

### Changed

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
- CRUMB reads are capped at 3 MiB per file, with a 5 MiB combined comparison
  cap, a 1 MiB parsed-text-node cap, a 100,000-markup-delimiter cap, and a
  64-key aggregate budget for unknown payload observations per component.
- Unity parsing now enforces UTF-8/XML 1.0 declaration rules, namespace
  well-formedness, finite decimal and signed-int32 lexical forms, exact boolean
  spellings, float32 modeling where Unity serializes single-precision values,
  and canonical thumbnail base64.
- Partial-node comparison now retains conservative `opaque-payload`
  classification alongside narrower modeled changes; unused, well-formed
  namespace declarations remain representation-neutral.

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
