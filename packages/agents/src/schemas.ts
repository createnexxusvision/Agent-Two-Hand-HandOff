/**
 * Output schemas. Every object is strict: an extra key (say, "amount") fails the whole response,
 * and a failed response is rejected and logged, never retried with a looser schema.
 * Optional values are nullable rather than omitted, which structured-output modes handle best.
 */
import { z } from "zod";

export const SpecSchema = z
  .object({
    deliverable: z.string().min(1).max(300),
    aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).nullable(),
    maxDurationS: z.number().int().min(1).max(3600).nullable(),
    minWidth: z.number().int().min(1).max(8000).nullable(),
    fileCount: z.number().int().min(1).max(100).nullable(),
  })
  .strict();
export type Spec = z.infer<typeof SpecSchema>;

export const OpsPlanSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            payeeId: z.string().min(1).max(64),
            rateLineId: z.string().min(1).max(64),
            quantity: z.number().int().min(1).max(100),
            due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            spec: SpecSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    messages: z
      .array(z.object({ payeeId: z.string().min(1).max(64), text: z.string().min(1).max(600) }).strict())
      .max(20),
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
