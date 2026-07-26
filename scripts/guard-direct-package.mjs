throw new Error(
  [
    "Direct npm pack and directory-based npm publish are disabled.",
    "Run npm run package:check to build and verify the release tarball.",
    "Publish only that retained .tgz file.",
  ].join(" "),
);
