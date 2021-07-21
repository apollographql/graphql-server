import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

export declare function fetch(
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response>;

export type RequestAgent = HttpAgent | HttpsAgent;

export type RequestInfo = Request | string;

export declare class Headers implements Iterable<[string, string]> {
  constructor(init?: HeadersInit);

  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;

  entries(): Iterator<[string, string]>;
  keys(): Iterator<string>;
  values(): Iterator<[string]>;
  [Symbol.iterator](): Iterator<[string, string]>;
}

export type HeadersInit = Headers | string[][] | { [name: string]: string };

export declare class Body {
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<any>;
  text(): Promise<string>;
}

export declare class Request extends Body {
  constructor(input: Request | string, init?: RequestInit);

  method: string;
  url: string;
  readonly headers: Headers;

  clone(): Request;
}

export interface RequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
  mode?: RequestMode;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;

  // The following properties are node-fetch extensions
  follow?: number;
  timeout?: number;
  compress?: boolean;
  size?: number;
  agent?: RequestAgent | false;

  // Cloudflare Workers accept a `cf` property to control Cloudflare features
  // See https://developers.cloudflare.com/workers/reference/cloudflare-features/
  cf?: {
    [key: string]: any;
  };
}

export type RequestMode = 'navigate' | 'same-origin' | 'no-cors' | 'cors';

export type RequestCredentials = 'omit' | 'same-origin' | 'include';

export type RequestCache =
  | 'default'
  | 'no-store'
  | 'reload'
  | 'no-cache'
  | 'force-cache'
  | 'only-if-cached';

export type RequestRedirect = 'follow' | 'error' | 'manual';

export type ReferrerPolicy =
  | ''
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'same-origin'
  | 'origin'
  | 'strict-origin'
  | 'origin-when-cross-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

export declare class Response extends Body {
  constructor(body?: BodyInit, init?: ResponseInit);
  static error(): Response;
  static redirect(url: string, status?: number): Response;

  readonly url: string;
  readonly redirected: boolean;
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: Headers;

  clone(): Response;
}

export interface ResponseInit {
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
  // Although this isn't part of the spec, `node-fetch` accepts a `url` property
  url?: string;
}

export type BodyInit = ArrayBuffer | ArrayBufferView | string;
