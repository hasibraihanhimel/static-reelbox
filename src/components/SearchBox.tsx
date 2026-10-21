import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api, apiIsConfigured } from '../api/client';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

export function SearchBox({ compact = false, onSubmit }: { compact?: boolean; onSubmit?: () => void }) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ title: string; slug?: string }>>([]);
  const [open, setOpen] = useState(false);
  const deferred = useDebouncedValue(value.trim(), 300);
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (deferred.length < 2 || !apiIsConfigured) { setSuggestions([]); return; }
    const controller = new AbortController();
    api.suggestions(deferred, controller.signal).then((result) => setSuggestions(result.suggestions ?? [])).catch(() => setSuggestions([]));
    return () => controller.abort();
  }, [deferred]);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);
  const submit = (query = value) => {
    const clean = query.trim();
    if (!clean) return;
    setOpen(false);
    onSubmit?.();
    navigate(`/search?q=${encodeURIComponent(clean)}`);
  };
  return <div className={`search-wrap ${compact ? 'search-compact' : ''}`} ref={root}>
    <form className="search-box" onSubmit={(event) => { event.preventDefault(); submit(); }} role="search">
      <Search size={18} aria-hidden="true" />
      <input aria-label="Search movies and series" placeholder={compact ? 'Search titles' : 'Search movies, series…'} value={value} onChange={(event) => { setValue(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {value && <button type="button" aria-label="Clear search" className="icon-button search-clear" onClick={() => { setValue(''); setOpen(false); }}><X size={15} /></button>}
      <button className="search-submit" type="submit" aria-label="Submit search"><Search size={17} /><span>Search</span></button>
    </form>
    {open && suggestions.length > 0 && <div className="suggestions" role="listbox">{suggestions.slice(0, 6).map((entry, index) => <button key={`${entry.slug ?? entry.title}-${index}`} role="option" type="button" onClick={() => submit(entry.title)}><Search size={14} />{entry.title}</button>)}</div>}
  </div>;
}
