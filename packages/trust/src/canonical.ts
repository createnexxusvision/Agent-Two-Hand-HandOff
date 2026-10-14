/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * ES2015+ `JSON.stringify` already serializes numbers and strings exactly as JCS requires,
 * so the work here is ordering object keys by UTF-16 code units (the default `Array#sort`
 * order) and rejecting values that have no single canonical form.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function canonicalize(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalize: NaN and Infinity are not valid JSON");
      return JSON.stringify(value);
    case "string":
      if (LONE_SURROGATE.test(value)) throw new TypeError("canonicalize: string contains a lone surrogate");
      return JSON.stringify(value);
    case "object":
      return serializeObject(value, seen);
    default:
      throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
  }
}

function serializeObject(value: object, seen: Set<object>): string {
  if (seen.has(value)) throw new TypeError("canonicalize: cyclic structure");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return "[" + value.map((item) => {
        if (item === undefined) throw new TypeError("canonicalize: undefined inside an array");
        return serialize(item, seen);
      }).join(",") + "]";
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("canonicalize: only plain objects are allowed");
    }
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      parts.push(serialize(key, seen) + ":" + serialize(item, seen));
    }
    return "{" + parts.join(",") + "}";
  } finally {
    seen.delete(value);
  }
}
