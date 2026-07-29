# MCP Inspector host verification

Circuitarium includes a reproducible host-side exercise for its complete MCP
tool surface. The harness launches the
[official MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
CLI at the exact version `2.0.0`, connects to Circuitarium over stdio, checks
`tools/list`, and calls all 23 registered tools in the current source tree.

This is release evidence, not a circuit certification. The exercise confirms
that an independent MCP client can discover and call the advertised surface
with the repository's synthetic examples. It does not prove compatibility with
private projects, physical hardware, a live CRUMB session, or a persistent
Logisim GUI session.

![Circuitarium running in the official MCP Inspector](https://raw.githubusercontent.com/Craftiee/circuitarium-mcp/v0.3.1/docs/assets/circuitarium-inspector-demo.gif)

The recording uses only the same synthetic CRUMB LED and Logisim full-adder
fixtures. It shows a clean CRUMB ERC result with two floating-terminal warnings
and a Logisim vector result with all eight independently authored cases passing.
The accompanying
[`inspector-tool-evidence.json`](assets/inspector-tool-evidence.json) is the
sanitized current-source CLI exercise; it contains no user path or raw host
session. The immutable v0.3.1 tag retains its original 22-of-22 report.

## What the harness uses

The script creates a new operating-system temporary directory and copies only
these independently authored repository examples into it:

- `fixtures/crumb/breadboard-led.cru`
- `fixtures/crumb/breadboard-resistor.cru`
- `examples/logisim/full-adder.circ`
- `examples/logisim/full-adder.vec`

`crumb_generate_fixture` writes one additional synthetic file inside that
temporary directory. The directory is deleted at the end of the run. The
checked summary contains no absolute paths, raw circuit bytes, session IDs,
tokens, timing data, or private artifacts.

The harness verifies the exact tool names and order, human-readable titles,
`readOnlyHint` on every tool, and `destructiveHint` on every tool that is not
read-only. Each result must use the `electronics.mcp/0.2` envelope. Tools that
return `data.valid` must return a passing verdict for this fixture set.

## Static-only run

MCP Inspector 2.0.0 requires Node.js 22.19.0 or newer. From a clean checkout:

```text
npm ci
npm run build
npx tsx scripts/verify-inspector-tools.ts --output inspector-evidence.json
```

Without `CIRCUITARIUM_LOGISIM_JAR`, the harness still calls every tool. The 20
neutral, CRUMB, and static Logisim calls must pass. The three Logisim runtime
calls must return the typed `BACKEND_UNAVAILABLE` envelope, and the sanitized
report records them as `skipped-runtime-unconfigured`. Any other result fails
the run.

Expected totals:

```json
{
  "called": 23,
  "passed": 20,
  "skipped": 3,
  "failed": 0
}
```

## Full release run with Logisim-evolution

Release QA must repeat the exercise with Java 21 or newer and the separately
downloaded official
[`logisim-evolution-4.1.0-all.jar`](https://github.com/logisim-evolution/logisim-evolution/releases/tag/v4.1.0).
Circuitarium does not download, bundle, link, or redistribute that JAR.

Verify the release asset before using it. Its pinned SHA-256 is:

```text
fe6386a3217a591bcc311a4eda49e1f43a389b499dd3d0f6f40f344fc85f2577
```

PowerShell:

```powershell
$jar = "C:\path\to\logisim-evolution-4.1.0-all.jar"
if ((Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant() -ne "fe6386a3217a591bcc311a4eda49e1f43a389b499dd3d0f6f40f344fc85f2577") {
  throw "Unexpected Logisim-evolution JAR digest."
}
$env:CIRCUITARIUM_LOGISIM_JAR = $jar
npx tsx scripts/verify-inspector-tools.ts --require-runtime --output inspector-evidence.json
```

Linux:

```bash
export CIRCUITARIUM_LOGISIM_JAR=/absolute/path/to/logisim-evolution-4.1.0-all.jar
printf '%s  %s\n' \
  fe6386a3217a591bcc311a4eda49e1f43a389b499dd3d0f6f40f344fc85f2577 \
  "$CIRCUITARIUM_LOGISIM_JAR" | sha256sum --check -
npx tsx scripts/verify-inspector-tools.ts \
  --require-runtime \
  --output inspector-evidence.json
```

macOS:

```bash
export CIRCUITARIUM_LOGISIM_JAR=/absolute/path/to/logisim-evolution-4.1.0-all.jar
printf '%s  %s\n' \
  fe6386a3217a591bcc311a4eda49e1f43a389b499dd3d0f6f40f344fc85f2577 \
  "$CIRCUITARIUM_LOGISIM_JAR" | shasum --algorithm 256 --check
npx tsx scripts/verify-inspector-tools.ts \
  --require-runtime \
  --output inspector-evidence.json
```

Logisim-evolution 4.1.0 test-vector mode needs a trusted X11 display on Linux.
On a display-less release runner, execute the final command under Xvfb:

```bash
xvfb-run -a npx tsx scripts/verify-inspector-tools.ts \
  --require-runtime \
  --output inspector-evidence.json
```

Set `CIRCUITARIUM_JAVA` to an absolute Java executable only when the correct
Java 21+ binary is not already on `PATH`. Logisim may read or update its
per-user Java preferences even though each Circuitarium request is a bounded
one-shot subprocess; use an appropriately isolated release environment.

`--require-runtime` turns every runtime skip into a failure. A complete release
run has these totals:

```json
{
  "called": 23,
  "passed": 23,
  "skipped": 0,
  "failed": 0
}
```

## Covered tools

| Evidence layer | Tools | Expected evidence |
|---|---|---|
| Neutral | `electronics_capabilities`, `electronics_validate_experiment`, `electronics_plan_verification`, `electronics_validate_run_record` | Capability, schema-validation, non-certifying planning, and unsigned run-record sealing results |
| CRUMB static | `crumb_component_catalog`, `crumb_analyze_design`, `crumb_compare_designs`, `crumb_inspect_design`, `crumb_validate_design`, `crumb_list_projects`, `crumb_get_component`, `crumb_bom`, `crumb_ic_reference`, `crumb_export_netlist`, `crumb_trace_net`, `crumb_check_design` | Static Unity-era CRUMB 1.3.5 save evidence; no live game control or simulation |
| CRUMB bounded write | `crumb_generate_fixture` | One non-overwriting synthetic file inside the temporary workspace |
| Logisim static | `logisim_list_projects`, `logisim_analyze_design`, `logisim_export_netlist` | Saved `.circ` structure and an explicitly partial neutral representation |
| Logisim runtime | `logisim_component_stats` | The configured JAR self-reported 4.1.0 and loaded the selected project; this does not authenticate the JAR or prove output behavior |
| Logisim behavior | `logisim_truth_table`, `logisim_run_test_vector` | Bounded non-interactive evidence for the exact synthetic project; no persistent GUI session |

The output JSON is intentionally compact and deterministic, so maintainers can
compare release runs without publishing machine paths or raw host transcripts.
Keep the full report with the release checklist, and publish only the sanitized
summary when sharing verification evidence.
