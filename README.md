# Reelbox

Reelbox is a React, TypeScript, and Vite static streaming catalog. The frontend is published on Netlify. A small FastAPI service on Render resolves titles and relays media with the provider's required playback headers.

## Deployment layout

- **Netlify:** static frontend built into `dist/`, with SPA rewrites from `public/_redirects`.
- **Render:** resolver API only. `MEDIA_DELIVERY_MODE=proxy` relays video and subtitle bytes with the provider's required `Referer` and byte-range headers. This mode is required when the provider blocks direct browser playback.
- **Search:** search and suggestion requests go directly from the browser to the provider API. Keep the current search implementation in `src/api/client.ts` when changing deployment settings.

The frontend has a production fallback for `https://reelbox-stream-resolver.onrender.com`. `netlify.toml` also sets this URL for Netlify builds. If the Render service URL changes, update the Netlify build setting and the fallback in `src/api/client.ts`; update `FRONTEND_URL` in Render if the Netlify domain changes.

## Deploy the resolver API on Render

1. Push the repository, including `render.yaml`, to GitHub.
2. In Render, choose **New** → **Blueprint**, connect the repository, and deploy the `reelbox-stream-resolver` service.
3. Wait for **Live**, then open `https://reelbox-stream-resolver.onrender.com/health`. It should return `{"status":"ok","media_delivery_mode":"proxy"}`.
4. Confirm the Render service environment contains `MEDIA_DELIVERY_MODE=proxy`.

This mode sends video and subtitle traffic through Render, which preserves the provider's playback headers and supports HLS playlists and byte-range seeking. That traffic uses Render outbound bandwidth. Render free web services can sleep while idle, so the first API request after inactivity may take about a minute; the frontend allows up to 75 seconds per resolver request attempt.

## Deploy the static frontend on Netlify

### Manual `dist` upload

From the project folder in PowerShell:

```powershell
npm ci
$env:VITE_STREAM_RESOLVER_URL = "https://reelbox-stream-resolver.onrender.com"
npm run build
```

Upload the generated `dist/` directory to Netlify. Vite copies `public/_redirects` into `dist/` so direct visits to routes such as `/search` and `/watch/movie/...` load the app.

### Git-connected Netlify site

Connect the repository to Netlify. `netlify.toml` sets the build command to `npm ci && npm run build`, the publish directory to `dist`, and the resolver URL for the build.

## Bandwidth and playback behavior

The frontend remains a static Netlify site. The resolver is set to proxy media because the provider is refusing direct browser playback in the deployed site. Video and subtitle bytes therefore pass through Render and count toward its outbound bandwidth allowance. Netlify still serves the app's HTML, JavaScript, CSS, and images.

The relay preserves the provider-specific `Referer`, redirects, byte ranges, and HLS playlist URLs needed by the browser player. This is the reliable playback path for the current provider; it cannot be bandwidth-free because the video bytes must be delivered by a server that can set those headers.

## Run locally

Install dependencies once:

```powershell
npm install
python -m pip install -r resolver-api/requirements.txt
```

Start both services together with `npm run dev`. The Vite site prints its local address, and the API listens on port `8000`. Press Ctrl+C to stop both. On a phone using the same Wi-Fi, open the development PC's LAN address.

You can run only the frontend with `npm run dev:web` or only the API with `npm run dev:api`. Local API mode uses the media proxy by default; Render uses the same mode for provider compatibility.
