/**
 * Unit tests for the SimpleLogin HTTP client request construction and errors.
 */
import { describe, expect, it } from "vitest";
import { SimpleLoginAPIError, SimpleLoginClient, type FetchLike } from "../../src/client/simplelogin.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });
}

describe("SimpleLoginClient", () => {
  it("passes Authentication header and validates alias list responses", async () => {
    const calls: Request[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push(new Request(input, init));
      return jsonResponse({ aliases: [] });
    };
    const client = new SimpleLoginClient({ baseUrl: "https://example.test", apiKey: "secret" }, fetchImpl);

    await expect(client.listAliases({ page_id: 2, filter: "enabled", query: "shop" })).resolves.toEqual({ aliases: [] });

    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request?.headers.get("Authentication")).toBe("secret");
    expect(new URL(request?.url ?? "").searchParams.get("enabled")).toBe("true");
    expect(new URL(request?.url ?? "").searchParams.get("query")).toBe("shop");
  });

  it("throws typed API errors for non-2xx responses", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: "bad key" }, { status: 401 });
    const client = new SimpleLoginClient({ baseUrl: "https://example.test", apiKey: "bad" }, fetchImpl);

    await expect(client.getUserInfo()).rejects.toMatchObject<Partial<SimpleLoginAPIError>>({
      name: "SimpleLoginAPIError",
      status: 401,
      endpoint: "/api/user_info",
      message: "bad key",
    });
  });
});
