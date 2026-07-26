# CRUMBLE integration guide

**CRUMBLE** means **C**ircuit **R**epresentation & **U**niversal **M**odel
**B**ridge for **L**aboratory **E**lectronics. It is Circuitarium MCP's
unofficial CRUMB-specific ruleset and integration family.

Circuitarium MCP is the simulator-neutral umbrella. CRUMBLE is one integration
within it; CRUMB is not the canonical model for other Circuitarium backends.

## Current scope

The callable `crumb.file` backend can:

- inspect, structurally validate, and perform bounded semantic analysis of
  `.cru` files;
- recognize the version-pinned component signatures documented in
  [the format notes](crumb-format.md);
- infer optional, version-pinned breadboard connectivity;
- compare controlled baseline and candidate saves with bounded, digest-guarded
  root and component changes under `crumb.unity/1.3.5`;
- create five fixed, independently authored synthetic fixtures; and
- preserve a workspace-relative artifact reference and SHA-256 digest for
  cross-model handoffs.

It cannot control a running CRUMB process, simulate circuit behavior, edit an
arbitrary design, or convert a general Circuitarium project to CRUMB.

`crumb_compare_designs` is an observation tool. It does not open, control,
save, or modify CRUMB. The user performs those controls in the Unity
application and gives the resulting before/after artifacts to the adapter.
That separation is the first stage of the
[Unity adapter plan](unity-adapter-plan.md).

The comparison never assumes a file was authored by Unity. It applies the
selected evidence profile. Unknown XML structure forces partial,
`inconclusive` coverage and is represented only by an order-sensitive digest.

## Evidence profiles

The current profile is `crumb.unity/1.3.5`. It describes the interpretation
evidence applied by the adapter to the observed CRUMB 1.3.5 Unity-era save
format. It is not automatic detection of the application that created a file.
Its evidence combines controlled saves, reopened synthetic fixtures,
version-pinned installed-build observations, non-redistributed
developer-published validation designs, and explicitly labeled inference. See
[the provenance policy](../PROVENANCE.md) for the exact categories and limits.

Godot-era CRUMB compatibility is not currently claimed. It requires a distinct
profile and evidence corpus, such as `crumb.godot/<verified-version>`, built
from new controlled saves and reopen tests. A future Godot adapter must not
silently reuse Unity positional layouts or topology rules.

## Stable public identifiers

Branding and protocol identity are separate:

- `electronics_*` remains the simulator-neutral tool namespace.
- `crumb_*` remains the CRUMB-specific tool namespace.
- `electronics.mcp/0.2` remains the result-envelope contract.
- `crumb.file` remains the backend ID.
- `crumb.file/0.2` remains the adapter version.
- `crumb.unity/1.3.5` remains the current compatibility profile.

These identifiers are intentionally descriptive rather than brand-prefixed.
Keeping them stable avoids breaking existing MCP clients, prompts, handoff
records, and automation as Circuitarium gains additional integrations.

## Independence and redistribution boundary

CRUMBLE and Circuitarium MCP are independent community work. They are not
affiliated with, endorsed by, or sponsored by CRUMB or its developer or
publisher. CRUMB names and marks belong to their respective owners.

This repository does not redistribute CRUMB code, binaries, engine metadata,
assets, logos, decompiled source, or third-party circuit designs. Its committed
`.cru` fixtures are small synthetic files produced by independently authored
code. External designs used for compatibility observations remain outside the
repository and public CI. Users must obtain and license CRUMB separately if
they choose to open generated files in the application.

Start with [`electronics_capabilities`](contract.md#electronics_capabilities)
for machine-readable availability and limitations, then use
`crumb_analyze_design` in summary mode before requesting bounded detail. Use
`crumb_compare_designs` when a controlled Unity change or Save As operation
needs an evidence-backed difference report.
