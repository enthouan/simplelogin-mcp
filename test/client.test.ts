/**
 * Client behaviour with an injected fetcher: request construction (URL, query,
 * method, headers, body), per-endpoint request shapes, error mapping, and Zod
 * response validation. No live SimpleLogin calls are made.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SimpleLoginClient,
  SimpleLoginAPIError,
  AliasMutationError,
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

/**
 * Build a client wired to a recording stub fetcher. `respond` may be a fixed
 * Response or a function of the recorded call.
 */
function stubClient(respond: Response | ((call: RecordedCall) => Response | Promise<never>)) {
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
    apiKey: 'secret-key',
    timeoutMs: 1000,
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

  it('reads the message/msg keys and plain string bodies', async () => {
    const fromMessage = await stubClient(jsonResponse({ message: 'bad input' }, 400))
      .client.getAlias(1)
      .catch((e: unknown) => (e as SimpleLoginAPIError).message);
    expect(fromMessage).toBe('bad input');

    const fromMsg = await stubClient(jsonResponse({ msg: 'nope' }, 400))
      .client.getAlias(1)
      .catch((e: unknown) => (e as SimpleLoginAPIError).message);
    expect(fromMsg).toBe('nope');

    const fromString = await stubClient(jsonResponse('plain failure', 400))
      .client.getAlias(1)
      .catch((e: unknown) => (e as SimpleLoginAPIError).message);
    expect(fromString).toBe('plain failure');
  });

  it('falls back to the status text when the body carries no message', async () => {
    const { client } = stubClient(new Response(null, { status: 500, statusText: 'Server Error' }));
    const message = await client
      .getAlias(1)
      .catch((e: unknown) => (e as SimpleLoginAPIError).message);
    expect(message).toBe('Server Error');
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

  it('maps a network failure to status 0 with a network message', async () => {
    const { client } = stubClient(() => Promise.reject(new Error('connection refused')));
    const error = (await client.getAlias(1).catch((e: unknown) => e)) as SimpleLoginAPIError;
    expect(error.status).toBe(0);
    expect(error.message).toBe('Network error: connection refused');
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
