# Security Policy

## Supported versions

Until the first tagged release, only the latest revision of `main` receives
security fixes. This experimental project provides no support guarantee for
older commits or independently modified copies.

## Reporting a vulnerability

Do not disclose exploitable details in a public issue, discussion, pull
request, or circuit fixture.

GitHub private vulnerability reporting is enabled and is the preferred
channel. Use **Security → Report a vulnerability** or the
[private advisory form](https://github.com/Craftiee/circuitarium-mcp/security/advisories/new)
to contact the maintainers without publishing the report.

No project security email is published yet. If private vulnerability reporting
is not available, open a public issue containing no technical details and ask
the maintainers to establish a private contact channel. Before a tagged
release, maintainers must verify that private vulnerability reporting remains
enabled or publish another stable private route.

Include the affected revision, operating system, Node.js version, impact,
minimal reproduction steps, and any suggested mitigation. Use a synthetic
fixture and remove personal, proprietary, and third-party circuit data.

Maintainers will acknowledge a private report, assess impact, coordinate a fix,
and agree on disclosure timing. Response times are best effort while the
project is pre-release.

## Security boundary

The current MCP server is a local stdio process intended to be launched by a
trusted MCP host under the user's operating-system account. It is not a
network service and does not provide authentication, authorization between
users, TLS, tenant isolation, rate limiting, or sandboxing.

The CRUMBLE backend can read `.cru` files within `CIRCUITARIUM_MCP_ROOT` and
can create specific generated fixtures there. `ELECTRONICS_MCP_ROOT` remains a
compatibility fallback for existing installations. It rejects paths outside
the selected root, oversized inputs, unsupported extensions, and overwrites.
These checks reduce risk; they do not make an untrusted host, model, plugin,
workspace, or operating-system account safe.

Reads use one opened file handle, a fixed byte ceiling, and before/after file
identity checks. Directory discovery streams entries and skips symbolic links.
Node does not expose a race-free directory-relative open/write primitive on
every supported platform, so the configured workspace and its parent
directories must not be concurrently replaced by an untrusted local process.
This is a local same-account trust boundary, not a defense against a hostile
user who can mutate the workspace while the server runs.

Treat all circuit files, labels, and embedded source as untrusted input:

- point `CIRCUITARIUM_MCP_ROOT` at a dedicated directory containing no secrets;
- grant the MCP process only the filesystem permissions it needs;
- back up original circuit files before analysis or generation;
- do not expose the stdio server through a public or shared network wrapper
  without adding authentication, authorization, isolation, limits, and audit
  logging; and
- review model-requested file operations before granting a host broad approval.

Relevant reports include path-containment or symlink escapes, unintended
overwrite, parser denial of service, unbounded or sensitive-data disclosure,
stdio protocol injection, and incorrect redaction of embedded content.
