# Reelbox

Reelbox is a React, TypeScript, and Vite streaming catalog with a custom browser video player. It uses a FastAPI service to resolve playback sources and relay media bytes with the provider's required headers.

## Deploy the whole site on Render

The root `render.yaml` defines both the frontend and resolver. Render builds the frontend with `VITE_STREAM_RESOLVER_URL` set to the resolver's generated public HTTPS URL, then publishes `dist/`. The API has a `/health` check, and the static site has a client-side route rewrite.

### 1. Put the project in GitHub

Render deploys a Blueprint from a Git repository. Push the project root containing `render.yaml`, `package.json`, `package-lock.json`, `src/`, and `resolver-api/` to a GitHub repository. Do not upload `node_modules`, `dist`, or `.env` files.

If this project is not in GitHub yet, create an empty GitHub repository, then run these commands in PowerShell from the project folder (replace the URL with your repository URL):

```powershell
git init
git add .
git commit -m "Prepare Reelbox for Render"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

### 2. Create the Render Blueprint

1. Sign in to the [Render Dashboard](https://dashboard.render.com/).
2. Choose **New** → **Blueprint**.
3. Connect the GitHub repository and choose its branch.
4. Confirm the Blueprint lists two services: `reelbox-stream-resolver` and `reelbox-site`.
5. Choose **Deploy Blueprint**.

Render installs the Python requirements and starts the resolver. It installs the Node dependencies, builds the React app, and publishes the static output. The Blueprint generates `MEDIA_TOKEN_SECRET` for the resolver and wires the resolver's public URL into the frontend build automatically.

### 3. Check the deployment

Wait until both services show **Live** in the Render Dashboard. Open the resolver service's URL with `/health` appended; it should return `{"status":"ok"}`. Then open the `reelbox-site` URL shown in Render and try a title. The site should use the resolver deployed in the same Blueprint.

Render gives the frontend a new `onrender.com` address. The existing `reelhousec.netlify.app` address remains on Netlify; to use your own domain on Render, add it to the `reelbox-site` service in Render and follow the displayed DNS instructions.

### Render free plan notes

The frontend static site is free. A free resolver web service sleeps after 15 minutes without traffic and can take about a minute to wake on the next request. Video and subtitle bytes pass through the resolver, so they count toward Render outbound bandwidth. Render's Hobby workspace includes 5 GB per month; extra public bandwidth is currently billed at $0.15 per GB when billing is enabled, and services can be suspended after the included amount is used when no payment method is on file. Check the current [free plan limits](https://render.com/docs/free) and [bandwidth pricing](https://render.com/docs/outbound-bandwidth) before serving many viewers.

## Run locally

Install frontend and resolver dependencies once:

```powershell
npm install
python -m pip install -r resolver-api/requirements.txt
```

Start both services together:

```powershell
npm run dev
```

Vite prints the website address, and the resolver listens on port `8000`. Press Ctrl+C to stop both. On a phone using the same Wi-Fi, open the development PC's LAN address. If Python uses a different executable name, set `PYTHON` to that executable before starting the app.

You can run just the frontend with `npm run dev:web` or just the API with `npm run dev:api`.

## Resolver routes

- `GET /health` reports service health.
- `GET /movies?page={page}`, `GET /tv-series?page={page}`, and `GET /animation?page={page}` return typed catalog pages.
- `GET /api/stream/{subject_id}?detail_path={slug}&se={season}&ep={episode}` returns playback sources.
- `GET /api/stream/{subject_id}/captions?detail_path={slug}&se={season}&ep={episode}` returns captions.
- `GET` or `HEAD /api/media/{signed_token}` relays provider media bytes and byte ranges.

The provider may have no source for a particular title or may restrict access by region or time; the resolver cannot create an unavailable source.
