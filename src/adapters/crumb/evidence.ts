export const CRUMB_EVIDENCE_CONFIDENCE_VALUES = [
  "controlled",
  "installed-build",
  "official-example",
  "inferred",
  "unknown",
  "installed-build-extracted",
  "installed-build-partial",
] as const;

export type CrumbEvidenceConfidence =
  (typeof CRUMB_EVIDENCE_CONFIDENCE_VALUES)[number];

export interface CrumbEvidenceVocabularyEntry {
  confidence: CrumbEvidenceConfidence;
  label: string;
  meaning: string;
  sourceAndRedistributionBoundary: string;
  limitation: string;
}

/**
 * Machine-readable meanings for the confidence strings retained by the v0.2
 * component and IC catalogs. The entries describe evidence quality and source
 * boundaries; they are not a ranking of electrical-model accuracy.
 */
export const CRUMB_EVIDENCE_VOCABULARY = Object.freeze([
  Object.freeze({
    confidence: "controlled",
    label: "Controlled-save observation",
    meaning:
      "An independently authored fixture or deliberate action was checked against the pinned installed CRUMB build.",
    sourceAndRedistributionBoundary:
      "Only this project's code, synthetic fixture, and summarized observation are redistributed; no CRUMB binary or asset is included.",
    limitation:
      "Applies only to the exercised values and workflow on the named compatibility profile; it is not exhaustive behavior or cross-version proof.",
  }),
  Object.freeze({
    confidence: "installed-build",
    label: "Installed-build observation",
    meaning:
      "A format, label, ordering, or behavior fact was manually transcribed from inspection of the pinned installed CRUMB build.",
    sourceAndRedistributionBoundary:
      "Only a distilled interoperability fact is returned; executable code, resources, scenes, and other CRUMB asset payloads are excluded.",
    limitation:
      "The fact is unofficial, version-pinned, and may be incomplete; do not apply it to another build or infer unlisted behavior.",
  }),
  Object.freeze({
    confidence: "official-example",
    label: "Developer-published example observation",
    meaning:
      "A serialized shape or value was observed in a design published by the CRUMB developer.",
    sourceAndRedistributionBoundary:
      "The example design is not redistributed; only this project's independently authored description of the observed interoperability fact is returned.",
    limitation:
      "A published example does not prove field meaning, valid ranges, electrical behavior, or compatibility beyond the observed file.",
  }),
  Object.freeze({
    confidence: "inferred",
    label: "Inference",
    meaning:
      "The interpretation is a reasoned best fit from surrounding structure or multiple observations, without direct confirmation.",
    sourceAndRedistributionBoundary:
      "Only this project's inference is returned; no source binary, asset, or third-party design is redistributed.",
    limitation:
      "Treat as a hypothesis: do not use it for destructive writes, safety decisions, or authoritative compatibility claims without independent verification.",
  }),
  Object.freeze({
    confidence: "unknown",
    label: "Unknown",
    meaning:
      "Available evidence is insufficient to assign reliable semantics.",
    sourceAndRedistributionBoundary:
      "Only bounded structural metadata may be preserved; no unsupported semantic claim or source payload is supplied.",
    limitation:
      "Do not guess, normalize, simulate, or write based on this value; acquire new evidence first.",
  }),
  Object.freeze({
    confidence: "installed-build-extracted",
    label: "Installed-build-observed IC fact",
    meaning:
      "An IC label, ordered pin transform name, or related package fact was manually transcribed from the pinned installed CRUMB build.",
    sourceAndRedistributionBoundary:
      "Only factual labels and ordering are returned; CRUMB executable, resource, scene, mesh, texture, and other asset payloads are excluded.",
    limitation:
      "A label or ordering is not an electrical model, datasheet verification, or compatibility guarantee for another build.",
  }),
  Object.freeze({
    confidence: "installed-build-partial",
    label: "Partial installed-build IC fact",
    meaning:
      "Installed-build inspection exposed some IC labels or pin ordering, but one or more semantic pin names remain ambiguous or unresolved.",
    sourceAndRedistributionBoundary:
      "Only verified labels, ordering, and explicit nulls are returned; underlying CRUMB assets and guessed replacements are excluded.",
    limitation:
      "Unresolved pins must remain unresolved: do not invent names, infer a complete pinout, or simulate behavior from this entry.",
  }),
] satisfies CrumbEvidenceVocabularyEntry[]);

export function listCrumbEvidenceVocabulary(): CrumbEvidenceVocabularyEntry[] {
  return CRUMB_EVIDENCE_VOCABULARY.map((entry) => ({ ...entry }));
}
