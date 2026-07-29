import { createHash } from "node:crypto";

export const CANONICAL_JSON_PROFILE =
  "circuitarium.canonical-json/0.1" as const;

/**
 * Circuitarium canonical JSON 0.1:
 * - accepts JSON values only;
 * - omits undefined object properties, which cannot exist in JSON;
 * - preserves array order;
 * - sorts object keys by ECMAScript UTF-16 code-unit order;
 * - uses ECMAScript JSON serialization for strings, booleans, null, and
 *   finite IEEE-754 numbers (including normalizing -0 to 0).
 *
 * This intentionally versioned profile is deterministic for the bounded data
 * Circuitarium accepts. It is not a signature or an authenticity mechanism.
 */
export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new WeakSet<object>());
}

function canonicalJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError("Canonical JSON cannot contain unsafe integers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError(
          "Canonical JSON arrays cannot contain sparse holes",
        );
      }
    }
    if (ancestors.has(value)) {
      throw new TypeError("Canonical JSON cannot contain object cycles");
    }
    ancestors.add(value);
    try {
      return `[${value
        .map((item) => canonicalJsonValue(item, ancestors))
        .join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "Canonical JSON accepts only arrays and plain objects",
      );
    }
    if (ancestors.has(value)) {
      throw new TypeError("Canonical JSON cannot contain object cycles");
    }
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    try {
      return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(compareCodeUnits)
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonicalJsonValue(record[key], ancestors)}`,
        )
        .join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  throw new TypeError("Canonical JSON accepts JSON values only");
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function digestCanonicalJson(value: unknown): string {
  return sha256Text(canonicalJson(value));
}
