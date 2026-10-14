export type Currency = "USD";

/** Converts integer minor units (cents) to PayPal's decimal string, e.g. 4000 -> "40.00". */
export function minorToValue(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError(`amount must be a non-negative integer of cents, got ${minor}`);
  const whole = Math.trunc(minor / 100);
  const cents = minor % 100;
  return `${whole}.${String(cents).padStart(2, "0")}`;
}

/** Parses PayPal's decimal string back to integer minor units. Rejects anything but d+(.dd)?. */
export function valueToMinor(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new RangeError(`not a USD amount: ${value}`);
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new RangeError(`amount too large: ${value}`);
  return minor;
}
