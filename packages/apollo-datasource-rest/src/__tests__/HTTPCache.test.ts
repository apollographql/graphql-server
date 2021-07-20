import { fetch, Request } from './mock-apollo-server-env';

import FakeTimers from '@sinonjs/fake-timers';

import { HTTPCache } from '../HTTPCache';
import { MapKeyValueCache } from './MapKeyValueCache';

describe('HTTPCache', () => {
  let store: MapKeyValueCache<string>;
  let httpCache: HTTPCache;
  let clock: FakeTimers.Clock;

  beforeAll(() => {
    clock = FakeTimers.install();
  });

  beforeEach(() => {
    fetch.mockReset();

    store = new MapKeyValueCache<string>();
    httpCache = new HTTPCache(store as any);
  });

  afterAll(() => {
    clock.uninstall();
  });

  it('fetches a response from the origin when not cached', async () => {
    fetch.mockJSONResponseOnce({ name: 'Ada Lovelace' });

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(1);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it('returns a cached response when not expired', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30' },
    );

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    clock.tick(10000);

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(1);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response.headers.get('Age')).toEqual('10');
  });

  it('fetches a fresh response from the origin when expired', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30' },
    );

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    clock.tick(30000);

    fetch.mockJSONResponseOnce(
      { name: 'Alan Turing' },
      { 'Cache-Control': 'max-age=30' },
    );

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(2);

    expect(await response.json()).toEqual({ name: 'Alan Turing' });
    expect(response.headers.get('Age')).toEqual('0');
  });

  describe('overriding TTL', () => {
    it('returns a cached response when the overridden TTL is not expired', async () => {
      fetch.mockJSONResponseOnce(
        { name: 'Ada Lovelace' },
        {
          'Cache-Control': 'private, no-cache',
          'Set-Cookie': 'foo',
        },
      );

      await httpCache.fetch(new Request('https://api.example.com/people/1'), {
        cacheOptions: {
          ttl: 30,
        },
      });

      clock.tick(10000);

      const response = await httpCache.fetch(
        new Request('https://api.example.com/people/1'),
      );

      expect(fetch.mock.calls.length).toEqual(1);
      expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
      expect(response.headers.get('Age')).toEqual('10');
    });

    it('fetches a fresh response from the origin when the overridden TTL expired', async () => {
      fetch.mockJSONResponseOnce(
        { name: 'Ada Lovelace' },
        {
          'Cache-Control': 'private, no-cache',
          'Set-Cookie': 'foo',
        },
      );

      await httpCache.fetch(new Request('https://api.example.com/people/1'), {
        cacheOptions: {
          ttl: 30,
        },
      });

      clock.tick(30000);

      fetch.mockJSONResponseOnce(
        { name: 'Alan Turing' },
        {
          'Cache-Control': 'private, no-cache',
          'Set-Cookie': 'foo',
        },
      );

      const response = await httpCache.fetch(
        new Request('https://api.example.com/people/1'),
      );

      expect(fetch.mock.calls.length).toEqual(2);

      expect(await response.json()).toEqual({ name: 'Alan Turing' });
      expect(response.headers.get('Age')).toEqual('0');
    });

    it('fetches a fresh response from the origin when the overridden TTL expired even if a longer max-age has been specified', async () => {
      fetch.mockJSONResponseOnce(
        { name: 'Ada Lovelace' },
        { 'Cache-Control': 'max-age=30' },
      );

      await httpCache.fetch(new Request('https://api.example.com/people/1'), {
        cacheOptions: {
          ttl: 10,
        },
      });

      clock.tick(10000);

      fetch.mockJSONResponseOnce(
        { name: 'Alan Turing' },
        { 'Cache-Control': 'max-age=30' },
      );

      const response = await httpCache.fetch(
        new Request('https://api.example.com/people/1'),
      );

      expect(fetch.mock.calls.length).toEqual(2);

      expect(await response.json()).toEqual({ name: 'Alan Turing' });
      expect(response.headers.get('Age')).toEqual('0');
    });

    it('does not store a response with an overriden TTL and a non-success status code', async () => {
      fetch.mockResponseOnce(
        'Internal server error',
        { 'Cache-Control': 'max-age=30' },
        500,
      );

      await httpCache.fetch(new Request('https://api.example.com/people/1'), {
        cacheOptions: {
          ttl: 30,
        },
      });

      expect(store.size).toEqual(0);
    });

    it('allows overriding the TTL dynamically', async () => {
      fetch.mockJSONResponseOnce(
        { name: 'Ada Lovelace' },
        {
          'Cache-Control': 'private, no-cache',
          'Set-Cookie': 'foo',
        },
      );

      await httpCache.fetch(new Request('https://api.example.com/people/1'), {
        cacheOptions: () => ({
          ttl: 30,
        }),
      });

      clock.tick(10000);

      const response = await httpCache.fetch(
        new Request('https://api.example.com/people/1'),
      );

      expect(fetch.mock.calls.length).toEqual(1);
      expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
      expect(response.headers.get('Age')).toEqual('10');
    });

    it('allows disabling caching when the TTL is 0 (falsy)', async () => {
      fetch.mockJSONResponseOnce(
        { name: 'Ada Lovelace' },
        { 'Cache-Control': 'max-age=30' },
      );

      await httpCache.fetch(new Request('https://api.example.com/people/1'), {
        cacheOptions: () => ({
          ttl: 0,
        }),
      });

      expect(store.size).toEqual(0);
    });
  });

  it('allows specifying a custom cache key', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30' },
    );

    await httpCache.fetch(
      new Request('https://api.example.com/people/1?foo=bar'),
      { cacheKey: 'https://api.example.com/people/1' },
    );

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1?foo=baz'),
      { cacheKey: 'https://api.example.com/people/1' },
    );

    expect(fetch.mock.calls.length).toEqual(1);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it('does not store a response to a non-GET request', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30' },
    );

    await httpCache.fetch(
      new Request('https://api.example.com/people/1', { method: 'POST' }),
    );

    expect(store.size).toEqual(0);
  });

  it('does not store a response with a non-success status code', async () => {
    fetch.mockResponseOnce(
      'Internal server error',
      { 'Cache-Control': 'max-age=30' },
      500,
    );

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    expect(store.size).toEqual(0);
  });

  it('does not store a response without Cache-Control header', async () => {
    fetch.mockJSONResponseOnce({ name: 'Ada Lovelace' });

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    expect(store.size).toEqual(0);
  });

  it('does not store a private response', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'private, max-age: 60' },
    );

    await httpCache.fetch(new Request('https://api.example.com/me'));

    expect(store.size).toEqual(0);
  });

  it('returns a cached response when Vary header fields match', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30', Vary: 'Accept-Language' },
    );

    await httpCache.fetch(
      new Request('https://api.example.com/people/1', {
        headers: { 'Accept-Language': 'en' },
      }),
    );

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1', {
        headers: { 'Accept-Language': 'en' },
      }),
    );

    expect(fetch.mock.calls.length).toEqual(1);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it(`does not return a cached response when Vary header fields don't match`, async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30', Vary: 'Accept-Language' },
    );

    await httpCache.fetch(
      new Request('https://api.example.com/people/1', {
        headers: { 'Accept-Language': 'en' },
      }),
    );

    fetch.mockJSONResponseOnce(
      { name: 'Alan Turing' },
      { 'Cache-Control': 'max-age=30' },
    );

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1', {
        headers: { 'Accept-Language': 'fr' },
      }),
    );

    expect(fetch.mock.calls.length).toEqual(2);
    expect(await response.json()).toEqual({ name: 'Alan Turing' });
  });

  it('sets the TTL as max-age when the response does not contain revalidation headers', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30' },
    );

    const storeSet = jest.spyOn(store, 'set');

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    expect(storeSet.mock.calls[0][2]).toEqual({ ttl: 30 });

    storeSet.mockRestore();
  });

  it('sets the TTL as 2 * max-age when the response contains an ETag header', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      { 'Cache-Control': 'max-age=30', ETag: 'foo' },
    );

    const storeSet = jest.spyOn(store, 'set');

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    expect(storeSet.mock.calls[0][2]).toEqual({ ttl: 60 });

    storeSet.mockRestore();
  });

  it('revalidates a cached response when expired and returns the cached response when not modified', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      {
        'Cache-Control': 'public, max-age=30',
        ETag: 'foo',
      },
    );

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    clock.tick(30000);

    fetch.mockResponseOnce(
      null,
      {
        'Cache-Control': 'public, max-age=30',
        ETag: 'foo',
      },
      304,
    );

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(2);
    expect(
      (fetch.mock.calls[1][0] as Request).headers.get('If-None-Match'),
    ).toEqual('foo');

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response.headers.get('Age')).toEqual('0');

    clock.tick(10000);

    const response2 = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(2);

    expect(response2.status).toEqual(200);
    expect(await response2.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response2.headers.get('Age')).toEqual('10');
  });

  it('revalidates a cached response when expired and returns and caches a fresh response when modified', async () => {
    fetch.mockJSONResponseOnce(
      { name: 'Ada Lovelace' },
      {
        'Cache-Control': 'public, max-age=30',
        ETag: 'foo',
      },
    );

    await httpCache.fetch(new Request('https://api.example.com/people/1'));

    clock.tick(30000);

    fetch.mockJSONResponseOnce(
      { name: 'Alan Turing' },
      {
        'Cache-Control': 'public, max-age=30',
        ETag: 'bar',
      },
    );

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(2);
    expect(
      (fetch.mock.calls[1][0] as Request).headers.get('If-None-Match'),
    ).toEqual('foo');

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({ name: 'Alan Turing' });

    clock.tick(10000);

    const response2 = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(2);

    expect(response2.status).toEqual(200);
    expect(await response2.json()).toEqual({ name: 'Alan Turing' });
    expect(response2.headers.get('Age')).toEqual('10');
  });

  it('fetches a response from the origin with a custom fetch function', async () => {
    fetch.mockJSONResponseOnce({ name: 'Ada Lovelace' });

    const customFetch = jest.fn(fetch);
    const customHttpCache = new HTTPCache(store as any, customFetch);

    const response = await customHttpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(customFetch.mock.calls.length).toEqual(1);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it('allows options to be passed to http-cache-semantics', async () => {
    fetch.mockJSONResponseOnce({ name: 'Ada Lovelace' }, {
      'Cache-Control': 'max-age=60,must-revalidate',
      'set-cookie': 'whatever=blah; expires=Mon, 01-Jan-2050 00:00:00 GMT; path=/; domain=www.example.com'
    });

    await httpCache.fetch(new Request('https://api.example.com/people/1'), { cachePolicyOptions: {
      // http-cache-semantics won't cache a response with a set-cookie header unless opted in
      shared: false
    }});

    advanceTimeBy(10000);

    const response = await httpCache.fetch(
      new Request('https://api.example.com/people/1'),
    );

    expect(fetch.mock.calls.length).toEqual(1);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });
});
