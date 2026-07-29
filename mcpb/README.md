# Circuitarium MCP bundle

`manifest.json` is the source manifest for the one-click local MCP bundle
attached to each GitHub Release. The bundle contains the compiled server and
all production Node.js dependencies; it does not contain CRUMB,
Logisim-evolution, Java, simulator assets, or user circuit files.

The current `0.4.0-dev.0` source manifest identifies the next bundle candidate
and its 23-tool, ten-Resource, four-Prompt Logisim-capable server. That
development identity is not published. The existing 0.3.1 bundle remains the
tagged 22-tool, nine-Resource artifact.

Build and verify it with:

```powershell
npm run mcpb:check
```

The default check creates the bundle in a guarded temporary directory,
validates and unpacks it with the pinned MCPB CLI, starts the unpacked server,
lists all 23 tools, lists all ten knowledge Resources and reads representative
capability, component-profile, Logisim-catalog, and run-record Resources,
lists and gets a workflow Prompt, plans verification, validates and seals a
minimal unsigned run record, runs `crumb_trace_net` and
`crumb_check_design` against the independently authored synthetic LED fixture,
and runs `logisim_analyze_design` against the full-adder copied from the
unpacked bundle before removing the temporary artifact.

When `CIRCUITARIUM_LOGISIM_JAR` identifies a Logisim-evolution 4.1.0 JAR, the
same audit also makes a real stdio `logisim_component_stats` call through the
unpacked bundle and requires runtime evidence marked
`self-reported-unverified` at version `4.1.0`. The no-JAR path remains the
ordinary bundle audit.

The 0.3.1 installer always asks for a circuit workspace. Its
Logisim-evolution 4.1.0 all-JAR and Java 21 selectors are optional; they only
enable the three JAR-backed runtime tools.

Release automation sets `CIRCUITARIUM_KEEP_MCPB=1`, which retains
`circuitarium-mcp-<version>.mcpb`. When `GITHUB_OUTPUT` is present, the verifier
also writes its absolute path as `bundle=<path>` for the release job.
