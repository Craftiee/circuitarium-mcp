# Support

Circuitarium MCP is an experimental community project. Support covers this
repository's code and documented interfaces, including the CRUMBLE integration,
not CRUMB itself or any other simulator.

## Questions and feature ideas

Use [GitHub Discussions](https://github.com/Craftiee/circuitarium-mcp/discussions)
when enabled. Otherwise,
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
- a newly created minimal synthetic save, if one is necessary and you have the
  right to share it.

Do not upload game binaries, extracted assets, decompiled source, access tokens,
private firmware, personal circuit files, or third-party designs without
permission. Prefer a minimal save containing one independently placed component.

## Compatibility scope

The public alpha's CRUMBLE integration supports the observed CRUMB 1.3.5
Unity-era file format only. CRUMB 2.x/Godot support and live simulation control
are not currently provided. Unknown formats should be reported as
compatibility gaps rather than silently treated as supported.

For installation, billing, gameplay, or product-support questions about CRUMB,
contact its developer through the official CRUMB support channels.

## Security reports

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md).
