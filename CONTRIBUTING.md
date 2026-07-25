# Contributing

Thank you for helping build Circuitarium MCP, a model-neutral electronics
toolset. Contributions to the neutral contract, documentation, tests, and
application integrations such as CRUMBLE are welcome when their behavior and
provenance are clear.

This is an independent, unofficial project. CRUMBLE is the project's
CRUMB-specific integration family, not a vendor-supported interface. Do not
represent a contribution as approved by CRUMB or any other simulator vendor.

## Development setup

Requirements: Node.js 22 or newer and npm.

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

`npm run typecheck` checks TypeScript without emitting files. `npm run build`
compiles the project. `npm run check` runs the type check, build, tests, and
deterministic-fixture verification together.

When changing fixture generation, regenerate the repository fixtures and then
run the complete check:

```powershell
npm run fixtures
npm run check
```

## Evidence and provenance

Every new adapter mapping, format claim, or fixture must identify its source in
the pull request:

- **Controlled observation:** state the application, exact version, platform,
  synthetic circuit recipe, and observed result.
- **Public specification:** link to the source and record its license or terms.
- **Inference:** identify the evidence and clearly label what remains
  unverified.
- **Original work:** state that the contributor authored the code, circuit, or
  documentation.

Record only the minimal facts needed for interoperability. Controlled
observations must be reproducible from a circuit you created for the test.
Unknown fields and behavior must remain unknown rather than being guessed.

Do not submit:

- proprietary game or simulator binaries, assets, logos, screenshots, extracted
  resources, decompiled or disassembled source, or confidential material;
- save files or circuit designs authored or published by a third party,
  including vendor examples and files downloaded from public sites;
- bulk metadata dumps or copied proprietary labels beyond the minimal
  independently observed facts required for interoperability;
- material obtained by bypassing access controls or violating applicable terms.

Fixtures committed to this repository must be small, synthetic, independently
authored, and stripped of personal data and unrelated embedded content. For a
bug originating in a real circuit, create the smallest synthetic reproduction;
do not attach the original file.

## Pull requests

Keep each pull request focused and include:

1. the problem and intended behavior;
2. provenance for new evidence or test data;
3. tests for behavior changes and any compatibility limits;
4. confirmation that `npm run check` passes; and
5. confirmation that no prohibited third-party material is included.

Do not silently broaden a version-pinned claim. A mapping verified against one
simulator version remains scoped to that version until separately reproduced.
Security-sensitive findings should follow [SECURITY.md](SECURITY.md), not a
public issue.

By intentionally submitting a contribution for inclusion, you agree that it is
provided under the Apache License 2.0 as described in section 5 of
[LICENSE](LICENSE), and you affirm that you have the right to submit it.

Participation in this project is governed by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
