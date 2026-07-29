# Support

Circuitarium MCP is an experimental community project. Support covers this
repository's code and documented interfaces, including the CRUMBLE and
Logisim-evolution integrations, not CRUMB, Logisim-evolution, or any other
simulator itself.

## Questions and feature ideas

Use [GitHub Discussions](https://github.com/Craftiee/circuitarium-mcp/discussions)
for questions, setup help, and design proposals. For actionable bugs and
features,
[open an issue](https://github.com/Craftiee/circuitarium-mcp/issues/new/choose)
and describe the user goal, model host, operating system, Node.js version,
backend, and adapter version.

## Bug reports

Include:

- the smallest reproducible sequence of MCP or CLI calls;
- the returned typed error and diagnostics;
- operating system and Node.js version;
- `contractVersion`, `backendId`, and `adapterVersion`;
- the CRUMB version and Steam build ID when reporting `.cru` compatibility;
- the Logisim-evolution and Java versions, selected circuit, whether the
  optional JAR runtime was configured, and Linux display/Xvfb details when
  reporting `.circ` or test-vector compatibility;
- a newly created minimal synthetic save, if one is necessary and you have the
  right to share it.

Do not upload game binaries, extracted assets, decompiled source, access tokens,
private firmware, personal circuit files, or third-party designs without
permission. Prefer a minimal save containing one independently placed component.

## Compatibility scope

The current CRUMBLE integration supports the observed CRUMB 1.3.5 Unity-era
file format only. CRUMB 2.x/Godot support and live simulation control are not
currently provided. Unknown formats should be reported as compatibility gaps
rather than silently treated as supported.

The Logisim-evolution integration targets version 4.1.0. Static inspection is
available without Java; runtime-backed project statistics, truth tables, and
test vectors require a separately configured official 4.1.0 all-JAR.

For installation, billing, gameplay, or product-support questions about a
simulator, contact that simulator's maintainers through its official support
channels.

## Security reports

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md).
