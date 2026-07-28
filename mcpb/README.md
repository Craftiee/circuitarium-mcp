# Circuitarium MCP bundle

`manifest.json` is the source manifest for the one-click local MCP bundle
attached to each GitHub Release. The bundle contains the compiled server and
all production Node.js dependencies; it does not contain CRUMB, CRUMB assets,
or user circuit files.

Build and verify it with:

```powershell
npm run mcpb:check
```

The default check creates the bundle in a guarded temporary directory,
validates and unpacks it with the pinned MCPB CLI, starts the unpacked server,
lists all 14 tools, runs `crumb_check_design` against the independently
authored synthetic LED fixture, and then removes the temporary artifact.

Release automation sets `CIRCUITARIUM_KEEP_MCPB=1`, which retains
`circuitarium-mcp-<version>.mcpb`. When `GITHUB_OUTPUT` is present, the verifier
also writes its absolute path as `bundle=<path>` for the release job.
