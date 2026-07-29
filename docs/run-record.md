# Universal engineering run records

> This is a `0.4.0-dev.0` source-tree capability, not a published package.
> Published `0.3.1` has 22 tools and nine Resources; this checkout adds
> `electronics_validate_run_record` as tool 23 and the run-record schema as
> Resource 10. Do not expect the new surface from npm/MCPB `0.3.1`.

`electronics.run-record/0.1` is Circuitarium's portable process snapshot. It
can describe a small Logisim check or a full chip flow:

```text
requirements -> RTL -> simulation/formal -> synthesis -> place and route
             -> extraction -> timing/power -> layout -> DRC/LVS
             -> scoped signoff -> fabrication handoff
```

The record does not perform those steps. It makes their inputs, outputs,
dependencies, evidence, unresolved risks, and current verdicts explicit so a
model, engineer, or later tool can continue from the same facts.

## Start with a template

Three validated examples ship with the repository:

- [`logisim-full-adder-plan.json`](../examples/run-records/logisim-full-adder-plan.json)
  binds the exact synthetic `.circ` and `.vec` digests and leaves every runtime
  activity `not-attempted`.
- [`asic-flow-template.json`](../examples/run-records/asic-flow-template.json)
  carries a design from requirements to a planned GDS and fabrication
  manifest. No PDK is selected, so that absence remains an open critical risk.
- [`logisim-full-adder-reported-failure.json`](../examples/run-records/logisim-full-adder-reported-failure.json)
  is a closed, structurally valid record whose functional claim failed. Its
  one mismatch receipt remains explicitly caller-reported; it does not claim
  Circuitarium executed or authenticated the simulator run.

From a source checkout, validate either file with the duplicate-aware CLI
path:

```text
npm run cli -- validate-run-record examples/run-records/asic-flow-template.json
```

An MCP host can call the same validator with a structured value:

```json
{
  "record": {
    "schemaVersion": "electronics.run-record/0.1",
    "recordId": "my-first-run",
    "recordType": "run",
    "recordStatus": "open",
    "content": {
      "intent": {
        "title": "One-bit adder",
        "summary": "Define the interface before implementation."
      },
      "stages": [
        {
          "id": "intent",
          "sequence": 1,
          "kind": "intent-architecture",
          "title": "Freeze intent",
          "status": "planned"
        }
      ],
      "disclosure": {
        "rawCommandsIncluded": false,
        "environmentValuesIncluded": false,
        "absolutePathsIncluded": false,
        "rawPayloadsIncluded": false,
        "userAuthoredTextMayContainSensitiveData": true
      },
      "completeness": {
        "status": "partial",
        "reasons": [
          "No implementation or evidence exists yet."
        ]
      }
    }
  }
}
```

Call `electronics_validate_run_record`. A valid result contains the normalized
record, materialized defaults, extension payload digests, collection counts,
and an integrity seal. Invalid domain content follows Circuitarium's normal
validator convention: the MCP envelope has `ok: true` and `data.valid: false`,
with actionable diagnostics.

For an external JSON document, send its text in `serializedRecord` instead of
parsing it first. Circuitarium then rejects duplicate and escaped-equivalent
keys, a byte-order mark, trailing documents, excessive nesting, and oversized
input before `JSON.parse`. The Tool requires exactly one of `record` or
`serializedRecord`.

## The neutral core

| Section | Purpose |
|---|---|
| `intent` | Plain-language goal, requirements, interfaces, exact-value constraints, and assumptions |
| `stages` | Ordered engineering phases and their dependencies; stage completion is not a pass verdict |
| `toolchain` | Public tool name, exact version/digest when known, and honest identity authenticity |
| `artifacts` | Immutable specifications, HDL, netlists, libraries, reports, layouts, GDS/OASIS, and handoff files |
| `activities` | Planned or observed operations, their artifact inputs/outputs, process status, outcome, and receipts |
| `claims` | Engineering statements with separate verdict and evidence basis |
| `evidence` | Exact artifact-bound observations, coverage, outcome, source, and authenticity |
| `diagnostics` | Open, resolved, or accepted informational through critical findings |
| `risks` | Explicit low through critical risks; accepted signoff cannot hide an open high/critical risk |
| `signoffs` | Scoped caller-reported human/system attestations, never Circuitarium certification |
| `provenance` | How an artifact, activity, evidence item, or claim was generated, derived, imported, measured, reported, or reviewed |
| `extensions` | Bounded adapter-specific facts that cannot override core verdict or trust semantics |
| `disclosure` | Caller assertion that raw commands, environment values, absolute paths, and raw payloads were excluded; validation cannot discover secrets hidden in free text or extensions |
| `completeness` | `complete` or `partial`, with explicit omitted sections and reasons |

Stages and activities are the two ordered collections. Their `sequence` values
are one-based, contiguous, and must agree with array order. Dependencies can
point only backward. Collections whose order has no engineering meaning are
normalized by stable identifier before sealing.

Artifact causality is one combined acyclic graph: explicit
`derivedFromArtifactIds`, provenance `sourceArtifactIds`, and a producing
activity's inputs all contribute edges. The validator uses that same graph for
cycle rejection and oracle-independence checks.

`recordStatus` is lifecycle state, not engineering outcome:

- `open` means the snapshot may still receive work or evidence;
- `closed` means the author considers this snapshot finished, even if a claim
  failed, evidence is incomplete, or a stage was cancelled; and
- `superseded` means a newer record should be located through lineage.

None of these values means passed, signed off, safe, fabrication-ready, or
certified.

## Artifacts and activities

A materialized or externally reported artifact requires a lowercase
`sha256:` digest. Its digest states whether it covers raw bytes or canonical
JSON and whether the value was computed or merely reported. Planned artifacts
may omit a digest because no immutable object exists yet.

An activity has independent fields for:

- `executionStatus`: whether the process ran;
- `outcome`: what the operation observed about its own scoped check; and
- `observationBasis`: whether the host, a tool, the caller, or an external
  source reported it.

`executionStatus: "completed"` or `"reported-only"` requires a receipt: a
result digest, evidence, diagnostic, or output artifact. Completed local work
uses host-observed or tool-reported basis; caller/external facts remain
reported-only. Terminal work cannot depend on unattempted work. Activity
dependencies and produced inputs cannot flow backward from a later stage, and
an output artifact cannot materialize before its producing activity completes
or is explicitly reported. Verdict-bearing evidence determines its activity's
engineering outcome: any failure makes the activity fail; otherwise all such
items pass. Activity-produced evidence and its activity share one exact
`resultDigest`. Output artifact digests independently identify the artifact
bytes or canonical value, so they may differ from that operation receipt. An
exit code or completed status alone never passes a claim.

Raw command strings and environment values are deliberately absent from v0.1.
Use public tool identities, operation names, bounded summaries, artifact
references, and request/result digests. This avoids turning a portable record
into a credential, machine-path, or shell-injection container.

## Claims, evidence, and signoff

Claim verdicts are:

- `not-assessed`
- `pass`
- `fail`
- `inconclusive`
- `unsupported`
- `withdrawn`

Passing and failing claims require compatible evidence whose outcome supports
the verdict at the same artifact and stage locus. The claim must name an exact
implementation or subject artifact, and each verdict-producing activity must
consume one of those subjects; a result report cannot prove itself. Every
claim-scoped subject needs outcome-matching evidence explicitly bound to it,
so an unrelated design cannot be appended to a valid verdict. A truth table
and an expected specification are observations, not proof that anyone
compared them. A separate comparison/check receipt must explicitly pass or
fail and must consume distinct expected and implementation artifacts. An
expected oracle cannot share the implementation's artifact identity or exact
SHA-256 value (regardless of digest basis), nor derive directly or transitively
from it. Derivation includes `derivedFromArtifactIds`, provenance
`sourceArtifactIds`, and the inputs of its producing activity.
Verdict-bearing test-vector evidence likewise consumes an exact vector
artifact that is independent of the implementation. Passing vector evidence
requires nonempty, untruncated exhaustive or listed-sequence coverage with
equal planned and executed counts.

Static parsing cannot become behavioral simulation. Project load cannot become
functional correctness. DRC evidence cannot become LVS evidence. Physical
measurement and qualified review remain externally or caller reported.

The schema Resource publishes the exact claim-class/evidence-kind,
evidence-kind/activity-kind, known-operation/evidence-kind, observation
basis/authenticity, verdict-subject-role, and oracle-independence rules. Read
`circuitarium://schemas/run-record/0.1` before generating a completed record;
operation names are stable identifiers, and the `electronics_`, `crumb_`, and
`logisim_` namespaces accept only exact lowercase registered names. Known
Circuitarium operations fail closed if they claim stronger evidence than
their tool actually produces.

A signoff records what an external person or system reportedly accepted, the
exact claims/artifacts in scope, its evidence, conditions, and accepted risks.
Every v0.1 signoff is `caller-reported-unverified`. Circuitarium does not grant
design authority, safety approval, foundry permission, or certification.

## Adapter extensions

The core contains no CRUMB-, Logisim-, PDK-, or EDA-specific nullable fields.
Those facts use a reverse-domain extension:

```json
{
  "extensionId": "io.github.craftiee.circuitarium/logisim-evolution/0.1",
  "schemaVersion": "0.1",
  "critical": true,
  "appliesTo": {
    "artifactIds": [
      "project",
      "vectors"
    ]
  },
  "payload": {
    "backendId": "logisim.evolution",
    "adapterVersion": "logisim.evolution/0.1",
    "compatibilityProfile": "logisim-evolution/4.1.0",
    "projectArtifactId": "project",
    "circuit": "Main",
    "vectorArtifactId": "vectors",
    "runtimeStatus": "unknown",
    "runtimeSafety": "unknown"
  }
}
```

v0.1 understands:

- `io.github.craftiee.circuitarium/crumb-unity/0.1`
- `io.github.craftiee.circuitarium/logisim-evolution/0.1`

An unknown noncritical extension is preserved and digest-bound but ignored.
An unknown critical extension makes the record invalid. Extensions cannot
shadow core claims, verdicts, signoffs, seals, digests, or authenticity.
Evidence from a known CRUMB or Logisim project operation requires its known
extension with `critical: true`. The extension, project/vector artifacts,
activities, evidence, and claims must all identify one exact adapter locus.
Any Logisim test-vector activity or evidence item requires an exact,
materialized, digest-bound `vectorArtifactId`.
For Logisim runtime evidence that locus must report a safe, available 4.1.0
runtime. The runtime activity's simulator identity must carry the same
version and self-reported authenticity; an extension cannot silently
contradict its toolchain entry.

## Canonicalization and the two digests

The seal uses `circuitarium.canonical-json/0.1`:

- object keys sort by ECMAScript UTF-16 code-unit order;
- ordered arrays retain order;
- identifier sets and set-like collections normalize by stable identifier;
- strings, booleans, null, and finite IEEE-754 numbers use ECMAScript JSON
  serialization;
- unsafe integers and non-finite numbers are rejected;
- class instances, `Date`, `Map`, `Set`, sparse arrays, and object cycles are
  rejected rather than hashed as ambiguous JSON;
- `-0` canonicalizes to `0`; and
- exact engineering quantities use decimal strings plus units.

The seal contains two different identities:

| Digest | Coverage | Intended use |
|---|---|---|
| `evidenceDigest` | normalized `content` only | Stable portable evidence identity across hosts and repeated captures |
| `recordDigest` | normalized record except `seal` | Detect changes to record ID, status, lineage, timestamps, execution IDs, or content |

Changing `recordId`, `capturedAt`, `executionId`, or `serverInstanceId` changes
`recordDigest` but not `evidenceDigest`. Changing any normalized engineering
content changes both.

Supply a previously trusted digest through `expectedRecordDigest` or
`expectedEvidenceDigest` to detect a conflict. An attacker who can rewrite a
record can also recompute its self-contained hashes. The seal is therefore
integrity and content identity only:

```text
authenticity = unsigned-unverified
```

It is not a signature, trusted timestamp, proof of origin, proof that a tool
ran, proof that a report is true, or certification. Signing and remote
attestation belong in a later, separate provenance layer.

## Bounds and larger projects

One record is limited to two MiB, 32 levels of nesting, 20,000 aggregate
properties/items, and 4,096 UTF-16 code units per generic string. Collection
limits are 128 items per intent collection, 24 stages, 64 tool identities, 128
artifacts, 128 activities, 64 claims, 128 evidence items, 200 diagnostics, 128
risks, 32 signoffs, 128 provenance entries, 32 extensions, and 32 lineage
parents. An extension payload is limited to 64 KiB. Input beyond a bound fails;
required evidence is never silently dropped.

For a larger design, seal child records for blocks or flow segments and build
an aggregate record whose lineage lists the exact child record digests and
whose content provenance repeats those digests. This makes the aggregate
`evidenceDigest` identify the exact child set. Do not truncate a clean-looking
summary around missing failures.

## Current boundary and next integration

v0.1 supplies the contract, validator, seal, schema Resource, CLI path, and
validated examples. It does not yet manufacture records automatically from
every CRUMB or Logisim result. Today, preserve each Tool's exact artifact and
result digests, then add the corresponding activity and evidence entries before
sealing.

The next adapter increment is guarded receipt construction: convert selected
Circuitarium envelopes into correctly classified run-record activity/evidence
entries without letting static analysis masquerade as simulation. Executors,
signatures, event streams, synthesis/P&R tool adapters, and PDK-specific
signoff remain separate future layers.
