/**
 * Zod schemas for SimpleLogin notification APIs.
 */
import { z } from "zod";
import { integerIdSchema, pageIdSchema } from "./common.js";

export const notificationSchema = z
  .object({
    id: integerIdSchema,
    message: z.string(),
    title: z.string().optional(),
    read: z.boolean(),
    created_at: z.string(),
  })
  .passthrough();

export const notificationListResponseSchema = z
  .object({ more: z.boolean(), notifications: z.array(notificationSchema) })
  .passthrough();
export const notificationListInputSchema = z.object({ page: pageIdSchema });
export const notificationIdInputSchema = z.object({ id: integerIdSchema });
