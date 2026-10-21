# Reelbox

Reelbox is a React, TypeScript, and Vite streaming catalog with its own browser video player. The website is a static frontend. A small FastAPI service resolves playback sources and relays requested media bytes using the provider's required headers.

## Run locally

Install the frontend and resolver dependencies once:

```powershell
npm install
python -m pip install -r resolver-api/requirements.txt
```

Start both services together:

```powershell
npm run dev
```

The site runs in Vite and the resolver listens on port `8000`. Open the URL printed by Vite. Press Ctrl+C to stop both. On a phone using the same Wi-Fi, open the development PC's LAN address; the resolver binds to the LAN as well. If Python is installed under a different command, set `PYTHON` to its executable before starting Vite.

You can run only the frontend with `npm run dev:web`, or only the API with `npm run dev:api`.

## Deploy the stream resolver

The Netlify site is static; it cannot run the Python API on `reelhousec.netlify.app:8000`. The frontend now uses port `8000` automatically only on local/private network hosts. A hosted site needs a separately deployed resolver with a public HTTPS address.

This repository includes a Render Blueprint in `render.yaml`:

1. In Render, create a new Blueprint and select this repository. Render will use `render.yaml` to install and start the resolver. The `/health` endpoint is used for service health checks.
2. When deployment finishes, copy the resolver's public HTTPS URL from Render.
3. In the Netlify site's environment variables, set `VITE_STREAM_RESOLVER_URL` to that URL (origin only, for example `https://your-resolver.example.com`).
4. Trigger a new Netlify deploy so Vite embeds the setting in the built site.

The API service must be running and allow browser CORS requests. The resolver streams media through its host, so that service and its network need enough bandwidth for active viewers. Free hosting may pause an idle service; the first request after a pause can take longer while it starts.

For your own deployment, set `MEDIA_TOKEN_SECRET` to a long random value shared by all resolver workers. The Render Blueprint creates one automatically. Set `MEDIA_PUBLIC_BASE_URL` to the resolver's public HTTPS origin only when a reverse proxy requires it. All `VITE_*` values are public in the built frontend; keep secrets out of them.

## API routes

- `GET /health` reports whether the resolver service is up.
- `GET /movies?page={page}`, `GET /tv-series?page={page}`, and `GET /animation?page={page}` return typed catalog pages.
- `GET /api/stream/{subject_id}?detail_path={slug}&se={season}&ep={episode}` returns available stream sources.
- `GET /api/stream/{subject_id}/captions?detail_path={slug}&se={season}&ep={episode}` returns captions.
- `GET` or `HEAD /api/media/{signed_token}` relays provider media bytes and byte ranges.

The browser calls the provider catalog API for home, search, suggestions, and title details. The resolver provides category listings, playback sources, caption metadata, and the media relay. The provider may have no source for a particular title or may restrict access by region or time; the resolver cannot create an unavailable source.
