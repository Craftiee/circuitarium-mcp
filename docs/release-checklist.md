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
- [ ] Review every staged path before creating the initial commit.

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
- [ ] Require the CI workflow on pull requests.
- [ ] Protect `main` from force pushes and deletion.
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

- [ ] Decide whether the first tag is a prerelease such as `v0.2.0-alpha.1`.
- [ ] Verify private vulnerability reporting remains enabled or publish another
      stable private route.
- [ ] Confirm the compatibility matrix and roadmap are current.
- [ ] Record the exact test environment and checked-in fixture digests.
- [ ] Publish release notes from `CHANGELOG.md`.
- [ ] Do not publish to npm until a supported package entrypoint, `exports` or
      `bin` metadata, and installation smoke test are intentionally added.
