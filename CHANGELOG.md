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
- An installable `circuitarium-mcp` package entrypoint with an allowlisted
  artifact, installed-package MCP handshake, and release-version coherence
  checks.
- SHA-pinned CI, package/coverage gates, dependency review, CodeQL scanning,
  and a protected tag-driven npm publication workflow.
- A controlled-observation issue form for community CRUMB format evidence.

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
- Pull-request CI no longer duplicates branch-push and pull-request matrices;
  macOS compatibility coverage and a non-blocking current-Node canary are
  included.
- The executable package publishes the MCP SDK's bundled, shrinkwrapped,
  audited dependency tree so consumers retain the security override used by
  repository CI.
- Release packaging builds and prepares bundled runtime metadata only inside
  per-run isolated staging and tarball workspaces.

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
