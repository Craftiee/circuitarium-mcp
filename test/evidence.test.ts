import assert from "node:assert/strict";
import test from "node:test";

import {
  CRUMB_EVIDENCE_CONFIDENCE_VALUES,
  CRUMB_EVIDENCE_VOCABULARY,
  listCrumbEvidenceVocabulary,
} from "../src/adapters/crumb/evidence.js";
import { CrumbEvidenceVocabularyEntrySchema } from "../src/domain/toolSchemas.js";

const EXPECTED_CONFIDENCE_VALUES = [
  "controlled",
  "installed-build",
  "official-example",
  "inferred",
  "unknown",
  "installed-build-extracted",
  "installed-build-partial",
] as const;

function entry(
  confidence: (typeof EXPECTED_CONFIDENCE_VALUES)[number],
) {
  const match = CRUMB_EVIDENCE_VOCABULARY.find(
    (candidate) => candidate.confidence === confidence,
  );
  assert.ok(match, `missing evidence entry for ${confidence}`);
  return match;
}

test("evidence vocabulary has exactly the legacy general and IC confidence values", () => {
  assert.deepEqual(
    CRUMB_EVIDENCE_CONFIDENCE_VALUES,
    EXPECTED_CONFIDENCE_VALUES,
  );
  assert.deepEqual(
    CRUMB_EVIDENCE_VOCABULARY.map((item) => item.confidence),
    EXPECTED_CONFIDENCE_VALUES,
  );
  assert.equal(
    new Set(CRUMB_EVIDENCE_VOCABULARY.map((item) => item.confidence)).size,
    EXPECTED_CONFIDENCE_VALUES.length,
  );

  for (const item of CRUMB_EVIDENCE_VOCABULARY) {
    assert.equal(CrumbEvidenceVocabularyEntrySchema.safeParse(item).success, true);
    assert.ok(item.label.length > 0);
    assert.ok(item.meaning.length > 0);
    assert.ok(item.sourceAndRedistributionBoundary.length > 0);
    assert.ok(item.limitation.length > 0);
  }
});

test("evidence vocabulary preserves strong semantic and redistribution distinctions", () => {
  assert.match(entry("controlled").meaning, /independently authored fixture/i);
  assert.match(entry("controlled").limitation, /not exhaustive behavior/i);

  assert.match(entry("installed-build").meaning, /manually transcribed/i);
  assert.match(
    entry("installed-build").sourceAndRedistributionBoundary,
    /executable code, resources, scenes/i,
  );
  assert.match(entry("installed-build").limitation, /do not apply it to another build/i);

  assert.match(
    entry("official-example").sourceAndRedistributionBoundary,
    /example design is not redistributed/i,
  );
  assert.match(entry("official-example").limitation, /does not prove field meaning/i);

  assert.match(entry("inferred").meaning, /without direct confirmation/i);
  assert.match(entry("inferred").limitation, /Treat as a hypothesis/i);

  assert.match(entry("unknown").meaning, /insufficient/i);
  assert.match(entry("unknown").limitation, /Do not guess/i);

  assert.match(entry("installed-build-extracted").meaning, /IC label/i);
  assert.match(
    entry("installed-build-extracted").limitation,
    /not an electrical model/i,
  );

  assert.match(entry("installed-build-partial").meaning, /ambiguous or unresolved/i);
  assert.match(
    entry("installed-build-partial").limitation,
    /must remain unresolved/i,
  );
  assert.notEqual(
    entry("installed-build-extracted").meaning,
    entry("installed-build-partial").meaning,
  );
});

test("evidence vocabulary listings are copies and the schema rejects unknown values", () => {
  const first = listCrumbEvidenceVocabulary();
  first[0]!.label = "mutated";
  assert.equal(listCrumbEvidenceVocabulary()[0]?.label, entry("controlled").label);

  assert.equal(
    CrumbEvidenceVocabularyEntrySchema.safeParse({
      ...entry("controlled"),
      confidence: "assumed",
    }).success,
    false,
  );
});
