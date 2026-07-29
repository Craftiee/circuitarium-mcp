# ADR 0001: Universal engineering run record

- Status: Accepted
- Date: 2026-07-29
- Decision owners: Circuitarium maintainers

## Context

Circuitarium can already inspect CRUMB and Logisim artifacts, plan verification,
and return digest-bound evidence. Those results are useful individually, but
they do not yet form one durable process record that can follow a design from
plain-language intent through HDL, implementation, physical verification, and
fabrication handoff.

The record must work across model hosts and simulator adapters. It must also
preserve the difference between a plan, an executed activity, an observed
result, an engineering verdict, and a human signoff. A successful subprocess,
a clean parser result, or a self-contained hash must never silently become a
claim that a design is correct, safe, authentic, or ready to fabricate.

## Decision

Adopt `electronics.run-record/0.1` as a strict, bounded, sealed snapshot with:

- a simulator-neutral core for intent, stages, tool identities, immutable
  artifacts, activities, claims, evidence, diagnostics, risks, signoffs, and
  provenance;
- adapter-specific data in bounded reverse-domain extensions;
- ordered stages and activities with explicit dependency edges;
- separate process status, engineering outcome, claim verdict, evidence basis,
  and signoff status;
- a versioned canonical JSON profile;
- `evidenceDigest`, covering normalized portable content only;
- `recordDigest`, covering the normalized record except its seal; and
- an explicit `unsigned-unverified` authenticity value.

The first public operation is the pure
`electronics_validate_run_record` Tool. It validates, normalizes, and seals a
caller-supplied snapshot. It does not execute any recorded activity. External
serialized JSON can be supplied through `serializedRecord`, which is scanned
for duplicate keys and other ambiguous syntax before ordinary JSON parsing.

A sealed snapshot is the handoff format. A future event stream may refer to
sealed snapshots, but it will not replace or mutate them.

## Options considered

### One monolithic Circuitarium schema

A monolith is easy to start and can expose every CRUMB or Logisim field
directly. It would quickly accumulate adapter-specific nullable fields,
however, and every new simulator, PDK, or EDA tool would pressure the core
version. It also makes it too easy for one adapter's evidence labels to acquire
meaning in another adapter.

### Append-only event log

An event log can preserve fine-grained timing, retries, concurrency, and
streaming telemetry. It also requires ordering, replay, partial-log recovery,
concurrency, retention, and trust rules before the first useful handoff. Those
costs are premature while Circuitarium still needs a stable cross-model
snapshot.

### Neutral sealed snapshot plus namespaced extensions

This option keeps the portable contract small enough to validate while still
representing the complete engineering arc. Extensions carry exact CRUMB,
Logisim, PDK, or tool-specific facts without changing core claim authority.
It is the selected option.

## Trade-off analysis

| Concern | Sealed neutral snapshot | Consequence |
|---|---|---|
| Cross-model handoff | Deterministic JSON and SHA-256 identities | Any host can preserve and compare the same bounded record |
| Adapter growth | Namespaced extensions | New adapters do not add nullable fields to the core |
| Audit detail | Snapshot rather than event stream | Fine-grained telemetry and replay are deferred |
| Trust | Unsigned integrity seal | Mutation is detectable only when an expected digest is trusted separately; origin is not authenticated |
| Usability | One strict validator and schema Resource | Models receive actionable diagnostics, but callers must assemble records until capture helpers land |
| Scale | Two MiB and explicit collection bounds | Large programs split into child records and aggregate records instead of silently truncating evidence |
| Physical signoff | Scoped caller-reported attestation | Circuitarium never becomes a certification authority |

## Consequences

Positive consequences:

- A requirement, artifact, activity, claim, and evidence item can be traced by
  stable identifiers instead of prose alone.
- Process completion and engineering correctness can no longer be represented
  by the same field.
- An exact PDK, standard-cell library, HDL, netlist, report, layout, GDS, or
  OASIS artifact can carry an immutable digest and derivation chain.
- Volatile execution metadata can change without changing portable evidence
  identity.
- Unknown noncritical extensions survive handoff without acquiring authority;
  unknown critical extensions fail closed.

Costs and limitations:

- The schema is intentionally richer than a one-tool receipt.
- v0.1 does not authenticate authors, timestamps, tool binaries, or external
  reports.
- v0.1 does not run a simulator, compiler, synthesis flow, place-and-route
  flow, DRC, LVS, or foundry handoff.
- The structured `record` input cannot recover duplicate keys already
  collapsed by an upstream JSON parser; raw documents must use
  `serializedRecord`.
- Automatic conversion of every existing Tool result into a run record is
  deferred until the core contract has public use.

## Action items

- [x] Add the versioned canonical JSON and digest implementation.
- [x] Add the strict run-record schema, semantic validator, bounds, and seal.
- [x] Add duplicate-aware serialized JSON validation.
- [x] Add the MCP Tool and static schema Resource.
- [x] Add Logisim and full ASIC-flow planning examples.
- [ ] Add guarded constructors that convert selected Circuitarium result
  envelopes into activity/evidence receipts.
- [ ] Add child/aggregate record workflows for larger implementations.
- [ ] Add optional DSSE/Sigstore or equivalent provenance without changing the
  unsigned v0.1 meaning.
- [ ] Add executor adapters only after each toolchain has an explicit sandbox,
  artifact, license, and evidence policy.
