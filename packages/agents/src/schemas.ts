/**
 * Output schemas. Every object is strict: an extra key (say, "amount") fails the whole response,
 * and a failed response is rejected and logged, never retried with a looser schema.
 * Optional values are nullable rather than omitted, which structured-output modes handle best.
 */
import { z } from "zod";

// Limits on the two larger schemas are enforced with refinements: they are checked on every
// parsed response but left out of the JSON schema sent to the model, because Gemini rejects
// response schemas above a complexity limit. Nothing is looser; the check just moves into code.
const text = (max: number) => z.string().refine((s) => s.length >= 1 && s.length <= max, `must be 1–${max} characters`);
const int = (min: number, max: number) =>
  z.number().refine((n) => Number.isInteger(n) && n >= min && n <= max, `must be a whole number from ${min} to ${max}`);
const isoDate = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)), "must be a YYYY-MM-DD date");

export const SpecSchema = z
  .object({
    deliverable: text(300),
    aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).nullable(),
    maxDurationS: int(1, 3600).nullable(),
    minWidth: int(1, 8000).nullable(),
    fileCount: int(1, 100).nullable(),
  })
  .strict();
export type Spec = z.infer<typeof SpecSchema>;

export const OpsPlanSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            payeeId: text(64),
            rateLineId: text(64),
            quantity: int(1, 100),
            due: isoDate,
            spec: SpecSchema,
          })
          .strict(),
      )
      .refine((a) => a.length >= 1 && a.length <= 20, "must have 1–20 tasks"),
    messages: z
      .array(z.object({ payeeId: text(64), text: text(600) }).strict())
      .refine((a) => a.length <= 20, "must have at most 20 messages"),
  })
  .strict();
export type OpsPlan = z.infer<typeof OpsPlanSchema>;

export const VerdictSchema = z
  .object({
    pass: z.boolean(),
    reasons: z.array(z.string().min(1).max(240)).min(1).max(6),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type ModelVerdict = z.infer<typeof VerdictSchema>;

export const FLAG_KINDS = ["payment_instruction_in_text", "duplicate_delivery", "near_threshold", "unusual_timing", "other"] as const;

export const ExplanationSchema = z
  .object({
    summary: z.string().min(1).max(700),
    flags: z
      .array(
        z
          .object({ kind: z.enum(FLAG_KINDS), receiptSeq: z.number().int().min(1), note: z.string().min(1).max(240) })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type Explanation = z.infer<typeof ExplanationSchema>;
