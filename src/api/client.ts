import type { ApiError, CatalogPage, HomeSection, MediaItem, StreamResponse } from '../types';
import { normalizeItem, normalizeStreams } from './normalize';

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const DEFAULT_API_BASE = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
export const apiBaseUrl = (configuredBase || DEFAULT_API_BASE).replace(/\/+$/, '');
const configuredResolver = (import.meta.env.VITE_STREAM_RESOLVER_URL as string | undefined)?.trim();
const DEFAULT_PUBLIC_RESOLVER_URL = 'https://reelbox-stream-resolver.onrender.com';
const LOOPBACK_URL = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i;
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

function isLocalNetworkHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOST.test(hostname) || host.endsWith('.local') || host.endsWith('.lan')) return true;

  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function getStreamResolverBaseUrl(): string {
  const pageHostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
  const pageIsLocal = isLocalNetworkHost(pageHostname);

  if (configuredResolver) {
    try {
      const configuredUrl = new URL(configuredResolver);
      if (pageIsLocal && !LOOPBACK_URL.test(configuredResolver)) return configuredUrl.origin;

      const validHostedResolver = configuredUrl.protocol === 'https:'
        && !configuredUrl.port
        && !LOOPBACK_URL.test(configuredResolver)
        && configuredUrl.hostname.toLowerCase() !== pageHostname.toLowerCase();
      if (!pageIsLocal && validHostedResolver) return configuredUrl.origin;
    } catch { /* Use the known public resolver URL for invalid production build settings. */ }
  }

  // The Netlify frontend is static; its resolver runs as a separate Render API.
  // This fallback also protects manual `npm run build` deployments when the
  // VITE_STREAM_RESOLVER_URL build variable was not provided.
  if (!pageIsLocal && typeof window !== 'undefined') return DEFAULT_PUBLIC_RESOLVER_URL;

  // A phone's 127.0.0.1 is the phone itself. Use the same host that served
  // a local frontend, but the resolver's port, so LAN clients reach the dev PC.
  // The production URL is selected above; this port is for local development.
  if (typeof window !== 'undefined') {
    const resolver = new URL(window.location.origin);
    let configuredPort = '';
    try { configuredPort = configuredResolver ? new URL(configuredResolver).port : ''; }
    catch { /* Ignore malformed local build settings and use the development port. */ }
    resolver.port = configuredPort || '8000';
    return resolver.origin;
  }

  return (configuredResolver || 'http://127.0.0.1:8000').replace(/\/+$/, '');
}

export const streamResolverBaseUrl = getStreamResolverBaseUrl();
export const apiIsConfigured = Boolean(apiBaseUrl);

const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const CACHE_MS = 45_000;
const API_HEADERS = {
  Accept: 'application/json',
  'X-Client-Info': JSON.stringify({ timezone: 'Asia/Dhaka' }),
  'X-Request-Lang': 'en',
};
let bearerToken = '';
let tokenRequest: Promise<string> | null = null;

function makeUrl(path: string) { return `${apiBaseUrl}${path}`; }

function absorbToken(response: Response) {
  const header = response.headers.get('x-user');
  if (!header) return;
  try {
    const value = JSON.parse(header) as { token?: string };
    if (value.token) bearerToken = value.token;
  } catch { /* Keep using the in-memory guest token if this optional header is malformed. */ }
}

async function fetchJson<T>(url: string, init: RequestInit = {}, externalSignal?: AbortSignal, timeoutMs = 15_000): Promise<{ value: T; response: Response }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
      if (externalSignal?.aborted) throw externalSignal.reason;
      const response = await fetch(url, { ...init, signal: controller.signal });
      absorbToken(response);
      if (!response.ok) {
        const error = new Error(friendlyStatus(response.status)) as ApiError;
        error.status = response.status;
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => window.setTimeout(resolve, 400 * (2 ** attempt)));
          lastError = error;
          continue;
        }
        throw error;
      }
      let value: T;
      try { value = await response.json() as T; }
      catch { throw new Error('The API returned an unreadable response. Please try again later.'); }
      return { value, response };
    } catch (error) {
      lastError = error;
      if (externalSignal?.aborted) throw error;
      if (attempt === 0 && (!(error instanceof Error && 'status' in error))) {
        await new Promise((resolve) => window.setTimeout(resolve, 400 * (2 ** attempt)));
        continue;
      }
      if (error instanceof Error && 'status' in error) throw error;
      throw new Error('Unable to connect. Check your internet connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unable to connect. Check your internet connection and try again.');
}

async function requestResolver<T>(path: string): Promise<T> {
  try {
    // Render's free API may be waking from idle; allow its cold start to finish.
    const { value } = await fetchJson<T>(`${streamResolverBaseUrl}${path}`, { headers: { Accept: 'application/json' } }, undefined, 75_000);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unable to connect')) {
      throw new Error(`Can't reach the Reelbox playback API at ${streamResolverBaseUrl}. Check that the Render resolver service is live and reachable over HTTPS.`);
    }
    throw error;
  }
}

async function getGuestToken(): Promise<string> {
  if (bearerToken) return bearerToken;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const { response } = await fetchJson<unknown>(makeUrl('/home?host=moviebox.ph'), { headers: API_HEADERS });
    absorbToken(response);
    if (!bearerToken) throw new Error('The provider did not return a guest access token.');
    return bearerToken;
  })();
  try { return await tokenRequest; }
  finally { tokenRequest = null; }
}

async function request<T>(path: string, options: {
  method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal; cacheFor?: number; dedupe?: boolean;
  auth?: boolean; referrer?: string;
} = {}): Promise<T> {
  const url = makeUrl(path);
  const key = `${options.method ?? 'GET'}:${url}:${options.body ? JSON.stringify(options.body) : ''}`;
  if (!options.signal) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    if (options.dedupe !== false) {
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
    }
  }
  const run = async () => {
    const attempt = async () => {
      const token = options.auth === false ? '' : await getGuestToken();
      const headers = new Headers(API_HEADERS);
      if (options.method === 'POST') headers.set('Content-Type', 'application/json');
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const init: RequestInit = {
        method: options.method ?? 'GET',
        headers,
        body: options.method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
        referrer: options.referrer,
        referrerPolicy: options.referrer ? 'unsafe-url' : undefined,
      };
      const { value, response } = await fetchJson<T>(url, init, options.signal);
      if (!response.ok) throw new Error('The API request failed.');
      if (!options.signal && options.cacheFor) cache.set(key, { value, expires: Date.now() + options.cacheFor });
      return value;
    };
    try { return await attempt(); }
    catch (error) {
      if ((error as ApiError).status !== 401) throw error;
      bearerToken = '';
      return attempt();
    }
  };
  const promise = run();
  if (!options.signal && options.dedupe !== false) {
    pending.set(key, promise);
    void promise.finally(() => pending.delete(key)).catch(() => undefined);
  }
  return promise;
}

function friendlyStatus(status: number) {
  if (status === 400) return 'The request could not be understood. Try a different search.';
  if (status === 401 || status === 403) return 'The provider denied this request. Check its access settings.';
  if (status === 404) return 'That title could not be found.';
  if (status === 429) return 'The provider is receiving too many requests. Wait a moment and try again.';
  if (status >= 500) return 'The content provider is having trouble. Please try again shortly.';
  return `The request failed (${status}). Please try again.`;
}

function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value !== undefined && params.set(key, String(value)));
  return `?${params.toString()}`;
}

function collectionItems(value: unknown): MediaItem[] {
  const outer = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const data = outer.data && typeof outer.data === 'object' ? outer.data as Record<string, unknown> : {};
  const rows = Array.isArray(data.items) ? data.items : Array.isArray(data.subjects) ? data.subjects : [];
  return rows.map((row) => {
    const object = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    return normalizeItem(object.subject ?? object);
  }).filter((item): item is MediaItem => item !== null);
}

async function homeCatalog(): Promise<{ status: string; sections: HomeSection[] }> {
  const result = await request<{ data?: { operatingList?: Array<Record<string, any>> } }>('/home?host=moviebox.ph', { auth: false, cacheFor: CACHE_MS });
  const operations = result.data?.operatingList ?? [];
  const sections: HomeSection[] = [];
  for (const operation of operations) {
    if (operation.type === 'BANNER') {
      const items = ((operation.banner?.items ?? []) as Array<Record<string, any>>).filter((item) => item.title && !String(item.title).includes('Communities')).map((item) => {
        const subject = item.subject ?? {};
        return normalizeItem({ ...subject, title: item.title ?? subject.title, imageUrl: item.image?.url ?? subject.cover?.url, detailPath: item.detailPath ?? subject.detailPath, badge: subject.corner });
      }).filter((item): item is MediaItem => item !== null);
      sections.push({ section: 'Banner', count: items.length, items });
    } else if (['SUBJECTS_MOVIE', 'SUBJECTS_TV', 'SUBJECTS_ANIMATION'].includes(operation.type)) {
      const items = ((operation.subjects ?? []) as unknown[]).map(normalizeItem).filter((item): item is MediaItem => item !== null);
      sections.push({ section: String(operation.title ?? 'Featured'), count: items.length, items });
    }
  }
  return { status: 'success', sections };
}

async function category(route: 'movies' | 'tv-series' | 'animation', page: number): Promise<CatalogPage> {
  const response = await requestResolver<CatalogPage>(`/${route}${query({ page })}`);
  return {
    ...response,
    items: (response.items ?? []).map(normalizeItem).filter((item): item is MediaItem => item !== null),
  };
}

export const api = {
  home: homeCatalog,
  movies: (page = 1) => category('movies', page),
  series: (page = 1) => category('tv-series', page),
  animation: (page = 1) => category('animation', page),
  search: async (q: string, page = 1, signal?: AbortSignal) => {
    const response = await request<unknown>('/subject/search', { method: 'POST', body: { keyword: q, page, perPage: 20 }, signal, dedupe: false });
    const outer = response as { data?: { pager?: { totalCount?: number }; total?: number } };
    const items = collectionItems(response);
    return { query: q, page, total: outer.data?.pager?.totalCount ?? outer.data?.total ?? items.length, items };
  },
  suggestions: async (q: string, signal?: AbortSignal) => {
    const response = await request<{ data?: { items?: Array<Record<string, any>>; list?: Array<Record<string, any>> } }>('/subject/search-suggest', { method: 'POST', body: { keyword: q, perPage: 10 }, signal, dedupe: false });
    const rows = response.data?.items ?? response.data?.list ?? [];
    const suggestions = rows.map((entry) => {
      const subject = entry.subject ?? {};
      return { title: String(subject.title ?? entry.word ?? entry.title ?? ''), slug: String(subject.detailPath ?? entry.detailPath ?? ''), subject_id: String(subject.subjectId ?? entry.subjectId ?? '') };
    }).filter((entry) => entry.title);
    return { suggestions };
  },
  detail: (slug: string, signal?: AbortSignal) => request<unknown>(`/detail${query({ detailPath: slug })}`, { signal, cacheFor: CACHE_MS }),
  streams: async (subjectId: string, slug: string, season = 0, episode = 0): Promise<StreamResponse> => {
    const resolved = await requestResolver<StreamResponse>(`/api/stream/${encodeURIComponent(subjectId)}${query({ detail_path: slug, se: season, ep: episode })}`);
    return {
      ...resolved,
      subject_id: resolved.subject_id ?? subjectId,
      se: resolved.se ?? season,
      ep: resolved.ep ?? episode,
      has_resource: Boolean(resolved.has_resource),
      sources: normalizeStreams(resolved.sources),
      hls: normalizeStreams(resolved.hls),
      dash: normalizeStreams(resolved.dash),
    };
  },
  captions: async (subjectId: string, slug: string, season = 0, episode = 0) => {
    return requestResolver<{ captions: unknown[]; count: number }>(`/api/stream/${encodeURIComponent(subjectId)}/captions${query({ detail_path: slug, se: season, ep: episode })}`);
  },
};
