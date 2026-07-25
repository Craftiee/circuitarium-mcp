import { createHash } from "node:crypto";

import type { Diagnostic } from "./experiment.js";

export const MAX_DESIGN_NAME_PREVIEW_CHARACTERS = 160;
export const MAX_COMPONENT_GEOMETRY_POINTS_RETURNED = 64;
export const MAX_COMPONENT_TERMINALS_RETURNED = 64;
export const MAX_COMPONENT_PAYLOAD_ENTRIES_RETURNED = 64;
export const MAX_PARAMETER_COLLECTION_ITEMS_RETURNED = 64;
export const MAX_CONNECTION_GROUP_MEMBERS_RETURNED = 128;
export const MAX_KIND_COUNTS_RETURNED = 64;
export const MAX_INSPECTION_TOOL_COUNTS_RETURNED = 64;
export const MAX_DIAGNOSTIC_SAMPLES_RETURNED = 20;
export const MAX_RESULT_DIAGNOSTICS_RETURNED = 200;
export const MAX_DIAGNOSTIC_CODE_CHARACTERS = 128;
export const MAX_DIAGNOSTIC_PATH_CHARACTERS = 512;
export const MAX_DIAGNOSTIC_MESSAGE_CHARACTERS = 1_024;
export const MAX_CRU_XSI_TYPE_CHARACTERS = 256;
export const MAX_CRU_NUMERIC_LEXICAL_CHARACTERS = 1_024;
export const MAX_CRU_GUID_TOKEN_CHARACTERS = 64;
export const MAX_CRU_XML_NAME_CHARACTERS = 256;

export interface BoundedCollectionInfo {
  total: number;
  returned: number;
  limit: number;
  truncated: boolean;
}

export interface BoundedTextInfo {
  characters: number;
  bytes: number;
  sha256: string;
  trust: "untrusted-user-authored";
  preview: string;
  previewCharacters: number;
  previewTruncated: boolean;
  fullContentIncluded: boolean;
  blank: boolean;
}

export function boundCollection<T>(
  values: readonly T[],
  limit: number,
): { items: T[]; bounds: BoundedCollectionInfo } {
  const items = values.slice(0, limit);
  return {
    items,
    bounds: {
      total: values.length,
      returned: items.length,
      limit,
      truncated: items.length < values.length,
    },
  };
}

export function describeUntrustedText(
  value: string,
  previewLimit = MAX_DESIGN_NAME_PREVIEW_CHARACTERS,
): BoundedTextInfo {
  const preview = value.slice(0, previewLimit);
  const previewTruncated = preview.length < value.length;
  return {
    characters: value.length,
    bytes: Buffer.byteLength(value, "utf8"),
    sha256: `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`,
    trust: "untrusted-user-authored",
    preview,
    previewCharacters: preview.length,
    previewTruncated,
    fullContentIncluded: !previewTruncated,
    blank: value.trim().length === 0,
  };
}

export function boundDiagnostics(
  diagnostics: readonly Diagnostic[],
  limit = MAX_RESULT_DIAGNOSTICS_RETURNED,
): Diagnostic[] {
  const truncate = (value: string, maximum: number): string => {
    if (value.length <= maximum) {
      return value;
    }
    const marker = " [truncated]";
    return `${value.slice(0, Math.max(0, maximum - marker.length))}${marker}`;
  };
  const bounded = diagnostics.map((diagnostic) => ({
    ...diagnostic,
    code: truncate(diagnostic.code, MAX_DIAGNOSTIC_CODE_CHARACTERS),
    path: truncate(diagnostic.path, MAX_DIAGNOSTIC_PATH_CHARACTERS),
    message: truncate(
      diagnostic.message,
      MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
    ),
  }));

  if (bounded.length <= limit) {
    return bounded;
  }

  const retained = bounded.slice(0, Math.max(0, limit - 1));
  return [
    ...retained,
    {
      severity: "warning",
      code: "diagnostics-truncated",
      path: "diagnostics",
      message:
        `Returned ${retained.length} of ${bounded.length} diagnostics; ` +
        `the final entry records truncation at the ${limit}-item response limit.`,
    },
  ];
}
