import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { api, apiIsConfigured } from '../api/client';
import { ApiNotice } from '../components/ApiNotice';
import { MediaCard } from '../components/MediaCard';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { setPageMeta } from '../lib/seo';
import type { MediaKind } from '../types';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q')?.trim() ?? '';
  const [draft, setDraft] = useState(query);
  const [kind, setKind] = useState<MediaKind>('unknown');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.search>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const deferredQuery = useDebouncedValue(query, 280);
  useEffect(() => { setDraft(query); setPage(1); setKind('unknown'); }, [query]);
  useEffect(() => { setPageMeta(query ? `Search “${query}” — Reelbox` : 'Search — Reelbox', query ? `Search results for ${query}.` : 'Search the connected movie and series catalog.'); }, [query]);
  useEffect(() => {
    if (!deferredQuery || !apiIsConfigured) { setResults(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    api.search(deferredQuery, page, controller.signal).then(setResults).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Search failed. Try again.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [deferredQuery, page]);
  const visible = useMemo(() => (results?.items ?? []).filter((item) => kind === 'unknown' || item.kind === kind), [results, kind]);
  const availableKinds = useMemo(() => new Set((results?.items ?? []).map((item) => item.kind).filter((value): value is Exclude<MediaKind, 'unknown'> => value === 'movie' || value === 'series')), [results]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); setPage(1); setParams(draft.trim() ? { q: draft.trim() } : {}); };
  return <div className="page-wrap search-page">
    <div className="page-intro"><span className="section-kicker">DISCOVER YOUR NEXT FAVORITE</span><h1>Search<span className="title-dot">.</span></h1><p>Titles from the live provider catalog.</p></div>
    <form className="search-page-form" onSubmit={submit}><SearchIcon size={20} /><input autoFocus aria-label="Search titles" placeholder="Try a title, genre, or person" value={draft} onChange={(event) => setDraft(event.target.value)} /><button className="button button-primary" type="submit">Search</button></form>
    {!apiIsConfigured && <ApiNotice />}
    {query && <div className="search-results-top"><div><span className="section-kicker">RESULTS FOR</span><h2>“{query}”</h2></div>{results && <span>{results.total.toLocaleString()} results</span>}</div>}
    {query && availableKinds.size > 0 && <div className="filter-tabs" aria-label="Filter search by type">{(['unknown', ...Array.from(availableKinds)] as MediaKind[]).map((value) => <button key={value} className={kind === value ? 'selected' : ''} onClick={() => setKind(value)}>{value === 'unknown' ? 'All titles' : value === 'movie' ? 'Movies' : 'Series'}</button>)}</div>}
    <ApiNotice error={error} />
    {loading && <div className="media-grid">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-card" key={index}><div className="skeleton skeleton-poster" /><div className="skeleton skeleton-line" /></div>)}</div>}
    {!loading && query && visible.length > 0 && <div className="media-grid">{visible.map((item, index) => <MediaCard key={item.slug ?? item.subject_id ?? `${index}-${item.name}`} item={item} />)}</div>}
    {!loading && query && !error && results && visible.length === 0 && <div className="empty-state"><span className="empty-mark">?</span><h2>No matching titles</h2><p>Try a shorter title or check the spelling.</p></div>}
    {!loading && results && results.total > 20 && <nav className="pagination" aria-label="Search result pages"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Previous</button><span>Page {page} of {Math.ceil(results.total / 20)}</span><button disabled={page >= Math.ceil(results.total / 20)} onClick={() => setPage((current) => current + 1)}>Next →</button></nav>}
    {!query && <div className="empty-state"><span className="empty-mark">⌕</span><h2>What are you in the mood for?</h2><p>Enter a title above to search movies and series.</p></div>}
  </div>;
}
