# Public release checklist

Use this checklist for the first GitHub publication and each tagged release.
The canonical repository is
[`Craftiee/circuitarium-mcp`](https://github.com/Craftiee/circuitarium-mcp).
Connecting, committing, and pushing the local checkout remain separate,
deliberate actions.

## Before the first push

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

After the intentional initial commit, scan the candidate history as well:

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
- [ ] Enable code scanning when a suitable TypeScript workflow is selected.
- [x] Enable private vulnerability reporting.
- [ ] Configure a private code-of-conduct reporting contact.
- [x] Enable Discussions if the project will use them for support and design
      proposals.
- [x] Add repository topics without implying unsupported Godot or live-simulator
      compatibility.

## First release

- [ ] Decide whether the first version is stable or a prerelease. Keep
      `package.json`, `SERVER_VERSION`, `CHANGELOG.md`, and the `v...` tag
      identical; prereleases publish under the npm `next` tag.
- [ ] Verify private vulnerability reporting remains enabled or publish another
      stable private route.
- [ ] Confirm the compatibility matrix and roadmap are current.
- [ ] Record the exact test environment and checked-in fixture digests.
- [ ] Publish release notes from `CHANGELOG.md`.

## npm publication gate

The npm package is an executable MCP server, not a supported JavaScript
library API. Its public surface is the `circuitarium-mcp` binary; do not add
`main` or `exports` until an importable API is intentionally designed.

- [ ] Recheck that the unscoped `circuitarium-mcp` name is available. An `E404`
      was observed on 2026-07-26, but registry names can be claimed at any time.
- [ ] Run `npm ci`, `npm run lint`, `npm run check`,
      `npm run test:coverage`, `npm run package:check`, and
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
- [ ] Test `npx -y circuitarium-mcp` from an empty temporary workspace and call
      `electronics_capabilities` from an MCP client.

### First-publication bootstrap

The package must exist on npm before npm allows a trusted publisher to be
attached to it. For the first release only:

1. Create a short-lived granular npm publish token and store it as the
   `NPM_TOKEN` secret on the protected `npm` GitHub environment.
2. Push the reviewed version tag and approve the environment deployment. The
   workflow publishes with provenance from the public GitHub repository.
3. Configure npm trusted publishing for GitHub user `Craftiee`, repository
   `circuitarium-mcp`, workflow `publish.yml`, environment `npm`, and
   `npm publish` permission. Follow the
   [npm trusted-publishing guide](https://docs.npmjs.com/trusted-publishers/).
4. Delete and revoke the bootstrap token. Later releases use the same workflow
   through tokenless OIDC and receive automatic provenance.

Never publish from an unreviewed branch, repack after the installation smoke
test, or reuse a long-lived automation token. Direct `npm pack` and
directory-based `npm publish` are deliberately blocked: `npm run
package:check` is the only supported packager, and releases publish the exact
tarball that command verified.
