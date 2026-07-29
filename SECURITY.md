# Security Policy

## Supported versions

Security fixes target the latest `0.3.x` patch and the latest revision of
`main`; older releases, older commits, and independently modified copies
receive no support guarantee.

| Version | Supported |
| --- | --- |
| `0.3.x` | Yes |
| `< 0.3.0` | No |

## Reporting a vulnerability

Do not disclose exploitable details in a public issue, discussion, pull
request, or circuit fixture.

GitHub private vulnerability reporting is enabled and is the preferred
channel. Use **Security → Report a vulnerability** or the
[private advisory form](https://github.com/Craftiee/circuitarium-mcp/security/advisories/new)
to contact the maintainers without publishing the report.

No project security email is published yet. If private vulnerability reporting
is not available, open a public issue containing no technical details and ask
the maintainers to establish a private contact channel. As part of every
release, maintainers verify that private vulnerability reporting remains
enabled or publish another stable private route.

Include the affected revision, operating system, Node.js version, impact,
minimal reproduction steps, and any suggested mitigation. Use a synthetic
fixture and remove personal, proprietary, and third-party circuit data.

Maintainers will acknowledge a private report, assess impact, coordinate a fix,
and agree on disclosure timing. Response times are best effort while the
project is maintained by a small, early-stage community.

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

`crumb_trace_net` builds a static connectivity graph from the decoded artifact
and fails closed before exceeding 50,000 nodes or 100,000 edges. Those work
caps limit graph expansion; a trace is not simulation evidence and does not
establish current flow, timing, or live switch state.

Treat Logisim `.circ` projects and `.vec` test vectors as untrusted input too.
The optional JAR-backed tools launch the separately configured Java and
Logisim-evolution JAR as child processes under the same operating-system
account. Circuitarium adds argument, file, output, and timeout bounds, but it
does not provide an OS sandbox, isolate Logisim preferences, or restrict the
child process beyond the account's permissions. Configure only a trusted
official 4.1.0 all-JAR, use a dedicated workspace and account/profile where
appropriate, and do not treat the runtime's unauthenticated
`self-reported-unverified` version as cryptographic proof of JAR provenance.

Treat all circuit files, labels, and embedded source as untrusted input:

- point `CIRCUITARIUM_MCP_ROOT` at a dedicated directory containing no secrets;
- grant the MCP process only the filesystem permissions it needs;
- back up original circuit files before analysis or generation;
- do not expose the stdio server through a public or shared network wrapper
  without adding authentication, authorization, isolation, limits, and audit
  logging; and
- review model-requested file operations before granting a host broad approval.

Treat run records as untrusted structured input and potentially sensitive
output. External documents should use `serializedRecord`, which rejects
duplicate and escaped-equivalent keys before ordinary JSON parsing. The
structured `record` input cannot recover duplicate keys already collapsed by
an upstream parser. Both paths enforce aggregate byte, depth, property, string,
collection, reference, and extension bounds.

The run-record core excludes raw commands, environment values, absolute paths,
and raw payloads. Bounded caller-authored text can still contain secrets or
prompt-injection content and is returned as data, never instructions. Do not
store credentials, proprietary PDK data, foundry-confidential material, or
unredacted private designs in a portable record.

`evidenceDigest` and `recordDigest` are unsigned SHA-256 identities. They can
detect a conflict only when an expected digest is trusted separately. Anyone
who can modify a record can recompute its self-contained hashes. A valid seal
does not authenticate origin, prove execution, establish tool-binary identity,
grant permission, approve safety, authorize signoff, or certify fabrication
readiness. Unknown critical extensions fail closed; unknown noncritical
extensions are preserved without gaining core claim authority.

Relevant reports include path-containment or symlink escapes, unintended
overwrite, parser denial of service, unbounded or sensitive-data disclosure,
stdio protocol injection, run-record canonicalization or duplicate-key
ambiguity, evidence-authority escalation, digest-scope confusion, and
incorrect redaction of embedded content.
