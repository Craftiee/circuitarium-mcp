# MCP client configurations

These examples launch the published `circuitarium-mcp@0.2.1` package over
standard input/output. Before copying one, replace
`/absolute/path/to/circuit-workspace` with the smallest directory that should
contain the `.cru` files the model may inspect or generate.
That published package exposes 14 CRUMBLE tools and no Logisim tools.

The configured directory is a security boundary, not a search hint.
Circuitarium rejects paths outside it, but tool results can still be sent to
the model selected in the host application. Do not point the server at a home
directory, drive root, or unrelated source tree.

| Host | Copyable example |
|---|---|
| Codex | [`codex.toml`](codex.toml) |
| Claude Code | [`claude-code.md`](claude-code.md) |
| VS Code | [`vscode-mcp.json`](vscode-mcp.json) |
| LM Studio | [`lm-studio-mcp.json`](lm-studio-mcp.json) |
| Jan | [`jan.md`](jan.md) |

Claude Desktop users can instead download
`circuitarium-mcp-0.2.1.mcpb` from the matching GitHub Release and open it.
The installer asks for the circuit workspace and bundles the server's Node.js
dependencies. It exposes the same 14-tool CRUMBLE surface as npm version
0.2.1.

After connecting, ask the host to call `electronics_capabilities`, then
`crumb_list_projects`. A healthy published 0.2.1 connection reports 14 tools.

The Unreleased 0.3.0 source tree reports 20 tools and adds Logisim `.circ` and
`.vec`/`.txt` access under the same workspace boundary. Its MCPB source
manifest also adds optional Logisim JAR and Java selectors, but no 0.3.0
package or bundle is published yet. Use the
[source-checkout Logisim setup](../../docs/logisim.md) to test it.
