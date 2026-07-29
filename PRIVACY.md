# Privacy Policy

Last updated: July 28, 2026

Circuitarium MCP is a local, open-source MCP server. It runs on your computer
over standard input/output and does not operate a Circuitarium-hosted service.

## Data Circuitarium accesses

Circuitarium accesses only the local paths and configuration needed for the
tool you request:

- files beneath `CIRCUITARIUM_MCP_ROOT`, normally `.cru`, `.circ`, `.vec`, or
  `.txt` circuit artifacts;
- an optional Logisim-evolution JAR and Java executable that you configure;
- tool arguments supplied by your MCP host; and
- private temporary copies made for bounded Logisim execution or the optional
  `doctor --smoke` check.

Circuitarium does not access conversation history, model memory, unrelated
files, accounts, contacts, or credentials. It contains no telemetry,
advertising, analytics, or background network reporting.

## Use and storage

Circuitarium uses circuit data locally to parse, validate, compare, summarize,
or simulate the artifact requested by the current tool call. It returns the
result to the MCP host that launched it.

Read tools do not modify source artifacts. `crumb_generate_fixture` can create
a new synthetic `.cru` file at a path you explicitly provide; it refuses to
overwrite an existing file. Logisim runtime tools stage private snapshots in
the operating system's temporary directory and remove the staging directory
when the operation finishes. An interrupted process may leave temporary files
for the operating system or user to clean up.

The independently installed Java or Logisim-evolution process may maintain its
own local preferences, caches, or logs. Circuitarium runs Logisim against
staged circuit copies but does not control or delete those external
application records.

Circuitarium does not maintain a user database, remote logs, or a
maintainer-controlled copy of tool inputs or results. Files that you create in
your workspace remain there until you remove them.

## Sharing and third parties

Circuitarium does not send circuit files or tool results to Craftiee or another
third party. When a Logisim runtime tool is used, local snapshots are passed
only to the locally configured Java and Logisim-evolution processes.

Your MCP host or model provider may process tool arguments and results under
its own privacy policy. npm, GitHub, your Java distribution, and
Logisim-evolution also apply their own policies when you obtain those
independent products. Circuitarium neither controls those products nor
receives data from them.

## Retention and deletion

Circuitarium retains no data on a maintainer-controlled system. Temporary
runtime snapshots are deleted after each operation as described above. Delete
an explicitly generated fixture from your workspace using your normal file
tools. Consult your MCP host or model provider for its retention and deletion
controls.

## Changes

Material changes to this policy will be committed to the public repository.
The Git history provides the change record.

## Contact

For privacy questions, open a
[GitHub Discussion](https://github.com/Craftiee/circuitarium-mcp/discussions).
For a sensitive security or privacy report, follow
[SECURITY.md](https://github.com/Craftiee/circuitarium-mcp/blob/main/SECURITY.md).
