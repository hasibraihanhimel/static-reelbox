import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Play, Star } from 'lucide-react';
import { api, apiIsConfigured } from '../api/client';
import { normalizeDetail } from '../api/normalize';
import { ApiNotice } from '../components/ApiNotice';
import { MediaCard } from '../components/MediaCard';
import { setPageMeta } from '../lib/seo';
import type { MediaDetail } from '../types';

export function DetailsPage({ routeKind }: { routeKind: 'movie' | 'series' }) {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const selectedSubjectId = searchParams.get('subject_id') ?? undefined;
  const slug = decodeURIComponent(id);
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    setDetail(null); setLoading(true); setError('');
    if (!apiIsConfigured) { setLoading(false); return; }
    const controller = new AbortController();
    api.detail(slug, controller.signal).then((data) => {
      const parsed = normalizeDetail(data, slug);
      setDetail(selectedSubjectId ? { ...parsed, subject_id: selectedSubjectId } : parsed);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load this title.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, selectedSubjectId]);
  useEffect(() => {
    if (!detail) return;
    const actualKind = detail.kind === 'series' ? 'series' : routeKind;
    if (actualKind !== routeKind) navigate(`/${actualKind}/${encodeURIComponent(slug)}${selectedSubjectId ? `?subject_id=${encodeURIComponent(selectedSubjectId)}` : ''}`, { replace: true });
    setPageMeta(`${detail.name} — Reelbox`, detail.overview, detail.backdrop_url ?? detail.poster_url);
    const structured = (document.getElementById('media-schema') as HTMLScriptElement | null) ?? document.createElement('script');
    structured.id = 'media-schema'; structured.type = 'application/ld+json';
    structured.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': actualKind === 'series' ? 'TVSeries' : 'Movie', name: detail.name, description: detail.overview, image: detail.poster_url, datePublished: detail.year, genre: detail.genres });
    if (!structured.parentElement) document.head.appendChild(structured);
    return () => structured.remove();
  }, [detail, routeKind, navigate, slug, selectedSubjectId]);
  useEffect(() => { setSeasonNumber(detail?.seasons[0]?.number ?? null); }, [detail]);
  const activeSeason = detail?.seasons.find((season) => season.number === seasonNumber) ?? detail?.seasons[0];
  const subjectId = detail?.subject_id;
  const watchHref = detail?.kind === 'series' && activeSeason?.episodes[0]
    ? `/watch/series/${encodeURIComponent(slug)}/${activeSeason.number}/${activeSeason.episodes[0].number}?subject_id=${encodeURIComponent(subjectId ?? '')}`
    : `/watch/movie/${encodeURIComponent(slug)}?subject_id=${encodeURIComponent(subjectId ?? '')}`;
  return <div className="details-page">
    <section className="details-backdrop" style={detail?.backdrop_url ? { backgroundImage: `linear-gradient(0deg,#08090b 2%,rgba(8,9,11,.58) 58%,rgba(8,9,11,.12)),url("${detail.backdrop_url}")` } : undefined}>
      <div className="details-top"><Link to="/" className="back-link"><ArrowLeft size={15} /> Back to discover</Link></div>
    </section>
    <div className="page-wrap details-body">
      {loading && <div className="details-loading"><div className="skeleton skeleton-detail-poster" /><div><div className="skeleton skeleton-line" /><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line wide" /></div></div>}
      {!loading && <ApiNotice error={error} />}
      {!loading && detail && <>
        <div className="details-main">
          <div className="detail-poster">{detail.poster_url && <img src={detail.poster_url} alt={`${detail.name} poster`} decoding="async" />}</div>
          <div className="detail-copy">
            <div className="eyebrow">{detail.kind === 'series' ? 'SERIES' : detail.kind === 'movie' ? 'MOVIE' : 'TITLE'}{detail.badge && <span className="eyebrow-sep">·</span>}{detail.badge}</div>
            <h1>{detail.name}</h1>
            {detail.originalTitle && detail.originalTitle !== detail.name && <p className="original-title">{detail.originalTitle}</p>}
            <div className="detail-facts">{detail.year && <span><CalendarDays size={15} /> {detail.year}</span>}{detail.rating && <span><Star size={15} fill="currentColor" /> {detail.rating}</span>}{detail.duration && <span><Clock3 size={15} /> {detail.duration}</span>}{detail.country && <span>{detail.country}</span>}</div>
            <div className="genre-list">{detail.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>
            <p className="detail-overview">{detail.overview ?? 'No description is available from the provider.'}</p>
            {detail.cast.length > 0 && <p className="detail-credit"><b>Cast</b> {detail.cast.slice(0, 8).join(', ')}</p>}
            {detail.director && <p className="detail-credit"><b>Director</b> {detail.director}</p>}
            <div className="detail-actions">{detail.kind !== 'series' && <Link to={watchHref} className="button button-primary"><Play size={17} fill="currentColor" /> Watch now</Link>}{detail.kind === 'series' && activeSeason?.episodes[0] && <Link to={watchHref} className="button button-primary"><Play size={17} fill="currentColor" /> Watch now</Link>}{detail.kind === 'series' && !activeSeason?.episodes[0] && <span className="button button-quiet" aria-disabled="true">Episodes unavailable</span>}{detail.trailerUrl && <a href={detail.trailerUrl} target="_blank" rel="noreferrer" className="button button-quiet">View trailer <ArrowRight size={16} /></a>}</div>
          </div>
        </div>
        {detail.kind === 'series' && <section className="episode-section">
          <div className="section-heading episode-heading"><div><span className="section-kicker">CHOOSE YOUR EPISODE</span><h2>Episodes</h2></div>
            {detail.seasons.length > 1 && <label className="season-select"><span className="visually-hidden">Select a season</span><select value={activeSeason?.number ?? ''} onChange={(event) => setSeasonNumber(Number(event.target.value))}>{detail.seasons.map((season) => <option key={season.number} value={season.number}>{season.title}</option>)}</select></label>}
          </div>
          {activeSeason?.episodes.length ? <>{activeSeason.episodes[0].metadataAvailable === false && <p className="episode-data-note">The provider lists this season by episode number only.</p>}<div className="episode-list">{activeSeason.episodes.map((episode) => <Link className="episode-card" key={episode.number} to={`/watch/series/${encodeURIComponent(slug)}/${activeSeason.number}/${episode.number}?subject_id=${encodeURIComponent(subjectId ?? '')}`}>
            <div className="episode-thumb">{episode.thumbnail ? <img loading="lazy" src={episode.thumbnail} alt="" /> : <span>{String(episode.number).padStart(2, '0')}</span>}<span className="episode-play"><Play size={16} fill="currentColor" /></span></div>
            <div className="episode-copy"><div><span className="episode-number">S{String(activeSeason.number).padStart(2, '0')}E{String(episode.number).padStart(2, '0')}</span>{episode.duration && <span className="episode-duration">{episode.duration}</span>}</div><h3>{episode.title}</h3><p>{episode.description ?? ''}</p></div>
            <ArrowRight className="episode-arrow" size={18} />
          </Link>)}</div></> : <div className="empty-state compact-empty"><h3>Episode information is not available</h3><p>The API did not include episodes for this season.</p></div>}
        </section>}
        {detail.related.length > 0 && <section className="content-section related-section"><div className="section-heading"><div><span className="section-kicker">MORE TO DISCOVER</span><h2>Related titles</h2></div></div><div className="media-grid">{detail.related.map((item, index) => <MediaCard key={item.slug ?? item.subject_id ?? index} item={item} />)}</div></section>}
      </>}
      {!loading && !detail && !error && apiIsConfigured && <div className="empty-state"><h2>Title details unavailable</h2><p>The provider did not return a detail record for this title.</p></div>}
      {!apiIsConfigured && <ApiNotice />}
    </div>
  </div>;
}
