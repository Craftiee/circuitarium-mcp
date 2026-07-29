# MCP client configurations

These examples launch the published `circuitarium-mcp@0.3.0` package over
standard input/output. Before copying one, replace
`/absolute/path/to/circuit-workspace` with the smallest directory that should
contain the `.cru` files the model may inspect or generate and the `.circ` and
`.vec`/`.txt` files it may inspect. The package exposes 22 tools across
CRUMBLE and Logisim-evolution.

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
`circuitarium-mcp-0.3.0.mcpb` from the matching GitHub Release and open it.
The installer asks for the circuit workspace and bundles the server's Node.js
dependencies. It exposes the same 22-tool surface as npm version 0.3.0 and
offers optional Logisim JAR and Java selectors.

After connecting, ask the host to call `electronics_capabilities`, then
`crumb_list_projects`. A healthy published 0.3.0 connection reports 22 tools,
nine read-only knowledge Resources, and four workflow Prompts. See the
[Logisim setup](../../docs/logisim.md) to enable the optional runtime tools.
