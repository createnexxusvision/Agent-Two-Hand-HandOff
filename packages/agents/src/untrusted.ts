/**
 * Text from contractors (delivery notes, file names) and from the web is data, never instructions.
 * It reaches a model only inside an <untrusted_data> block, with markup escaped and invisible
 * characters removed so it cannot close the block or hide text from a reviewer.
 */

// Zero-width characters, bidirectional overrides and the BOM, built from code points so the
// source file itself never contains invisible characters.
const INVISIBLE_RANGES: [number, number][] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const INVISIBLE = new RegExp(
  "[" + INVISIBLE_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("") + "]",
  "g",
);

export function cleanText(text: string, maxLength = 2000): string {
  return text.replace(INVISIBLE, "").normalize("NFKC").slice(0, maxLength);
}

export function untrusted(source: string, text: string, maxLength = 2000): string {
  const escaped = cleanText(text, maxLength).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<untrusted_data source="${source}">\n${escaped}\n</untrusted_data>`;
}

/** Deterministic flag for text that tries to direct a payment. Used for display, never to pay. */
export function looksLikePaymentInstruction(text: string): boolean {
  const t = cleanText(text).toLowerCase();
  return /\$\s?\d|\b(pay|payout|transfer|send|wire|approve[ds]?)\b.*\b(\d+|usd|dollars?)\b|amount(minor)?\s*[:=]|ignore (the )?(rate card|previous|above)|\bsystem\s*(note|message|prompt)?\s*:/.test(t);
}
