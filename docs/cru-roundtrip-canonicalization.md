# CRUMB round-trip canonicalization

This specification applies to the internal, Unity-era CRUMB `.cru` round-trip
core. It does not widen the compatibility claim beyond
`crumb.unity/1.3.5`, and it does not make unknown payloads editable.

## Preservation is the default

A decode followed by serialization with no edit returns the exact input bytes.
That includes the optional UTF-8 BOM, XML declaration, line endings,
indentation, attribute order and quote style, namespace prefixes, entity
spellings, comments, CDATA sections, self-closing forms, scalar spellings, and
embedded-base64 whitespace.

The implementation retains source bytes privately and exposes only immutable
semantic and byte-span indexes. Every direct `data/anyType` value has an exact
source span. Unknown or nested payloads are opaque and are never reconstructed
from their summarized semantic representation.

Initial round-trip decoding accepts only a structurally valid CRUMB save. This
precondition prevents an edit from appearing to succeed while unrelated
pre-existing errors remain in the artifact.

An edit is a minimal byte splice against a specific indexed element. Raw patch
application is private; callers use structured rename, scalar, movement, and
removal operations. Every mutation requires the expected source SHA-256.
Patches must be in bounds and non-overlapping. Their final byte length is
checked before one bounded output buffer is assembled in source order, after
which the result is decoded, indexed, and validated again. A stale source
digest or failed validation produces no replacement document.

## Encoding

The supported format is XML 1.0 encoded as UTF-8, with or without a UTF-8 BOM.
Invalid UTF-8, UTF-16 BOMs, XML 1.1, and declarations naming another encoding
are rejected.
Character offsets reported by the XML parser are converted to UTF-8 byte
offsets through a sparse checkpoint index, so non-ASCII text before an edit
cannot displace the byte splice.

The root must retain CRUMB's standard `xsi` and `xsd` namespace bindings.
Qualified `xsi:type` values must use a bound prefix; rebinding `xsi`, `xsd`, or
the observed GUID namespace fails closed instead of letting a familiar-looking
type name acquire different semantics.

The semantic parser deliberately rejects the JavaScript-reserved XML element
names `constructor`, `prototype`, and `__proto__` as a prototype-pollution
defense. A save containing those unusual names therefore fails closed instead
of receiving partial round-trip support.

## Newly emitted scalar text

Unchanged values retain their original lexical text. Assigning the same
semantic value is a no-op.

Changed values use these spellings:

- `xsd:boolean`: lowercase `true` or `false`.
- `xsd:int`: signed base-10 with no leading plus or unnecessary zeroes;
  negative zero becomes `0`, and the value must fit the signed 32-bit range.
- `xsd:float` and `xsd:double`: the shortest finite ECMAScript
  round-trippable decimal; negative zero becomes `0`, and an exponent marker is
  uppercase `E`.
- `xsd:string` and the save name: invalid XML 1.0 characters are rejected;
  ampersand, angle brackets, quotes, and apostrophes are escaped. Leading and
  trailing whitespace remains part of the semantic string value.

The scalar setter refuses GUIDs, vectors, arrays, unknown types, and payloads
with opaque structure. A changed self-closing scalar or a nominal scalar
containing child elements, comments, CDATA, or processing instructions is also
refused because replacing its content would require reconstructing XML syntax.
The same rule protects the save name and individual spatial coordinates.
Spatial movement has a separate operation that changes only plain-text `x`,
`y`, `z`, and `w` nodes of recognized `Vector3S` and `QuaternionS` values.
Component removal deletes exactly one indexed `SaveComponent` element and then
revalidates the remaining design. It first refuses removal when the target GUID
appears literally anywhere outside that component's source span, including
inside an opaque payload. Post-edit validation still checks modeled tie-point
references. This is a conservative guard, not evidence that every possible
encoded or game-internal reference form is understood.

## Future writers

Rename, parameter, movement, removal, and placement tools must use the
round-trip document and its guarded patch operations. They must not serialize a
`CruDecodedDocument`, use text replacement to locate a component, or rebuild a
component's complete `data` array merely to change one known field.

Placement will require a separately documented canonical component layout and
game-reopen evidence. Until then, this core deliberately provides no raw XML
insertion escape hatch.
