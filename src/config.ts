/**
 * Parses and validates environment configuration for the MCP server and SimpleLogin API.
 */
import { z } from "zod";

const envSchema = z.object({
  TRANSPORT: z.enum(["stdio", "http"]).default("http"),
  PORT: z.coerce.number().int().positive().default(3000),
  MCP_AUTH_TOKEN: z.string().min(1).optional(),
  SL_API_URL: z.string().url().default("https://app.simplelogin.io"),
  SL_API_KEY: z.string().min(1, "SL_API_KEY is required"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}
