# Roadmap

Circuitarium MCP is intended to become a model-neutral circuit workspace, not
a model-vendor wrapper and not an unofficial replacement for any simulator.
CRUMBLE is its unofficial CRUMB-specific integration family, not the umbrella
data model. Dates are deliberately omitted until each milestone has
reproducible evidence.

## Current release: 0.3.1

This section describes the published 22-tool, nine-Resource, four-Prompt
release available from npm and as an MCPB. It includes the CRUMBLE and
Logisim-evolution adapters plus the simulator-neutral knowledge surfaces.

- Stable `electronics.mcp/0.2` result envelope and capability discovery.
- Portable experiment validation.
- Read-only CRUMBLE inspection, validation, and bounded semantic analysis for
  the observed CRUMB 1.3.5 Unity-era `.cru` format.
- Read-only, digest-guarded comparison of controlled baseline and candidate
  `.cru` files interpreted under `crumb.unity/1.3.5`, including modeled root
  and component changes.
- A small, synthetic, non-overwriting CRUMBLE fixture generator.
- Cross-model artifact handoff using workspace-relative references and SHA-256
  digests.
- Bounded MCP Resources for compatibility profiles, the CRUMBLE catalog,
  synthetic examples, electrical review, digital-logic testing, a strict
  neutral component-profile schema, and the complete 14-library/169-identity
  Logisim-evolution 4.1.0 built-in catalog.
- Deterministic, simulator-neutral verification planning from explicit claims
  and bounded caller-reported evidence, with no file access, simulator launch,
  receipt authentication, or physical certification.
- Paged CRUMBLE terminal-to-net witnesses with structured topology provenance,
  full internal terminal coverage, digest/selector-bound cursors, and explicit
  no-simulation/no-current-flow boundaries.
- User-invoked MCP Prompts for review, controlled comparison, Logisim
  verification, and cross-model handoff.
- Version-pinned Logisim-evolution 4.1.0 project discovery, strict `.circ`
  structure, explicitly partial neutral IR/netlist export, official-JAR
  project-load statistics, bounded truth tables, and test vectors.
- Deterministic `doctor --smoke` validation, executable client-configuration
  tests, cross-platform installed-package smoke checks, a compact dependency
  install, and reproducible official MCP Inspector evidence for the full tool
  surface.

The current server does not provide a live simulator session, arbitrary circuit
editing, or CRUMB 2.x/Godot compatibility. Logisim runtime calls are bounded
one-shot subprocesses.

## Next: CRUMBLE adapter boundary and CRUMB format coverage

- Make format/profile detection explicit so Unity- and Godot-era evidence
  cannot be silently mixed.
- Create a distinct CRUMBLE Godot profile only after its own controlled-save
  evidence and reopen tests exist.
- Collect minimal, controlled saves from a public Godot release when one is
  available to the project.
- Use controlled-save comparisons to expand the Unity evidence corpus.
- Validate the byte-preserving round-trip core's guarded move and removal
  operations in-game, add evidence-backed placement, and expose none of them
  publicly before their writer gates pass.
- Expand fixture generation only from independently authored controlled cases.
- Seek a documented save contract or local plugin API from the CRUMB developer.

## Portable circuit projects and conversion

- Expand detailed source-cited component profiles only when official
  documentation and independent fixtures support their attributes, logical
  ports, behavior class, and verification eligibility.
- Add a neutral component-reference Tool fallback for MCP hosts that cannot
  read Resources, with exact source identity lookup and bounded search.
- Define hierarchical components, ports, nets, parameters, firmware artifacts,
  stimuli, probes, and assertions independently of any simulator.
- Report conversion losses rather than forcing unsupported concepts into a
  destination format.
- Expand the neutral IR only with evidence-backed port and hierarchy mappings;
  preserve explicit conversion losses across Logisim and future adapters.
- Add controlled `.circ` corpora for subcircuits, buses, sequential state, and
  test-vector failure reporting without redistributing third-party designs.
- Keep Wokwi, SPICE, HDL, and other tools behind capability-negotiated
  backends or companion servers.

## Deterministic digital simulation

- Build a reference event-driven engine with logical time and delta cycles.
- Represent `0`, `1`, unknown/uninitialized, high-impedance, and contention
  states.
- Add deterministic seeds, traces, assertions, and differential tests.
- Explore compiled, GPU, and FPGA acceleration only after the reference engine
  defines semantics.

## Live application bridges

A live CRUMB bridge should begin with a developer-supported plugin or local API
that can expose project identity, lifecycle, controls, probes, and traces.
Authentication, authorization, isolation, timeouts, and auditability are
required before any remote transport is offered.

## Non-goals

- Redistributing proprietary simulator code, binaries, assets, or circuit
  designs.
- Circumventing technical protections or relying on process injection.
- Coupling the tool contract to one language-model company.
- Claiming behavioral simulation from file recognition.
- Requiring one host CPU core for every simulated logical core.
