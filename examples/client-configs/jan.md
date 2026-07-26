# Jan

Open **Settings → MCP Servers → Add MCP Server** and enter:

| Field | Value |
|---|---|
| Name | `circuitarium` |
| Transport | `STDIO` |
| Command | `npx` |
| Args | `-y`, `circuitarium-mcp@0.2.0` |
| Env | `CIRCUITARIUM_MCP_ROOT=/absolute/path/to/circuit-workspace` |

Replace the workspace placeholder, enable the server, and select a model with
tool calling enabled. Keep per-tool approvals on while evaluating a new model;
Jan's global “Allow All MCP Tool Permissions” setting is not required for
Circuitarium.
