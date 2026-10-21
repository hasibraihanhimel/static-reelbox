import { ChevronLeft, ChevronRight, MoveRight } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import type { MediaItem } from '../types';
import { MediaCard } from './MediaCard';

export function SectionRow({ title, items, preferred }: { title: string; items: MediaItem[]; preferred?: 'movie' | 'series' }) {
  const row = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const scroll = (direction: number) => row.current?.scrollBy({ left: direction * Math.max(320, row.current.clientWidth * 0.8), behavior: 'smooth' });
  return <section className="content-section">
    <div className="section-heading"><div><span className="section-kicker">CURATED FOR YOU</span><h2>{title}</h2></div><div className="section-actions"><Link className="view-all" to={preferred === 'series' ? '/series' : '/movies'}>Explore <MoveRight size={15} /></Link><button aria-label={`Scroll ${title} left`} className="row-arrow" onClick={() => scroll(-1)}><ChevronLeft size={18} /></button><button aria-label={`Scroll ${title} right`} className="row-arrow" onClick={() => scroll(1)}><ChevronRight size={18} /></button></div></div>
    <div className="media-row" ref={row}>{items.map((item, index) => <MediaCard key={item.slug ?? item.subject_id ?? `${title}-${index}`} item={item} preferred={preferred} />)}</div>
  </section>;
}
