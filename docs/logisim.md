# Logisim-evolution adapter

Circuitarium MCP includes an experimental, version-pinned adapter for
Logisim-evolution 4.1.0. It combines a clean-room `.circ` reader with bounded
subprocess calls to a separately installed, user-supplied Logisim-evolution
JAR.

> **Release status:** this adapter is included in the published
> `circuitarium-mcp@0.3.1` package and `circuitarium-mcp-0.3.1.mcpb`.

Circuitarium does **not** bundle, download at runtime, link against, or
redistribute Logisim-evolution. Circuitarium remains Apache-2.0; the user
supplies Logisim-evolution under its own GPL-3.0 license.

## Setup

1. Install Java 21 or newer.
2. Download the official
   [`logisim-evolution-4.1.0-all.jar`](https://github.com/logisim-evolution/logisim-evolution/releases/tag/v4.1.0).
3. Set `CIRCUITARIUM_LOGISIM_JAR` to its absolute path in the MCP host
   configuration.
4. If `java` is not on `PATH`, set `CIRCUITARIUM_JAVA` to the Java 21
   executable.
5. Set `CIRCUITARIUM_MCP_ROOT` to the smallest directory containing the
   `.circ` and `.vec`/`.txt` files the model may access.

For a source checkout, build with `npm ci` and `npm run build`, then point the
MCP host at its production entrypoint:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/circuitarium-mcp/dist/src/bin.js"],
  "env": {
    "CIRCUITARIUM_MCP_ROOT": "/absolute/path/to/circuit-workspace",
    "CIRCUITARIUM_LOGISIM_JAR": "/absolute/path/to/logisim-evolution-4.1.0-all.jar",
    "CIRCUITARIUM_JAVA": "java"
  }
}
```

The equivalent immutable package command is
`npx -y circuitarium-mcp@0.3.1`.

`LOGISIM_JAR` remains a compatibility fallback, but new configurations should
use `CIRCUITARIUM_LOGISIM_JAR`.

### Linux test-vector display requirement

Logisim-evolution 4.1.0 implements `--test-vector` through its non-TTY AWT
startup path. On Linux, `logisim_run_test_vector` therefore requires a working
X11 `DISPLAY`; the statistics and truth-table tools do not. Circuitarium does
not start or control an X server. On a display-less host, install Xvfb and
launch the MCP host beneath it:

```text
xvfb-run -a node /absolute/path/to/circuitarium-mcp/dist/src/bin.js
```

For an MCP client configuration, use `xvfb-run` as the command and place
`-a`, `node`, and the server entrypoint at the beginning of `args`. The Java
JAR remains a direct, shell-free child of the MCP server. If Linux has no
trusted `DISPLAY`, the test-vector tool returns `BACKEND_UNAVAILABLE` before
starting Java rather than reporting an opaque parser failure.

The adapter probes `--version` before each runtime operation and accepts only a
JAR that self-reports Logisim-evolution 4.1.0 using the expected four-line
response. This is a compatibility check, not publisher authentication: the
runtime result labels the configured JAR
`authenticity: "self-reported-unverified"`, and Circuitarium does not compare
that user-supplied file to the upstream release digest. Use a JAR obtained from
the official setup link above.

## Six tools

| Tool | Evidence | Requires JAR |
|---|---|---|
| `logisim_list_projects` | Stable workspace refs, sizes, timestamps, raw-byte SHA-256 digests | No |
| `logisim_analyze_design` | Static project, library, circuit, component, wire, Pin, Clock, and unknown-construct structure | No |
| `logisim_export_netlist` | Explicitly partial simulator-neutral coordinate graph and conversion-loss markers | No |
| `logisim_component_stats` | Logisim accepted the project and returned component totals | Yes |
| `logisim_truth_table` | Bounded combinational rows evaluated by Logisim | Yes |
| `logisim_run_test_vector` | Explicit vectors executed by Logisim with structured mismatches | Yes |

Two static Resources improve model orientation without changing this six-tool
adapter boundary:

- `circuitarium://schemas/component-profile/0.1` contains a neutral structural
  profile schema, explicit semantic cross-reference constraints, and 11
  curated, source-cited Logisim planning profiles.
- `circuitarium://catalogs/logisim-evolution/4.1.0/standard-library` inventories
  all 14 built-in libraries and 169 exact component identities from the
  official v4.1.0 source commit
  `632d66dca880ac089e2c6c2c383ea20d9c707ee2`.

The catalog distinguishes semantic profiles from identity-only recognition.
It does not add port geometry to the neutral IR, execute component behavior,
or override the runtime preflight. HDL-IP, TCL, SoC, and Input/Output-Extra
remain runtime-forbidden; `I/O` remains conditional because Telnet is denied.
TTL names are simulator identities, not manufacturer-verified voltage, timing,
current, power, or package models.

The neutral `electronics_plan_verification` Tool can select an evidence path
for explicit Logisim claims. Its returned steps are a plan, not executed work:
caller-reported receipts are unauthenticated, truth tables are not expected
oracles, and finite vectors cover only their listed cases or sequences.
Circuit-specific receipts must name the exact target circuit. An exhaustive
claim must match the declared `2 ** inputBits` space; vector evidence must also
report distinct input assignments, not merely the same row count, and bind to
the exact vector reference and digest. Zero-input constant circuits have one
exhaustive assignment. Failed supporting receipts and `runtimeSafe: false`
facts fail affected runtime verification paths closed.

Every project operation supports `expectedProjectDigest`. The digest is
checked against the exact raw bytes before XML parsing. Runtime operations then
copy those already-read bytes into a newly created private temporary directory
under fixed names (`project.circ` and, when needed, `vectors.vec`), invoke Java
only with those staged snapshots, await completion, and remove the directory
on success or failure. Caller filenames are never reused for staging.
Test-vector calls also support `expectedVectorDigest`.
Because Logisim 4.1.0 test-vector mode initializes its non-TTY startup path,
Circuitarium also copies the configured JAR into the private staging
directory under the fixed name `runtime.jar`. The version probe and vector
operation both execute that isolated copy, where no sibling
`logisim-defaults` directory exists. Configured JARs larger than 256 MiB are
refused for this isolated mode.

## Evidence boundary

The adapter deliberately distinguishes three levels:

1. **Static file evidence** recognizes XML structure and declared metadata.
   It does not execute a gate.
2. **Project-load evidence** comes from Logisim's `--tty stats` command. It
   proves the configured JAR loaded and inventoried the selected circuit, but
   it does not prove outputs.
3. **Non-interactive simulation evidence** comes from Logisim's documented
   truth-table or test-vector commands for one exact project digest.
   Test-vector mode still initializes AWT internally and needs an X11 display
   on Linux, even though Circuitarium does not automate or expose a live GUI.

The neutral netlist is marked `partial`. It joins exact wire endpoints and
ports whose coordinates the clean-room adapter can model safely. It does not
guess built-in gate port geometry, mid-segment junction semantics, timing,
state, or component behavior. Use the JAR tools when behavioral evidence is
required.

Truth-table generation is refused when Pin direction/width metadata is
incomplete or declared input width exceeds the caller's bound. The public
maximum is 12 input bits; the default is 8. Returned rows, component
statistics, nets, losses, failures, and nested memberships all have explicit
bounds. It is also refused when an output Pin label normalizes to the reserved
label `halt` under Logisim-evolution 4.1.0's TTY label rules (for example,
`halt!`), because that label selects run-until-halt behavior instead of
ordinary combinational table output. Use an explicit test vector, or rename
the output only when it is not intentionally a halt signal.

Every public string in a Logisim result is limited to 4,096 characters.
Oversized values become bounded previews carrying the original character and
byte counts plus SHA-256. The aggregate serialized Logisim result envelope is
limited to 2 MiB; a result that remains larger returns `QUOTA_EXCEEDED` instead
of entering the model context.

Test-vector assertion failures are domain results:

```json
{
  "ok": true,
  "data": {
    "valid": false,
    "passedVectors": 7,
    "failedVectors": 1
  }
}
```

Logisim 4.1.0 can exit with process code `0` even when vectors fail.
Circuitarium therefore parses and validates Logisim's final `Passed`/`Failed`
summary instead of treating the process exit code as the test verdict.

## Subprocess and filesystem safety

- Java is launched directly with an argument array and `shell: false`.
- The server never builds a command string from project, circuit, or vector
  input.
- Project and vector paths are canonicalized inside
  `CIRCUITARIUM_MCP_ROOT`; symlink/reparse traversal is rejected.
- Exact project/vector byte snapshots are staged under private, fixed-name
  temporary files and reliably removed after the awaited subprocess work.
- Test-vector mode copies the configured JAR into that private directory
  before probing and execution, preventing executable-directory discovery of
  a configured JAR's sibling `logisim-defaults` content.
- Before staging, a full-stream runtime-safety assessment defaults to denial
  when the project contains an external file/JAR library descriptor, VHDL,
  file/URL/unsafe path-bearing attributes, HDL-IP, I/O Extra, SoC, TCL or
  Telnet runtime features, a source-version mismatch, or unknown/malformed XML
  constructs. Only a project with no recorded runtime-safety reason proceeds.
- The JAR path comes only from explicit local configuration. The configured
  JAR must self-report 4.1.0, but the local file is not authenticated as the
  official release asset.
- Every child has a timeout and separate stdout/stderr byte limits.
- A child is force-terminated when a limit is exceeded.
- The child receives an allowlisted environment rather than the MCP server's
  API tokens or Java option-injection variables. `DISPLAY` and `XAUTHORITY`
  are forwarded only when already present so Linux test-vector mode can use a
  host-provided X server.
- Compatibility probes use a headless early-exit TTY command that avoids
  initializing Logisim preferences.
- Project execution forces English output for strict parsing. Upstream
  Logisim may read or update per-user Java preferences, so all three
  JAR-backed tools advertise `readOnlyHint: false`.
- Output parsers require the documented English, machine-readable formats and
  reject inconsistent totals or columns.
- No GUI automation, process injection, persistent session, network service,
  or caller-selected project write is involved. Circuitarium itself writes
  only the private temporary staging described above; Logisim may separately
  update per-user Java preferences during project execution.

These controls reduce project-driven risk; they are **not an operating-system
sandbox or a malicious-JAR security boundary**. A configured JAR runs with the
Java process permissions of the MCP server and can lie about its version.
Install only a trusted JAR. Projects rejected by preflight may still be opened
manually in an appropriately isolated Logisim environment, but Circuitarium
will not execute them.

## Included demo

[`examples/logisim/full-adder.circ`](../examples/logisim/full-adder.circ) and
[`full-adder.vec`](../examples/logisim/full-adder.vec) are independently
authored project fixtures. The vector covers all eight combinations of `A`,
`B`, and `Cin`.

These repository/package assets are not automatically installed into the
circuit workspace. Before calling an MCP Tool against them, copy both files
inside the directory selected by `CIRCUITARIUM_MCP_ROOT`, then use their paths
relative to that directory (for example, `full-adder.circ` and
`full-adder.vec`). Do not broaden the workspace root to an npm cache or MCPB
installation directory merely to reach a packaged example.

For repository verification:

```text
set CIRCUITARIUM_LOGISIM_JAR=C:\path\to\logisim-evolution-4.1.0-all.jar
npm run logisim:e2e
```

On macOS, use the equivalent `export` syntax. On display-less Linux, run the
same command beneath `xvfb-run -a`. The dedicated CI job uses Xvfb, downloads
the upstream official v4.1.0 release asset, and verifies SHA-256
`fe6386a3217a591bcc311a4eda49e1f43a389b499dd3d0f6f40f344fc85f2577`
before checking project load, the eight-row truth table, all 8/8 vectors, and
all six MCP envelopes. CI then installs the npm tarball and unpacks the MCPB
bundle, launches each packaged server over stdio, parses the packaged
full-adder, and makes a JAR-backed call that must report version `4.1.0`.
That digest verification applies to the CI asset only; ordinary user-supplied
runtime JARs are not authenticated or hash-pinned.
