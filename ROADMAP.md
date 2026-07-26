# Roadmap

Circuitarium MCP is intended to become a model-neutral circuit workspace, not
a model-vendor wrapper and not an unofficial replacement for any simulator.
CRUMBLE is its unofficial CRUMB-specific integration family, not the umbrella
data model. Dates are deliberately omitted until each milestone has
reproducible evidence.

## Current: public alpha

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

The current server does not provide live simulation, arbitrary circuit editing,
or CRUMB 2.x/Godot compatibility.

## Next: CRUMBLE adapter boundary and CRUMB format coverage

- Make format/profile detection explicit so Unity- and Godot-era evidence
  cannot be silently mixed.
- Create a distinct CRUMBLE Godot profile only after its own controlled-save
  evidence and reopen tests exist.
- Collect minimal, controlled saves from a public Godot release when one is
  available to the project.
- Use controlled-save comparisons to expand the Unity evidence corpus.
- Add a lossless no-op round-trip representation that preserves unknown fields
  before enabling general editing.
- Expand fixture generation only from independently authored controlled cases.
- Seek a documented save contract or local plugin API from the CRUMB developer.

## Portable circuit projects and conversion

- Define hierarchical components, ports, nets, parameters, firmware artifacts,
  stimuli, probes, and assertions independently of any simulator.
- Report conversion losses rather than forcing unsupported concepts into a
  destination format.
- Add a version-pinned Logisim-evolution adapter.
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
