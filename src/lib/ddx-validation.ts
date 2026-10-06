import { z } from "zod";

const text = z.string();
const strings = z.array(text);
const hypothesis = z.object({
  diagnosis: text.trim().min(1),
  icd10: text.optional(),
  probability: z.number().finite().optional(),
  argumentsFor: strings.optional(),
  argumentsAgainst: strings.optional(),
  workup: strings.optional(),
  differentiator: text.optional(),
  redFlags: z.union([strings, text]).optional(),
  rationale: text.optional(),
});
const workup = z.object({ name: text, priority: text.optional(), purpose: text.optional(), targetDx: text.optional() });
const therapy = z.object({
  targetDx: text, name: text, regimen: text.optional(), justification: text.optional(),
  evidenceLevel: text.optional(), source: text.optional(), caution: text.optional(),
  preStartChecks: strings.optional(),
});

/** Reject malformed audit output before any draft content is replaced. */
export const ddxAuditSchema = z.object({
  diagnoses: z.array(hypothesis).min(3).max(8),
  workupPlan: z.array(workup),
  therapyOptions: z.array(therapy),
});
