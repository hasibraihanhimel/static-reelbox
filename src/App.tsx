import { Link, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { CatalogPage } from './pages/CatalogPage';
import { SearchPage } from './pages/SearchPage';
import { DetailsPage } from './pages/DetailsPage';
import { WatchPage } from './pages/WatchPage';
import { SiteLayout } from './components/SiteLayout';

function NotFound() {
  return <div className="not-found"><span>404</span><h1>This page took a wrong turn.</h1><p>The link may be outdated or the title may have left the catalog.</p><Link to="/" className="button button-primary">Back to discover</Link></div>;
}

export default function App() {
  return <Routes>
    <Route element={<SiteLayout />}>
      <Route index element={<HomePage />} />
      <Route path="movies" element={<CatalogPage key="movies" />} />
      <Route path="series" element={<CatalogPage key="series" />} />
      <Route path="animation" element={<CatalogPage key="animation" />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="movie/:id" element={<DetailsPage routeKind="movie" />} />
      <Route path="series/:id" element={<DetailsPage routeKind="series" />} />
      <Route path="watch/movie/:id" element={<WatchPage routeKind="movie" />} />
      <Route path="watch/series/:id/:season/:episode" element={<WatchPage routeKind="series" />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>;
}
