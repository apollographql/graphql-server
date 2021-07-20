declare namespace CachePolicy {
  interface Request {
    url: string;
    method: string;
    headers: Headers;
  }

  interface Response {
    status: number;
    headers: Headers;
  }

  interface Options {
    /**
     * If `true`, then the response is evaluated from a perspective of a shared cache (i.e. `private` is not
     * cacheable and `s-maxage` is respected). If `false`, then the response is evaluated from a perspective
     * of a single-user cache (i.e. `private` is cacheable and `s-maxage` is ignored).
     * `true` is recommended for HTTP clients.
     * @default true
     */
    shared?: boolean;
    /**
     * A fraction of response's age that is used as a fallback cache duration. The default is 0.1 (10%),
     * e.g. if a file hasn't been modified for 100 days, it'll be cached for 100*0.1 = 10 days.
     * @default 0.1
     */
    cacheHeuristic?: number;
    /**
     * A number of milliseconds to assume as the default time to cache responses with `Cache-Control: immutable`.
     * Note that [per RFC](https://httpwg.org/specs/rfc8246.html#the-immutable-cache-control-extension)
     * these can become stale, so `max-age` still overrides the default.
     * @default 24*3600*1000 (24h)
     */
    immutableMinTimeToLive?: number;
    /**
     * If `true`, common anti-cache directives will be completely ignored if the non-standard `pre-check`
     * and `post-check` directives are present. These two useless directives are most commonly found
     * in bad StackOverflow answers and PHP's "session limiter" defaults.
     * @default false
     */
    ignoreCargoCult?: boolean;
    /**
     * If `false`, then server's `Date` header won't be used as the base for `max-age`. This is against the RFC,
     * but it's useful if you want to cache responses with very short `max-age`, but your local clock
     * is not exactly in sync with the server's.
     * @default true
     */
    trustServerDate?: boolean;
  }

  type Headers = { [name: string]: string };
}

declare class CachePolicy {
  constructor(request: CachePolicy.Request, response: CachePolicy.Response, options?: CachePolicy.Options);

  storable(): boolean;

  satisfiesWithoutRevalidation(request: CachePolicy.Request): boolean;
  responseHeaders(): CachePolicy.Headers;

  age(): number;
  timeToLive(): number;

  revalidationHeaders(request: CachePolicy.Request): CachePolicy.Headers;
  revalidatedPolicy(
    request: CachePolicy.Request,
    response: CachePolicy.Response,
  ): { policy: CachePolicy; modified: boolean };

  static fromObject(object: object): CachePolicy;
  toObject(): object;

  _url: string | undefined;
  _status: number;
  _rescc: { [key: string]: any };
}

declare module 'http-cache-semantics' {
  export = CachePolicy;
}
