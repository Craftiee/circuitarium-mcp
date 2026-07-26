# CRUMBLE: CRUMB `.cru` format notes

These notes belong to CRUMBLE — Circuitarium MCP's unofficial
**C**ircuit **R**epresentation & **U**niversal **M**odel **B**ridge for
**L**aboratory **E**lectronics integration family. See the
[integration guide](crumble.md) for scope, stable identifiers, and the
non-affiliation and non-redistribution boundary.

## Confidence and version scope

Evidence terms in this document follow the
[project provenance policy](../PROVENANCE.md). These notes combine:

- controlled-save observations created and reopened in CRUMB 1.3.5;
- developer-published designs used only as external validation evidence and not
  redistributed in this repository;
- factual labels, orderings, and field-use hints manually transcribed during
  inspection of the installed CRUMB 1.3.5 build; and
- explicitly marked inferences, including hidden board topology.

The observations and inferred board topology are pinned to the **CRUMB 1.3.5
Unity-era format**. They do not establish compatibility with a later Godot-based
release. Before extending the version claim, collect fresh controlled saves,
diff their payloads, and reopen generated fixtures in that exact release.

The format is XML 1.0 represented as UTF-8 and serialized under a `SaveData`
root. It is not an opaque binary container. A file may omit its XML declaration.
When a declaration is present, it must declare version `1.0`; an optional
encoding must be `utf-8`, and an optional standalone value must be `yes` or
`no`. An optional UTF-8 BOM remains part of exact byte identity even though it
does not change the decoded model. The order of values inside each component's
`data/anyType` array is part of that component's version-specific contract.

The adapter supports only the signatures that have evidence. Unknown tool IDs
remain unknown. A known tool ID with an unexpected payload is reported as
`schema-mismatch`; its values are not shifted or guessed into fields.

## Root structure

Observed child order:

1. `name`
2. `components`
3. `imageData`
4. `pivotPos`
5. `pivotRot`
6. `camPos`
7. `frequency`
8. `timeStep`
9. `throttling`

Fresh CRUMB 1.3.5 defaults observed in a controlled blank save:

| Field | Value |
|---|---|
| `pivotPos` | `0, 0, 0` |
| `pivotRot` | `45.0000038, 315, 0` |
| `camPos` | `0, 0, -200` |
| `frequency` | `200` |
| `timeStep` | `0.005` |
| `throttling` | `true` |

Fresh saves contain a 560×480 PNG in `imageData`. A self-closing/empty
`imageData` was also observed to load in a controlled test; it produced a blank
or question-mark recent-file thumbnail. The fixture generator supplies a small
valid 560×480 PNG. Inspection does not return the embedded thumbnail by
default.

The decoder rejects malformed UTF-8, XML `DOCTYPE` and entity declarations,
non-empty default namespaces, undeclared prefixes, invalid reserved-prefix
bindings, and duplicate expanded attribute names. Namespace aliases and
inherited prefix bindings remain valid when they resolve to the expected URI.
An unused, well-formed namespace declaration is representation-neutral. A
binding that is actually used by a modeled type or element must resolve
correctly; rebinding a used XML Schema, schema-instance, or CRUMB GUID prefix
cannot masquerade as the expected type.

Typed scalar parsing is deliberately strict:

- finite decimal and scientific notation are accepted; `NaN`, infinities,
  hexadecimal forms, and surrounding whitespace are not;
- `xsd:int`, tool IDs, and tie-point IDs use signed 32-bit integer bounds;
- booleans accept only `true`, `false`, `1`, or `0`;
- `xsd:float`, vectors, quaternions, and Unity root timing/spatial fields are
  modeled at IEEE-754 float32 precision; `xsd:double` remains double precision;
  and
- thumbnail `imageData` must use canonical base64 after XML whitespace is
  removed. EEPROM base64 is separately checked for syntax and its exact
  2,048-byte decoded size.

Numeric lexical forms, including scientific notation such as `1E-06`, are
retained alongside decoded root, spatial, array, and typed-scalar values. This
lets comparison distinguish a value change from an encoding-only change.

File reads are capped at 3 MiB, and a baseline/candidate comparison is capped
at 5 MiB combined. Before response shaping, the adapter also rejects more than
100,000 `<` markup delimiters, any parsed text or attribute-value node over
1,048,576 characters, `xsi:type` values over 256 characters, numeric lexical
text over 1,024 characters, GUID/parent-GUID tokens over 64 characters, and
XML element or namespace-prefix names over 256 characters. Fixed diagnostics
identify the field and limit without echoing rejected content.

The root `name` is user-authored and untrusted. Inspection and analysis return
only a 160-character preview plus full size, SHA-256, trust, blank, and
truncation metadata. Analysis returns no more than 64 unknown child-key names
in aggregate across all opaque payload descriptors for one component.

## Spatial structural components

Controlled save for tool `0`:

```xml
<SaveComponent>
  <toolID>0</toolID>
  <data>
    <anyType xmlns:q1="http://microsoft.com/wsdl/types/" xsi:type="q1:guid">...</anyType>
    <anyType xsi:type="Vector3S">
      <x>0</x>
      <y>0</y>
      <z>0</z>
    </anyType>
    <anyType xsi:type="QuaternionS">
      <w>1</w>
      <x>0</x>
      <y>0</y>
      <z>0</z>
    </anyType>
  </data>
</SaveComponent>
```

The XML namespace prefix (`q1`, `q2`, and so on) is an alias. The namespace URI
and local type name carry the meaning, so the decoder normalizes the type to
`guid`. Every component requires a unique UUID.

## Recognized CRUMB 1.3.5 signatures

Indexes below count values after the GUID as they appear in the positional
payload. Read support means semantic recognition, not simulation. “Developer
example” means a developer-published design was analyzed externally; the design
file is not included in this repository.

| Tool | Component | Version-pinned payload after GUID | Primary evidence | Read support | Fixture writer |
|---:|---|---|---|---|---|
| `0` | Main solderless breadboard | position, rotation | Controlled save | Full | Yes |
| `1` | Detached power rail | position, rotation | Controlled save | Full | Yes |
| `2` | Jumper wire | geometry, 2 tie points, color code, current rating (A) | Developer example + installed-build inspection | Full | No |
| `3` | Resistor | geometry, 2 tie points, resistance (Ω), max power (W) | Controlled save | Full | Yes, controlled placement |
| `4` | Capacitor | geometry, 2 tie points, capacitance (F), type code, trap-model flag | Developer example + installed-build inspection | Partial | No |
| `5` | DIP integrated circuit | position, rotation, ordered pin attachments, prefab ID | Installed-build inspection + developer example | Variant-dependent | No |
| `6` | 5 mm LED | geometry, 2 tie points, forward voltage (V), color code, max current (A) | Controlled save | Full | Yes, controlled placement |
| `7` | DC 12V Power Supply | position, rotation, on flag, DC voltage (V), 2 tie points | Installed-build inspection | Full | No |
| `8` | Tactile Switch | position, rotation, 4 tie points | Installed-build inspection | Full | No |
| `9` | Slide Switch | position, rotation, 3 tie points, position code | Installed-build inspection | Full | No |
| `10` | Potentiometer | position, rotation, 3 tie points, normalized position, max resistance (Ω) | Installed-build inspection | Full | No |
| `11` | Label | position, rotation, user-authored string | Installed-build inspection | Full, bounded | No |
| `12` | Seven Segment Display | position, rotation, 10 tie points, forward voltage, max current, common-anode flag | Installed-build inspection | Full | No |
| `13` | 4bit DIP Switch | position, rotation, 8 tie points, 4 booleans | Installed-build inspection | Full | No |
| `14` | 8bit DIP Switch | position, rotation, 16 tie points, 8 booleans | Installed-build inspection | Full | No |
| `15` | Diode | geometry, 2 tie points, type code, forward/zener voltage, leakage/max current | Developer example + installed-build inspection | Partial | No |
| `20` | Arduino/code component | position, rotation, tie points, source string, auxiliary string | Developer example | Partial | No |
| `24` | 12V Signal Generator | position, rotation, ambiguous boolean, tie points, voltage, frequency, waveform code | Developer example + installed-build inspection | Partial | No |

Tool `2`'s last float is named `IRating` in the installed metadata and is
interpreted as a current rating in amperes, not wire thickness.

Controlled resistor defaults were `1000` ohms and `0.25` watts. Controlled red
LED defaults were `2.2` volts forward drop, color enum `0`, and `0.03` amperes
maximum current. LED terminals are deliberately called `terminal-a` and
`terminal-b`; controlled evidence has not yet verified which serialized
terminal is anode or cathode.

For tool `20`, ordinary analysis returns source metadata such as size, line
count, and SHA-256 digest rather than the embedded text. Source text is returned
only when explicitly requested. This is response redaction, not encryption or
removal from the `.cru` file.

Use `crumb_component_catalog` for the machine-readable signatures, confidence,
units, and current read/write support.

### Tool-5 integrated-circuit variants

> Evidence class: installed-build inspection, exercised by external validation
> designs. The table below contains manually transcribed factual labels and
> ordering observations. It does not embed a CRUMB scene, resource, or other
> asset file.

Tool `5` ends with an integer `prefabId`. Inspection of the tested CRUMB 1.3.5
build found 21 variants (`0..20`) and observed `tiePointIDs[i]` being read with
the same index as the prefab's ordered pin entry. This finding is limited to
that build. The ordinary positional signature is `guid`, `Vector3S`,
`QuaternionS`, `ArrayOfTiePointID`, `xsd:int`.

`crumb_component_catalog` returns these under `data.icVariants`, including
`prefabId`, the installed-build label, package, ordered pin entries, confidence,
and `pinNameCoverage`:

| Prefab ID | Installed label | Package | Semantic pin-name coverage |
|---:|---|---|---|
| `0` | LM555 | DIP-8 | complete (8/8) |
| `1` | 74HC00 Quad NAND | DIP-14 | complete (14/14) |
| `2` | 74HC161 4bit Counter | DIP-16 | complete (16/16) |
| `3` | 74HC245 8bit Buffer | DIP-20 | complete (20/20) |
| `4` | 75LS76 | DIP-16 | unresolved (0/16) |
| `5` | 74HC139 Dual 2to4 Decoder | DIP-16 | complete (16/16) |
| `6` | 74H02 Quad NOR | DIP-14 | complete (14/14) |
| `7` | 74HC04 Hex Inverter | DIP-14 | complete (14/14) |
| `8` | 74HC08 Quad AND | DIP-14 | complete (14/14) |
| `9` | 74HC32 Quad OR | DIP-14 | complete (14/14) |
| `10` | 74HC86 Quad XOR | DIP-14 | complete (14/14) |
| `11` | 74HC107 Dual JK | DIP-14 | complete (14/14) |
| `12` | 74HC138 3to8 Decoder | DIP-16 | complete (16/16) |
| `13` | 28C16 EEPROM | DIP-24 | complete (24/24) |
| `14` | 74HC173 Quad D | DIP-16 | complete (16/16) |
| `15` | 74HC283 4bit Adder | DIP-16 | complete (16/16) |
| `16` | 74HC157 Quad 2-Input Multiplexer | DIP-16 | complete (16/16) |
| `17` | 74HC273 Octal D Flip Flop | DIP-20 | complete (20/20) |
| `18` | 74F189 64 Bit RAM | DIP-16 | complete (16/16) |
| `19` | LM741 | DIP-8 | partial (5/8) |
| `20` | 74HC595 8bit Shift Register | DIP-16 | complete (16/16) |

Installed labels are preserved exactly, including apparent `75LS76` and `74H02`
typos. In the catalog, an unresolved pin retains its package position and
installed source name with semantic `name: null`; analyzed terminals use a
neutral `pin-N` fallback. Neither form silently assigns a guessed electrical
role.

For a matching tool-5 component, `crumb_analyze_design` returns the resolved
`variant` (`prefabId`, label, package, pin count, and coverage) and terminals in
serialized package-pin order. An unknown prefab ID, pin-count mismatch, or
partial/unresolved pin registry produces a diagnostic rather than fabricated
meaning.

Prefab `13`, the 28C16 EEPROM, has an exact alternate signature:

```text
guid, Vector3S, QuaternionS, ArrayOfTiePointID, xsd:base64Binary, xsd:int
```

The trailing integer must be prefab ID `13`, and the base64 value must decode to
exactly 2,048 bytes. Analysis never returns those bytes or their base64 text.
Instead it returns bounded `embeddedData` metadata:

```json
{
  "role": "eeprom-image",
  "present": true,
  "encoding": "xsd:base64Binary",
  "valid": true,
  "expectedBytes": 2048,
  "bytes": 2048,
  "sha256": "sha256:...",
  "contentIncluded": false
}
```

Invalid base64, another decoded size, or using this alternate signature with
another prefab is a schema mismatch with a diagnostic. There is no EEPROM-byte
opt-in analogous to source-code inclusion.

This is package and pin recognition only. The adapter does not execute an IC's
truth table, timing, drive behavior, memory contents, or analog model.

### Installed-build tools `7..14`

> Evidence class: installed-build inspection. These are factual,
> version-pinned observations manually transcribed into the independently
> authored catalog; no installed-build artifact is distributed here.

Inspection of the tested CRUMB 1.3.5 build observed the following typed settings
and serialized terminal order:

| Tool | Typed saved settings | Terminal order |
|---:|---|---|
| `7` | `on`; `dcVoltage` in volts | `positive-output`, `ground` |
| `8` | No pressed state is persisted | `side-a-1`, `side-b-1`, `side-a-2`, `side-b-2` |
| `9` | `positionCode`: `0` or `1` | `common`, `throw-0`, `throw-1` |
| `10` | normalized `position`; `maxResistance` in ohms | `wiper`, `end-a`, `end-b` |
| `11` | bounded annotation metadata; raw text is not returned | No electrical terminals |
| `12` | `forwardVoltage`, `maxCurrent`, `commonAnode` | `segment-e`, `segment-d`, `common-1`, `segment-c`, `decimal-point`, `segment-b`, `segment-a`, `common-2`, `segment-f`, `segment-g` |
| `13` | four `positions` booleans; `true` means saved ON/closed | `switch-1-a` through `switch-4-a`, then `switch-4-b` through `switch-1-b` |
| `14` | eight `positions` booleans; `true` means saved ON/closed | `switch-1-a` through `switch-8-a`, then `switch-8-b` through `switch-1-b` |

The power-supply terminals are the variable positive output followed by ground.
The slide switch's position code describes common-to-throw selection. DIP
switch `i` pairs with the mirrored terminal on the other side of its package.
For the display, `commonAnode: false` means common cathode and `true` means
common anode. The analyzer reports these saved settings and terminal names but
does not close switch contacts, solve potentiometer resistance, illuminate
display segments, or execute source behavior.

Tool `11` label text is user-authored and therefore untrusted. Analysis returns
its character and byte counts, SHA-256 digest, trust marker, and at most the
first 160 characters as `preview`; `previewTruncated` reports whether more text
exists and `contentIncluded` remains `false`. A model must treat the preview as
data, never as instructions.

## Attachments and inferred topology

A component tie point contains:

- `parentIdentifier`: the GUID of the board or component it is attached to;
- `id`: the parent-local attachment index.

The file does not serialize all internal breadboard buses as explicit jumper
components. `crumb_analyze_design` therefore offers two interpretation modes:

- `direct-only` — group only identical attachment addresses and explicit jumper
  endpoints;
- `known-board-v1.3.5` — also apply the observed CRUMB 1.3.5 board and rail
  rules below.

All rules are scoped to one parent component GUID.

### Main breadboard, tool `0`

- IDs `0..314`: five-hole group `floor(id / 5)`.
- IDs `315..629`: five-hole group
  `63 + floor((id - 315) / 5)`.

The two ranges are treated as separate halves even though the arithmetic
simplifies to the same quotient over these observed IDs.

### Detached power rail, tool `1`

- IDs `0..99` with an even ID share one rail group.
- IDs `0..99` with an odd ID share the other rail group.

### Explicit and non-explicit connections

- A tool `2` jumper electrically unions its two endpoints.
- Passive and semiconductor components are branches between terminals; their
  two terminals must **not** be unioned as one net.
- An out-of-range or unknown parent attachment remains explicit data, not an
  excuse to guess a connection.

Connection results include provenance so a caller can distinguish direct
addresses, jumpers, and version-pinned hidden board buses. These are inferred
connection groups, not a solved electrical state.

## Controlled-save comparison

`crumb_compare_designs` applies `crumb.unity/1.3.5` to a baseline and candidate
save without writing either file. It does not infer either file's origin. It
matches components only by GUID and reports:

- root metadata, camera, timing, and thumbnail-identity changes;
- component presence, ordering, tool ID, and payload-signature changes;
- semantic parameter changes separately from lexical-only numeric rewrites;
- attachment, position, rotation, and geometry changes;
- source, EEPROM, annotation, thumbnail, and opaque data through bounded
  metadata and digests rather than content; and
- unknown or schema-mismatched candidate signatures as unverified
  observations.

Known lexical-only differences use `parameter-encoding` for typed parameters
and `modeled-encoding` for other retained root or component representations.
An otherwise unclassified semantic payload difference remains
`opaque-payload`. For a partially modeled component, a visible parameter or
geometry change does not suppress `opaque-payload` when the hidden structural
projection also changed.

Byte equality is stronger than modeled equality. Modeled equality is limited
to the fields represented by this profile and is not a lossless XML
round-trip guarantee or automatic origin detection. The implementation plan
and writer acceptance ladder are in
[unity-adapter-plan.md](unity-adapter-plan.md).

An unknown XML field, attribute, mixed-content fragment, namespace binding used
by content, or subtree forces `coverage: partial` and an `inconclusive`
assessment. Unused, well-formed namespace declarations remain neutral.
Order-sensitive fingerprints still detect opaque changes without disclosing
their contents. Exact artifact identity hashes the file bytes, including an
optional UTF-8 BOM.

## Game verification

These are synthetic fixtures emitted by this project's fixture generator. The
generated files were opened directly in the tested CRUMB 1.3.5 build:

- `empty.cru` opened as a blank workspace.
- `breadboard.cru` rendered one full solderless breadboard.
- `breadboard-and-rail.cru` rendered the breadboard and a detached power rail.
- `breadboard-resistor.cru` rendered a 1 kΩ resistor with both leads seated in
  separate breadboard holes.
- `breadboard-led.cru` rendered an upright red 5 mm LED with both legs seated in
  neighboring holes.

No fixture was overwritten by CRUMB during verification.

## Validation corpus

The semantic analyzer was also run against two developer-published designs as
external evidence. Those source `.cru` files, their embedded payloads, and game
assets are not included in this repository; only the aggregate results below
are retained:

| Design | Recognized | Inferred connection groups | Bounded/redacted payload evidence |
|---|---:|---:|---|
| 8-bit CPU | 764/764 components | 362 | 5 EEPROM images represented only by metadata; 32 labels limited to untrusted previews |
| Bridge Rectifier | 20/20 components | 6 | — |

The non-redistributed 8-bit CPU artifact also provides a practical safety-cap
reference. In the 2026-07-25 recheck, its fetch reported 2,149,258 HTTP bytes
and decoded to 2,149,255 characters; it contained 63,556 `<` delimiters, and
its largest parsed text node (`imageData`) was 812,648 characters. The current
3 MiB file, 100,000-delimiter, and 1,048,576-character node limits leave
bounded headroom for that known corpus artifact.

Both group counts use `known-board-v1.3.5`. Full recognition means every
serialized component matched a known positional schema; it does not establish
behavioral correctness or mean either circuit was simulated. The external files
are not redistributed or run in public CI; their official publication links
and SHA-256 identities are recorded in [PROVENANCE.md](../PROVENANCE.md).

## Compatibility policy

- Apply these findings only through compatibility profile
  `crumb.unity/1.3.5`; a `.cru` file does not identify its originating engine
  or build automatically.
- Treat tool IDs, signatures, and topology as version-specific.
- Preserve scalar lexical representation for future round-trip work.
- Preserve unknown payloads when a future general editor is added.
- Pin the CRUMB version and adapter version in provenance.
- Validate and visually reopen controlled fixtures after every game update.
- Never mutate the user's only copy of a design.
- Do not advertise Godot-release compatibility without new evidence.
