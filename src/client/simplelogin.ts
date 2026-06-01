/**
 * Typed HTTP client for SimpleLogin API endpoints with Zod response validation.
 */
import { z } from "zod";
import { API_PATHS } from "./paths.js";
import { formatZodError } from "../config.js";
import { aliasDomainsResponseSchema, aliasListResponseSchema, aliasOptionsResponseSchema, aliasSchema, aliasToggleResponseSchema, activitiesResponseSchema, aliasListInputSchema, aliasOptionsInputSchema, createCustomAliasInputSchema, createRandomAliasInputSchema, aliasUpdateInputSchema } from "../schemas/aliases.js";
import { contactsResponseSchema, contactSchema, contactToggleResponseSchema, aliasContactsInputSchema, contactCreateInputSchema } from "../schemas/contacts.js";
import { customDomainListResponseSchema, customDomainSchema, deletedAliasesResponseSchema, customDomainUpdateInputSchema } from "../schemas/domains.js";
import { mailboxListResponseSchema, mailboxSchema, mailboxCreateInputSchema, mailboxDeleteInputSchema, mailboxUpdateInputSchema } from "../schemas/mailboxes.js";
import { notificationListResponseSchema } from "../schemas/notifications.js";
import { settingsSchema, settingsUpdateInputSchema } from "../schemas/settings.js";
import { userInfoSchema } from "../schemas/account.js";
import { deleteResponseSchema, okSchema, unknownJsonSchema } from "../schemas/common.js";

export type ClientConfig = { baseUrl: string; apiKey: string };
export type FetchLike = typeof fetch;

export class SimpleLoginAPIError extends Error {
  public readonly status: number;
  public readonly endpoint: string;
  public readonly details: unknown;

  public constructor(status: number, endpoint: string, message: string, details: unknown) {
    super(message);
    this.name = "SimpleLoginAPIError";
    this.status = status;
    this.endpoint = endpoint;
    this.details = details;
  }
}

type QueryValue = string | number | boolean | undefined;
type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  acceptText?: boolean;
};

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<unknown>;
  }
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFromErrorBody(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error;
    return typeof error === "string" ? error : JSON.stringify(error);
  }
  return JSON.stringify(body);
}

export class SimpleLoginClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  public constructor(config: ClientConfig, fetchImpl: FetchLike = fetch) {
    this.baseUrl = new URL(config.baseUrl);
    this.apiKey = config.apiKey;
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(endpoint: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);
    Object.entries(options.query ?? {}).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });

    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        Authentication: this.apiKey,
        Accept: options.acceptText ? "text/csv, text/plain, application/json" : "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (options.body) {
      requestInit.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url, requestInit);

    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new SimpleLoginAPIError(response.status, endpoint, messageFromErrorBody(body), body);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SimpleLoginAPIError(
        response.status,
        endpoint,
        `Invalid SimpleLogin API response: ${formatZodError(parsed.error)}`,
        body,
      );
    }
    return parsed.data;
  }

  public listAliases(input: z.infer<typeof aliasListInputSchema>) {
    const query: Record<string, QueryValue> = { page_id: input.page_id, sort: input.sort };
    if (input.filter) query[input.filter] = true;
    if (input.query) query.query = input.query;
    return this.request(API_PATHS.aliases, aliasListResponseSchema, { query });
  }

  public getAlias(id: number) {
    return this.request(API_PATHS.alias(id), aliasSchema);
  }

  public createRandomAlias(input: z.infer<typeof createRandomAliasInputSchema>) {
    const { hostname, mode, note, mailbox_id } = input;
    return this.request(API_PATHS.aliasRandomNew, aliasSchema, {
      method: "POST",
      query: { hostname, mode },
      body: { ...(note !== undefined ? { note } : {}), ...(mailbox_id !== undefined ? { mailbox_id } : {}) },
    });
  }

  public createCustomAlias(input: z.infer<typeof createCustomAliasInputSchema>) {
    const { hostname, mailboxes, ...body } = input;
    return this.request(API_PATHS.aliasCustomNew, aliasSchema, {
      method: "POST",
      query: { hostname },
      body: { ...body, mailbox_ids: mailboxes ?? body.mailbox_ids },
    });
  }

  public deleteAlias(id: number) {
    return this.request(API_PATHS.alias(id), deleteResponseSchema, { method: "DELETE" });
  }

  public updateAlias(input: z.infer<typeof aliasUpdateInputSchema>) {
    const { id, ...body } = input;
    return this.request(API_PATHS.alias(id), okSchema, { method: "PATCH", body });
  }

  public toggleAlias(id: number) {
    return this.request(API_PATHS.aliasToggle(id), aliasToggleResponseSchema, { method: "POST" });
  }

  public listAliasContacts(input: z.infer<typeof aliasContactsInputSchema>) {
    return this.request(API_PATHS.aliasContacts(input.alias_id), contactsResponseSchema, { query: { page_id: input.page_id } });
  }

  public listAliasActivities(id: number, page_id?: number) {
    return this.request(API_PATHS.aliasActivities(id), activitiesResponseSchema, { query: { page_id } });
  }

  public getAliasOptions(input: z.infer<typeof aliasOptionsInputSchema>) {
    return this.request(API_PATHS.aliasOptions, aliasOptionsResponseSchema, { query: { hostname: input.hostname } });
  }

  public listAliasDomains() {
    return this.request(API_PATHS.aliasDomains, aliasDomainsResponseSchema);
  }

  public listMailboxes() {
    return this.request(API_PATHS.mailboxes, mailboxListResponseSchema);
  }

  public createMailbox(input: z.infer<typeof mailboxCreateInputSchema>) {
    return this.request(API_PATHS.mailboxCreate, mailboxSchema, { method: "POST", body: input });
  }

  public deleteMailbox(input: z.infer<typeof mailboxDeleteInputSchema>) {
    const { id, ...body } = input;
    return this.request(API_PATHS.mailbox(id), okSchema, { method: "DELETE", body });
  }

  public updateMailbox(input: z.infer<typeof mailboxUpdateInputSchema>) {
    const { id, ...body } = input;
    return this.request(API_PATHS.mailbox(id), okSchema, { method: "PUT", body });
  }

  public listCustomDomains() {
    return this.request(API_PATHS.customDomains, customDomainListResponseSchema);
  }

  public updateCustomDomain(input: z.infer<typeof customDomainUpdateInputSchema>) {
    const { id, random_prefix, ...body } = input;
    return this.request(API_PATHS.customDomain(id), customDomainSchema, {
      method: "PATCH",
      body: { ...body, ...(random_prefix !== undefined ? { random_prefix_generation: random_prefix } : {}) },
    });
  }

  public deleteCustomDomain(id: number) {
    return this.request(API_PATHS.customDomain(id), okSchema, { method: "DELETE" });
  }

  public listDeletedAliasesForCustomDomain(id: number) {
    return this.request(API_PATHS.customDomainTrash(id), deletedAliasesResponseSchema);
  }

  public createContact(input: z.infer<typeof contactCreateInputSchema>) {
    return this.request(API_PATHS.aliasContacts(input.alias_id), contactSchema, { method: "POST", body: { contact: input.contact } });
  }

  public deleteContact(id: number) {
    return this.request(API_PATHS.contact(id), deleteResponseSchema, { method: "DELETE" });
  }

  public toggleContactBlock(id: number) {
    return this.request(API_PATHS.contactToggle(id), contactToggleResponseSchema, { method: "POST" });
  }

  public getUserInfo() {
    return this.request(API_PATHS.userInfo, userInfoSchema);
  }

  public getSettings() {
    return this.request(API_PATHS.setting, settingsSchema);
  }

  public updateSettings(input: z.infer<typeof settingsUpdateInputSchema>) {
    return this.request(API_PATHS.setting, settingsSchema, { method: "PATCH", body: input });
  }

  public listNotifications(page?: number) {
    return this.request(API_PATHS.notifications, notificationListResponseSchema, { query: { page } });
  }

  public markNotificationRead(id: number) {
    return this.request(API_PATHS.notification(id), okSchema, { method: "POST" });
  }

  public exportData() {
    return this.request(API_PATHS.exportData, unknownJsonSchema);
  }

  public async exportAliasesCsv() {
    return this.request(API_PATHS.exportAliases, z.string(), { acceptText: true });
  }
}
