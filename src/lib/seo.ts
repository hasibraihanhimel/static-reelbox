export function setPageMeta(title: string, description?: string, image?: string) {
  document.title = title;
  const content = description ?? 'Discover films and series on Reelbox.';
  const meta = (selector: string, key: string, value: string) => {
    let element = document.querySelector<HTMLMetaElement>(selector);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(key, selector.includes('property') ? selector.match(/"([^"]+)"/)?.[1] ?? '' : selector.match(/"([^"]+)"/)?.[1] ?? '');
      document.head.appendChild(element);
    }
    element.content = value;
  };
  meta('meta[name="description"]', 'name', content);
  meta('meta[property="og:title"]', 'property', title);
  meta('meta[property="og:description"]', 'property', content);
  meta('meta[name="twitter:title"]', 'name', title);
  meta('meta[name="twitter:description"]', 'name', content);
  if (image) meta('meta[property="og:image"]', 'property', image);
  if (image) meta('meta[name="twitter:image"]', 'name', image);
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement('link');
  canonical.rel = 'canonical';
  canonical.href = window.location.href;
  if (!canonical.parentElement) document.head.appendChild(canonical);
}
