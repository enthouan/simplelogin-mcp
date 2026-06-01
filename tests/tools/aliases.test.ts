/**
 * Unit tests for shared MCP tool response helpers.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runTool } from "../../src/tools/types.js";

describe("runTool", () => {
  it("returns structured JSON text for successful tool calls", async () => {
    const result = await runTool(z.object({ id: z.number() }), { id: 1 }, async (input) => ({ ok: input.id }));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({ ok: 1 });
  });

  it("converts validation failures into MCP error responses", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runTool(z.object({ id: z.number() }), { id: "nope" }, async () => ({ ok: true }));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("id");
    stderr.mockRestore();
  });
});
