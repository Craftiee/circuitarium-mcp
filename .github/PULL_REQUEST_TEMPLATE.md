## Summary

Describe what changed and why.

## Scope

- Adapter or subsystem:
- Simulator and version, if applicable:
- Related issue:
- Compatibility profile:
- Evidence class (controlled observation, public specification, inference, or
  original work):

## Release impact

- [ ] No published-interface change
- [ ] Patch-level fix
- [ ] Additive/minor capability
- [ ] Breaking/major change

Explain any MCP schema, error-code, package, CLI, or save-format impact.

## Verification

- [ ] `npm run lint` passes locally.
- [ ] `npm run check` passes locally.
- [ ] New or changed behavior has tests.
- [ ] Checked-in fixtures remain deterministic, or fixture changes are explained.
- [ ] Fixture digest changes are listed below, or no fixture digest changed.
- [ ] `npm run package:check` passes when package/runtime files changed.
- [ ] Documentation reflects user-visible contract changes.
- [ ] `CHANGELOG.md` is updated, or the change has no release-note impact.

## Provenance and safety

- [ ] This change contains only material I am permitted to contribute.
- [ ] No game binaries, extracted assets, decompiled or disassembled code, screenshots, logos, third-party circuit designs, EEPROM contents, personal paths, credentials, private circuit data, or proprietary firmware are included.
- [ ] Simulator-specific observations are identified as observations and version-scoped.
- [ ] Sensitive firmware source and labels are not exposed in logs or examples.
- [ ] New output fields and diagnostics remain bounded and redact untrusted data.

## Compatibility

Describe any MCP contract, save-format, simulator-version, or client compatibility impact.

## Fixture digests

List each changed checked-in fixture and its old/new SHA-256 digest, or write
`None`.
