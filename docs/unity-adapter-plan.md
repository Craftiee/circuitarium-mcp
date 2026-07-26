# CRUMBLE Unity adapter plan

## Decision

Finish the evidence-backed `crumb.unity/1.3.5` file adapter before creating a
Godot profile. The read-only controlled-save comparison and the private,
byte-preserving round-trip foundation are implemented. The next major gate is
evidence-backed, new-file-only editing—not a public arbitrary XML escape hatch.

The current decoder is intentionally semantic rather than lossless. It can
recognize the observed Unity-profile fields, retain modeled numeric lexical
forms, and fingerprint unmodeled ordered XML. Re-serializing that semantic
model directly could still discard data that CRUMB needs. The separate
round-trip layer therefore retains exact source bytes and indexed opaque spans
and applies only guarded minimal patches. It is internal infrastructure, not a
public editing contract.

## Requirements

The Unity adapter should eventually let a model:

1. identify the exact compatibility profile and evidence boundary in use;
2. inspect and validate a save without launching CRUMB;
3. compare a controlled before/after or original/resaved pair;
4. distinguish byte identity, modeled equivalence, and incomplete coverage;
5. plan a bounded change separately from applying it;
6. write only a new file guarded by the source digest;
7. verify generated output in the exact Unity build before expanding its write
   claim; and
8. keep live application controls absent unless CRUMB exposes a documented or
   developer-supported bridge.

Non-functional requirements are:

- deterministic results across ChatGPT, Claude, and local MCP clients;
- workspace-confined file access;
- bounded responses and opaque, digest-bound pagination;
- no raw XML, firmware, EEPROM bytes, thumbnails, or unbounded user text in
  ordinary comparison results;
- no overwriting a user's design;
- no proprietary binaries, assets, decompiled source, or third-party designs
  in the repository; and
- explicit uncertainty instead of inferred compatibility.

## High-level flow

```text
independently authored fixture or controlled baseline
                         |
                         v
              open / change / Save As
                in CRUMB 1.3.5
                         |
                         v
             crumb_compare_designs
      byte identity / modeled change / coverage
                         |
              +----------+-----------+
              |                      |
        evidence record       writer acceptance gate
              |                      |
        catalog update     byte-preserving round trip
                                      |
                             reopen / resave evidence
                                      |
                              new-file-only support
```

The comparison tool is an observation. Opening, changing, and saving a design
inside CRUMB are controls performed by the user until a supported application
bridge exists.

## Stage 1: controlled-save comparison — implemented

`crumb_compare_designs` compares two workspace-relative `.cru` artifacts under
`crumb.unity/1.3.5`.

The current implementation:

- matches components only by case-insensitive GUID;
- reports root, component, parameter, attachment, geometry, and payload
  differences on the fields modeled by the adapter;
- treats numeric lexical changes separately from numeric value changes;
- fingerprints source, EEPROM, thumbnail, annotation, and opaque payload data
  instead of returning their contents;
- applies strict UTF-8/XML 1.0, namespace, scalar, base64, file-size, text-node,
  markup-count, and aggregate unknown-key bounds before exposing modeled data;
- retains `opaque-payload` when a partial node's hidden projection changes,
  even when a narrower modeled field changed too;
- reports unknown tool IDs and payload signatures as unverified schema
  candidates;
- binds expected digests and pagination cursors to both artifacts; and
- never writes either input.

It does not heuristically pair independently created components with different
GUIDs. Inventory-level comparison can be added later, but guessing identity
would weaken controlled-save evidence.

Unknown fields, attributes, mixed content, namespace bindings used by content,
or payload subtrees outside the modeled profile cannot receive complete
coverage. Unused, well-formed namespace declarations are
representation-neutral. Order-sensitive structural fingerprints make partial
comparisons `inconclusive` without returning the opaque content.

## Stage 2: profile and installation verification — planned

A future opt-in installation probe may verify the Steam app ID, build ID, game
version, and engine version before applying Unity-specific rules. It must not
silently scan unrelated libraries, return personal absolute paths, or expand
the workspace file-access boundary without an explicit security design.

Save files themselves do not identify their originating CRUMB build. A profile
assessment can therefore say only that modeled fields are consistent with the
observed profile, inconclusive, or structurally invalid. It cannot prove which
engine authored the file.

## Stage 3: lossless edit foundation — implemented internally

The internal syntax-preserving representation now:

- retains exact UTF-8 source bytes privately and produces byte-identical no-op
  output across every checked-in fixture;
- indexes root fields, components, direct `anyType` values, and nested scalar
  spans without rebuilding opaque payloads;
- preserves namespace spelling, element order, whitespace, comments, CDATA,
  line endings, scalar lexical forms, and unknown subtrees when untouched;
- applies non-overlapping, digest-guarded byte patches and performs a fresh
  decode, syntax index, and structural validation before returning a
  replacement document;
- provides internal rename, simple typed-scalar, spatial move, and component
  removal helpers that fail closed on ambiguous or opaque structures; and
- rejects malformed UTF-8, unsupported encodings, stale digests, overlapping
  patches, illegal XML text, and invalid replacement artifacts.

These helpers do not write a file and are not registered MCP tools. Placement
is not implemented, and none of the internal operations has yet passed the
controlled reopen/resave evidence required for a public general editor.

When that evidence exists, public editing should be split into two tools:

1. `crumb_plan_edit` validates operations and reports expected changes and
   unsupported fields without writing.
2. `crumb_apply_edit` requires the planned source digest and writes a new path
   without overwrite.

## Stage 4: expand verified writers — planned

Writer support expands one component family at a time:

| Gate | Required evidence |
|---|---|
| Read | Controlled save or permitted version-pinned observation |
| Compare | Stable before/after classification with sensitive data redacted |
| Generate | Independently authored serializer shape and structural tests |
| Reopen | Generated file opens in CRUMB 1.3.5 with the intended visible state |
| Resave | Comparison explains CRUMB's resaved output without unknown loss |
| Publish | Synthetic fixture, tests, provenance note, catalog write claim, full CI, and packed-consumer smoke test |

Tools `0`, `1`, `3`, and `6` currently have limited fixture-writing evidence.
Other tools remain read-only until they pass the same ladder. The 21 DIP
variants require package-specific pin-count and payload tests; EEPROM contents
remain metadata-only.

## Later Unity work

The read side already offers optional saved slide/DIP-switch connectivity and
static electrical-rule diagnostics without claiming simulation. Later work
should:

- use comparison, netlist, and ERC results as pre/post checks around candidate
  writes without presenting them as circuit execution;
- collect reopen and resave evidence for internal rename, scalar, move, and
  removal operations, then add evidence-backed component placement;
- expose plan/apply editing only as new-file output after those writer gates
  pass;
- export a portable Circuitarium project with explicit conversion losses;
- add sanitized evidence-record generation for contributor observations; and
- seek a documented CRUMB plugin or local API for run, pause, step, stimulus,
  and signal observation.

## Trade-offs

| Choice | Benefit | Cost |
|---|---|---|
| Compare before edit | Builds reproducible evidence and protects user files | Delays arbitrary AI editing |
| Keep round-trip operations internal | Preserves unknown data while evidence is incomplete | No public general editor yet |
| GUID-only matching | Deterministic and honest | Does not pair independently created equivalents |
| Digest sensitive payloads | Useful change detection without disclosure | Cannot explain content-level firmware changes |
| Keep Unity profile explicit | Prevents evidence leakage into Godot support | Requires separate future adapter work |
| Developer-supported live bridge only | Stable, safer automation boundary | No live Unity controls today |

## Revisit when the system grows

Revisit GUID-only matching after a neutral project identity model exists.
Revisit installation probing after its privacy and cross-platform contract is
designed. Revisit live controls only with a supported bridge. Do not reuse
Unity positional schemas or topology rules for a Godot profile; collect a new
controlled corpus and compare it independently.
