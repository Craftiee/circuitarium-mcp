# MCP client configurations

These examples launch the published `circuitarium-mcp@0.2.1` package over
standard input/output. Before copying one, replace
`/absolute/path/to/circuit-workspace` with the smallest directory that should
contain the `.cru` files the model may inspect or generate.

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
dependencies; no manual JSON edit is required.

After connecting, ask the host to call `electronics_capabilities`, then
`crumb_list_projects`. A healthy connection reports 14 tools.
