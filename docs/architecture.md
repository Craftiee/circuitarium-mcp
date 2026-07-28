# Architecture

> This document describes the Unreleased 0.3.0 source tree. The published
> 0.2.1 npm package and MCPB remain the 14-tool CRUMBLE release without the
> Logisim-evolution adapter.

## Decision

Keep the model host, MCP contract, portable electronics model, and
application-specific backends separate. Do not make a model vendor or one
simulator's file format the center of the system.

Circuitarium MCP is the simulator-neutral umbrella. CRUMBLE — Circuit
Representation & Universal Model Bridge for Laboratory Electronics — is its
unofficial CRUMB-specific ruleset and integration family.

The implemented boundary is intentionally small:

```text
ChatGPT / Codex / Claude / local agent host
                         |
                   local MCP stdio
                         |
          Circuitarium MCP contract v0.2
              | capabilities | validation |
                         |
          +--------------+------------------+
          |                                 |
   CRUMBLE file backend          Logisim-evolution adapter
 inspect / compare / ERC         static .circ -> partial IR
 profile: crumb.unity/1.3.5      stats / table / test vector
          |                      profile: 4.1.0 + Java 21
          +--------------+------------------+
                         |
       workspace-relative artifact + immutable SHA-256 digest
```

`crumb.file` and `logisim.evolution` are callable through this server. No tool
modifies an input circuit. One tool can create only one of five fixed
synthetic CRUMB fixtures and never overwrites. Three Logisim tools launch a
bounded, one-shot configured-JAR subprocess; upstream Logisim may update its
per-user Java preferences, so those tools advertise `readOnlyHint: false`.
None is a bridge into a running GUI process. Runtime output is labeled
separately from static file evidence. The user-supplied JAR must self-report
4.1.0; that response is not proof that it is the official binary.

The branding boundary does not change protocol identity. Neutral tools retain
the `electronics_*` namespace, CRUMB-specific tools retain `crumb_*`, and the
result contract remains `electronics.mcp/0.2`. Stable descriptive identifiers
keep existing clients and model handoffs compatible as new Circuitarium
integrations are added.

The target system can add backends without changing which model is in charge:

```text
Model hosts
     |
Model-neutral MCP contract
     |
Portable project / experiments / artifacts
     |
     +-- CRUMBLE / CRUMB file adapter (callable now)
     +-- Wokwi cloud companion (external, separate server)
     +-- Logisim-evolution adapter (callable static + optional JAR runtime)
     +-- deterministic digital engine (planned)
     +-- SPICE / Verilator / GPU / FPGA tiers (research roadmap)
```

## Architectural invariants

1. **Model host is not backend.** Claude and OpenAI are callers; CRUMB, Wokwi,
   Logisim, and future engines are electronics backends.
2. **Capabilities are discovered, not assumed.** A model calls
   `electronics_capabilities` and uses only backends marked callable.
3. **Execution success differs from design validity.** A validator that ran
   correctly can return `ok: true` and `data.valid: false`.
4. **Artifacts cross process boundaries; sessions do not.** Stdio server state
   is process-scoped. Cross-model handoff uses a workspace-relative reference
   and SHA-256 digest. Continued reads pass that identity as
   `expectedProjectDigest`; controlled comparisons guard baseline and candidate
   independently.
5. **Fidelity and losses are explicit.** Unknown CRUMB payloads are inventoried,
   not guessed into canonical electrical behavior.
6. **Compatibility evidence is explicit.** An adapter reports the versioned
   interpretation profile it applied. A profile is not automatic detection of
   the file's originating application build.
7. **Large reads are bounded.** Summary-first analysis and paged detail protect
   smaller model context windows. Detail responses return an opaque,
   project-digest-and-view-bound `page.nextCursor`; callers pass it back as
   `cursor`.
8. **Sensitive and user-authored payloads are bounded.** Firmware/source text
   is opt-in and capped. EEPROM images remain metadata-only. Save names and
   labels return untrusted previews capped at 160 characters. Component,
   connection, summary, and diagnostic collections have explicit nested
   limits and truncation metadata. Digests support recognition without
   returning whole payloads.
9. **Local backend is not a privacy claim about the host.** CRUMB filesystem
   access happens locally, but a cloud MCP client or model host may receive the
   returned data. Capability discovery therefore reports
   `dataLeavesMachine: "depends"`.
10. **Static load and simulation are distinct evidence classes.** Parsing
    `.circ` XML proves structure; `--tty stats` proves the configured JAR loaded
    the project; truth tables and vectors provide bounded behavioral evidence
    only for the exact artifact digest and selected circuit. Runtime execution
    uses the exact already-read byte snapshot, not a second read of the caller's
    path. A 4.1.0 self-report is compatibility evidence, not binary or publisher
    authentication.

## Current Logisim-evolution backend

The adapter is pinned to `logisim-evolution/4.1.0` and has two independent
layers:

- a strict, streaming `.circ` reader that rejects DTDs/entities, malformed
  UTF-8, hostile XML work, and workspace escape;
- a shell-free Java runner for Logisim's documented `--tty stats`,
  `--tty table,csv,binary`, and `--test-vector` modes.

Static conversion targets `circuitarium.project-ir/0.1`. Its netlist is always
marked partial because the clean-room reader does not guess every built-in
component's port geometry, mid-wire junction behavior, timing, or state.
Conversion losses are first-class data rather than hidden assumptions.

The runtime JAR is user-supplied and probed for an exact self-reported version
of 4.1.0. That probe is not publisher or digest authentication. Before launch,
a full-stream safety preflight defaults to denial for external file/JAR
libraries, VHDL, path-bearing or unsafe runtime features, and unknown or
malformed constructs. Accepted project/vector snapshots are staged byte for
byte under private fixed-name temporary files and removed after success or
failure. For non-TTY test-vector startup, the configured JAR is copied into
that directory before its probe and operation so Logisim cannot discover
`logisim-defaults` beside the configured source JAR.

Java processes use argument-array invocation without a shell, an allowlisted
environment, timeouts, output byte caps, and forced termination. Compatibility
probes use a preference-free headless early-exit command. Project execution
forces English output but may update Logisim's per-user Java preferences.
Logisim 4.1.0 test-vector mode also initializes AWT: on Linux the host must
provide a trusted X11 `DISPLAY` (normally through Xvfb on a display-less
server), while Circuitarium continues to spawn Java directly and does not
manage that display. Public Logisim result strings are limited to 4,096
characters, and the aggregate
serialized envelope is limited to 2 MiB. These controls reduce project-driven
risk; they are not an operating-system sandbox or a malicious-JAR boundary.
Circuitarium neither bundles nor links Logisim-evolution, and it controls no
persistent session. CI alone downloads the upstream official v4.1.0 asset and
verifies its pinned SHA-256 for E2E coverage. See [logisim.md](logisim.md).

The normative MCP result rules are in [contract.md](contract.md).

## Current CRUMBLE backend

The adapter currently supports:

- workspace discovery with stable file snapshots, sizes, timestamps, and
  exact-byte digests;
- format-level inventory and validation;
- controlled baseline/candidate comparison with both artifact digests,
  modeled-equivalence assessment, order-sensitive opaque fingerprints, and
  bounded change pages;
- focused single-component reads with bounded firmware-source windows;
- semantic recognition for 18 observed tool-ID signatures (`0..15`, `20`,
  `24`);
- typed component parameters with units and confidence;
- machine-readable evidence meanings and redistribution boundaries for every
  catalog confidence value;
- 21 installed-build tool-5 DIP prefab variants with ordered pin labels and
  explicit complete, partial, or unresolved pin-name coverage;
- an exact 2,048-byte, metadata-only prefab-13 EEPROM image signature;
- installed-build settings and terminal order for power, tactile/slide/DIP
  switches, potentiometers, labels, and seven-segment displays;
- untrusted, 160-character-bounded label previews;
- untrusted, 160-character-bounded design-name previews;
- terminal attachments;
- explicit jumper connectivity;
- inferred main-board and detached-rail connectivity under
  `known-board-v1.3.5`;
- jumper-collapsed netlist export with deterministic supply naming and optional
  saved slide/DIP-switch connectivity, including bounded provenance;
- static electrical rule checks for evidence-supported supply shorts, bypassed
  parts, LED series resistance, resistor power, floating IC power pins, and
  floating terminals;
- bill-of-materials grouping by decoded part identity and version-pinned IC
  package/pin reference queries;
- bounded component and connection views;
- bounded nested component, group-membership, summary, and diagnostic fields;
- a private byte-preserving round-trip foundation that retains exact source
  bytes and opaque payload spans, applies digest-guarded minimal patches, and
  revalidates every replacement artifact; and
- five non-overwriting synthetic, compatibility-tested fixtures.

The inferred board rules are pinned to the observed CRUMB 1.3.5 Unity-era save
format. `direct-only` analysis avoids those hidden board-bus assumptions.
Neither mode simulates voltage, current, timing, firmware, or component
behavior. Recognizing an IC label and its package pins does not simulate that
device's logic or analog behavior. Likewise, decoding a saved switch position,
supply voltage, EEPROM digest, or display setting does not apply or execute it.
No claim is made for later Godot-based CRUMB releases until controlled saves
establish compatibility under a separate CRUMBLE profile.

Every CRUMB result identifies the applied interpretation as
`compatibilityProfile: "crumb.unity/1.3.5"`. This describes the evidence used
by the adapter; it does not detect or certify the build that created an
arbitrary input. A future Godot adapter must use a separate profile and
evidence corpus while retaining the neutral MCP contract and stable `crumb_*`
tool namespace.

### Validation-corpus evidence

The developer 8-bit CPU analyzed with 764/764 components recognized, 362
inferred connection groups, five EEPROM images redacted to metadata, and 32
labels bounded to untrusted previews. The Bridge Rectifier analyzed with 20/20
components recognized and six groups.

Both group counts use `known-board-v1.3.5`, and neither run executed circuit
behavior. The external inputs are not redistributed or run in public CI; their
official publication links and SHA-256 identities are recorded in
[PROVENANCE.md](../PROVENANCE.md).

CRUMB live run/pause/step/read tools require a supported bridge. The preferred
route is developer cooperation or a documented plugin/local API. GUI automation
can help acceptance-test generated files, but it is not a stable simulation
contract.

The staged Unity editing design and writer-evidence gates are documented in
[unity-adapter-plan.md](unity-adapter-plan.md). The semantic decoder remains a
read model rather than a lossless serializer. The separate internal round-trip
layer closes that preservation gap for future guarded operations, but no public
general editor or placement tool is exposed.

### Distribution and verification boundary

A tagged source checkout and its same-version npm artifact expose the same
stdio server and tool envelopes. The Unreleased 0.3.0 source tree intentionally
differs from the published 14-tool 0.2.1 artifact until 0.3.0 is released. The
npm package supports only the `circuitarium-mcp` executable; source exports
used internally by the repository are not a JavaScript compatibility promise.
Packaging is allowlisted and verified from an isolated packed tarball: CI
installs that exact artifact in a clean consumer and completes an MCP handshake
through the packaged executable. Pull requests additionally run the supported
Node/OS matrix, lint, coverage, dependency review, CodeQL, and deterministic
fixture verification. These gates establish build and packaging integrity;
they do not add CRUMB-runtime or live-session capabilities.

## Why a neutral electronics layer matters

CRUMB is useful as a tactile visual electronics workspace. Wokwi is oriented
toward MCU firmware and interactive peripherals. Logisim is useful for
educational digital logic and deterministic test vectors. SPICE-class solvers
model analog voltage/current behavior. Verilator and FPGA execution trade edit
latency and observability for throughput.

Making any one format the source of truth would import its limitations into
every backend. A future canonical project model should instead store:

- hierarchical components with stable IDs, parameters, models, and ports;
- nets with widths, drivers, resolution rules, and clock domains;
- firmware and generated artifacts by digest;
- stimuli, probes, assertions, and traces;
- explicit fidelity and deterministic execution settings;
- adapter provenance and loss reports during conversion.

The present neutral experiment validator is a footing for that design. A
general project editor and converters are not implemented yet.

## Cross-model and process behavior

Claude Code and Codex can point at the same server entrypoint and workspace, but
each stdio host normally launches a separate Node.js process. A
`serverInstanceId` therefore identifies only one process lifetime. It is not a
portable collaboration ID.

For a safe handoff:

1. retain the workspace-relative `projectRef`;
2. retain `context.projectDigest`;
3. retain backend `crumb.file` and adapter version `crumb.file/0.2`;
4. retain compatibility profile `crumb.unity/1.3.5`;
5. state whether connection inference used `direct-only` or
   `known-board-v1.3.5`;
6. have the receiving model pass the recorded digest as
   `expectedProjectDigest` on `crumb_analyze_design`,
   `crumb_inspect_design`, `crumb_validate_design`, `crumb_get_component`,
   `crumb_bom`, `crumb_export_netlist`, or `crumb_check_design`.

For a controlled comparison, retain both artifact references and digests, then
pass them as `expectedBaselineDigest` and `expectedCandidateDigest`. A
comparison cursor is bound to both identities and its view options.

If the digest changed, the read returns `ok: false` with
`error.code: "PROJECT_STATE_CONFLICT"` because earlier findings describe a
different artifact. Re-analyze without the expectation only after acknowledging
and reviewing that change. A future shared remote service could introduce
durable projects and authenticated sessions, but the current stdio server does
not.

## Logical scale: “one-to-one, but slower”

A host with 8 physical cores can simulate a 16-core CPU. Simulated concurrency
does not require one host core per simulated core. The host schedules state
transitions and may take many wall-clock seconds to produce one millisecond of
simulated time.

The one-to-one property should mean **logical equivalence**, not real-time speed:

- architectural state changes on the same simulated clock edges;
- combinational logic reaches the same fixed point;
- defined delays and event ordering are preserved;
- the same inputs and seed yield the same trace.

Pacing is then a separate choice:

- `as-fast-as-possible`
- `real-time`
- `fixed-ratio`

This is a design goal for a future execution engine, not functionality in the
current MCP.

## Backend roadmap

### Wokwi

Run Wokwi's own MCP as a separate companion initially. It is not callable
through this server. Wokwi's cloud service, account, token, data handling, and
capabilities remain separate from the local `crumb.file` backend.

### Logisim-evolution

The Unreleased 0.3.0 source tree registers six version-pinned Logisim tools:
three static `.circ`/partial-IR tools and three bounded configured-JAR
execution tools. The configured JAR must self-report 4.1.0 but is not
authenticated as the official asset. `.circ` remains an adapter format rather
than the canonical database, and every runtime request is a one-shot subprocess
rather than a live session. The next work is broader controlled coverage for
subcircuits, buses, sequential state, and explicit conversion losses.

### Deterministic digital engine

A future golden engine can use an event-driven dirty-fanout queue:

1. apply input changes at logical time `(tick, delta)`;
2. evaluate dirty combinational nodes;
3. repeat until a fixed point or oscillation limit;
4. commit sequential state on explicit clock edges;
5. record probes and assertions.

It should preserve at least `0`, `1`, unknown/uninitialized, high-impedance, and
contention states. This reference engine would define semantics before compiled
or hardware acceleration is attempted.

### Compiled, GPU, FPGA, and analog tiers

- Verilator can accelerate a supported synchronous subset, with differential
  tests against the golden engine.
- GPU execution is promising for regular batched workloads, not automatically
  for one sparse branch-heavy event queue.
- FPGA execution can provide throughput for stable synchronous designs but has
  long build times and lower observability.
- Analog and mixed-signal circuits require SPICE-like solving and explicit
  digital/analog boundary policies.

All four are research roadmap items.

## Future session contract

Live backends may eventually justify tools for creating, running, pausing,
stepping, resetting, and destroying simulations; reading serial and signals;
setting controls; collecting traces; and creating snapshots. Such tools must
return backend/model versions, project digest, seed, fidelity, state, and logical
time.

Those tools are intentionally absent until a real backend can honor them. The
current server must not advertise a session merely because MCP itself has a
client/server connection.

## Revisit later

- canonical multi-value logic and drive-strength rules;
- analog/digital co-simulation timestep policy;
- component-library licensing and model provenance;
- neutral project editing and conversion loss reports;
- a documented CRUMB bridge or Godot-format compatibility evidence;
- durable authenticated session service requirements;
- benchmark thresholds for event, compiled, GPU, and FPGA tiers.
