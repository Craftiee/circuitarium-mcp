# Architecture

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
                CRUMBLE file backend
       inspect / validate / analyze / compare / fixture
           profile: crumb.unity/1.3.5
                         |
          workspace-relative .cru artifact
                + immutable SHA-256 digest
```

Only `crumb.file` is callable through this server today. It reads files; it is
not a bridge into a running CRUMB process.

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
     +-- Logisim-evolution adapter (planned)
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
   `expectedProjectDigest`.
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

The normative MCP result rules are in [contract.md](contract.md).

## Current CRUMBLE backend

The adapter currently supports:

- format-level inventory and validation;
- controlled baseline/candidate comparison with both artifact digests,
  modeled-equivalence assessment, order-sensitive opaque fingerprints, and
  bounded change pages;
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
- bounded component and connection views;
- bounded nested component, group-membership, summary, and diagnostic fields;
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
[unity-adapter-plan.md](unity-adapter-plan.md). Comparison comes before general
editing because the current semantic decoder is not a lossless XML round-trip
representation.

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
   `crumb_inspect_design`, or `crumb_validate_design`.

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

Use `.circ` as a version-pinned adapter format, not the canonical database.
Potential headless test-vector and test-circuit workflows need their own
implementation and verification. No Logisim tool is registered today.

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
