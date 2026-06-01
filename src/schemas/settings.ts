/**
 * Zod schemas for SimpleLogin settings APIs.
 */
import { z } from "zod";

export const settingsSchema = z
  .object({
    alias_generator: z.enum(["uuid", "word"]).or(z.string()),
    notification: z.boolean(),
    random_alias_default_domain: z.string(),
    sender_format: z.enum(["AT", "A", "NAME_ONLY", "AT_ONLY", "NO_NAME"]).or(z.string()),
    random_alias_suffix: z.enum(["word", "random_string"]).or(z.string()),
  })
  .passthrough();

export const settingsUpdateInputSchema = z.object({
  alias_generator: z.enum(["uuid", "word"]).optional(),
  notification: z.boolean().optional(),
  random_alias_default_domain: z.string().optional(),
  sender_format: z.enum(["AT", "A", "NAME_ONLY", "AT_ONLY", "NO_NAME"]).optional(),
  random_alias_suffix: z.enum(["word", "random_string"]).optional(),
});
