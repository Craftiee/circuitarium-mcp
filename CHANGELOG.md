# Changelog

All notable changes will be recorded here. The project follows
[Semantic Versioning](https://semver.org/) for its public interfaces while it
remains experimental.

## [Unreleased]

### Added

- Added nine deterministic, read-only MCP Resources for capability
  orientation, version-pinned profiles, the CRUMBLE catalog, synthetic
  examples, low-voltage review, digital-logic test planning, a strict
  source-cited neutral component-profile schema, and a commit-pinned
  Logisim-evolution 4.1.0 standard-library catalog. The Logisim catalog records
  all 14 built-in libraries and 169 exact component identities while keeping
  158 entries explicitly identity-only.
- Added four bounded MCP Prompts for circuit review, controlled CRUMB
  comparison, Logisim verification, and digest-guarded cross-model handoff,
  with installed-package and MCPB protocol smoke tests.
- Added the experimental `logisim.evolution` backend pinned to
  Logisim-evolution 4.1.0, bringing the registered surface to 20 tools.
- Added `logisim_list_projects`, `logisim_analyze_design`, and
  `logisim_export_netlist` for containment-checked `.circ` discovery, hardened
  XML structure, and explicitly partial `circuitarium.project-ir/0.1`
  coordinate netlists with machine-readable conversion losses.
- Added `logisim_component_stats`, `logisim_truth_table`, and
  `logisim_run_test_vector`, which invoke a configured, user-supplied JAR that
  self-reports 4.1.0 through shell-free, timeout- and output-bounded Java
  subprocesses. Runtime evidence labels that self-report as unauthenticated;
  project-load, static, and simulation evidence are distinguished explicitly.
- Added an independently authored one-bit full-adder `.circ` project and 8/8
  passing vector, plus a pinned official-JAR CI job that verifies the release
  asset SHA-256 and all six MCP envelopes.
- Added optional MCPB selectors for the Logisim JAR and Java executable, a
  Logisim adapter/security guide, CLI parity commands, parser/runtime unit
  tests, and public setup documentation.
- Added `electronics_plan_verification`, a pure deterministic planner for
  explicit artifact, topology, ERC, runtime, behavior, conversion, and
  physical claims. It returns digest- and locus-bound evidence requirements,
  ordered steps, bounded test suggestions, and gaps; claimed exhaustive
  coverage is checked against the declared interface and vector distinctness.
  The planner does not read files, invoke tools, authenticate caller receipts,
  or certify hardware.
- Added `crumb_trace_net`, bringing the source surface to 22 tools. It selects
  a terminal by component ID and zero-based index and pages a deterministic
  conductive witness with structured attachment, board-topology, jumper, and
  optional persisted-switch provenance.

### Fixed

- Make verification-plan canonicalization locale-independent, and stop an
  unknown Logisim runtime plan after capability discovery until the caller
  records the exact status and replans.
- Permit a zero-input circuit with one or more uniquely labeled output Pins to
  produce its single-row Logisim truth table.
- Refuse `logisim_truth_table` when an output Pin label normalizes to the
  reserved label `halt` under Logisim-evolution 4.1.0's TTY label rules (for
  example, `halt!`), because that label selects run-until-halt behavior rather
  than ordinary combinational-table semantics.
- Report `convert: false` for the Logisim backend until a general guarded
  conversion operation exists; partial neutral-IR export remains available
  and explicitly loss-marked.

### Security

- Reject Logisim DTD/entity declarations, malformed UTF-8, hostile XML work,
  workspace escape, symlink/reparse traversal, oversized project/vector
  artifacts, child-process timeouts, and stdout/stderr floods.
- Added a full-stream, default-deny runtime preflight for external file/JAR
  libraries, VHDL, unsafe or path-bearing runtime features, and
  unknown/malformed constructs.
- Stage exact already-read project/vector bytes under private fixed-name
  temporary files, remove them after success or failure, and launch Java
  without a shell using an allowlisted environment.
- Isolate test-vector startup from executable-directory defaults by copying
  the configured JAR under a fixed name in that same private directory before
  its version probe and vector run.
- Reuse each operation's immediately preceding version probe as runtime
  evidence, so each runtime tool launches one probe and one operation process
  without weakening the 4.1.0 pin.
- Make version probes preference-free with a headless, early-exit TTY command,
  while marking all three project-execution tools non-read-only because
  Logisim may update per-user Java preferences when forcing deterministic
  English output.
- Detect Logisim 4.1.0's Linux test-vector X11 requirement before launch,
  forward only host-provided `DISPLAY`/`XAUTHORITY`, run official-JAR CI under
  Xvfb, and include bounded path-redacted subprocess context when vector output
  is malformed.
- Bound every public Logisim result string to 4,096 characters and the
  aggregate serialized result envelope to 2 MiB.
- Bound CRUMB net-trace construction to 50,000 graph nodes and 100,000 edges,
  use hub nodes instead of pairwise same-hole cliques, bind cursors to the
  exact digest/root/options/traversal version, and fail closed without a
  partial trace when a work limit is exceeded.
- Bound test-vector receipts to an exact vector reference and digest, reject
  invalid claim/scope pairs and mixed vector identities, propagate failed
  supporting or unsafe-runtime evidence, and support the single exhaustive row
  of a zero-input combinational circuit.
- Corrected source-cited profile guidance for Logisim level-triggered D
  flip-flops/registers and Active On High LEDs, and made the structural JSON
  Schema's additional uniqueness/cross-reference constraints explicit.
- Document that these controls reduce project-driven risk but do not provide an
  operating-system sandbox or protect against a malicious configured JAR.

## [0.2.1] - 2026-07-28

### Added

- Added a protocol-safe public launcher with `--help`, `--version`, strict
  argument handling, and a responsive plain-ASCII status panel for direct TTY
  launches. MCP-host launches remain silent outside JSON-RPC because the panel
  is emitted only to an attached terminal's stderr.
- Added a named package/startup audit that reports compressed and unpacked
  size, file count, installed MCP initialization and tool-list timings, tool
  count, and piped-stderr cleanliness against explicit release budgets.

### Changed

- Removed the repository demo GIF from the installable npm tarball while
  retaining it in GitHub and loading it from there in the packaged README.
- Prepared the release workflow for tokenless npm trusted publishing by
  pinning an OIDC-capable npm CLI, removing the bootstrap-token injection, and
  requiring SLSA v1 provenance metadata after publication.

## [0.2.0] - 2026-07-28

### Added

- Uniform `electronics.mcp/0.2` result envelopes and capability discovery.
- Portable experiment validation.
- CRUMB 1.3.5 Unity-era file inspection, validation, and bounded semantic
  analysis.
- Version-pinned component and IC catalogs.
- Five synthetic CRUMB fixtures.
- Cross-model handoff guards using project digests.
- Default source redaction and bounded handling for EEPROM and annotation data.
- Six new read-only CRUMB tools: `crumb_list_projects` (workspace discovery
  with digests), `crumb_get_component` (single-component detail with windowed
  firmware source), `crumb_export_netlist` (jumper-collapsed nets with
  `VCC`/`GND` naming and optional saved-switch-state merges),
  `crumb_check_design` (static electrical rule checks with evidence-tagged
  findings), `crumb_bom` (bill of materials by decoded part identity), and
  `crumb_ic_reference` (IC pinout lookup by prefab id or label query).
- A fourteenth tool, `crumb_compare_designs`, performs digest-guarded,
  read-only comparison of controlled baseline and candidate `.cru` files under
  `crumb.unity/1.3.5`. It reports bounded root/component changes, distinguishes
  byte identity from modeled equivalence, retains opaque-change evidence
  without disclosing payloads, and never writes either input.
- A Unity-first adapter plan with comparison, lossless-editing, and
  component-writer acceptance gates.
- New `review-crumb-design` and `identify-ic-pinout` capability workflows and a
  `net` vocabulary entry.
- Semantic-analysis diagnostics for duplicate component ids and for
  schema-mismatched structural/interconnect components that still shape
  topology inference.
- Experiment validation now rejects one pin appearing on two nets
  (`endpoint-net-conflict`) and warns when a probe targets an endpoint on no
  net (`probe-endpoint-unconnected`).
- A documented error-code table (including fixed file, comparison, and parser
  budgets mapped to `QUOTA_EXCEEDED`) in the contract.
- Adversarial-review hardening: project digests hash the raw file bytes (not
  the decoded text), electrical rules and net naming consult a full
  pre-truncation terminal index so oversized nets cannot hide shorts, ERC
  finding id lists are bounded to the published schema, supply rules are
  evaluated per supply with a separate `cross-supply-rail-tie` info finding,
  shorted signal generators are reported (`source-terminals-shorted`),
  findings on switch-merged nets state their conditionality, per-component
  diagnostics match exact path segments, and workspace-listing digests stop
  at a per-call byte budget (`digest-budget-exhausted`).
- Cross-review follow-up hardening: single oversized connection groups retain
  complete internal terminal membership for netlist/ERC, focused component
  reads cannot disappear past response bounds, switch provenance survives
  later unions and carries explicit truncation metadata, mixed supply roles
  stay deterministically unnamed, and pagination cursors bind topology and
  switch-state options.
- Known typed payloads now fail atomically on malformed vectors, quaternions,
  tie points, boolean arrays, and scalar lexical forms instead of silently
  losing terminals or parameters. XML work limits cap depth, element count,
  component count, and per-component payload count before analysis.
- Workspace enumeration now streams directory entries under a tested scan
  quota, directly tests symlink and containment behavior, and returns digest,
  size, and modification time from one stable opened snapshot.
- Neutral endpoint identity now uses collision-free tuples, so colons in
  component IDs or pin names cannot create false net conflicts.
- A byte-preserving CRUMB round-trip core now retains unknown payloads and
  lexical XML exactly, indexes edits by guarded byte span, validates every
  replacement artifact, and documents canonical spellings for future mutation
  tools. Public write tools remain disabled pending in-game reopen evidence.
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
- An installable `circuitarium-mcp` executable with an allowlisted artifact,
  installed-package MCP handshakes, and release-version coherence checks. The
  binary is the only supported package API in this release.
- Official-Registry metadata through matching `mcpName` and `server.json`
  identities.
- A manifest-v0.3 MCPB bundle for one-click Claude Desktop installation, built
  from the exact verified npm tarball and smoke-tested through all 14 tool
  registrations plus a synthetic ERC call.
- An `npx`-first onboarding path with copyable Codex, Claude Code, VS Code,
  LM Studio, and Jan configurations and a reproducible terminal GIF generated
  only from live synthetic-fixture output.
- SHA-pinned CI, package/coverage gates, dependency review, CodeQL scanning,
  and a protected tag-driven release workflow that publishes verified bytes to
  npm before registering the server with the MCP Registry and creating a
  GitHub Release.
- A controlled-observation issue form for community CRUMB format evidence.

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
- Pull-request CI no longer duplicates branch-push and pull-request matrices;
  macOS compatibility coverage and a non-blocking current-Node canary are
  included.
- The executable package publishes the MCP SDK's bundled, shrinkwrapped,
  audited dependency tree so consumers retain the security override used by
  repository CI.
- Release packaging builds and prepares bundled runtime metadata only inside
  per-run isolated staging and tarball workspaces.
- Unity parsing now enforces valid UTF-8 and XML 1.0 declarations, namespace
  well-formedness, finite decimal and signed-int32 lexical forms, exact boolean
  spellings, float32 modeling where Unity serializes single-precision values,
  and canonical thumbnail base64.
- Stable CRUMB byte reads are capped at 64 MiB, semantic XML documents at
  3,145,728 characters, and comparison pairs at 5 MiB combined, with a 1 MiB
  parsed-text-node cap, a 100,000-markup-delimiter cap, and a 64-key aggregate
  budget for unknown payload observations per component.
- Partial-node comparison retains conservative `opaque-payload`
  classification alongside narrower modeled changes; unused, well-formed
  namespace declarations remain representation-neutral.
