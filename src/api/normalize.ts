import type { AudioVariant, CaptionSource, Episode, MediaDetail, MediaItem, Season, StreamSource } from '../types';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const str = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const nestedUrl = (value: unknown) => str(record(value).url) ?? str(value);

export function normalizeItem(value: unknown): MediaItem | null {
  const raw = record(value);
  const title = str(raw.name) ?? str(raw.title);
  if (!title) return null;
  const cover = record(raw.cover);
  const subjectType = Number(raw.subjectType);
  const kind = raw.kind === 'movie' || raw.kind === 'series' ? raw.kind : subjectType === 1 ? 'movie' : subjectType === 2 ? 'series' : 'unknown';
  return {
    name: title,
    slug: str(raw.slug) ?? str(raw.detailPath) ?? str(raw.detail_path),
    subject_id: str(raw.subject_id) ?? str(raw.subjectId),
    poster_url: str(raw.poster_url) ?? nestedUrl(cover) ?? str(raw.posterUrl) ?? str(raw.imageUrl),
    backdrop_url: str(raw.backdrop_url) ?? nestedUrl(raw.backdrop) ?? nestedUrl(raw.backgroundImage) ?? str(raw.backdropUrl),
    badge: str(raw.badge) ?? str(raw.corner),
    rating: typeof raw.rating === 'string' || typeof raw.rating === 'number' ? raw.rating : typeof raw.imdbRatingValue === 'string' || typeof raw.imdbRatingValue === 'number' ? raw.imdbRatingValue : undefined,
    year: str(raw.year) ?? str(raw.releaseDate)?.slice(0, 4),
    genres: humanList(raw.genres ?? raw.genre),
    kind,
    description: str(raw.description) ?? str(raw.introduction),
  };
}

function humanList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,|]/).map((item) => item.trim()).filter(Boolean);
  return arr(value).map((item) => {
    if (typeof item === 'string') return item;
    const raw = record(item);
    return str(raw.name) ?? str(raw.title) ?? '';
  }).filter(Boolean);
}

function episodeFrom(value: unknown, index: number): Episode | null {
  const raw = record(value);
  const number = Number(raw.number ?? raw.ep ?? raw.episode ?? raw.episodeNumber ?? index + 1);
  const title = str(raw.title) ?? str(raw.name) ?? `Episode ${number}`;
  if (!Number.isFinite(number)) return null;
  const cover = record(raw.cover);
  return {
    number,
    title,
    description: str(raw.description) ?? str(raw.introduction),
    thumbnail: str(raw.thumbnail) ?? str(raw.poster_url) ?? nestedUrl(cover),
    duration: str(raw.duration) ?? (typeof raw.duration === 'number' ? raw.duration : undefined),
    metadataAvailable: Boolean(raw.title ?? raw.name ?? raw.description ?? raw.thumbnail ?? raw.poster_url),
  };
}

function seasonsFrom(value: unknown): Season[] {
  const raw = record(value);
  const root = record(raw.data);
  const detail = record(root.subject ?? raw.subject ?? root.detail ?? raw.detail ?? root);
  const resource = record(root.resource);
  const rawSeasons = arr(resource.seasons ?? detail.seasons ?? detail.seasonList ?? root.seasons ?? raw.seasons);
  const seasons = rawSeasons.map((entry, index) => {
    const season = record(entry);
    const number = Number(season.number ?? season.se ?? season.season ?? season.seasonNumber ?? index + 1);
    const actualEpisodes = arr(season.episodes ?? season.episodeList ?? season.items).map(episodeFrom).filter((item): item is Episode => item !== null);
    const maxEpisode = Number(season.maxEp);
    const episodes = actualEpisodes.length ? actualEpisodes : Number.isFinite(maxEpisode) && maxEpisode > 0
      ? Array.from({ length: Math.min(maxEpisode, 500) }, (_, episodeIndex) => ({ number: episodeIndex + 1, title: `Episode ${episodeIndex + 1}`, metadataAvailable: false }))
      : [];
    return { number, title: str(season.title) ?? str(season.name) ?? `Season ${number}`, episodes };
  }).filter((season) => Number.isFinite(season.number));
  if (!seasons.length) {
    const episodes = arr(detail.episodes ?? detail.episodeList).map(episodeFrom).filter((item): item is Episode => item !== null);
    if (episodes.length) seasons.push({ number: 1, title: 'Episodes', episodes });
  }
  return seasons;
}

export function normalizeDetail(value: unknown, slug: string): MediaDetail {
  const raw = record(value);
  const data = record(raw.data);
  const subject = record(data.subject ?? raw.subject ?? data.detail ?? raw.detail ?? data);
  const metadata = record(data.metadata);
  const cover = record(subject.cover);
  const item = normalizeItem({ ...subject, slug: subject.detailPath ?? slug, subject_id: subject.subjectId ?? subject.subject_id, poster_url: nestedUrl(cover) ?? subject.poster_url });
  const genres = humanList(subject.genres ?? subject.genre ?? subject.genreList);
  const staff = arr(subject.staffList ?? subject.staff ?? subject.actors ?? subject.cast);
  const cast = staff.map((person) => {
    const personRaw = record(person);
    return str(personRaw.name) ?? str(personRaw.title) ?? '';
  }).filter(Boolean);
  const backdrop = nestedUrl(subject.backgroundImage) ?? nestedUrl(subject.backdrop) ?? nestedUrl(subject.image) ?? nestedUrl(metadata.image);
  const related = arr(data.related ?? data.recommendations ?? raw.related ?? raw.recommendations).map(normalizeItem).filter((entry): entry is MediaItem => entry !== null);
  const audioVariants: AudioVariant[] = arr(subject.dubs).flatMap((entry) => {
    const dub = record(entry);
    const subjectId = str(dub.subjectId) ?? str(dub.subject_id);
    const detailPath = str(dub.detailPath) ?? str(dub.detail_path);
    const language = str(dub.lanName) ?? str(dub.language) ?? str(dub.name);
    return subjectId && detailPath && language ? [{ subject_id: subjectId, slug: detailPath, language }] : [];
  }).filter((variant, index, variants) => variants.findIndex((candidate) => candidate.subject_id === variant.subject_id) === index);
  const seasons = seasonsFrom(value);
  const subjectType = Number(subject.subjectType);
  const rating = typeof subject.imdbRatingValue === 'string' || typeof subject.imdbRatingValue === 'number' ? subject.imdbRatingValue : item?.rating;
  const rawDuration = Number(subject.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration >= 600
    ? `${Math.floor(rawDuration / 3600) ? `${Math.floor(rawDuration / 3600)}h ` : ''}${Math.floor(rawDuration % 3600 / 60)}m`
    : str(subject.duration) ?? str(subject.durationText);
  const trailer = record(subject.trailer);
  return {
    ...(item ?? { name: slug.replaceAll('-', ' ') }),
    rating,
    originalTitle: str(subject.originalTitle) ?? str(subject.original_title),
    overview: str(subject.description) ?? str(subject.introduction) ?? str(subject.content) ?? str(metadata.description),
    backdrop_url: backdrop ?? item?.backdrop_url,
    genres,
    duration,
    country: humanList(subject.countryName ?? subject.country ?? subject.countries).join(', ') || undefined,
    cast,
    director: str(subject.director),
    trailerUrl: str(subject.trailerUrl) ?? str(trailer.url) ?? str(trailer.link) ?? str(subject.trailer),
    audioLanguage: str(subject.lanName) ?? str(subject.languageName) ?? str(subject.audioLanguage),
    audioVariants,
    seasons,
    related,
    kind: subjectType === 1 ? 'movie' : subjectType === 2 || seasons.length > 0 ? 'series' : item?.kind ?? 'unknown',
  };
}

export function normalizeStreams(value: unknown): StreamSource[] {
  return arr(value).flatMap((entry) => {
    if (typeof entry === 'string') return [{ url: entry }];
    const raw = record(entry);
    const url = str(raw.url) ?? str(raw.src);
    if (!url) return [];
    const rawResolution = str(raw.resolution) ?? str(raw.resolutions) ?? str(raw.quality);
    const resolution = rawResolution ? (/^\d+$/.test(rawResolution) ? `${rawResolution}p` : rawResolution) : undefined;
    return [{
      url,
      resolution,
      format: str(raw.format),
      codec: str(raw.codec) ?? str(raw.codecName),
      size: typeof raw.size === 'number' || typeof raw.size === 'string' ? raw.size : undefined,
      duration: typeof raw.duration === 'number' || typeof raw.duration === 'string' ? raw.duration : undefined,
      id: typeof raw.id === 'number' || typeof raw.id === 'string' ? raw.id : undefined,
    }];
  });
}

export function normalizeCaptions(value: unknown): CaptionSource[] {
  return arr(value).flatMap((entry) => {
    if (typeof entry === 'string') return [{ url: entry, language: 'Unknown' }];
    const raw = record(entry);
    const url = str(raw.url) ?? str(raw.src) ?? str(raw.file);
    if (!url) return [];
    return [{
      url,
      language: str(raw.language) ?? str(raw.langName) ?? str(raw.lanName) ?? str(raw.lan) ?? str(raw.lang) ?? str(raw.name) ?? 'Unknown',
      label: str(raw.label) ?? str(raw.lanName) ?? str(raw.name),
      format: str(raw.format) ?? str(raw.type),
      delay: typeof raw.delay === 'number' ? raw.delay : Number.isFinite(Number(raw.delay)) ? Number(raw.delay) : undefined,
    }];
  });
}
