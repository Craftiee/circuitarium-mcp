# Claude Code

Run this from the project where you want Circuitarium available. Replace the
workspace placeholder first:

```bash
claude mcp add --transport stdio \
  --env CIRCUITARIUM_MCP_ROOT=/absolute/path/to/circuit-workspace \
  --scope local \
  circuitarium -- npx -y circuitarium-mcp@0.2.1
```

On PowerShell, use one line:

```powershell
claude mcp add --transport stdio --env CIRCUITARIUM_MCP_ROOT=C:\absolute\path\to\circuit-workspace --scope local circuitarium -- npx -y circuitarium-mcp@0.2.1
```

Verify the registration with:

```text
claude mcp get circuitarium
```

Inside Claude Code, open `/mcp` and confirm that the published 0.2.1 server
exposes 14 tools.
Use `--scope project` instead of `--scope local` only when you intentionally
want Claude Code to write a shared `.mcp.json` entry for the team.

The six Logisim tools are part of the Unreleased 0.3.0 source tree, not the
`npx ...@0.2.1` commands above. To test them, follow the
[source-checkout Logisim setup](../../docs/logisim.md); that setup adds
`CIRCUITARIUM_LOGISIM_JAR` and, only if needed, `CIRCUITARIUM_JAVA`.
