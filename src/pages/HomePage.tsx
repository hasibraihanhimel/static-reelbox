import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Play, Sparkles } from 'lucide-react';
import { api, apiIsConfigured } from '../api/client';
import { normalizeItem } from '../api/normalize';
import { ApiNotice } from '../components/ApiNotice';
import { SectionRow } from '../components/SectionRow';
import { mediaPath } from '../components/MediaCard';
import { ContinueCard } from '../components/ContinueCard';
import { readProgress } from '../lib/progress';
import { setPageMeta } from '../lib/seo';
import type { HomeSection } from '../types';

export function HomePage() {
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true); setError('');
    api.home().then((response) => setSections((response.sections ?? []).map((section) => ({ ...section, items: (section.items ?? []).map(normalizeItem).filter((item): item is NonNullable<typeof item> => item !== null) })))).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Check your internet connection and try again.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { setPageMeta('Reelbox — Find your next watch'); if (apiIsConfigured) load(); else setLoading(false); }, [load]);
  const hero = useMemo(() => sections.find((section) => section.section.toLowerCase().includes('banner'))?.items[0] ?? sections.flatMap((section) => section.items)[0], [sections]);
  const rows = sections.filter((section) => !section.section.toLowerCase().includes('banner') && section.items.length);
  const progress = readProgress();
  const heroLink = hero ? mediaPath(hero) : '/movies';
  const watchLink = hero?.kind === 'movie' && hero.subject_id
    ? `/watch/movie/${encodeURIComponent(hero.slug ?? hero.subject_id)}?subject_id=${encodeURIComponent(hero.subject_id)}`
    : heroLink;
  const primaryLabel = !hero ? 'Browse movies' : hero.kind === 'movie' ? 'Watch now' : hero.kind === 'series' ? 'Choose an episode' : 'View title';
  return <>
    <section className={`hero ${hero?.backdrop_url || hero?.poster_url ? 'hero-image' : ''}`} style={hero?.backdrop_url || hero?.poster_url ? { backgroundImage: `linear-gradient(90deg, #08090b 4%, rgba(8,9,11,.78) 42%, rgba(8,9,11,.18) 100%), linear-gradient(0deg,#08090b 0%,transparent 38%), url("${hero.backdrop_url ?? hero.poster_url}")` } : undefined}>
      <div className="hero-content">
        <div className="eyebrow"><Sparkles size={15} /> YOUR NEXT GREAT WATCH</div>
        <h1>{hero?.name ?? 'Stories worth staying in for.'}</h1>
        <p>{hero?.description ?? (hero ? 'A featured pick from the connected catalog. Open the details to see what is available.' : 'Find a new favorite from a catalog that keeps moving.')}</p>
        <div className="hero-meta">{hero?.kind && hero.kind !== 'unknown' && <span>{hero.kind === 'series' ? 'Series' : 'Movie'}</span>}{hero?.year && <span>{hero.year}</span>}{hero?.genres?.slice(0, 2).map((genre) => <span key={genre}>{genre}</span>)}{hero?.rating && <span className="hero-rating">★ {hero.rating}</span>}{hero?.badge && <span className="hero-pill">{hero.badge}</span>}</div>
        <div className="hero-actions"><Link className="button button-primary" to={watchLink}><Play size={17} fill="currentColor" /> {primaryLabel}</Link>{hero && <Link className="button button-quiet" to={heroLink}>Details <ArrowRight size={16} /></Link>}{!hero && <Link className="button button-quiet" to="/movies">Browse catalog <ArrowRight size={16} /></Link>}</div>
      </div>
      <a className="hero-scroll" href="#catalog"><span>SCROLL TO EXPLORE</span><ArrowDown size={14} /></a>
      {!hero && <div className="hero-orbit" aria-hidden="true"><span /><span /><span /></div>}
    </section>
    <div className="page-wrap" id="catalog">
      <ApiNotice error={error} onRetry={load} />
      {!apiIsConfigured && <div className="setup-helper">Add your API origin to <code>.env</code> to load real titles and artwork.</div>}
      {progress.length > 0 && <section className="content-section continue-section"><div className="section-heading"><div><span className="section-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Continue watching</h2></div></div><div className="continue-grid">{progress.map((entry) => <ContinueCard key={`${entry.id}-${entry.type}`} item={entry} />)}</div></section>}
      {loading && <div className="skeleton-sections">{[0, 1].map((key) => <div className="skeleton-section" key={key}><div className="skeleton skeleton-title" /><div className="skeleton-posters">{[0, 1, 2, 3, 4].map((item) => <div className="skeleton skeleton-poster" key={item} />)}</div></div>)}</div>}
      {!loading && rows.map((section, index) => <SectionRow key={`${section.section}-${index}`} title={section.section} items={section.items} preferred={/series|show|anime|animation|tv/i.test(section.section) ? 'series' : undefined} />)}
      {!loading && apiIsConfigured && !error && rows.length === 0 && <div className="empty-state"><span className="empty-mark">RB</span><h2>No titles are available right now</h2><p>The connected API returned no homepage sections.</p></div>}
      {rows.length > 0 && <div className="home-bottom-link"><Link to="/movies">Explore the full catalog <ArrowRight size={16} /></Link></div>}
    </div>
  </>;
}
