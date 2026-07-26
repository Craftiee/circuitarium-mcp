# Public release checklist

Use this checklist for the first package release (`v0.2.0`) and each later
tagged release. The canonical public repository is
[`Craftiee/circuitarium-mcp`](https://github.com/Craftiee/circuitarium-mcp).
Merging, tagging, approving the protected release environment, and publishing
remain separate, deliberate actions.

## Public repository baseline

- [x] Use the public name Circuitarium MCP and repository slug
      `circuitarium-mcp`.
- [x] Update the display name in `README.md` and `NOTICE`.
- [x] Add `repository`, `homepage`, and `bugs` URLs to `package.json`.
- [x] Confirm `LICENSE`, `NOTICE`, `PROVENANCE.md`, `CONTRIBUTING.md`,
      `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `docs/crumble.md` describe the
      same project and unofficial integration boundary.
- [x] Confirm all committed `.cru` files are independently authored,
      deterministic synthetic fixtures.
- [x] Confirm no game binaries, extracted assets, decompiled source,
      screenshots, firmware secrets, personal paths, or third-party designs are
      present.
- [x] Run a purpose-built secret scanner over the candidate history and working
      tree.
- [x] Review every staged path before creating the initial commit.

Recommended validation:

```powershell
npm ci
npm run check
npm audit --omit=dev
git status --short
git diff --cached --stat
```

If Gitleaks is installed:

```powershell
gitleaks dir .
```

Scan the candidate history as well:

```powershell
gitleaks git .
```

## GitHub repository configuration

- [x] Make `main` the default branch.
- [x] Require the CI workflow on pull requests.
- [x] Protect `main` from force pushes and deletion.
- [ ] Require pull-request review once another trusted maintainer is available.
- [x] Enable Dependabot alerts and security updates.
- [x] Enable secret scanning and push protection when available.
- [x] Enable TypeScript CodeQL scanning.
- [x] Enable private vulnerability reporting.
- [ ] **Release blocker:** configure a dedicated, monitored private
      code-of-conduct reporting contact and replace the temporary notice in
      `CODE_OF_CONDUCT.md`. Do not publish a placeholder or personal address
      that will not be monitored.
- [x] Enable Discussions if the project will use them for support and design
      proposals.
- [x] Add repository topics without implying unsupported Godot or live-simulator
      compatibility.
- [x] Require the `Package and coverage` job on `main` in addition to the
      supported Node/OS test matrix.

## `v0.2.0` release identity

- [x] Treat `v0.2.0` as the first real release; no earlier `v0.2.0` tag or
      package was published. Publish it under the npm `latest` tag.
- [ ] Keep `package.json`, `SERVER_VERSION`, `server.json`, MCPB metadata,
      `CHANGELOG.md`, and the `v0.2.0` tag identical.
- [ ] Verify private vulnerability reporting remains enabled or publish another
      stable private route.
- [ ] Confirm the compatibility matrix and roadmap are current.
- [ ] Record the exact test environment and checked-in fixture digests.
- [ ] Confirm `CHANGELOG.md` has one dated `0.2.0` section and no release work
      left under `Unreleased`.
- [ ] Publish the `0.2.0` section as the GitHub Release notes only after npm and
      MCP Registry publication succeed.

## npm publication gate

The npm package is an executable MCP server, not a supported JavaScript
library API. For `0.2.x`, its only supported package surface is the
`circuitarium-mcp` binary. Internal source exports used by the repository's CLI
and tests are not a compatibility promise. Do not publish `main`, root
`exports`, or type declarations until an importable API is intentionally
designed, documented, and tested.

- [ ] Recheck that the unscoped `circuitarium-mcp` name is available. An `E404`
      was observed on 2026-07-26, but registry names can be claimed at any time.
- [ ] Run `npm ci`, `npm run lint`, `npm run check`,
      `npm run test:coverage`, `npm run package:check`,
      `npm run mcpb:check`, `npm run registry:check`, and
      `npm audit --omit=dev`.
- [ ] Inspect the package allowlist. It must include the compiled server,
      license/notices, linked public documentation and examples, and
      `npm-shrinkwrap.json`; it must exclude repository source, tests, fixtures,
      GitHub internals, third-party designs, and `.cru` files.
- [ ] Keep the MCP SDK's bundled, shrinkwrapped runtime while it requests the
      vulnerable `@hono/node-server` 1.x range. npm consumers ignore dependency
      overrides declared by installed packages, so bundling carries the audited
      2.0.11 override into the executable package. Remove the bundle only after
      an upstream SDK release provides a compatible patched dependency range.
- [ ] Confirm the `npm` GitHub environment requires an intentional maintainer
      approval.
- [ ] Push only a version tag whose commit is already contained in `main`.
      The publish workflow rejects any other commit or version spelling.
- [ ] Confirm the workflow smoke-installed the tarball, completed an MCP
      handshake, audited its production tree, retained it as a workflow
      artifact, and published those exact bytes.
- [ ] Confirm the tag workflow ran the same coverage thresholds required on
      `main`; a passing build alone is not a release test.
- [ ] Test `npx -y circuitarium-mcp` from an empty temporary workspace and call
      `electronics_capabilities` from an MCP client.

## MCP Registry and GitHub Release gate

The official MCP Registry stores discovery metadata, not the npm package.
Therefore the tag workflow must preserve this order:

1. Build, test, coverage-check, pack, install, audit, and MCP-handshake the
   candidate.
2. Publish those exact verified bytes to npm with provenance.
3. Verify that the version is publicly resolvable from npm.
4. Authenticate the official `mcp-publisher` with GitHub OIDC and publish the
   matching `server.json` to the MCP Registry.
5. Create the GitHub Release from the same tagged commit and attach the
   verified npm tarball and MCPB bundle.

If npm publication or Registry submission fails, do not create the GitHub
Release and never move the tag. A workflow rerun may continue from an npm
version that already exists only after it verifies the public package has the
same integrity as the retained tarball. If the version exists with different
bytes, stop and follow npm's version rules when choosing a recovery version.

- [ ] Run `npm run registry:check` to validate `server.json` against the
      official schema and local release identity.
- [ ] Confirm its `name` matches `package.json#mcpName`, its version matches all
      other release identities, and its npm package points to the public
      `circuitarium-mcp` artifact over stdio.
- [ ] Pin the Registry publisher and verify its downloaded checksum rather than
      executing an unpinned latest binary.
- [ ] Confirm GitHub OIDC publishes only metadata after the npm package is
      publicly installable; do not store a separate Registry credential.
- [ ] Validate and smoke-test `circuitarium-mcp-0.2.0.mcpb` with
      `npm run mcpb:check`, then attach the exact verified bundle retained by
      the tag workflow.
- [ ] Confirm the GitHub Release links to npm and the Registry record and uses
      release notes from `CHANGELOG.md`.

### First-publication bootstrap

The package must exist on npm before npm allows a trusted publisher to be
attached to it. The protected `npm` GitHub environment requires maintainer
approval. For `v0.2.0` only:

1. Create a short-lived granular npm token with read/write package permission
   and bypass 2FA enabled. npm cannot grant a package-specific token for an
   uncreated package, so the first-publication token may have to select **All
   Packages**; give it the shortest practical expiry and no organization
   permissions. Enter it only through the GitHub environment-secret UI as
   `NPM_TOKEN`; never paste it into an issue, chat, log, file, or command
   history.
2. Push the reviewed version tag and approve the environment deployment. The
   workflow publishes the verified tarball to npm with provenance, then
   publishes Registry metadata, then creates the GitHub Release.
3. Configure npm trusted publishing for GitHub user `Craftiee`, repository
   `circuitarium-mcp`, workflow `publish.yml`, environment `npm`, and
   `npm publish` permission. Follow the
   [npm trusted-publishing guide](https://docs.npmjs.com/trusted-publishers/).
4. In a reviewed follow-up, remove the workflow's bootstrap-token dependency,
   delete `NPM_TOKEN` from the GitHub environment, and revoke the token at npm.
   Confirm the token is revoked; deleting only the GitHub secret is not enough.
5. For the next release, verify the protected workflow publishes through
   tokenless npm OIDC and still records provenance before treating trusted
   publishing as complete.

Never publish from an unreviewed branch, repack after the installation smoke
test, or reuse a long-lived automation token. Direct `npm pack` and
directory-based `npm publish` are deliberately blocked: `npm run
package:check` is the only supported packager, and releases publish the exact
tarball that command verified.
