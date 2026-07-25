import assert from "node:assert/strict";
import test from "node:test";

import {
  boundCollection,
  boundDiagnostics,
  describeUntrustedText,
  MAX_DIAGNOSTIC_CODE_CHARACTERS,
  MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
  MAX_DIAGNOSTIC_PATH_CHARACTERS,
  MAX_RESULT_DIAGNOSTICS_RETURNED,
} from "../src/domain/bounds.js";

test("bounded collections retain totals and explicit truncation state", () => {
  const bounded = boundCollection([1, 2, 3, 4], 2);

  assert.deepEqual(bounded.items, [1, 2]);
  assert.deepEqual(bounded.bounds, {
    total: 4,
    returned: 2,
    limit: 2,
    truncated: true,
  });
});

test("untrusted text returns a bounded preview, digest, and full size", () => {
  const value = `${"A".repeat(200)}PRIVATE_TAIL`;
  const bounded = describeUntrustedText(value, 32);

  assert.equal(bounded.preview, "A".repeat(32));
  assert.equal(bounded.previewTruncated, true);
  assert.equal(bounded.fullContentIncluded, false);
  assert.equal(bounded.characters, value.length);
  assert.match(bounded.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(bounded).includes("PRIVATE_TAIL"), false);
});

test("diagnostic counts and every diagnostic text field are bounded", () => {
  const diagnostics = Array.from(
    { length: MAX_RESULT_DIAGNOSTICS_RETURNED + 50 },
    (_, index) => ({
      severity: "warning" as const,
      code: `code-${index}-${"c".repeat(1_000)}`,
      path: `path.${index}.${"p".repeat(2_000)}`,
      message: `message ${index}: ${"m".repeat(4_000)}`,
    }),
  );
  const bounded = boundDiagnostics(diagnostics);

  assert.equal(bounded.length, MAX_RESULT_DIAGNOSTICS_RETURNED);
  assert.equal(bounded.at(-1)?.code, "diagnostics-truncated");
  assert.ok(
    bounded.every(
      (diagnostic) =>
        diagnostic.code.length <= MAX_DIAGNOSTIC_CODE_CHARACTERS &&
        diagnostic.path.length <= MAX_DIAGNOSTIC_PATH_CHARACTERS &&
        diagnostic.message.length <= MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
    ),
  );
  assert.match(bounded[0]!.message, /\[truncated\]$/);
});
