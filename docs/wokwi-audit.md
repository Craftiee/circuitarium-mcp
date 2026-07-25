# Wokwi CLI/MCP audit

Audit date: 2026-07-25. This is a point-in-time review of the pinned upstream
commit below, not a claim about later Wokwi releases.

## What it is

The official [`wokwi/wokwi-cli`](https://github.com/wokwi/wokwi-cli) repository
was inspected at commit
[`7a208779ef6579463626a24f898ab08495ee247e`](https://github.com/wokwi/wokwi-cli/tree/7a208779ef6579463626a24f898ab08495ee247e).
Its MCP implementation is TypeScript and runs as:

```text
wokwi-cli mcp [path] [-q]
```

Wokwi describes MCP support as experimental in its
[official documentation](https://docs.wokwi.com/wokwi-ci/mcp-support).
The command requires a `WOKWI_CLI_TOKEN`.

The open repository contains the CLI, MCP wrapper, client protocol, project
linter, and support libraries. The actual simulator runs on Wokwi's hosted
service: the CLI uploads the project diagram and firmware over a WebSocket and
streams results back. A Wokwi token/quota is separate from Claude, ChatGPT, or
OpenAI API access.

## Current tool surface

The implementation exposes 11 tools:

1. `wokwi_start_simulation`
2. `wokwi_stop_simulation`
3. `wokwi_resume_simulation`
4. `wokwi_restart_simulation`
5. `wokwi_get_status`
6. `wokwi_write_serial`
7. `wokwi_read_serial`
8. `wokwi_read_pin`
9. `wokwi_set_control`
10. `wokwi_take_screenshot`
11. `wokwi_export_vcd`

Source:
[`WokwiMCPTools.ts`](https://github.com/wokwi/wokwi-cli/blob/7a208779ef6579463626a24f898ab08495ee247e/packages/cli/src/mcp/WokwiMCPTools.ts).

The server also exposes existing `wokwi.toml` and `diagram.json` files as MCP
resources. The entrypoint and server routing are in
[`mcp.ts`](https://github.com/wokwi/wokwi-cli/blob/7a208779ef6579463626a24f898ab08495ee247e/packages/cli/src/commands/mcp.ts)
and
[`MCPServer.ts`](https://github.com/wokwi/wokwi-cli/blob/7a208779ef6579463626a24f898ab08495ee247e/packages/cli/src/mcp/MCPServer.ts).

The repository built successfully and all 88 existing unit tests passed during
the audit. A local MCP client probe enumerated all 11 tools. No authenticated
cloud simulation was started.

## Useful ideas to retain

- An MCP can target an application/service, not just a game engine.
- Keep the MCP facade thin and put simulator behavior behind a provider
  interface.
- Expose lifecycle, serial, pins, controls, screenshots, and trace artifacts as
  recognizable user goals.
- Validate the project before opening a simulation session.

## Things Circuitarium MCP intentionally changes

The current Wokwi MCP has one implicit session per process, text-only outputs,
and no output schemas. Tool failures are returned as ordinary text. Serial data
can persist between runs, the screenshot tool returns only a short base64
prefix, and VCD export accepts a direct filesystem path.

The Circuitarium-neutral design should instead provide:

- explicit `sessionId` values and deterministic cleanup;
- structured results with units, logical timestamps, engine versions, and typed
  error codes;
- cursor-based serial/trace reads;
- artifacts identified by safe IDs or resource URIs;
- canonical path containment;
- capability negotiation for fidelity and supported components;
- deadlines, cancellation, and multiple sessions.

The relevant boundary is not "Godot MCP" versus "Unity MCP." Wokwi demonstrates
that the useful integration point is a controllable simulation contract. CRUMB
currently lacks that live contract, so its first adapter uses `.cru` files.
