import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import type { WatchProgress } from '../types';

export function ContinueCard({ item }: { item: WatchProgress }) {
  const target = item.type === 'series'
    ? `/watch/series/${encodeURIComponent(item.slug)}/${item.season}/${item.episode}?subject_id=${encodeURIComponent(item.id)}`
    : `/watch/movie/${encodeURIComponent(item.slug)}?subject_id=${encodeURIComponent(item.id)}`;
  const progress = item.duration && item.duration > 0 ? Math.min(100, item.position / item.duration * 100) : 0;
  const timeLabel = item.duration && item.duration > 0 ? `${formatClock(item.duration - item.position)} left` : `${formatClock(item.position)} watched`;
  return <Link className="continue-card" to={target} aria-label={`Continue watching ${item.title}`}>
    <div className="continue-poster">{item.poster ? <img loading="lazy" decoding="async" src={item.poster} alt="" /> : <span>{item.title.slice(0, 1).toUpperCase()}</span>}<span className="continue-play"><Play size={17} fill="currentColor" /></span></div>
    <div className="continue-progress"><span style={{ width: `${progress}%` }} /></div>
    <strong>{item.title}</strong>
    <small>{item.type === 'series' ? `S${String(item.season).padStart(2, '0')} · E${String(item.episode).padStart(2, '0')}` : 'Movie'} · {timeLabel}</small>
  </Link>;
}

function formatClock(seconds: number) {
  const remaining = Math.max(0, Math.floor(seconds));
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
}
