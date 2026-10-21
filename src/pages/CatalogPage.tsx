import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { api, apiIsConfigured } from '../api/client';
import { ApiNotice } from '../components/ApiNotice';
import { MediaCard } from '../components/MediaCard';
import { setPageMeta } from '../lib/seo';
import type { CatalogPage as CatalogResponse } from '../types';

const PAGE_CONFIG: Record<string, { title: string; eyebrow: string; kind: 'movie' | 'series' | 'animation'; fetch: (page: number) => Promise<CatalogResponse> }> = {
  movies: { title: 'Movies', eyebrow: 'FEATURE FILMS', kind: 'movie', fetch: api.movies },
  series: { title: 'Series', eyebrow: 'EPISODIC STORIES', kind: 'series', fetch: api.series },
  animation: { title: 'Animation', eyebrow: 'ANIMATION & ANIME', kind: 'animation', fetch: api.animation },
};

export function CatalogPage() {
  const { pathname } = useLocation();
  const key = pathname.split('/').filter(Boolean)[0] ?? 'movies';
  const config = PAGE_CONFIG[key] ?? PAGE_CONFIG.movies;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true); setError('');
    config.fetch(page).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Check your internet connection and try again.')).finally(() => setLoading(false));
  }, [config, page]);
  useEffect(() => { setPageMeta(`${config.title} — Reelbox`, `Explore ${config.title.toLowerCase()} from the connected catalog.`); if (apiIsConfigured) load(); else setLoading(false); }, [config, load]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  return <div className="page-wrap catalog-page">
    <div className="page-intro"><span className="section-kicker">{config.eyebrow}</span><h1>{config.title}<span className="title-dot">.</span></h1><p>Browse what is available from the connected catalog.</p></div>
    <ApiNotice error={error} onRetry={load} />
    {!apiIsConfigured && <div className="setup-helper">Set <code>VITE_API_BASE_URL</code> to your hosted API origin to see live results.</div>}
    {loading && <div className="media-grid">{Array.from({ length: 12 }, (_, index) => <div className="skeleton-card" key={index}><div className="skeleton skeleton-poster" /><div className="skeleton skeleton-line" /></div>)}</div>}
    {!loading && data?.items.length ? <><div className="catalog-result-line"><span>{data.total.toLocaleString()} titles in this collection</span><span>Page {page} of {pages}</span></div><div className="media-grid">{data.items.map((item, index) => <MediaCard key={item.slug ?? item.subject_id ?? `${page}-${index}`} item={item} preferred={config.kind === 'animation' ? undefined : config.kind} />)}</div>
      {pages > 1 && <nav className="pagination" aria-label="Catalog pages"><button disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ArrowLeft size={16} /> Previous</button><span>{page} / {pages}</span><button disabled={page >= pages || loading} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight size={16} /></button></nav>}
    </> : !loading && apiIsConfigured && !error && <div className="empty-state"><h2>No titles found in this collection</h2><p>Try again later or choose another section.</p></div>}
  </div>;
}
