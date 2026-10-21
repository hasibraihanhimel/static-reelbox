# Reelbox

Reelbox is a React, TypeScript, and Vite static streaming catalog. The frontend is published on Netlify. A small FastAPI service on Render resolves titles and playback URLs; production uses direct media delivery so video bytes do not pass through Render.

## Deployment layout

- **Netlify:** static frontend built into `dist/`, with SPA rewrites from `public/_redirects`.
- **Render:** resolver API only. `MEDIA_DELIVERY_MODE=direct` returns provider media URLs to the browser instead of proxying video and subtitle bytes through Render.
- **Search:** search and suggestion requests go directly from the browser to the provider API. Keep the current search implementation in `src/api/client.ts` when changing deployment settings.

The frontend has a production fallback for `https://reelbox-stream-resolver.onrender.com`. `netlify.toml` also sets this URL for Netlify builds. If the Render service URL changes, update the Netlify build setting and the fallback in `src/api/client.ts`; update `FRONTEND_URL` in Render if the Netlify domain changes.

## Deploy the resolver API on Render

1. Push the repository, including `render.yaml`, to GitHub.
2. In Render, choose **New** → **Blueprint**, connect the repository, and deploy the `reelbox-stream-resolver` service.
3. Wait for **Live**, then open `https://reelbox-stream-resolver.onrender.com/health`. It should return `{"status":"ok","media_delivery_mode":"direct"}`.
4. Confirm the Render service environment contains `MEDIA_DELIVERY_MODE=direct`.

The Render service returns small API responses and resolves stream links. With direct mode enabled, it does not relay video bytes. Requests for API responses still use some Render outbound bandwidth. Render free web services can sleep while idle, so the first API request after inactivity may take about a minute; the frontend allows up to 75 seconds per resolver request attempt.

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

## Bandwidth and direct-playback limitation

In direct mode, the browser downloads each media stream from the provider's media host, not from Netlify or Render. Netlify still serves the app's HTML, JavaScript, CSS, and images; Render still sends resolver JSON. Hosting plans have their own included usage limits, so this avoids sending large video files through Render but does not mean all network traffic is unlimited or literally bandwidth-free.

Direct playback depends on the provider allowing browser requests to its media URLs. MP4 and native HLS can play directly when the provider accepts the browser request. HLS.js and DASH.js may require provider CORS headers, and some providers require a custom `Referer` header browsers cannot set. If that happens, set `MEDIA_DELIVERY_MODE=proxy` in Render and redeploy: the resolver's header-preserving media proxy may restore playback, but the video traffic will then count as Render outbound bandwidth. The deployment defaults to `direct` so it never silently sends video through Render.

## Run locally

Install dependencies once:

```powershell
npm install
python -m pip install -r resolver-api/requirements.txt
```

Start both services together with `npm run dev`. The Vite site prints its local address, and the API listens on port `8000`. Press Ctrl+C to stop both. On a phone using the same Wi-Fi, open the development PC's LAN address.

You can run only the frontend with `npm run dev:web` or only the API with `npm run dev:api`. Local API mode uses the media proxy by default; Render explicitly uses direct mode.
