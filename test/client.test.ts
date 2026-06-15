/**
 * Client behaviour with an injected fetcher: request construction (URL, query,
 * method, headers, body), per-endpoint request shapes, error mapping, and Zod
 * response validation. No live SimpleLogin calls are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  SimpleLoginClient,
  SimpleLoginAPIError,
  AliasMutationError,
  ContactMutationError,
  MailboxMutationError,
  CustomDomainMutationError,
  SettingsMutationError,
  type FetchLike,
} from '../src/client/simplelogin.js';

interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A minimal valid alias payload satisfying AliasSchema. */
const ALIAS = {
  id: 1,
  email: 'a@b.io',
  enabled: true,
  creation_timestamp: 0,
  nb_block: 0,
  nb_forward: 0,
  nb_reply: 0,
  mailboxes: [{ id: 1, email: 'me@b.io' }],
};

/** A minimal valid user-info payload satisfying UserInfoSchema. */
const USER_INFO = { name: 'A', email: 'a@b.io', is_premium: false, in_trial: false };

function jsonResponse(data: unknown, status = 200, statusText?: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, status: number, statusText?: string): Response {
  return new Response(text, {
    status,
    statusText,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * Build a client wired to a recording stub fetcher. `respond` may be a fixed
 * Response or a function of the recorded call.
 */
function stubClient(
  respond: Response | ((call: RecordedCall) => Response | Promise<Response> | Promise<never>),
  options: { apiKey?: string; timeoutMs?: number } = {},
) {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call: RecordedCall = { url, method: init.method ?? 'GET', headers, body };
    calls.push(call);
    return Promise.resolve(typeof respond === 'function' ? respond(call) : respond);
  };
  const client = new SimpleLoginClient({
    apiUrl: 'https://sl.example.com/',
    apiKey: options.apiKey ?? 'secret-key',
    timeoutMs: options.timeoutMs ?? 1000,
    fetch: fetchImpl,
  });
  return { client, calls };
}

describe('request construction', () => {
  it('sends auth and accept headers, no body, on a GET', async () => {
    const { client, calls } = stubClient(jsonResponse(USER_INFO));
    await client.getUserInfo();

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.toString()).toBe('https://sl.example.com/api/user_info');
    expect(call.headers['Authentication']).toBe('secret-key');
    expect(call.headers['Accept']).toBe('application/json');
    expect(call.headers['Content-Type']).toBeUndefined();
    expect(call.body).toBeUndefined();
  });

  it('strips a trailing slash from the base URL exactly once', async () => {
    const { client, calls } = stubClient(jsonResponse(USER_INFO));
    await client.getUserInfo();
    expect(calls[0]!.url.toString()).not.toContain('.com//');
  });
});

describe('alias list', () => {
  it('uses GET with page and filter query params and no body', async () => {
    const { client, calls } = stubClient(jsonResponse({ aliases: [ALIAS] }));
    await client.listAliases({ pageId: 2, filter: 'pinned' });

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/v2/aliases');
    expect(call.url.searchParams.get('page_id')).toBe('2');
    expect(call.url.searchParams.get('pinned')).toBe('true');
    expect(call.body).toBeUndefined();
  });

  it('switches to POST with a body when a search query is present', async () => {
    const { client, calls } = stubClient(jsonResponse({ aliases: [] }));
    await client.listAliases({ pageId: 0, query: 'amazon' });

    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.searchParams.get('page_id')).toBe('0');
    expect(call.url.searchParams.has('query')).toBe(false);
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.body).toEqual({ query: 'amazon' });
  });
});

describe('alias activity list', () => {
  const ACTIVITY = {
    action: 'reply',
    from: 'alias@sl.io',
    to: 'dest@example.com',
    timestamp: 1580903760,
    reverse_alias: '"dest at example.com" <reply@sl.io>',
    reverse_alias_address: 'reply@sl.io',
  };

  it('uses GET with the activities path and a page_id query, no body', async () => {
    const { client, calls } = stubClient(jsonResponse({ activities: [ACTIVITY] }));
    await client.listAliasActivities({ aliasId: 42, pageId: 3 });

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/aliases/42/activities');
    expect(call.url.searchParams.get('page_id')).toBe('3');
    expect(call.body).toBeUndefined();
  });

  it('parses an activity payload, leaving reverse-alias fields optional', async () => {
    const minimal = { action: 'block', from: 'x@sl.io', to: 'y@example.com', timestamp: 1 };
    const { client } = stubClient(jsonResponse({ activities: [ACTIVITY, minimal] }));
    await expect(client.listAliasActivities({ aliasId: 1, pageId: 0 })).resolves.toEqual({
      activities: [ACTIVITY, minimal],
    });
  });

  it('propagates a ZodError when an activity entry is malformed', async () => {
    const { client } = stubClient(jsonResponse({ activities: [{ action: 'reply' }] }));
    await expect(client.listAliasActivities({ aliasId: 1, pageId: 0 })).rejects.toBeInstanceOf(
      z.ZodError,
    );
  });
});

describe('alias creation request shapes', () => {
  it('random alias sends note in the body and mode/hostname in the query', async () => {
    const { client, calls } = stubClient(jsonResponse(ALIAS));
    await client.createRandomAlias({ mode: 'word', note: 'shopping', hostname: 'shop.com' });

    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/api/alias/random/new');
    expect(call.url.searchParams.get('mode')).toBe('word');
    expect(call.url.searchParams.get('hostname')).toBe('shop.com');
    expect(call.body).toEqual({ note: 'shopping' });
  });

  it('custom alias sends prefix, signed suffix, and mailbox ids', async () => {
    const { client, calls } = stubClient(jsonResponse(ALIAS));
    await client.createCustomAlias({
      aliasPrefix: 'foo',
      signedSuffix: '.sig123',
      mailboxIds: [1, 2],
      note: 'n',
      name: 'N',
    });

    const call = calls[0]!;
    expect(call.url.pathname).toBe('/api/v3/alias/custom/new');
    expect(call.body).toEqual({
      alias_prefix: 'foo',
      signed_suffix: '.sig123',
      mailbox_ids: [1, 2],
      note: 'n',
      name: 'N',
    });
  });
});

describe('alias mutations', () => {
  it('update sends only provided fields and normalizes the empty response', async () => {
    const { client, calls } = stubClient(new Response(null, { status: 200 }));
    const result = await client.updateAlias(7, { note: 'hi', pinned: true });

    expect(result).toEqual({ ok: true });
    const call = calls[0]!;
    expect(call.method).toBe('PATCH');
    expect(call.url.pathname).toBe('/api/aliases/7');
    expect(call.body).toEqual({ note: 'hi', pinned: true });
    expect(Object.keys(call.body as Record<string, unknown>)).toEqual(['note', 'pinned']);
  });

  it('delete issues a DELETE to the alias path', async () => {
    const { client, calls } = stubClient(jsonResponse({ deleted: true }));
    await expect(client.deleteAlias(9)).resolves.toEqual({ deleted: true });
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url.pathname).toBe('/api/aliases/9');
  });

  it('toggle issues a POST to the toggle path', async () => {
    const { client, calls } = stubClient(jsonResponse({ enabled: false }));
    await expect(client.toggleAlias(9)).resolves.toEqual({ enabled: false });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe('/api/aliases/9/toggle');
  });
});

describe('alias update guardrails', () => {
  it('rejects a no-op update before any network call', async () => {
    const { client, calls } = stubClient(jsonResponse({}));
    const error = await client.updateAlias(7, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AliasMutationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an update that sets both mailbox_id and mailbox_ids', async () => {
    const { client, calls } = stubClient(jsonResponse({}));
    const error = await client
      .updateAlias(7, { mailboxId: 1, mailboxIds: [2] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AliasMutationError);
    expect(calls).toHaveLength(0);
  });

  it('allows an update that sets only one of the mailbox fields', async () => {
    const { client, calls } = stubClient(new Response(null, { status: 200 }));
    await expect(client.updateAlias(7, { mailboxIds: [2, 3] })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ mailbox_ids: [2, 3] });
  });
});

describe('alias set enabled', () => {
  it('reads the alias then toggles when the current state differs from the target', async () => {
    const { client, calls } = stubClient((call) =>
      call.url.pathname.endsWith('/toggle')
        ? jsonResponse({ enabled: true })
        : jsonResponse({ ...ALIAS, enabled: false }),
    );
    await expect(client.setAliasEnabled(5, true)).resolves.toEqual({ enabled: true });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe('/api/aliases/5');
    expect(calls[1]!.method).toBe('POST');
    expect(calls[1]!.url.pathname).toBe('/api/aliases/5/toggle');
  });

  it('skips the toggle and stays a no-op when already in the target state', async () => {
    const { client, calls } = stubClient(jsonResponse({ ...ALIAS, enabled: true }));
    await expect(client.setAliasEnabled(5, true)).resolves.toEqual({ enabled: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe('/api/aliases/5');
  });
});

describe('alias contacts', () => {
  /** A minimal valid contact payload satisfying ContactSchema. */
  const CONTACT = {
    id: 7,
    contact: 'marketing@example.com',
    creation_timestamp: 1582284900,
    reverse_alias: 'marketing at example.com <reply+abc@sl.co>',
    reverse_alias_address: 'reply+abc@sl.co',
    block_forward: false,
  };

  it('list uses GET with the contacts path and a page_id query, no body', async () => {
    const { client, calls } = stubClient(jsonResponse({ contacts: [CONTACT] }));
    await client.listAliasContacts({ aliasId: 42, pageId: 2 });

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/aliases/42/contacts');
    expect(call.url.searchParams.get('page_id')).toBe('2');
    expect(call.body).toBeUndefined();
  });

  it('list parses a contact with the optional/nullable fields omitted', async () => {
    const minimal = {
      id: 1,
      contact: 'a@b.io',
      creation_timestamp: 1,
      reverse_alias: 'a at b.io <reply+x@sl.co>',
      block_forward: true,
    };
    const { client } = stubClient(jsonResponse({ contacts: [minimal] }));
    await expect(client.listAliasContacts({ aliasId: 1, pageId: 0 })).resolves.toEqual({
      contacts: [minimal],
    });
  });

  it('create POSTs the contact in the body to the alias contacts path', async () => {
    const { client, calls } = stubClient(jsonResponse({ ...CONTACT, existed: false }, 201));
    await client.createContact({ aliasId: 9, contact: 'First Last <first@example.com>' });

    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/api/aliases/9/contacts');
    expect(call.body).toEqual({ contact: 'First Last <first@example.com>' });
  });

  it('create accepts the existed-only response when the contact already exists', async () => {
    const { client } = stubClient(jsonResponse({ existed: true }));
    await expect(
      client.createContact({ aliasId: 9, contact: 'first@example.com' }),
    ).resolves.toEqual({ existed: true });
  });

  it('toggle issues a POST to the contact toggle path', async () => {
    const { client, calls } = stubClient(jsonResponse({ block_forward: true }));
    await expect(client.toggleContactBlock(7)).resolves.toEqual({ block_forward: true });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe('/api/contacts/7/toggle');
  });

  it('delete issues a DELETE to the contact path', async () => {
    const { client, calls } = stubClient(jsonResponse({ deleted: true }));
    await expect(client.deleteContact(7)).resolves.toEqual({ deleted: true });
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url.pathname).toBe('/api/contacts/7');
  });
});

describe('contact set blocked', () => {
  const CONTACT = {
    id: 7,
    contact: 'marketing@example.com',
    creation_timestamp: 1582284900,
    reverse_alias: 'marketing at example.com <reply+abc@sl.co>',
    block_forward: false,
  };

  it('reads the contact list then toggles when the current state differs', async () => {
    const { client, calls } = stubClient((call) =>
      call.url.pathname.endsWith('/toggle')
        ? jsonResponse({ block_forward: true })
        : jsonResponse({ contacts: [CONTACT] }),
    );
    await expect(client.setContactBlocked(42, 7, true)).resolves.toEqual({ block_forward: true });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe('/api/aliases/42/contacts');
    expect(calls[1]!.method).toBe('POST');
    expect(calls[1]!.url.pathname).toBe('/api/contacts/7/toggle');
  });

  it('skips the toggle and stays a no-op when already in the target state', async () => {
    const { client, calls } = stubClient(jsonResponse({ contacts: [CONTACT] }));
    await expect(client.setContactBlocked(42, 7, false)).resolves.toEqual({ block_forward: false });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
  });

  it('pages through the contact list to find a contact beyond the first page', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => ({ ...CONTACT, id: i + 100 }));
    const { client, calls } = stubClient((call) => {
      if (call.url.pathname.endsWith('/toggle')) return jsonResponse({ block_forward: true });
      const page = call.url.searchParams.get('page_id');
      return jsonResponse({ contacts: page === '0' ? firstPage : [CONTACT] });
    });
    await expect(client.setContactBlocked(42, 7, true)).resolves.toEqual({ block_forward: true });

    expect(calls[0]!.url.searchParams.get('page_id')).toBe('0');
    expect(calls[1]!.url.searchParams.get('page_id')).toBe('1');
    expect(calls[2]!.url.pathname).toBe('/api/contacts/7/toggle');
  });

  it('throws ContactMutationError without toggling when the contact is absent', async () => {
    const { client, calls } = stubClient(jsonResponse({ contacts: [] }));
    const error = await client.setContactBlocked(42, 7, true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContactMutationError);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe('/api/aliases/42/contacts');
  });
});

describe('mailbox create', () => {
  const CREATED = { id: 4, email: 'new@example.com', verified: false, default: false };

  it('POSTs the email in the body and parses the created mailbox', async () => {
    const { client, calls } = stubClient(
      jsonResponse({ ...CREATED, creation_timestamp: 1, nb_alias: 0 }, 201),
    );
    await expect(client.createMailbox('new@example.com')).resolves.toEqual({
      ...CREATED,
      creation_timestamp: 1,
      nb_alias: 0,
    });

    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/api/mailboxes');
    expect(call.body).toEqual({ email: 'new@example.com' });
  });

  it('parses a response without the optional creation_timestamp/nb_alias fields', async () => {
    const { client } = stubClient(jsonResponse(CREATED, 201));
    await expect(client.createMailbox('new@example.com')).resolves.toEqual(CREATED);
  });

  it('propagates a ZodError when the created mailbox is malformed', async () => {
    const { client } = stubClient(jsonResponse({ email: 'new@example.com' }, 201));
    await expect(client.createMailbox('new@example.com')).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe('mailbox update', () => {
  it('PUTs only the provided fields to the mailbox path', async () => {
    const { client, calls } = stubClient(jsonResponse({ updated: true }));
    await expect(client.updateMailbox(7, { email: 'renamed@example.com' })).resolves.toEqual({
      updated: true,
    });

    const call = calls[0]!;
    expect(call.method).toBe('PUT');
    expect(call.url.pathname).toBe('/api/mailboxes/7');
    expect(call.body).toEqual({ email: 'renamed@example.com' });
    expect(Object.keys(call.body as Record<string, unknown>)).toEqual(['email']);
  });

  it('sends default=true when promoting a mailbox to default', async () => {
    const { client, calls } = stubClient(jsonResponse({ updated: true }));
    await client.updateMailbox(7, { setDefault: true });
    expect(calls[0]!.body).toEqual({ default: true });
  });

  it('sends cancel_email_change=true when cancelling a pending change', async () => {
    const { client, calls } = stubClient(jsonResponse({ updated: true }));
    await client.updateMailbox(7, { cancelEmailChange: true });
    expect(calls[0]!.body).toEqual({ cancel_email_change: true });
  });

  it('rejects a no-op update before any network call', async () => {
    const { client, calls } = stubClient(jsonResponse({ updated: true }));
    const error = await client.updateMailbox(7, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects setDefault=false, which SimpleLogin would silently ignore', async () => {
    const { client, calls } = stubClient(jsonResponse({ updated: true }));
    const error = await client.updateMailbox(7, { setDefault: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects cancelEmailChange=false, which SimpleLogin would silently ignore', async () => {
    const { client, calls } = stubClient(jsonResponse({ updated: true }));
    const error = await client
      .updateMailbox(7, { cancelEmailChange: false })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects combining an email change with cancel_email_change', async () => {
    const { client, calls } = stubClient(jsonResponse({ updated: true }));
    const error = await client
      .updateMailbox(7, { email: 'renamed@example.com', cancelEmailChange: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(0);
  });
});

describe('mailbox delete safeguards', () => {
  /** Account fixture: a default mailbox, a verified secondary, and an unverified one. */
  const MAILBOXES = {
    mailboxes: [
      {
        id: 1,
        email: 'me@b.io',
        default: true,
        creation_timestamp: 0,
        nb_alias: 5,
        verified: true,
      },
      {
        id: 2,
        email: 'work@b.io',
        default: false,
        creation_timestamp: 0,
        nb_alias: 2,
        verified: true,
      },
      {
        id: 3,
        email: 'new@b.io',
        default: false,
        creation_timestamp: 0,
        nb_alias: 0,
        verified: false,
      },
    ],
  };

  /** Stub that serves the mailbox list for GETs and a delete success otherwise. */
  function deleteStub() {
    return stubClient((call) =>
      call.method === 'GET' ? jsonResponse(MAILBOXES) : jsonResponse({ deleted: true }),
    );
  }

  it('transfers aliases: reads the mailbox list, then DELETEs with transfer_aliases_to', async () => {
    const { client, calls } = deleteStub();
    await expect(client.deleteMailbox(2, { transferAliasesTo: 1 })).resolves.toEqual({
      deleted: true,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe('/api/v2/mailboxes');
    expect(calls[1]!.method).toBe('DELETE');
    expect(calls[1]!.url.pathname).toBe('/api/mailboxes/2');
    expect(calls[1]!.body).toEqual({ transfer_aliases_to: 1 });
  });

  it('deletes aliases only with an explicit delete_aliases acknowledgement, sending no body', async () => {
    const { client, calls } = deleteStub();
    await expect(client.deleteMailbox(2, { deleteAliases: true })).resolves.toEqual({
      deleted: true,
    });

    expect(calls[1]!.method).toBe('DELETE');
    expect(calls[1]!.body).toBeUndefined();
    expect(calls[1]!.headers['Content-Type']).toBeUndefined();
  });

  it('rejects a delete that chooses no alias fate, before any network call', async () => {
    const { client, calls } = deleteStub();
    const error = await client.deleteMailbox(2, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a delete that both transfers and deletes the aliases', async () => {
    const { client, calls } = deleteStub();
    const error = await client
      .deleteMailbox(2, { transferAliasesTo: 1, deleteAliases: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects transferring aliases to the mailbox being deleted', async () => {
    const { client, calls } = deleteStub();
    const error = await client.deleteMailbox(2, { transferAliasesTo: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(0);
  });

  it('refuses to delete the default mailbox, issuing no DELETE', async () => {
    const { client, calls } = deleteStub();
    const error = await client.deleteMailbox(1, { deleteAliases: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect((error as Error).message).toContain('default');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
  });

  it('rejects a mailbox id that is not on the account, issuing no DELETE', async () => {
    const { client, calls } = deleteStub();
    const error = await client.deleteMailbox(99, { deleteAliases: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(1);
  });

  it('rejects a transfer target that is not on the account, issuing no DELETE', async () => {
    const { client, calls } = deleteStub();
    const error = await client.deleteMailbox(2, { transferAliasesTo: 99 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect(calls).toHaveLength(1);
  });

  it('rejects an unverified transfer target, issuing no DELETE', async () => {
    const { client, calls } = deleteStub();
    const error = await client.deleteMailbox(2, { transferAliasesTo: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailboxMutationError);
    expect((error as Error).message).toContain('not verified');
    expect(calls).toHaveLength(1);
  });

  it('allows a transfer target whose verified flag is absent (older instances)', async () => {
    const mailboxes = {
      mailboxes: [
        { id: 2, email: 'work@b.io', default: false, creation_timestamp: 0 },
        { id: 5, email: 'old@b.io', default: false, creation_timestamp: 0 },
      ],
    };
    const { client, calls } = stubClient((call) =>
      call.method === 'GET' ? jsonResponse(mailboxes) : jsonResponse({ deleted: true }),
    );
    await expect(client.deleteMailbox(2, { transferAliasesTo: 5 })).resolves.toEqual({
      deleted: true,
    });
    expect(calls).toHaveLength(2);
  });
});

describe('custom domains', () => {
  /** A valid custom-domain payload satisfying CustomDomainSchema. */
  const CUSTOM_DOMAIN = {
    id: 3,
    domain_name: 'mail.example.org',
    is_verified: true,
    nb_alias: 4,
    creation_date: '2021-03-10 21:36:08+00:00',
    creation_timestamp: 1615412168,
    catch_all: false,
    name: null,
    random_prefix_generation: false,
    mailboxes: [{ id: 1, email: 'me@b.io' }],
  };

  it('list uses GET on the custom domains path with no body', async () => {
    const { client, calls } = stubClient(jsonResponse({ custom_domains: [CUSTOM_DOMAIN] }));
    await expect(client.listCustomDomains()).resolves.toEqual({
      custom_domains: [CUSTOM_DOMAIN],
    });

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/custom_domains');
    expect(call.body).toBeUndefined();
  });

  it('list propagates a ZodError when a domain entry is malformed', async () => {
    const { client } = stubClient(jsonResponse({ custom_domains: [{ id: 3 }] }));
    await expect(client.listCustomDomains()).rejects.toBeInstanceOf(z.ZodError);
  });

  it('trash uses GET on the trash path and parses the deleted aliases', async () => {
    const trash = { aliases: [{ alias: 'old@mail.example.org', deletion_timestamp: 1605464595 }] };
    const { client, calls } = stubClient(jsonResponse(trash));
    await expect(client.getCustomDomainTrash(3)).resolves.toEqual(trash);

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/custom_domains/3/trash');
    expect(call.body).toBeUndefined();
  });

  it('update PATCHes only the provided fields to the domain path', async () => {
    const updated = { custom_domain: { ...CUSTOM_DOMAIN, catch_all: true } };
    const { client, calls } = stubClient(jsonResponse(updated));
    await expect(client.updateCustomDomain(3, { catchAll: true })).resolves.toEqual(updated);

    const call = calls[0]!;
    expect(call.method).toBe('PATCH');
    expect(call.url.pathname).toBe('/api/custom_domains/3');
    expect(call.body).toEqual({ catch_all: true });
    expect(Object.keys(call.body as Record<string, unknown>)).toEqual(['catch_all']);
  });

  it('update sends a null name to clear the display name', async () => {
    const { client, calls } = stubClient(jsonResponse({ custom_domain: CUSTOM_DOMAIN }));
    await client.updateCustomDomain(3, { name: null });
    expect(calls[0]!.body).toEqual({ name: null });
  });

  it('update sends a replacement mailbox set', async () => {
    const { client, calls } = stubClient(jsonResponse({ custom_domain: CUSTOM_DOMAIN }));
    await client.updateCustomDomain(3, { randomPrefixGeneration: true, mailboxIds: [1, 2] });
    expect(calls[0]!.body).toEqual({ random_prefix_generation: true, mailbox_ids: [1, 2] });
  });

  it('rejects a no-op update before any network call', async () => {
    const { client, calls } = stubClient(jsonResponse({ custom_domain: CUSTOM_DOMAIN }));
    const error = await client.updateCustomDomain(3, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CustomDomainMutationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty mailbox set before any network call', async () => {
    const { client, calls } = stubClient(jsonResponse({ custom_domain: CUSTOM_DOMAIN }));
    const error = await client.updateCustomDomain(3, { mailboxIds: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CustomDomainMutationError);
    expect((error as Error).message).toContain('at least one mailbox');
    expect(calls).toHaveLength(0);
  });

  it('rejects a mailbox set above the 20-per-domain cap before any network call', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => i + 1);
    const { client, calls } = stubClient(jsonResponse({ custom_domain: CUSTOM_DOMAIN }));
    const error = await client
      .updateCustomDomain(3, { mailboxIds: tooMany })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CustomDomainMutationError);
    expect((error as Error).message).toContain('20');
    expect(calls).toHaveLength(0);
  });
});

describe('error mapping', () => {
  it('maps a non-2xx response to a SimpleLoginAPIError with status, endpoint, and message', async () => {
    const { client } = stubClient(jsonResponse({ error: 'Alias not found' }, 404));
    const error = await client.getAlias(99).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SimpleLoginAPIError);
    const apiError = error as SimpleLoginAPIError;
    expect(apiError.status).toBe(404);
    expect(apiError.endpoint).toBe('/api/aliases/99');
    expect(apiError.message).toBe('Alias not found');
    expect(apiError.body).toEqual({ error: 'Alias not found' });
  });

  it.each([
    [{ error: 'Invalid API key' }, 401, 'Invalid API key'],
    [{ message: 'Forbidden' }, 403, 'Forbidden'],
    [{ msg: 'Validation failed' }, 400, 'Validation failed'],
    [{ error: 'Already exists' }, 409, 'Already exists'],
    [{ error: 'Upstream unavailable' }, 502, 'Upstream unavailable'],
  ])('reads JSON error/message/msg bodies for HTTP %s', async (body, status, expected) => {
    const message = await stubClient(jsonResponse(body, status))
      .client.getAlias(1)
      .catch((e: unknown) => (e as SimpleLoginAPIError).message);
    expect(message).toBe(expected);
  });

  it('reads plain-text error bodies', async () => {
    const { client } = stubClient(textResponse('plain failure', 503));
    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error.status).toBe(503);
    expect(error.endpoint).toBe('/api/aliases/1');
    expect(error.message).toBe('plain failure');
    expect(error.body).toBe('plain failure');
  });

  it('falls back to the status text for an empty error body', async () => {
    const { client } = stubClient(new Response(null, { status: 500, statusText: 'Server Error' }));
    const message = await client
      .getAlias(1)
      .catch((e: unknown) => (e as SimpleLoginAPIError).message);
    expect(message).toBe('Server Error');
  });

  it('reports malformed JSON error bodies deterministically', async () => {
    const { client } = stubClient(
      new Response('{ nope', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error.status).toBe(502);
    expect(error.endpoint).toBe('/api/aliases/1');
    expect(error.message).toBe('Bad Gateway (malformed JSON error body)');
    expect(error.body).toBe('{ nope');
  });

  it('surfaces rate-limit status, endpoint, message, and retry-after without retrying', async () => {
    const { client, calls } = stubClient(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      }),
    );
    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;

    expect(error.status).toBe(429);
    expect(error.endpoint).toBe('/api/aliases/1');
    expect(error.message).toBe('Rate limit exceeded (retry after 60)');
    expect(calls).toHaveLength(1);
  });

  it('redacts the configured API key if a server error echoes it', async () => {
    const { client } = stubClient(jsonResponse({ error: 'bad secret-key' }, 401));
    const error = (await client.getUserInfo().catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error.message).toBe('bad [REDACTED]');
    expect(error.message).not.toContain('secret-key');
  });

  it('redacts the configured API key from logged status text', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { client } = stubClient(
        new Response(null, { status: 500, statusText: 'bad secret-key' }),
      );
      const error = (await client.getUserInfo().catch((e: unknown) => e)) as SimpleLoginAPIError;
      expect(error.message).toBe('bad [REDACTED]');

      const logged = stderrWrite.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('bad [REDACTED]');
      expect(logged).not.toContain('secret-key');
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it('maps a timeout to status 0 with a timeout message', async () => {
    const { client } = stubClient(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
    );
    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error).toBeInstanceOf(SimpleLoginAPIError);
    expect(error.status).toBe(0);
    expect(error.message).toBe('Request timed out after 1000ms');
  });

  it('maps a response body timeout to a transport error with endpoint context', async () => {
    const response = jsonResponse(ALIAS);
    vi.spyOn(response, 'text').mockRejectedValue(
      Object.assign(new Error('body stalled'), { name: 'TimeoutError' }),
    );
    const { client, calls } = stubClient(response);

    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;

    expect(error).toBeInstanceOf(SimpleLoginAPIError);
    expect(error.status).toBe(0);
    expect(error.endpoint).toBe('/api/aliases/1');
    expect(error.message).toBe('Request timed out after 1000ms');
    expect(calls).toHaveLength(1);
  });

  it('maps an abort to status 0 with an abort message', async () => {
    const { client } = stubClient(() =>
      Promise.reject(Object.assign(new Error('operation aborted'), { name: 'AbortError' })),
    );
    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error).toBeInstanceOf(SimpleLoginAPIError);
    expect(error.status).toBe(0);
    expect(error.endpoint).toBe('/api/aliases/1');
    expect(error.message).toBe('Request was aborted before SimpleLogin responded');
  });

  it('maps an invalid timeout configuration before any fetch call', async () => {
    const { client, calls } = stubClient(jsonResponse(USER_INFO), { timeoutMs: 5_000_000_000 });
    const error = (await client.getUserInfo().catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error).toBeInstanceOf(SimpleLoginAPIError);
    expect(error.status).toBe(0);
    expect(error.endpoint).toBe('/api/user_info');
    expect(error.message).toBe(
      'Invalid request timeout 5000000000ms; set SL_REQUEST_TIMEOUT_MS between 1 and 2147483647.',
    );
    expect(calls).toHaveLength(0);
  });

  it('maps a network failure to status 0 with a network message', async () => {
    const { client } = stubClient(() => Promise.reject(new Error('connection refused')));
    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error.status).toBe(0);
    expect(error.endpoint).toBe('/api/aliases/1');
    expect(error.message).toBe('Network error: connection refused');
  });
});

describe('account stats', () => {
  it('uses GET on the stats path and parses the counters', async () => {
    const stats = { nb_alias: 12, nb_block: 3, nb_forward: 240, nb_reply: 9 };
    const { client, calls } = stubClient(jsonResponse(stats));
    await expect(client.getStats()).resolves.toEqual(stats);

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/stats');
    expect(call.body).toBeUndefined();
  });

  it('propagates a ZodError when a counter is missing', async () => {
    const { client } = stubClient(jsonResponse({ nb_alias: 12 }));
    await expect(client.getStats()).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe('notifications', () => {
  /** A minimal valid notification payload satisfying NotificationSchema. */
  const NOTIFICATION = {
    id: 5,
    title: 'Mailbox is bouncing',
    message: '<p>Your mailbox bounced an email</p>',
    read: false,
    created_at: '2 days ago',
  };

  it('list uses GET with a `page` query (not page_id), no body', async () => {
    const { client, calls } = stubClient(
      jsonResponse({ more: true, notifications: [NOTIFICATION] }),
    );
    await expect(client.listNotifications({ pageId: 3 })).resolves.toEqual({
      more: true,
      notifications: [NOTIFICATION],
    });

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/notifications');
    expect(call.url.searchParams.get('page')).toBe('3');
    expect(call.url.searchParams.has('page_id')).toBe(false);
    expect(call.body).toBeUndefined();
  });

  it('list accepts notifications without a title', async () => {
    const titlelessNotification = { ...NOTIFICATION, title: null };
    const { client } = stubClient(
      jsonResponse({ more: false, notifications: [titlelessNotification] }),
    );
    await expect(client.listNotifications({ pageId: 0 })).resolves.toEqual({
      more: false,
      notifications: [titlelessNotification],
    });
  });

  it('mark-read POSTs to the /read suffix path with no body', async () => {
    const { client, calls } = stubClient(jsonResponse({ done: true }));
    await expect(client.markNotificationRead(5)).resolves.toEqual({ done: true });

    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/api/notifications/5/read');
    expect(call.body).toBeUndefined();
  });
});

describe('settings', () => {
  /** A valid settings payload satisfying SettingSchema. */
  const SETTING = {
    alias_generator: 'word',
    notification: true,
    random_alias_default_domain: 'sl.example.com',
    sender_format: 'AT',
    random_alias_suffix: 'random_string',
  };

  it('get uses GET on the setting path and parses the settings', async () => {
    const { client, calls } = stubClient(jsonResponse(SETTING));
    await expect(client.getSettings()).resolves.toEqual(SETTING);

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/setting');
    expect(call.body).toBeUndefined();
  });

  it('get propagates a ZodError on an unknown enum value', async () => {
    const { client } = stubClient(jsonResponse({ ...SETTING, sender_format: 'FULL' }));
    await expect(client.getSettings()).rejects.toBeInstanceOf(z.ZodError);
  });

  it('update PATCHes only the provided fields and parses the resulting settings', async () => {
    const updated = { ...SETTING, alias_generator: 'uuid', notification: false };
    const { client, calls } = stubClient(jsonResponse(updated));
    await expect(
      client.updateSettings({ aliasGenerator: 'uuid', notification: false }),
    ).resolves.toEqual(updated);

    const call = calls[0]!;
    expect(call.method).toBe('PATCH');
    expect(call.url.pathname).toBe('/api/setting');
    expect(call.body).toEqual({ alias_generator: 'uuid', notification: false });
    expect(Object.keys(call.body as Record<string, unknown>)).toEqual([
      'alias_generator',
      'notification',
    ]);
  });

  it('update maps the remaining fields to their snake_case keys', async () => {
    const { client, calls } = stubClient(jsonResponse(SETTING));
    await client.updateSettings({
      randomAliasDefaultDomain: 'sl.example.com',
      senderFormat: 'NAME_ONLY',
      randomAliasSuffix: 'word',
    });
    expect(calls[0]!.body).toEqual({
      random_alias_default_domain: 'sl.example.com',
      sender_format: 'NAME_ONLY',
      random_alias_suffix: 'word',
    });
  });

  it('rejects a no-op update before any network call', async () => {
    const { client, calls } = stubClient(jsonResponse(SETTING));
    const error = await client.updateSettings({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettingsMutationError);
    expect(calls).toHaveLength(0);
  });
});

describe('response validation', () => {
  it('parses and returns a valid payload', async () => {
    const { client } = stubClient(jsonResponse(USER_INFO));
    await expect(client.getUserInfo()).resolves.toEqual(USER_INFO);
  });

  it('propagates a ZodError when the payload is malformed', async () => {
    const { client } = stubClient(jsonResponse({ email: 'a@b.io' }));
    await expect(client.getUserInfo()).rejects.toBeInstanceOf(z.ZodError);
  });
});
