import { Link, NavLink, Outlet } from 'react-router-dom';
import { Clapperboard, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { SearchBox } from './SearchBox';

export function SiteLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="app-frame">
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="Reelbox home"><span className="brand-mark"><Clapperboard size={19} strokeWidth={2.2} /></span><span>reel<span className="brand-accent">box</span></span></Link>
        <button className="icon-button mobile-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
          <NavLink to="/" end onClick={() => setMenuOpen(false)}>Discover</NavLink>
          <NavLink to="/movies" onClick={() => setMenuOpen(false)}>Movies</NavLink>
          <NavLink to="/series" onClick={() => setMenuOpen(false)}>Series</NavLink>
          <NavLink to="/animation" onClick={() => setMenuOpen(false)}>Animation</NavLink>
        </nav>
        <div className="header-search"><SearchBox compact /></div>
      </div>
    </header>
    <main className="site-main"><Outlet /></main>
    <footer className="site-footer"><div className="footer-inner"><Link className="brand footer-brand" to="/"><span className="brand-mark"><Clapperboard size={17} /></span><span>reel<span className="brand-accent">box</span></span></Link><span>Discover something worth staying in for.</span><span className="footer-note">Titles and playback availability come from the connected provider.</span></div></footer>
  </div>;
}
