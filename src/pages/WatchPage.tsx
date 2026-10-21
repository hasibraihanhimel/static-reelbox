import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Play, ShieldAlert } from 'lucide-react';
import { api, apiIsConfigured } from '../api/client';
import { normalizeCaptions, normalizeDetail, normalizeStreams } from '../api/normalize';
import { ApiNotice } from '../components/ApiNotice';
import { VideoPlayer } from '../components/VideoPlayer';
import { forgetProgress, readProgress, saveProgress } from '../lib/progress';
import { setPageMeta } from '../lib/seo';
import type { AudioVariant, CaptionSource, MediaDetail, StreamResponse, StreamSource, WatchProgress } from '../types';

export function WatchPage({ routeKind }: { routeKind: 'movie' | 'series' }) {
  const { id = '', season: seasonParam = '1', episode: episodeParam = '1' } = useParams();
  const [searchParams] = useSearchParams();
  const slug = decodeURIComponent(id);
  const seasonNumber = Number(seasonParam);
  const episodeNumber = Number(episodeParam);
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [captions, setCaptions] = useState<CaptionSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [captionError, setCaptionError] = useState('');
  const passedId = searchParams.get('subject_id') ?? undefined;
  const contentId = passedId ?? detail?.subject_id ?? slug;
  const type = routeKind;
  const resume = readProgress().find((entry) => entry.id === contentId && entry.type === type && entry.season === (type === 'series' ? seasonNumber : 1) && entry.episode === (type === 'series' ? episodeNumber : 1));
  const activeSeason = detail?.seasons.find((season) => season.number === seasonNumber);
  const activeEpisode = activeSeason?.episodes.find((episode) => episode.number === episodeNumber);
  const episodeOrder = useMemo(() => detail?.seasons.flatMap((season) => season.episodes.map((episode) => ({ season: season.number, episode: episode.number }))).sort((a, b) => a.season - b.season || a.episode - b.episode) ?? [], [detail]);
  const currentIndex = episodeOrder.findIndex((item) => item.season === seasonNumber && item.episode === episodeNumber);
  const previousEpisode = currentIndex > 0 ? episodeOrder[currentIndex - 1] : undefined;
  const nextEpisode = currentIndex >= 0 ? episodeOrder[currentIndex + 1] : undefined;
  const watchPath = (season: number, episode: number) => `/watch/series/${encodeURIComponent(slug)}/${season}/${episode}?subject_id=${encodeURIComponent(contentId)}`;

  const load = useCallback(async () => {
    setLoading(true); setError(''); setSources([]); setCaptions([]); setCaptionError('');
    if (!apiIsConfigured) { setLoading(false); return; }
    try {
      const raw = await api.detail(slug);
      const parsed = normalizeDetail(raw, slug);
      setDetail(parsed);
      const subjectId = passedId ?? parsed.subject_id;
      if (!subjectId) throw new Error('The provider did not return a subject ID, so playback cannot be requested.');
      // The provider resolves feature films with the special 0/0 coordinates.
      // Series use their actual 1-based season and episode numbers.
      const streamSeason = routeKind === 'series' ? seasonNumber : 0;
      const streamEpisode = routeKind === 'series' ? episodeNumber : 0;
      const response: StreamResponse = await api.streams(subjectId, slug, streamSeason, streamEpisode);
      const available = [...normalizeStreams(response.sources), ...normalizeStreams(response.hls), ...normalizeStreams(response.dash)];
      setSources(available);
      if (!available.length) {
        throw new Error('No stream is currently available for this title or episode. The provider may have removed it or restricted access in your region. Try again later or choose another episode.');
      }
      const captionResult = await api.captions(subjectId, slug, streamSeason, streamEpisode).catch((reason: unknown) => { setCaptionError(reason instanceof Error ? reason.message : 'Subtitles could not be loaded.'); return null; });
      if (captionResult) setCaptions(normalizeCaptions(captionResult.captions));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to prepare playback.');
    } finally { setLoading(false); }
  }, [slug, passedId, routeKind, seasonNumber, episodeNumber]);

  useEffect(() => { if (apiIsConfigured) void load(); else setLoading(false); }, [load]);
  useEffect(() => { setPageMeta(`Watch ${detail?.name ?? slug} — Reelbox`, detail?.overview, detail?.backdrop_url ?? detail?.poster_url); }, [detail, slug]);

  const save = (position: number, duration: number) => {
    if (!Number.isFinite(position) || position < 0) return;
    const item: WatchProgress = { id: contentId, slug, type, season: type === 'series' ? seasonNumber : 1, episode: type === 'series' ? episodeNumber : 1, position, duration, timestamp: Date.now(), title: detail?.name ?? slug, poster: detail?.poster_url };
    saveProgress(item);
  };
  const loadAudioVariant = useCallback(async (variant: AudioVariant) => {
    const season = routeKind === 'series' ? seasonNumber : 0;
    const episode = routeKind === 'series' ? episodeNumber : 0;
    const response = await api.streams(variant.subject_id, variant.slug, season, episode);
    const variantSources = [...normalizeStreams(response.sources), ...normalizeStreams(response.hls), ...normalizeStreams(response.dash)];
    if (!variantSources.length) throw new Error(`No playable ${variant.language} stream was returned.`);
    const captionResult = await api.captions(variant.subject_id, variant.slug, season, episode).catch(() => null);
    return { sources: variantSources, captions: captionResult ? normalizeCaptions(captionResult.captions) : [] };
  }, [routeKind, seasonNumber, episodeNumber]);
  const label = routeKind === 'series' ? `S${String(seasonNumber).padStart(2, '0')} · E${String(episodeNumber).padStart(2, '0')}${activeEpisode?.title ? ` — ${activeEpisode.title}` : ''}` : detail?.kind === 'movie' ? 'FEATURE FILM' : 'TITLE';
  const playlistPosition = resume?.position && resume.position < (resume.duration ?? Infinity) - 15 ? resume.position : 0;
  const audioVariants = useMemo<AudioVariant[]>(() => {
    const variants = detail?.audioVariants ?? [];
    const current = variants.find((variant) => variant.subject_id === contentId) ?? {
      subject_id: contentId,
      slug: detail?.slug ?? slug,
      language: detail?.audioLanguage ?? 'Current audio',
    };
    return [current, ...variants].filter((variant, index, all) => Boolean(variant.subject_id && variant.slug) && all.findIndex((candidate) => candidate.subject_id === variant.subject_id) === index);
  }, [contentId, detail, slug]);
  return <div className="watch-page page-wrap">
    <div className="watch-topline"><Link to={`/${routeKind}/${encodeURIComponent(slug)}`} className="back-link"><ArrowLeft size={15} /> Back to title</Link><span className="watch-label">{label}</span></div>
    {!apiIsConfigured && <ApiNotice />}
    <div className="watch-player-wrap">
      {loading && <div className="player-loading-screen"><span className="player-spinner"><i /></span><span>Preparing your stream…</span></div>}
      {!loading && error && <div className="player-error-screen"><ShieldAlert size={35} /><h2>Playback unavailable</h2><p>{error}</p><button className="button button-quiet" onClick={() => void load()}>Try again</button></div>}
      {!loading && !error && sources.length > 0 && <>
        <VideoPlayer key={`${contentId}-${seasonNumber}-${episodeNumber}`} sources={sources} captions={captions} audioVariants={audioVariants} initialAudioVariantId={contentId} onAudioVariantChange={loadAudioVariant} poster={detail?.backdrop_url ?? detail?.poster_url} title={detail?.name ?? slug} initialPosition={playlistPosition} onProgress={save} onEnded={() => forgetProgress(contentId, type)} />
      </>}
    </div>
    {resume && playlistPosition > 0 && <p className="resume-hint">Continue from {formatClock(playlistPosition)}</p>}
    <div className="watch-details"><div><span className="section-kicker">NOW PLAYING</span><h1>{detail?.name ?? slug.replaceAll('-', ' ')}</h1><p>{routeKind === 'series' ? activeEpisode?.title ?? label : detail?.year ?? (detail?.kind === 'movie' ? 'Movie' : 'Title')}</p>{detail?.overview && <p className="watch-description">{detail.overview}</p>}</div>
      {routeKind === 'series' && <div className="episode-navigation">{previousEpisode && <Link className="button button-quiet" to={watchPath(previousEpisode.season, previousEpisode.episode)}><ArrowLeft size={15} /> Previous</Link>}{nextEpisode && <Link className="button button-primary" to={watchPath(nextEpisode.season, nextEpisode.episode)}>Next episode <ArrowRight size={15} /></Link>}</div>}
    </div>
    {captionError && <p className="caption-notice">Subtitles could not be retrieved: {captionError}</p>}
    {routeKind === 'series' && activeSeason?.episodes.length && <section className="watch-episodes"><div className="section-heading"><div><span className="section-kicker">SEASON {seasonNumber}</span><h2>Episodes</h2></div></div><div className="watch-episode-links">{activeSeason.episodes.map((episode) => { const active = episode.number === episodeNumber; return <Link className={active ? 'watch-episode active' : 'watch-episode'} key={episode.number} to={watchPath(seasonNumber, episode.number)}><span>S{String(seasonNumber).padStart(2, '0')}E{String(episode.number).padStart(2, '0')}</span><strong>{episode.title}</strong><Play size={14} /></Link>; })}</div></section>}
  </div>;
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60); const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
