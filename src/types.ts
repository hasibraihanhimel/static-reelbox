export type MediaKind = 'movie' | 'series' | 'unknown';

export interface MediaItem {
  name: string;
  slug?: string;
  subject_id?: string;
  poster_url?: string;
  backdrop_url?: string;
  badge?: string;
  rating?: string | number;
  year?: string | number;
  genres?: string[];
  kind?: MediaKind;
  description?: string;
}

export interface HomeSection {
  section: string;
  count?: number;
  items: MediaItem[];
}

export interface CatalogPage {
  page: number;
  per_page: number;
  total: number;
  items: MediaItem[];
}

export interface ApiError extends Error {
  status?: number;
}

export interface Episode {
  number: number;
  title: string;
  description?: string;
  thumbnail?: string;
  duration?: string | number;
  metadataAvailable?: boolean;
}

export interface Season {
  number: number;
  title: string;
  episodes: Episode[];
}

export interface AudioVariant {
  subject_id: string;
  slug: string;
  language: string;
}

export interface MediaDetail extends MediaItem {
  originalTitle?: string;
  overview?: string;
  genres: string[];
  duration?: string | number;
  country?: string;
  cast: string[];
  director?: string;
  trailerUrl?: string;
  audioLanguage?: string;
  audioVariants: AudioVariant[];
  seasons: Season[];
  related: MediaItem[];
}

export interface StreamSource {
  url: string;
  resolution?: string;
  format?: string;
  codec?: string;
  size?: number | string;
  duration?: number | string;
  id?: string | number;
}

export interface CaptionSource {
  url: string;
  language: string;
  format?: string;
  label?: string;
  delay?: number;
}

export interface StreamResponse {
  subject_id?: string;
  se?: number;
  ep?: number;
  has_resource?: boolean;
  sources: StreamSource[];
  hls: StreamSource[];
  dash: StreamSource[];
  limited?: boolean;
  note?: string | null;
}

export interface WatchProgress {
  id: string;
  slug: string;
  type: Exclude<MediaKind, 'unknown'>;
  season: number;
  episode: number;
  position: number;
  timestamp: number;
  title: string;
  poster?: string;
  duration?: number;
}
