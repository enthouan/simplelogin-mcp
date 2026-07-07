/**
 * @module client/simplelogin
 * Typed SimpleLogin API client. A single private `request()` helper centralizes the
 * `Authentication` header, per-request timeout, error parsing, and Zod response
 * validation; every public method is a thin wrapper over it. Adding an endpoint is a
 * small, obvious change: one constant in constants.ts, one schema, one method here.
 */
import { z } from 'zod';
import {
  API_PATHS,
  aliasPath,
  aliasTogglePath,
  aliasActivitiesPath,
  aliasContactsPath,
  contactTogglePath,
  contactPath,
  mailboxPath,
  customDomainPath,
  customDomainTrashPath,
  notificationReadPath,
} from '../constants.js';
import { logger, redactSecrets } from '../logger.js';
import {
  AliasSchema,
  AliasListResponseSchema,
  AliasOptionsSchema,
  AliasToggleResponseSchema,
  AliasDeleteResponseSchema,
  AliasUpdateResponseSchema,
  AliasActivitiesResponseSchema,
  type Alias,
  type AliasListResponse,
  type AliasOptions,
  type AliasToggleResponse,
  type AliasDeleteResponse,
  type AliasActivitiesResponse,
} from '../schemas/alias.js';
import {
  ContactListResponseSchema,
  ContactCreateResponseSchema,
  ContactToggleResponseSchema,
  ContactDeleteResponseSchema,
  type Contact,
  type ContactListResponse,
  type ContactCreateResponse,
  type ContactToggleResponse,
  type ContactDeleteResponse,
} from '../schemas/contact.js';
import {
  MailboxListResponseSchema,
  MailboxCreateResponseSchema,
  MailboxUpdateResponseSchema,
  MailboxDeleteResponseSchema,
  type MailboxListResponse,
  type MailboxCreateResponse,
  type MailboxUpdateResponse,
  type MailboxDeleteResponse,
} from '../schemas/mailbox.js';
import {
  DomainListResponseSchema,
  CustomDomainListResponseSchema,
  CustomDomainUpdateResponseSchema,
  CustomDomainTrashResponseSchema,
  type DomainListResponse,
  type CustomDomainListResponse,
  type CustomDomainUpdateResponse,
  type CustomDomainTrashResponse,
} from '../schemas/domain.js';
import {
  UserInfoSchema,
  AccountStatsSchema,
  ALIAS_GENERATORS,
  SENDER_FORMATS,
  RANDOM_ALIAS_SUFFIXES,
  NotificationListResponseSchema,
  NotificationReadResponseSchema,
  SettingSchema,
  type UserInfo,
  type AccountStats,
  type NotificationListResponse,
  type NotificationReadResponse,
  type Setting,
} from '../schemas/account.js';

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

/**
 * Thrown when a contact block/unblock cannot proceed because the target contact
 * could not be located on its alias. SimpleLogin exposes no single-contact read,
 * so {@link SimpleLoginClient.setContactBlocked} locates the contact by paging the
 * alias's contact list; this signals that the id was absent from that list.
 */
export class ContactMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactMutationError';
  }
}

/**
 * Thrown when a mailbox mutation is rejected locally, before any destructive
 * network call: a no-op update, conflicting inputs, deleting the default mailbox,
 * or an invalid alias-transfer target. Carries no HTTP status because the
 * offending request was never sent.
 */
export class MailboxMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailboxMutationError';
  }
}

/**
 * Thrown when a custom-domain mutation is rejected locally, before any network
 * call: a no-op update or an invalid mailbox set. SimpleLogin answers both with
 * an unhelpful generic 400, so catching them here yields a clear message instead.
 */
export class CustomDomainMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomDomainMutationError';
  }
}

/**
 * Thrown when a settings update is rejected locally, before any network call.
 * SimpleLogin silently accepts an empty PATCH and returns the unchanged
 * settings, so the no-op is caught here with a clear message instead.
 */
export class SettingsMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsMutationError';
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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

type ParsedResponseBody =
  | { kind: 'empty'; body: undefined }
  | { kind: 'json'; body: unknown }
  | { kind: 'text'; body: string }
  | { kind: 'malformed-json'; body: string };

const MAX_ABORT_SIGNAL_TIMEOUT_MS = 2_147_483_647;

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

  /**
   * Read one page (max 20 entries) of an alias's forward/reply/block activity log.
   * Pagination is the bound that keeps the result from growing unbounded.
   */
  listAliasActivities(params: {
    aliasId: number;
    pageId: number;
  }): Promise<AliasActivitiesResponse> {
    return this.request({
      method: 'GET',
      endpoint: aliasActivitiesPath(params.aliasId),
      query: { page_id: params.pageId },
      schema: AliasActivitiesResponseSchema,
    });
  }

  // --- Contacts --------------------------------------------------------------

  /**
   * Read one page (max 20 entries) of an alias's contacts (reverse aliases).
   * Pagination is the bound that keeps the result from growing unbounded.
   */
  listAliasContacts(params: { aliasId: number; pageId: number }): Promise<ContactListResponse> {
    return this.request({
      method: 'GET',
      endpoint: aliasContactsPath(params.aliasId),
      query: { page_id: params.pageId },
      schema: ContactListResponseSchema,
    });
  }

  /**
   * Create a contact (reverse alias) so the user can send mail *from* the alias to
   * `contact`. The value may be a bare address or an RFC-5322 "Name <addr>" form.
   * When the contact already exists the response is simply `{ existed: true }`.
   */
  createContact(params: { aliasId: number; contact: string }): Promise<ContactCreateResponse> {
    return this.request({
      method: 'POST',
      endpoint: aliasContactsPath(params.aliasId),
      body: { contact: params.contact },
      schema: ContactCreateResponseSchema,
    });
  }

  toggleContactBlock(contactId: number): Promise<ContactToggleResponse> {
    return this.request({
      method: 'POST',
      endpoint: contactTogglePath(contactId),
      schema: ContactToggleResponseSchema,
    });
  }

  /**
   * Set a contact's forward-blocking state explicitly and idempotently. As with
   * {@link setAliasEnabled}, SimpleLogin only exposes a toggle (and offers no
   * single-contact read), so this locates the contact in the alias's contact list
   * to learn its current state, then toggles solely when it differs from the
   * target. Re-setting an already-correct state is a no-op that still returns the
   * resulting state. Throws {@link ContactMutationError} if the contact is not on
   * the alias.
   */
  async setContactBlocked(
    aliasId: number,
    contactId: number,
    blocked: boolean,
  ): Promise<ContactToggleResponse> {
    const contact = await this.findContact(aliasId, contactId);
    if (contact === undefined) {
      throw new ContactMutationError(
        `Contact ${contactId} was not found on alias ${aliasId}; use contact_list to confirm the id.`,
      );
    }
    if (contact.block_forward === blocked) return { block_forward: blocked };
    return this.toggleContactBlock(contactId);
  }

  deleteContact(contactId: number): Promise<ContactDeleteResponse> {
    return this.request({
      method: 'DELETE',
      endpoint: contactPath(contactId),
      schema: ContactDeleteResponseSchema,
    });
  }

  /**
   * Find a contact on an alias by walking the paginated contact list (20 per
   * page). Stops at the first match, or once a short/empty page proves the id is
   * absent. Used by {@link setContactBlocked} because no single-contact read exists.
   */
  private async findContact(aliasId: number, contactId: number): Promise<Contact | undefined> {
    for (let pageId = 0; ; pageId++) {
      const { contacts } = await this.listAliasContacts({ aliasId, pageId });
      const match = contacts.find((contact) => contact.id === contactId);
      if (match) return match;
      if (contacts.length < 20) return undefined;
    }
  }

  // --- Domains & mailboxes ---------------------------------------------------

  listDomains(): Promise<DomainListResponse> {
    return this.request({
      method: 'GET',
      endpoint: API_PATHS.settingDomains,
      schema: DomainListResponseSchema,
    });
  }

  listCustomDomains(): Promise<CustomDomainListResponse> {
    return this.request({
      method: 'GET',
      endpoint: API_PATHS.customDomains,
      schema: CustomDomainListResponseSchema,
    });
  }

  /**
   * Update a custom domain's settings. Guardrails enforced before any network
   * call (SimpleLogin answers both cases with a generic 400): the change set must
   * not be empty, and `mailboxIds`, when provided, must name between 1 and 20
   * mailboxes — a domain always keeps at least one mailbox, and SimpleLogin caps
   * a domain at 20. `name: null` clears the domain's display name.
   */
  async updateCustomDomain(
    customDomainId: number,
    patch: {
      catchAll?: boolean;
      randomPrefixGeneration?: boolean;
      name?: string | null;
      mailboxIds?: number[];
    },
  ): Promise<CustomDomainUpdateResponse> {
    if (patch.mailboxIds?.length === 0) {
      throw new CustomDomainMutationError(
        'mailbox_ids cannot be empty; a custom domain must keep at least one mailbox.',
      );
    }
    if (patch.mailboxIds !== undefined && patch.mailboxIds.length > 20) {
      throw new CustomDomainMutationError(
        'mailbox_ids lists more than 20 mailboxes; SimpleLogin allows at most 20 per domain.',
      );
    }
    const hasChange =
      patch.catchAll !== undefined ||
      patch.randomPrefixGeneration !== undefined ||
      patch.name !== undefined ||
      patch.mailboxIds !== undefined;
    if (!hasChange) {
      throw new CustomDomainMutationError(
        'No changes provided; supply at least one field to update (catch_all, random_prefix_generation, name, or mailbox_ids).',
      );
    }

    // undefined fields are dropped by JSON.stringify (a null name survives, clearing it).
    return this.request({
      method: 'PATCH',
      endpoint: customDomainPath(customDomainId),
      body: {
        catch_all: patch.catchAll,
        random_prefix_generation: patch.randomPrefixGeneration,
        name: patch.name,
        mailbox_ids: patch.mailboxIds,
      },
      schema: CustomDomainUpdateResponseSchema,
    });
  }

  /**
   * Read a custom domain's trash: aliases on the domain that were deleted, each
   * with its deletion timestamp. Unpaginated by the API.
   */
  getCustomDomainTrash(customDomainId: number): Promise<CustomDomainTrashResponse> {
    return this.request({
      method: 'GET',
      endpoint: customDomainTrashPath(customDomainId),
      schema: CustomDomainTrashResponseSchema,
    });
  }

  listMailboxes(): Promise<MailboxListResponse> {
    return this.request({
      method: 'GET',
      endpoint: API_PATHS.mailboxes,
      schema: MailboxListResponseSchema,
    });
  }

  /**
   * Create a new mailbox. SimpleLogin emails a verification link to the address;
   * the mailbox is returned unverified and cannot own aliases or become the
   * default until that link is clicked.
   */
  createMailbox(email: string): Promise<MailboxCreateResponse> {
    return this.request({
      method: 'POST',
      endpoint: API_PATHS.mailboxCreate,
      body: { email },
      schema: MailboxCreateResponseSchema,
    });
  }

  /**
   * Update a mailbox. Guardrails enforced before any network call: the change set
   * must not be empty, `setDefault` and `cancelEmailChange` only accept `true`
   * (SimpleLogin ignores `false` for both, so accepting it would silently no-op:
   * a mailbox stops being the default only when another one is promoted, and a
   * pending email change can only be cancelled), and `email` cannot be combined
   * with `cancelEmailChange` since one starts an address change while the other
   * aborts it.
   */
  async updateMailbox(
    mailboxId: number,
    patch: { email?: string; setDefault?: boolean; cancelEmailChange?: boolean },
  ): Promise<MailboxUpdateResponse> {
    if (patch.setDefault === false) {
      throw new MailboxMutationError(
        'set_default only accepts true; to demote this mailbox, set another mailbox as default instead.',
      );
    }
    if (patch.cancelEmailChange === false) {
      throw new MailboxMutationError(
        'cancel_email_change only accepts true; a pending email change is either cancelled or left alone.',
      );
    }
    if (patch.email !== undefined && patch.cancelEmailChange !== undefined) {
      throw new MailboxMutationError(
        'Provide either email or cancel_email_change, not both: one starts an address change, the other cancels it.',
      );
    }
    const hasChange =
      patch.email !== undefined ||
      patch.setDefault !== undefined ||
      patch.cancelEmailChange !== undefined;
    if (!hasChange) {
      throw new MailboxMutationError(
        'No changes provided; supply at least one field to update (email, set_default, or cancel_email_change).',
      );
    }

    // undefined fields are dropped by JSON.stringify, so only provided fields are sent.
    return this.request({
      method: 'PUT',
      endpoint: mailboxPath(mailboxId),
      body: {
        email: patch.email,
        default: patch.setDefault,
        cancel_email_change: patch.cancelEmailChange,
      },
      schema: MailboxUpdateResponseSchema,
    });
  }

  /**
   * Delete a mailbox after local transfer-safety checks. SimpleLogin deletes the
   * mailbox's aliases unless they are transferred, so the caller must choose
   * explicitly: `transferAliasesTo` moves the aliases to another mailbox, while
   * `deleteAliases: true` acknowledges they are deleted with the mailbox. The
   * mailbox list is read first so deleting the default mailbox, a wrong mailbox
   * id, or transferring to a missing/unverified target is rejected with a clear
   * message before anything is destroyed.
   */
  async deleteMailbox(
    mailboxId: number,
    options: { transferAliasesTo?: number; deleteAliases?: boolean },
  ): Promise<MailboxDeleteResponse> {
    const transferring = options.transferAliasesTo !== undefined;
    if (transferring && options.deleteAliases !== undefined) {
      throw new MailboxMutationError(
        'Provide either transfer_aliases_to or delete_aliases, not both: the aliases are either transferred or deleted.',
      );
    }
    if (!transferring && options.deleteAliases !== true) {
      throw new MailboxMutationError(
        'Choose what happens to the aliases owned by this mailbox: pass transfer_aliases_to with the id of another mailbox, or delete_aliases=true to delete them with it.',
      );
    }
    if (options.transferAliasesTo === mailboxId) {
      throw new MailboxMutationError(
        'transfer_aliases_to must be a different mailbox than the one being deleted.',
      );
    }

    const { mailboxes } = await this.listMailboxes();
    const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId);
    if (mailbox === undefined) {
      throw new MailboxMutationError(
        `Mailbox ${mailboxId} was not found on this account; use mailbox_list to confirm the id.`,
      );
    }
    if (mailbox.default) {
      throw new MailboxMutationError(
        `Mailbox ${mailboxId} (${mailbox.email}) is the default mailbox and cannot be deleted; make another mailbox the default first via mailbox_update with set_default=true.`,
      );
    }
    if (transferring) {
      const target = mailboxes.find((candidate) => candidate.id === options.transferAliasesTo);
      if (target === undefined) {
        throw new MailboxMutationError(
          `Transfer target mailbox ${options.transferAliasesTo} was not found on this account; use mailbox_list to confirm the id.`,
        );
      }
      // `verified` is optional in older instances; only a known-unverified target is rejected.
      if (target.verified === false) {
        throw new MailboxMutationError(
          `Transfer target mailbox ${target.id} (${target.email}) is not verified; verify it before transferring aliases to it.`,
        );
      }
    }

    return this.request({
      method: 'DELETE',
      endpoint: mailboxPath(mailboxId),
      body: transferring ? { transfer_aliases_to: options.transferAliasesTo } : undefined,
      schema: MailboxDeleteResponseSchema,
    });
  }

  // --- Account ---------------------------------------------------------------

  getUserInfo(): Promise<UserInfo> {
    return this.request({ method: 'GET', endpoint: API_PATHS.userInfo, schema: UserInfoSchema });
  }

  getStats(): Promise<AccountStats> {
    return this.request({ method: 'GET', endpoint: API_PATHS.stats, schema: AccountStatsSchema });
  }

  /**
   * Read one page (max 20 entries) of account notifications, unread first then
   * newest first. The endpoint pages via `page`, unlike the `page_id` used by
   * the alias/contact/activity lists.
   */
  listNotifications(params: { pageId: number }): Promise<NotificationListResponse> {
    return this.request({
      method: 'GET',
      endpoint: API_PATHS.notifications,
      query: { page: params.pageId },
      schema: NotificationListResponseSchema,
    });
  }

  markNotificationRead(notificationId: number): Promise<NotificationReadResponse> {
    return this.request({
      method: 'POST',
      endpoint: notificationReadPath(notificationId),
      schema: NotificationReadResponseSchema,
    });
  }

  getSettings(): Promise<Setting> {
    return this.request({ method: 'GET', endpoint: API_PATHS.setting, schema: SettingSchema });
  }

  /**
   * Update the account-wide alias settings and return the resulting settings.
   * Deliberately conservative: only the five documented, well-understood fields
   * are supported, and an empty change set is rejected before any network call
   * (SimpleLogin would silently accept it). `randomAliasDefaultDomain` is
   * validated server-side: it must be a domain from the alias-domains list, and
   * premium-only or unverified/foreign custom domains are rejected with a clear
   * API error.
   */
  async updateSettings(patch: {
    aliasGenerator?: (typeof ALIAS_GENERATORS)[number];
    notification?: boolean;
    randomAliasDefaultDomain?: string;
    senderFormat?: (typeof SENDER_FORMATS)[number];
    randomAliasSuffix?: (typeof RANDOM_ALIAS_SUFFIXES)[number];
  }): Promise<Setting> {
    const hasChange =
      patch.aliasGenerator !== undefined ||
      patch.notification !== undefined ||
      patch.randomAliasDefaultDomain !== undefined ||
      patch.senderFormat !== undefined ||
      patch.randomAliasSuffix !== undefined;
    if (!hasChange) {
      throw new SettingsMutationError(
        'No changes provided; supply at least one field to update (alias_generator, notification, random_alias_default_domain, sender_format, or random_alias_suffix).',
      );
    }

    // undefined fields are dropped by JSON.stringify, so only provided fields are sent.
    return this.request({
      method: 'PATCH',
      endpoint: API_PATHS.setting,
      body: {
        alias_generator: patch.aliasGenerator,
        notification: patch.notification,
        random_alias_default_domain: patch.randomAliasDefaultDomain,
        sender_format: patch.senderFormat,
        random_alias_suffix: patch.randomAliasSuffix,
      },
      schema: SettingSchema,
    });
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
    let signal: AbortSignal | undefined;
    try {
      signal = this.buildTimeoutSignal();
      response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: bodyInit,
        signal,
      });
    } catch (error) {
      const apiError = this.toTransportError(error, options.endpoint, signal?.aborted ?? false);
      this.logTransportFailure(options.endpoint, options.method, error, apiError);
      throw apiError;
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch (error) {
      const apiError = this.toTransportError(error, options.endpoint, signal?.aborted ?? false);
      this.logTransportFailure(options.endpoint, options.method, error, apiError);
      throw apiError;
    }

    const parsedBody = this.parseResponseBody(rawText, response.headers.get('content-type'));

    if (!response.ok) {
      const message = this.httpErrorMessage(response, parsedBody);
      const retryAfter = response.headers.get('retry-after') ?? undefined;
      logger.error('SimpleLogin API request failed', {
        endpoint: options.endpoint,
        method: options.method,
        status: response.status,
        statusText: response.statusText
          ? redactSecrets(response.statusText, [this.apiKey])
          : undefined,
        responseBody: parsedBody.kind,
        retryAfter: retryAfter ? redactSecrets(retryAfter, [this.apiKey]) : undefined,
      });
      throw new SimpleLoginAPIError(response.status, options.endpoint, message, parsedBody.body);
    }

    // A ZodError here propagates to the tool layer.
    return options.schema.parse(parsedBody.body);
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

  private buildTimeoutSignal(): AbortSignal {
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > MAX_ABORT_SIGNAL_TIMEOUT_MS
    ) {
      throw new RangeError(
        `Invalid request timeout ${this.timeoutMs}ms; set SL_REQUEST_TIMEOUT_MS between 1 and ${MAX_ABORT_SIGNAL_TIMEOUT_MS}.`,
      );
    }
    return AbortSignal.timeout(this.timeoutMs);
  }

  private logTransportFailure(
    endpoint: string,
    method: HttpMethod,
    error: unknown,
    apiError: SimpleLoginAPIError,
  ): void {
    logger.error('SimpleLogin API transport failure', {
      endpoint,
      method,
      errorName: this.errorName(error),
      errorMessage: apiError.message,
      timeoutMs: this.timeoutMs,
    });
  }

  private parseResponseBody(rawText: string, contentType: string | null): ParsedResponseBody {
    if (rawText.length === 0) return { kind: 'empty', body: undefined };
    const expectsJson = contentType?.toLowerCase().includes('json') ?? false;
    try {
      return { kind: 'json', body: JSON.parse(rawText) as unknown };
    } catch {
      return { kind: expectsJson ? 'malformed-json' : 'text', body: rawText };
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

  private httpErrorMessage(response: Response, parsedBody: ParsedResponseBody): string {
    const serverMessage =
      parsedBody.kind === 'malformed-json' ? undefined : this.extractErrorMessage(parsedBody.body);
    const fallback = response.statusText || `HTTP ${response.status}`;
    let message: string;

    if (response.status === 429) {
      message = serverMessage ?? 'Rate limited by SimpleLogin';
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) message = `${message} (retry after ${retryAfter})`;
    } else if (serverMessage) {
      message = serverMessage;
    } else if (parsedBody.kind === 'malformed-json') {
      message = `${fallback} (malformed JSON error body)`;
    } else {
      message = fallback;
    }

    return redactSecrets(message, [this.apiKey]);
  }

  private toTransportError(
    error: unknown,
    endpoint: string,
    timedOut: boolean,
  ): SimpleLoginAPIError {
    const name = this.errorName(error);
    if (timedOut || name === 'TimeoutError') {
      return new SimpleLoginAPIError(0, endpoint, `Request timed out after ${this.timeoutMs}ms`);
    }
    if (name === 'AbortError') {
      return new SimpleLoginAPIError(
        0,
        endpoint,
        'Request was aborted before SimpleLogin responded',
      );
    }
    if (error instanceof RangeError && error.message.startsWith('Invalid request timeout ')) {
      return new SimpleLoginAPIError(0, endpoint, error.message);
    }
    const detail = redactSecrets(this.errorDetail(error), [this.apiKey]);
    return new SimpleLoginAPIError(0, endpoint, `Network error: ${detail}`);
  }

  private errorName(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  }

  private errorDetail(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
}
