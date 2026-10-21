import os
import re
import json
import base64
import hashlib
import hmac
import ipaddress
import secrets
import time
from urllib.parse import urljoin, urlparse
import truststore
truststore.inject_into_ssl()
import httpx
import asyncio
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

app = FastAPI(
    title="Reelbox Stream Resolver",
    description="Stream resolution and media relay service for Reelbox",
    version="2.1.5"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag", "Last-Modified"],
)

BASE_URL = "https://moviebox.ph"
API_BASE = "https://h5-api.aoneroom.com/wefeed-h5api-bff"

_bearer_token: str | None = None

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Referer": "https://moviebox.ph/",
    "Origin": "https://moviebox.ph",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Request-Lang": "en",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
}

# Player-side headers for the stream domain (netfilm.world)
PLAYER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Source": "",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
}

# Tokens make the media endpoint a constrained proxy rather than an open URL proxy.
# Set MEDIA_TOKEN_SECRET to a stable random value when running multiple workers or
# deploying the resolver; the generated fallback is valid for this process only.
MEDIA_TOKEN_SECRET = os.environ.get("MEDIA_TOKEN_SECRET", "") or secrets.token_urlsafe(32)
MEDIA_TOKEN_TTL_SECONDS = 12 * 60 * 60
MEDIA_PUBLIC_BASE_URL = os.environ.get("MEDIA_PUBLIC_BASE_URL", "").rstrip("/")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _valid_upstream_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return False
        if parsed.port not in (None, 443):
            return False
        host = parsed.hostname.rstrip(".").lower()
        if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal")):
            return False
        try:
            address = ipaddress.ip_address(host)
            if not address.is_global:
                return False
        except ValueError:
            pass
        return True
    except (ValueError, TypeError):
        return False


def _sign_media_url(url: str, referer: str) -> str:
    if not _valid_upstream_url(url):
        raise HTTPException(status_code=502, detail="The provider returned an invalid media URL.")
    payload = json.dumps({"url": url, "referer": referer, "exp": int(time.time()) + MEDIA_TOKEN_TTL_SECONDS}, separators=(",", ":")).encode()
    encoded = _b64url(payload)
    signature = _b64url(hmac.new(MEDIA_TOKEN_SECRET.encode(), encoded.encode(), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def _read_media_token(token: str) -> tuple[str, str]:
    try:
        encoded, signature = token.rsplit(".", 1)
        expected = _b64url(hmac.new(MEDIA_TOKEN_SECRET.encode(), encoded.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        url, referer = payload["url"], payload["referer"]
        if int(payload["exp"]) < int(time.time()) or not _valid_upstream_url(url) or not _valid_upstream_url(referer):
            raise ValueError("expired or invalid token")
        return url, referer
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=403, detail="This playback link is invalid or expired.")


def _media_proxy_url(url: str, referer: str, request: Request) -> str:
    public_base = MEDIA_PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    return f"{public_base}/api/media/{_sign_media_url(url, referer)}"


def _wrap_media_entries(entries, referer: str, request: Request):
    wrapped = []
    for entry in entries or []:
        if isinstance(entry, str):
            wrapped.append(_media_proxy_url(entry, referer, request))
        elif isinstance(entry, dict):
            item = dict(entry)
            key = "url" if item.get("url") else "src" if item.get("src") else None
            if key:
                item[key] = _media_proxy_url(item[key], referer, request)
            wrapped.append(item)
    return wrapped


def _rewrite_hls_playlist(body: bytes, base_url: str, referer: str, request: Request) -> bytes:
    text = body.decode("utf-8-sig", errors="replace")
    rewritten = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            rewritten.append(line)
            continue
        if stripped.startswith("#"):
            def rewrite_uri_attribute(match):
                absolute = urljoin(base_url, match.group(3))
                if urlparse(absolute).scheme not in {"http", "https"}:
                    return match.group(0)
                return f"{match.group(1)}{match.group(2)}{_media_proxy_url(absolute, referer, request)}{match.group(2)}"
            line = re.sub(r'((?:URI|uri)\s*=\s*)(["\'])(.*?)(\2)', rewrite_uri_attribute, line)
            rewritten.append(line)
        else:
            absolute = urljoin(base_url, stripped)
            rewritten.append(_media_proxy_url(absolute, referer, request) if urlparse(absolute).scheme in {"http", "https"} else line)
    return ("\n".join(rewritten) + "\n").encode("utf-8")


@app.api_route("/api/media/{token}", methods=["GET", "HEAD"])
async def relay_media(token: str, request: Request):
    """Stream provider bytes without buffering; preserve byte-range playback."""
    upstream_url, player_referer = _read_media_token(token)
    parsed_referer = urlparse(player_referer)
    headers = {
        "User-Agent": PLAYER_HEADERS["User-Agent"],
        "Accept": "*/*",
        "Accept-Language": PLAYER_HEADERS["Accept-Language"],
        "Referer": player_referer,
        "Origin": f"{parsed_referer.scheme}://{parsed_referer.netloc}",
        "Accept-Encoding": "identity",
    }
    for name in ("range", "if-range", "if-none-match", "if-modified-since"):
        if request.headers.get(name):
            headers[name] = request.headers[name]

    client = httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(20, read=None))
    response = None
    try:
        current_url = upstream_url
        for redirect_count in range(6):
            upstream_request = client.build_request(request.method, current_url, headers=headers)
            response = await client.send(upstream_request, stream=True)
            if response.status_code not in (301, 302, 303, 307, 308):
                break
            location = response.headers.get("location")
            await response.aclose()
            if not location or redirect_count == 5:
                raise HTTPException(status_code=502, detail="The provider returned an invalid media redirect.")
            current_url = urljoin(current_url, location)
            if not _valid_upstream_url(current_url):
                raise HTTPException(status_code=502, detail="The provider redirected to an invalid media host.")
        if response.status_code >= 400 and response.status_code != 416:
            await response.aclose()
            await client.aclose()
            raise HTTPException(status_code=502, detail=f"The provider rejected this media request ({response.status_code}).")

        response_headers = {"Cache-Control": "private, no-store"}
        for name in ("content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"):
            value = response.headers.get(name)
            if value:
                response_headers[name] = value

        content_type = response.headers.get("content-type", "").lower()
        is_hls = "mpegurl" in content_type or urlparse(upstream_url).path.lower().endswith(".m3u8")
        if is_hls and request.method == "GET" and response.status_code in (200, 206):
            body = await response.aread()
            body = _rewrite_hls_playlist(body, str(response.url), player_referer, request)
            await response.aclose()
            await client.aclose()
            response_headers["content-type"] = "application/vnd.apple.mpegurl; charset=utf-8"
            response_headers["content-length"] = str(len(body))
            response_headers.pop("content-range", None)
            response_headers.pop("accept-ranges", None)
            return Response(content=body, status_code=200, headers=response_headers)

        if request.method == "HEAD":
            await response.aclose()
            await client.aclose()
            return Response(status_code=response.status_code, headers=response_headers)

        async def stream_body():
            try:
                async for chunk in response.aiter_raw():
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        return StreamingResponse(stream_body(), status_code=response.status_code, headers=response_headers, background=BackgroundTask(client.aclose))
    except HTTPException:
        if response is not None:
            await response.aclose()
        await client.aclose()
        raise
    except httpx.HTTPError as error:
        if response is not None:
            await response.aclose()
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Could not reach the provider media server: {error.__class__.__name__}.")

async def _get_bearer_token() -> str:
    """Auto-acquire a guest JWT from the x-user response header."""
    global _bearer_token
    if _bearer_token:
        return _bearer_token
    async with httpx.AsyncClient(follow_redirects=True, timeout=25) as client:
        resp = await client.get(f"{API_BASE}/home?host=moviebox.ph", headers=DEFAULT_HEADERS)
        x_user = resp.headers.get("x-user")
        if x_user:
            _bearer_token = json.loads(x_user).get("token")
        if not _bearer_token:
            # fallback: read from set-cookie
            cookie = resp.headers.get("set-cookie", "")
            import re as _re
            m = _re.search(r"token=([^;]+)", cookie)
            if m:
                _bearer_token = m.group(1)
    return _bearer_token or ""

async def _make_request(url: str, method: str = "GET", payload: dict = None, custom_headers: dict = None) -> dict:
    global _bearer_token
    token = await _get_bearer_token()
    headers = {
        **DEFAULT_HEADERS,
        "Authorization": f"Bearer {token}" if token else "",
        **(custom_headers or {})
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=25) as client:
        try:
            if method == "POST":
                resp = await client.post(url, headers=headers, json=payload)
            else:
                resp = await client.get(url, headers=headers)

            # Refresh token if server sends a new one
            x_user = resp.headers.get("x-user")
            if x_user:
                new_token = json.loads(x_user).get("token")
                if new_token:
                    _bearer_token = new_token

            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Upstream API error: {resp.status_code}")

            return resp.json()
        except Exception as e:
            if isinstance(e, HTTPException): raise e
            raise HTTPException(status_code=502, detail=f"Request failed: {str(e)}")

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reelbox Stream Resolver</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #ff3d71;
                --secondary: #3366ff;
                --accent: #00f2ff;
                --bg: #07080c;
                --card-bg: rgba(255, 255, 255, 0.03);
                --glass: rgba(255, 255, 255, 0.06);
                --text: #ffffff;
            }

            * { margin: 0; padding: 0; box-sizing: border-box; }
            
            body {
                font-family: 'Outfit', sans-serif;
                background: var(--bg);
                color: var(--text);
                overflow-x: hidden;
                min-height: 100vh;
                background-image: 
                    radial-gradient(circle at 10% 10%, rgba(255, 61, 113, 0.12) 0%, transparent 40%),
                    radial-gradient(circle at 90% 90%, rgba(51, 102, 255, 0.12) 0%, transparent 40%);
            }

            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 60px 24px;
                position: relative;
            }

            header {
                text-align: center;
                margin-bottom: 80px;
                animation: fadeInDown 1s ease-out;
            }

            @keyframes fadeInDown {
                from { opacity: 0; transform: translateY(-30px); }
                to { opacity: 1; transform: translateY(0); }
            }

            h1 {
                font-size: clamp(2.5rem, 8vw, 4rem);
                font-weight: 800;
                background: linear-gradient(135deg, #fff 0%, #aaa 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 15px;
                letter-spacing: -2px;
            }

            .badge {
                background: linear-gradient(90deg, var(--primary), var(--secondary));
                padding: 8px 18px;
                border-radius: 40px;
                font-size: 0.85rem;
                font-weight: 700;
                display: inline-block;
                margin-bottom: 25px;
                text-transform: uppercase;
                letter-spacing: 1px;
                box-shadow: 0 10px 30px rgba(255, 61, 113, 0.3);
            }

            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
                gap: 30px;
                margin-top: 20px;
            }

            .card {
                background: var(--card-bg);
                border: 1px solid var(--glass);
                border-radius: 28px;
                padding: 35px;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                backdrop-filter: blur(12px);
                position: relative;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }

            @media (hover: hover) {
                .card:hover {
                    transform: translateY(-12px) scale(1.02);
                    border-color: rgba(255,255,255,0.2);
                    box-shadow: 0 30px 60px rgba(0,0,0,0.5);
                }
            }

            .card-title {
                font-size: 1.5rem;
                font-weight: 700;
                margin-bottom: 18px;
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .card-title i {
                width: 32px; height: 32px;
                background: rgba(255,255,255,0.05);
                border-radius: 8px;
                display: flex; align-items: center; justify-content: center;
                font-size: 1rem; color: var(--accent);
                font-style: normal;
            }

            .card-desc {
                color: #9ea3ac;
                font-size: 1rem;
                line-height: 1.6;
                margin-bottom: 25px;
                flex-grow: 1;
            }

            .endpoint {
                font-family: 'JetBrains Mono', monospace;
                background: rgba(0,0,0,0.4);
                padding: 14px;
                border-radius: 14px;
                font-size: 0.85rem;
                color: var(--accent);
                border: 1px solid rgba(0,242,255,0.15);
                margin-bottom: 25px;
                word-break: break-all;
                position: relative;
            }

            .endpoint::after {
                content: 'GET';
                position: absolute;
                right: 14px; top: 14px;
                font-size: 0.65rem; font-weight: 800;
                color: rgba(255,255,255,0.3);
            }

            .btn {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                background: #ffffff;
                color: #000000;
                text-decoration: none;
                border-radius: 16px;
                font-weight: 700;
                font-size: 0.95rem;
                transition: all 0.3s;
            }

            .btn:hover {
                background: var(--primary);
                color: #fff;
                transform: translateY(-2px);
                box-shadow: 0 10px 25px rgba(255, 61, 113, 0.4);
            }

            footer {
                text-align: center;
                padding: 80px 0 40px;
                animation: fadeIn 2s ease;
            }

            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

            .dev-tag {
                font-weight: 800;
                color: #666;
                letter-spacing: 3px;
                text-transform: uppercase;
                font-size: 0.75rem;
                border: 1px solid #222;
                padding: 12px 30px;
                border-radius: 50px;
                display: inline-block;
                background: rgba(255,255,255,0.01);
                transition: all 0.3s;
            }

            .dev-tag:hover {
                color: var(--text);
                border-color: var(--primary);
                letter-spacing: 5px;
            }

            @media (max-width: 480px) {
                .container { padding: 40px 16px; }
                .card { padding: 25px; }
                h1 { margin-bottom: 10px; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <div class="badge">Enterprise API Solution</div>
                <h1>Reelbox Stream Resolver</h1>
                <p style="color: #667; font-size: 1.25rem; font-weight: 300;">State-of-the-Art Pure API Architecture</p>
            </header>

            <div class="grid">
                <div class="card">
                    <div class="card-title"><i>🏠</i> Discover Home</div>
                    <p class="card-desc">Resolver status and connected catalog endpoints for the Reelbox streaming site.</p>
                    <div class="endpoint">/home</div>
                    <a href="/home" target="_blank" class="btn">Launch API</a>
                </div>

                <div class="card">
                    <div class="card-title"><i>🔍</i> Smart Search</div>
                    <p class="card-desc">High-precision search engine results. Returns titles, posters, and slugs for lightning-fast matching.</p>
                    <div class="endpoint">/search?q=Attack on Titan</div>
                    <a href="/search?q=Attack on Titan" target="_blank" class="btn">Test Search</a>
                </div>

                <div class="card">
                    <div class="card-title"><i>🆔</i> Metadata A-Z</div>
                    <p class="card-desc">Deep-dive into any subject. Episodes, seasons, languages, and full high-resolution metadata trees.</p>
                    <div class="endpoint">/detail/{slug}</div>
                    <a href="/detail/attack-on-titan-hindi-kGWQOIx0d4" target="_blank" class="btn">Fetch Specs</a>
                </div>

                <div class="card">
                    <div class="card-title"><i>🎬</i> Stream Engine</div>
                    <p class="card-desc">Dynamic domain discovery and direct MP4 extraction. Supports multiple resolutions and qualities.</p>
                    <div class="endpoint">/api/stream/{subject_id}</div>
                    <a href="/api/stream/56988683026712168?detail_path=attack-on-titan-hindi-kGWQOIx0d4" target="_blank" class="btn">Get Player Link</a>
                </div>

                <div class="card">
                    <div class="card-title"><i>📦</i> Catalog Filters</div>
                    <p class="card-desc">Paginated collections for all genres. Movies, TV shows, and Animations filtered by professional criteria. Pagination Supported.</p>
                    <div class="endpoint">/tv-series?page=2</div>
                    <a href="/tv-series?page=2" target="_blank" class="btn">Test Page 2</a>
                </div>

                <div class="card">
                    <div class="card-title"><i>💬</i> Subtitle Suite</div>
                    <p class="card-desc">Access to the complete SRT/VTT global database for all streaming subjects.</p>
                    <div class="endpoint">/api/stream/{id}/captions</div>
                    <a href="/api/stream/6207982430134357800/captions?detail_path=breaking-bad-ej6Bp0MCAo7" target="_blank" class="btn">Retrive Subs</a>
                </div>
            </div>

            <footer>
                <div class="dev-tag">Developer: Walter</div>
            </footer>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/home")
async def get_home():
    url = f"{API_BASE}/home?host=moviebox.ph"
    data = await _make_request(url)
    sections = []
    for op in data.get("data", {}).get("operatingList", []) or []:
        op_type = op.get("type")
        title = op.get("title", "Featured")
        if op_type == "BANNER":
            items = [{
                "name": item.get("title") or (item.get("subject") or {}).get("title"),
                "poster_url": item.get("image", {}).get("url") or (item.get("subject") or {}).get("cover", {}).get("url"),
                "slug": item.get("detailPath") or (item.get("subject") or {}).get("detailPath"),
                "subject_id": (item.get("subject") or {}).get("subjectId"),
                "badge": (item.get("subject") or {}).get("corner")
            } for item in op.get("banner", {}).get("items", []) if item.get("title") and "Communities" not in item.get("title")]
            sections.append({"section": "Banner", "count": len(items), "items": items})
        elif op_type in ["SUBJECTS_MOVIE", "SUBJECTS_TV", "SUBJECTS_ANIMATION"]:
            items = [{
                "name": sub.get("title"),
                "poster_url": sub.get("cover", {}).get("url"),
                "slug": sub.get("detailPath"),
                "subject_id": sub.get("subjectId"),
                "badge": sub.get("corner"),
                "rating": sub.get("imdbRatingValue")
            } for sub in op.get("subjects", [])]
            sections.append({"section": title, "count": len(items), "items": items})
    return {"status": "success", "sections": sections}

async def _get_category_data(kind: str, page: int = 1, per_page: int = 24) -> dict:
    # The old subject/filter tab IDs now return mixed media types and a bogus
    # total of 1,000,000. Build these pages from the provider's explicitly
    # typed and named homepage collections instead.
    data = await _make_request(f"{API_BASE}/home?host=moviebox.ph")
    operations = data.get("data", {}).get("operatingList", []) or []
    is_animation = lambda value: bool(re.search(r"anime|animation|cartoon", value or "", re.IGNORECASE))
    seen = set()
    items = []
    for operation in operations:
        if operation.get("type") not in {"SUBJECTS_MOVIE", "SUBJECTS_TV", "SUBJECTS_ANIMATION"}:
            continue
        section_name = str(operation.get("title") or "")
        animation_section = operation.get("type") == "SUBJECTS_ANIMATION" or is_animation(section_name)
        for subject in operation.get("subjects", []) or []:
            subject_type = int(subject.get("subjectType") or 0)
            matches = (
                kind == "movie" and subject_type == 1
                or kind == "series" and subject_type == 2
                or kind == "animation" and animation_section and subject_type in (1, 2)
            )
            if not matches:
                continue
            subject_id = str(subject.get("subjectId") or "")
            detail_path = subject.get("detailPath")
            identity = subject_id or detail_path or subject.get("title")
            if not identity or identity in seen:
                continue
            seen.add(identity)
            cover = subject.get("cover") or {}
            release_date = str(subject.get("releaseDate") or "")
            items.append({
                "name": subject.get("title"),
                "poster_url": cover.get("url"),
                "slug": detail_path,
                "subject_id": subject_id or None,
                "badge": subject.get("corner"),
                "rating": subject.get("imdbRatingValue"),
                "year": release_date[:4] or None,
                "kind": "movie" if subject_type == 1 else "series",
            })
    start = max(0, (page - 1) * per_page)
    return {"page": page, "per_page": per_page, "total": len(items), "items": items[start:start + per_page]}

@app.get("/movies")
async def get_movies(page: int = 1, sort: str = "RECOMMEND"):
    return await _get_category_data(kind="movie", page=page)

@app.get("/tv-series")
async def get_tv_series(page: int = 1, sort: str = "RECOMMEND"):
    return await _get_category_data(kind="series", page=page)

@app.get("/animation")
async def get_animation(page: int = 1, sort: str = "RECOMMEND"):
    return await _get_category_data(kind="animation", page=page)

@app.get("/search/suggest")
async def get_search_suggestions(q: str = Query(..., min_length=1)):
    url = f"{API_BASE}/subject/search-suggest"
    data = await _make_request(url, method="POST", payload={"keyword": q, "perPage": 10})
    inner = data.get("data", {})
    raw = inner.get("items", inner.get("list", []))
    suggestions = []
    for item in raw:
        sub = item.get("subject") or {}
        suggestions.append({
            "title": sub.get("title") or item.get("word") or item.get("title"),
            "slug": sub.get("detailPath") or item.get("detailPath"),
            "subject_id": sub.get("subjectId") or item.get("subjectId")
        })
    return {"suggestions": suggestions}

@app.get("/search")
async def search(q: str = Query(..., min_length=1), page: int = 1):
    url = f"{API_BASE}/subject/search"
    data = await _make_request(url, method="POST", payload={"keyword": q, "page": page, "perPage": 20})
    inner = data.get("data", {})
    raw = inner.get("items", inner.get("list", []))
    items = [{
        "name": sub.get("title"),
        "poster_url": sub.get("cover", {}).get("url"),
        "slug": sub.get("detailPath"),
        "subject_id": sub.get("subjectId")
    } for sub in raw]
    pager = inner.get("pager", {})
    total = pager.get("totalCount") or inner.get("total") or len(items)
    return {"query": q, "page": page, "total": total, "items": items}

@app.get("/detail/{slug}")
async def get_movie_detail(slug: str):
    url = f"{API_BASE}/detail?detailPath={slug}"
    return await _make_request(url)

@app.get("/api/stream/{subject_id}")
async def get_stream_sources(subject_id: str, request: Request, detail_path: str, se: int = 0, ep: int = 0):
    # Step 1: get the player domain
    dom_data = await _make_request(f"{API_BASE}/media-player/get-domain")
    domain = dom_data.get("data", "https://netfilm.world").rstrip("/")

    # Step 2: build the Referer the way the real browser player does
    player_referer = (
        f"{domain}/spa/videoPlayPage/movies/{detail_path}"
        f"?id={subject_id}&type=/movie/detail&detailSe={se}&detailEp={ep}&lang=en"
    )
    play_url = f"{domain}/wefeed-h5api-bff/subject/play?subjectId={subject_id}&se={se}&ep={ep}&detailPath={detail_path}"

    async with httpx.AsyncClient(follow_redirects=True, timeout=25) as client:
        resp = await client.get(play_url, headers={**PLAYER_HEADERS, "Referer": player_referer})
        data = resp.json().get("data", {})

    has_resource = data.get("hasResource", False)
    streams = [
        {
            "resolution": f"{s.get('resolutions')}p",
            "format": s.get("format"),
            "url": _media_proxy_url(s.get("url"), player_referer, request) if s.get("url") else None,
            "size": s.get("size"),
            "duration": s.get("duration"),
            "codec": s.get("codecName")
        }
        for s in data.get("streams", [])
    ]
    return {
        "subject_id": subject_id,
        "se": se,
        "ep": ep,
        "has_resource": has_resource,
        "sources": streams,
        "hls": _wrap_media_entries(data.get("hls", []), player_referer, request),
        "dash": _wrap_media_entries(data.get("dash", []), player_referer, request),
        "free_episodes": data.get("freeNum"),
        "limited": data.get("limited", False),
        "note": None if has_resource else "No stream found for this episode."
    }

@app.get("/api/stream/{subject_id}/captions")
async def get_captions(subject_id: str, request: Request, detail_path: str, se: int = 0, ep: int = 0):
    dom_data = await _make_request(f"{API_BASE}/media-player/get-domain")
    domain = dom_data.get("data", "https://netfilm.world").rstrip("/")

    player_referer = (
        f"{domain}/spa/videoPlayPage/movies/{detail_path}"
        f"?id={subject_id}&type=/movie/detail&detailSe={se}&detailEp={ep}&lang=en"
    )
    play_url = f"{domain}/wefeed-h5api-bff/subject/play?subjectId={subject_id}&se={se}&ep={ep}&detailPath={detail_path}"

    async with httpx.AsyncClient(follow_redirects=True, timeout=25) as client:
        play_resp = await client.get(play_url, headers={**PLAYER_HEADERS, "Referer": player_referer})
        play_data = play_resp.json().get("data", {})

    streams = play_data.get("streams", [])
    dash = play_data.get("dash", [])

    stream_id = None
    stream_format = None
    if streams:
        stream_id = streams[0].get("id")
        stream_format = streams[0].get("format", "MP4")
    elif dash:
        stream_id = dash[0].get("id")
        stream_format = dash[0].get("format", "DASH")

    if not stream_id:
        return {"subject_id": subject_id, "se": se, "ep": ep, "count": 0, "captions": []}

    cap_url = (
        f"{API_BASE}/subject/caption"
        f"?format={stream_format}&id={stream_id}&subjectId={subject_id}&detailPath={detail_path}"
    )
    data = await _make_request(cap_url)
    inner = data.get("data", {})
    captions = inner.get("captions", []) if isinstance(inner, dict) else inner
    proxied_captions = []
    for caption in captions or []:
        if isinstance(caption, str):
            proxied_captions.append(_media_proxy_url(urljoin(API_BASE + "/", caption), player_referer, request))
        elif isinstance(caption, dict):
            item = dict(caption)
            for key in ("url", "src", "file"):
                if item.get(key):
                    item[key] = _media_proxy_url(urljoin(API_BASE + "/", item[key]), player_referer, request)
            proxied_captions.append(item)
    return {"subject_id": subject_id, "se": se, "ep": ep, "count": len(proxied_captions), "captions": proxied_captions}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
