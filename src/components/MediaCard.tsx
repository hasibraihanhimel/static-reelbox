import { Link } from 'react-router-dom';
import { Play, Star } from 'lucide-react';
import type { MediaItem } from '../types';

export function mediaPath(item: MediaItem, preferred?: 'movie' | 'series') {
  const slug = item.slug ?? item.subject_id;
  if (!slug) return '#';
  const kind = preferred ?? item.kind;
  const path = `/${kind === 'series' ? 'series' : 'movie'}/${encodeURIComponent(slug)}`;
  return item.subject_id ? `${path}?subject_id=${encodeURIComponent(item.subject_id)}` : path;
}

export function MediaCard({ item, preferred }: { item: MediaItem; preferred?: 'movie' | 'series' }) {
  return <Link className="media-card" to={mediaPath(item, preferred)} aria-label={`View ${item.name}`}>
    <div className="poster-frame">
      {item.poster_url ? <img src={item.poster_url} alt="" loading="lazy" decoding="async" sizes="(max-width: 640px) 42vw, (max-width: 1100px) 22vw, 15vw" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <div className="poster-placeholder"><span>{item.name.slice(0, 1).toUpperCase()}</span></div>}
      {item.badge && <span className="card-badge">{item.badge}</span>}
      <span className="card-play"><Play size={18} fill="currentColor" /></span>
    </div>
    <div className="card-meta"><strong title={item.name}>{item.name}</strong><span>{item.year && <span>{item.year}</span>}{item.year && item.rating && <i>·</i>}{item.rating && <span className="rating"><Star size={12} fill="currentColor" /> {item.rating}</span>}</span></div>
  </Link>;
}
