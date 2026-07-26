import {
  boundCollection,
  type BoundedCollectionInfo,
} from "../../domain/bounds.js";
import type { CrumbDesignAnalysis } from "./analyze.js";

/**
 * Saved values that describe a component's current state rather than which
 * part it is. They are excluded from bill-of-materials identity so, for
 * example, an ON and an OFF copy of the same switch collapse into one line.
 */
const STATE_PARAMETER_NAMES = new Set([
  "on",
  "position",
  "positionCode",
  "positions",
  "enabledOrConnected",
]);

const MAX_BOM_COMPONENT_ID_SAMPLE = 5;

export interface CrumbBomIdentityValue {
  value: string | number | boolean;
  unit?: string;
}

export interface CrumbBomLine {
  toolId: number;
  kind: string;
  label: string;
  recognitionStatus: "recognized" | "schema-mismatch" | "unknown";
  variantLabel?: string;
  identity: Record<string, CrumbBomIdentityValue>;
  quantity: number;
  componentIdSample: string[];
  sampleTruncated: boolean;
}

export interface CrumbBom {
  bomVersion: "crumb.bom/0.1";
  totals: {
    components: number;
    distinctLines: number;
    recognized: number;
    schemaMismatch: number;
    unknown: number;
  };
  lines: CrumbBomLine[];
  lineBounds: BoundedCollectionInfo;
}

function identityOf(
  component: CrumbDesignAnalysis["components"][number],
): Record<string, CrumbBomIdentityValue> {
  const identity: Record<string, CrumbBomIdentityValue> = {};
  for (const [name, parameter] of Object.entries(component.parameters)) {
    if (STATE_PARAMETER_NAMES.has(name) || Array.isArray(parameter.value)) {
      continue;
    }
    if (name === "prefabId" && component.variant !== undefined) {
      continue;
    }
    identity[name] = {
      value: parameter.value,
      ...(parameter.unit === undefined ? {} : { unit: parameter.unit }),
    };
  }
  return identity;
}

function lineKey(line: Omit<CrumbBomLine, "quantity" | "componentIdSample" | "sampleTruncated">): string {
  const identityKey = Object.keys(line.identity)
    .sort()
    .map((name) => {
      const entry = line.identity[name]!;
      return `${name}=${JSON.stringify(entry.value)}${entry.unit ?? ""}`;
    })
    .join("|");
  return [
    line.toolId,
    line.kind,
    line.label,
    line.recognitionStatus,
    line.variantLabel ?? "",
    identityKey,
  ].join("::");
}

export function buildBom(analysis: CrumbDesignAnalysis, limit: number): CrumbBom {
  const linesByKey = new Map<
    string,
    Omit<CrumbBomLine, "sampleTruncated"> & { componentIds: string[] }
  >();
  for (const component of analysis.components) {
    const partial = {
      toolId: component.toolId,
      kind: component.kind,
      label: component.label,
      recognitionStatus: component.recognitionStatus,
      ...(component.variant === undefined
        ? {}
        : { variantLabel: component.variant.label }),
      identity: identityOf(component),
    };
    const key = lineKey(partial);
    const existing = linesByKey.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.componentIds.push(component.id);
      if (existing.componentIdSample.length < MAX_BOM_COMPONENT_ID_SAMPLE) {
        existing.componentIdSample.push(component.id);
      }
    } else {
      linesByKey.set(key, {
        ...partial,
        quantity: 1,
        componentIdSample: [component.id],
        componentIds: [component.id],
      });
    }
  }

  const sortedLines = [...linesByKey.entries()]
    .sort(([leftKey, left], [rightKey, right]) =>
      left.toolId - right.toolId || leftKey.localeCompare(rightKey),
    )
    .map(([, line]) => {
      const { componentIds, ...rest } = line;
      return {
        ...rest,
        sampleTruncated: componentIds.length > line.componentIdSample.length,
      };
    });
  const bounded = boundCollection(sortedLines, limit);

  return {
    bomVersion: "crumb.bom/0.1",
    totals: {
      components: analysis.components.length,
      distinctLines: sortedLines.length,
      recognized: analysis.summary.recognizedComponentCount,
      schemaMismatch: analysis.summary.schemaMismatchComponentCount,
      unknown: analysis.summary.unknownComponentCount,
    },
    lines: bounded.items,
    lineBounds: bounded.bounds,
  };
}
