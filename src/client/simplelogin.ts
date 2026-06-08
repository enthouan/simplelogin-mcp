/**
 * @module client/simplelogin
 * Typed SimpleLogin API client. A single private `request()` helper centralizes the
 * `Authentication` header, per-request timeout, error parsing, and Zod response
 * validation; every public method is a thin wrapper over it. Adding an endpoint is a
 * small, obvious change: one constant in constants.ts, one schema, one method here.
 */
import { z } from 'zod';
import { API_PATHS, aliasPath, aliasTogglePath } from '../constants.js';
import { logger } from '../logger.js';
import {
  AliasSchema,
  AliasListResponseSchema,
  AliasOptionsSchema,
  AliasToggleResponseSchema,
  AliasDeleteResponseSchema,
  AliasUpdateResponseSchema,
  type Alias,
  type AliasListResponse,
  type AliasOptions,
  type AliasToggleResponse,
  type AliasDeleteResponse,
} from '../schemas/alias.js';
import { MailboxListResponseSchema, type MailboxListResponse } from '../schemas/mailbox.js';
import { DomainListResponseSchema, type DomainListResponse } from '../schemas/domain.js';
import { UserInfoSchema, type UserInfo } from '../schemas/account.js';

/** Thrown for any non-2xx SimpleLogin response, request timeout, or network error. */
export class SimpleLoginAPIError extends Error {
  /**
   * @param status HTTP status code, or 0 for a timeout / network-level failure.
   * @param endpoint The API path the request targeted.
   * @param message Human-readable message (server-provided when available).
   * @param body The parsed response body, when one was returned.
   */
  constructor(
    readonly status: number,
    readonly endpoint: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'SimpleLoginAPIError';
  }
}

/**
 * Thrown when an alias mutation is rejected locally — before any network call —
 * because the requested change is a no-op or has conflicting inputs. Carries no
 * HTTP status because SimpleLogin was never contacted.
 */
export class AliasMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AliasMutationError';
  }
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

/**
 * The subset of the global `fetch` signature the client depends on. Tests inject a
 * stub to assert request shape and drive error paths without live network calls.
 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Options accepted by the {@link SimpleLoginClient} constructor. */
export interface SimpleLoginClientOptions {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  /** Fetch implementation to use. Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

interface RequestOptions<S extends z.ZodTypeAny> {
  method: HttpMethod;
  endpoint: string;
  schema: S;
  query?: QueryParams;
  body?: Record<string, unknown>;
}

/** Filters supported by {@link SimpleLoginClient.listAliases} (mutually exclusive). */
export type AliasListFilter = 'enabled' | 'disabled' | 'pinned';

export class SimpleLoginClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: SimpleLoginClientOptions) {
    this.baseUrl = options.apiUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    // Bind to globalThis so the default fetch keeps its expected receiver.
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  // --- Aliases ---------------------------------------------------------------

  listAliases(params: {
    pageId: number;
    filter?: AliasListFilter;
    query?: string;
  }): Promise<AliasListResponse> {
    const query: QueryParams = { page_id: params.pageId };
    if (params.filter) query[params.filter] = true;

    // `query` is documented as a request-body field; some stacks forbid a GET body,
    // so the endpoint also accepts POST. Use POST only when actually searching.
    const searching = typeof params.query === 'string' && params.query.length > 0;
    return this.request({
      method: searching ? 'POST' : 'GET',
      endpoint: API_PATHS.aliases,
      query,
      body: searching ? { query: params.query } : undefined,
      schema: AliasListResponseSchema,
    });
  }

  getAlias(aliasId: number): Promise<Alias> {
    return this.request({ method: 'GET', endpoint: aliasPath(aliasId), schema: AliasSchema });
  }

  createRandomAlias(params: {
    mode?: 'uuid' | 'word';
    note?: string;
    hostname?: string;
  }): Promise<Alias> {
    return this.request({
      method: 'POST',
      endpoint: API_PATHS.aliasRandomNew,
      query: { mode: params.mode, hostname: params.hostname },
      body: { note: params.note },
      schema: AliasSchema,
    });
  }

  createCustomAlias(params: {
    aliasPrefix: string;
    signedSuffix: string;
    mailboxIds: number[];
    note?: string;
    name?: string;
    hostname?: string;
  }): Promise<Alias> {
    return this.request({
      method: 'POST',
      endpoint: API_PATHS.aliasCustomNew,
      query: { hostname: params.hostname },
      body: {
        alias_prefix: params.aliasPrefix,
        signed_suffix: params.signedSuffix,
        mailbox_ids: params.mailboxIds,
        note: params.note,
        name: params.name,
      },
      schema: AliasSchema,
    });
  }

  async updateAlias(
    aliasId: number,
    patch: {
      note?: string;
      name?: string;
      mailboxId?: number;
      mailboxIds?: number[];
      disablePgp?: boolean;
      pinned?: boolean;
    },
  ): Promise<{ ok: true }> {
    // Guardrails enforced before any network call: SimpleLogin would otherwise
    // silently accept a no-op PATCH or arbitrarily pick one of two mailbox fields.
    if (patch.mailboxId !== undefined && patch.mailboxIds !== undefined) {
      throw new AliasMutationError(
        'Provide either mailbox_id or mailbox_ids, not both — they are mutually exclusive.',
      );
    }
    const hasChange =
      patch.note !== undefined ||
      patch.name !== undefined ||
      patch.mailboxId !== undefined ||
      patch.mailboxIds !== undefined ||
      patch.disablePgp !== undefined ||
      patch.pinned !== undefined;
    if (!hasChange) {
      throw new AliasMutationError(
        'No changes provided; supply at least one field to update (note, name, mailbox_id, mailbox_ids, disable_pgp, or pinned).',
      );
    }

    // undefined fields are dropped by JSON.stringify, so only provided fields are sent.
    await this.request({
      method: 'PATCH',
      endpoint: aliasPath(aliasId),
      body: {
        note: patch.note,
        name: patch.name,
        mailbox_id: patch.mailboxId,
        mailbox_ids: patch.mailboxIds,
        disable_pgp: patch.disablePgp,
        pinned: patch.pinned,
      },
      schema: AliasUpdateResponseSchema,
    });
    return { ok: true };
  }

  deleteAlias(aliasId: number): Promise<AliasDeleteResponse> {
    return this.request({
      method: 'DELETE',
      endpoint: aliasPath(aliasId),
      schema: AliasDeleteResponseSchema,
    });
  }

  toggleAlias(aliasId: number): Promise<AliasToggleResponse> {
    return this.request({
      method: 'POST',
      endpoint: aliasTogglePath(aliasId),
      schema: AliasToggleResponseSchema,
    });
  }

  /**
   * Set an alias's enabled state explicitly and idempotently. SimpleLogin only
   * exposes a toggle, so this reads the current state first and toggles solely
   * when it differs from the target — re-setting an already-correct state is a
   * no-op that still returns the resulting state.
   */
  async setAliasEnabled(aliasId: number, enabled: boolean): Promise<AliasToggleResponse> {
    const alias = await this.getAlias(aliasId);
    if (alias.enabled === enabled) return { enabled };
    return this.toggleAlias(aliasId);
  }

  getAliasOptions(hostname?: string): Promise<AliasOptions> {
    return this.request({
      method: 'GET',
      endpoint: API_PATHS.aliasOptions,
      query: { hostname },
      schema: AliasOptionsSchema,
    });
  }

  // --- Domains & mailboxes ---------------------------------------------------

  listDomains(): Promise<DomainListResponse> {
    return this.request({
      method: 'GET',
      endpoint: API_PATHS.settingDomains,
      schema: DomainListResponseSchema,
    });
  }

  listMailboxes(): Promise<MailboxListResponse> {
    return this.request({
      method: 'GET',
      endpoint: API_PATHS.mailboxes,
      schema: MailboxListResponseSchema,
    });
  }

  // --- Account ---------------------------------------------------------------

  getUserInfo(): Promise<UserInfo> {
    return this.request({ method: 'GET', endpoint: API_PATHS.userInfo, schema: UserInfoSchema });
  }

  // --- Shared request helper -------------------------------------------------

  private async request<S extends z.ZodTypeAny>(options: RequestOptions<S>): Promise<z.output<S>> {
    const url = this.buildUrl(options.endpoint, options.query);
    const headers: Record<string, string> = {
      Authentication: this.apiKey,
      Accept: 'application/json',
    };
    let bodyInit: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: bodyInit,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw this.toTransportError(error, options.endpoint);
    }

    const parsedBody = this.parseJson(await response.text());

    if (!response.ok) {
      const message =
        this.extractErrorMessage(parsedBody) ?? response.statusText ?? 'Request failed';
      logger.error('SimpleLogin API request failed', {
        endpoint: options.endpoint,
        status: response.status,
      });
      throw new SimpleLoginAPIError(response.status, options.endpoint, message, parsedBody);
    }

    // `parse` is typed as `any` under ZodTypeAny; the assertion restores the
    // schema's precise output type. A ZodError here propagates to the tool layer.
    return options.schema.parse(parsedBody) as z.output<S>;
  }

  private buildUrl(endpoint: string, query?: QueryParams): URL {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private parseJson(rawText: string): unknown {
    if (rawText.length === 0) return undefined;
    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      return rawText;
    }
  }

  private extractErrorMessage(body: unknown): string | undefined {
    if (typeof body === 'string') return body.length > 0 ? body : undefined;
    if (body !== null && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      for (const key of ['error', 'message', 'msg']) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
    return undefined;
  }

  private toTransportError(error: unknown, endpoint: string): SimpleLoginAPIError {
    const name =
      typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    if (name === 'TimeoutError') {
      return new SimpleLoginAPIError(0, endpoint, `Request timed out after ${this.timeoutMs}ms`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new SimpleLoginAPIError(0, endpoint, `Network error: ${detail}`);
  }
}
