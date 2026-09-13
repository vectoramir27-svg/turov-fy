import os
import time
import sqlite3
import json
import re
import random
import string
import asyncio
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
from ytmusicapi import YTMusic
import yt_dlp

app = FastAPI(title="TurovFy Core")

os.makedirs("assets", exist_ok=True)
CACHE_DIR = os.path.join(os.getcwd(), ".cache", "audio")
os.makedirs(CACHE_DIR, exist_ok=True)

app.mount("/assets", StaticFiles(directory="assets"), name="assets")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "turovfy.db"
TELEGRAM_BOT_USERNAME = "turovfyaubot"

RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

def format_ru_date(dt: datetime) -> str:
    return f"{dt.day} {RU_MONTHS[dt.month - 1]} {dt.year} г."

def format_ru_datetime(dt: datetime) -> str:
    return f"{dt.day} {RU_MONTHS[dt.month - 1]}, {dt.strftime('%H:%M')}"

def generate_tf_key():
    chars = string.ascii_uppercase + string.digits
    rand_part = ''.join(random.choices(chars, k=6))
    return f"TF-{rand_part}"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            name TEXT,
            picture TEXT,
            playlists TEXT,
            state TEXT,
            profile_meta TEXT,
            reg_date TEXT,
            last_seen TEXT,
            telegram_id TEXT UNIQUE,
            telegram_username TEXT,
            password_hash TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS auth_keys (
            code TEXT PRIMARY KEY,
            telegram_id TEXT,
            telegram_username TEXT,
            first_name TEXT,
            expires INTEGER
        )
    """)
    conn.commit()

    cur.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in cur.fetchall()]
    for col, col_type in [
        ("profile_meta", "TEXT"),
        ("reg_date", "TEXT"),
        ("last_seen", "TEXT"),
        ("id", "INTEGER"),
        ("telegram_id", "TEXT"),
        ("telegram_username", "TEXT"),
        ("password_hash", "TEXT")
    ]:
        if col not in columns:
            cur.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
    conn.commit()
    conn.close()

init_db()

ytmusic = YTMusic()
STREAM_CACHE = {}
ACTIVE_FETCHES = {}

CATALOG_DEFAULT_QUERIES = [
    "Aggressive Phonk 2026", "OG Buda MAYOT", "VILLIAN madk1d", 
    "Russian Drift Phonk", "Тренды VK Музыка рэп", "Slowed Reverb Phonk"
]

CHART_TOP_ARTISTS = [
    "OG Buda", "MAYOT", "Toxi$", "VILLIAN", "madk1d", "Big Baby Tape",
    "kizaru", "Icegergert", "Scally Milano", "Miyagi & Эндшпиль", "MACAN",
    "163ONMYNECK", "Aarne", "BUSHIDO ZHO", "Friendly Thug 52 NGG", "ALBLAK 52",
    "Saluki", "Markul", "Платина", "LOVV66", "Kai Angel", "9mice"
]

def get_ytdl_opts(quality: str = "medium"):
    if quality == "low":
        fmt = "ba[abr<=128]/ba[ext=m4a]/ba/b"
    elif quality in ("high", "lossless"):
        fmt = "ba[ext=m4a]/ba[abr>=160]/ba/b"
    else:
        fmt = "140/ba[ext=m4a]/ba/b"

    return {
        "format": fmt,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "nocheckcertificate": True,
        "ignoreerrors": True,
        "no_check_formats": True,
        "socket_timeout": 4,
        "extractor_args": {
            "youtube": {
                "player_client": ["android"],
                "player_skip": ["js", "configs", "webpage"]
            }
        }
    }

def clean_cover_url(raw_url: str, video_id: str = "") -> str:
    if not raw_url:
        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if video_id else ""
    if raw_url.startswith("//"):
        raw_url = "https:" + raw_url
    if "=w" in raw_url and "-h" in raw_url:
        raw_url = re.sub(r'=w\d+-h\d+[^=]*$', '=w600-h600-l90-rj', raw_url)
    elif "=s" in raw_url:
        raw_url = re.sub(r'=s\d+[^=]*$', '=s600', raw_url)
    return raw_url

def get_track_cache_path(video_id: str, quality: str = "medium") -> str:
    return os.path.join(CACHE_DIR, f"{video_id}_{quality}.m4a")

def fetch_direct_audio_url(video_id: str, quality: str = "medium") -> str:
    now = time.time()
    cache_key = f"{video_id}_{quality}"
    if cache_key in STREAM_CACHE and STREAM_CACHE[cache_key]["expires"] > now:
        return STREAM_CACHE[cache_key]["url"]

    target_url = f"https://www.youtube.com/watch?v={video_id}"
    opts = get_ytdl_opts(quality)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(target_url, download=False)
        stream_url = info.get("url") if info else None

        if not stream_url and info and "formats" in info:
            m4as = [f["url"] for f in info["formats"] if f.get("ext") == "m4a" and f.get("url")]
            if m4as:
                stream_url = m4as[0]
            elif info["formats"]:
                stream_url = info["formats"][-1].get("url")

        if not stream_url:
            raise HTTPException(status_code=404, detail="Поток не найден")

        STREAM_CACHE[cache_key] = {"url": stream_url, "expires": now + 14400}
        return stream_url

async def download_file_in_background(video_id: str, direct_url: str, quality: str = "medium"):
    cache_path = get_track_cache_path(video_id, quality)
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 100000:
        return

    temp_path = cache_path + ".part"
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            async with client.stream("GET", direct_url) as resp:
                if resp.status_code == 200:
                    with open(temp_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=128 * 1024):
                            f.write(chunk)
                    if os.path.exists(temp_path) and os.path.getsize(temp_path) > 100000:
                        os.replace(temp_path, cache_path)
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/favicon.ico")
async def favicon():
    if os.path.exists("assets/logo.png"):
        return FileResponse("assets/logo.png")
    return Response(status_code=204)

class UserAuthPayload(BaseModel):
    email: str
    name: str
    picture: str

class TelegramKeyAuthPayload(BaseModel):
    code: str

class SyncPayload(BaseModel):
    email: str
    playlists: dict
    state: dict
    profile_meta: dict | None = None

class ImportPayload(BaseModel):
    url: str | None = None
    text_list: str | None = None

@app.post("/api/user/auth")
async def user_auth(user: UserAuthPayload):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now_dt = datetime.now()
    now_seen = format_ru_datetime(now_dt)

    cur.execute("SELECT rowid, playlists, state, profile_meta, reg_date, telegram_username FROM users WHERE email = ?", (user.email,))
    row = cur.fetchone()

    if not row:
        default_playlists = json.dumps({"Любимое": []})
        default_state = json.dumps({
            "currentTrack": None,
            "currentTime": 0,
            "volume": 1.0,
            "eqBands": [0, 0, 0, 0, 0],
            "activePreset": "flat"
        })
        reg_date = format_ru_date(now_dt)
        def_meta = json.dumps({
            "nickname": user.name.split(" ")[0] if user.name else "User",
            "username": user.email.split("@")[0].lower() if user.email else "user",
            "bio": "Новый пользователь TurovFy",
            "status": "",
            "telegram": "",
            "balance": 0,
            "xp": 0,
            "level": 1,
            "stats": {"plays": 0, "uniqueTracks": [], "totalMinutes": 0}
        })
        cur.execute(
            """INSERT INTO users (email, name, picture, playlists, state, profile_meta, reg_date, last_seen) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (user.email, user.name, user.picture, default_playlists, default_state, def_meta, reg_date, now_seen)
        )
        user_id = cur.lastrowid
        conn.commit()
        conn.close()
        return {
            "id": user_id,
            "playlists": json.loads(default_playlists),
            "state": json.loads(default_state),
            "profile_meta": json.loads(def_meta),
            "reg_date": reg_date,
            "last_seen": now_seen,
            "telegram": ""
        }

    user_id = row[0]
    playlists = json.loads(row[1]) if row[1] else {"Любимое": []}
    state = json.loads(row[2]) if row[2] else {}
    profile_meta = json.loads(row[3]) if row[3] else {}
    reg_date = row[4] or format_ru_date(now_dt)
    tg_user = row[5] or ""

    if not profile_meta.get("nickname"):
        profile_meta["nickname"] = user.name.split(" ")[0] if user.name else "User"
    if not profile_meta.get("username"):
        profile_meta["username"] = user.email.split("@")[0].lower() if user.email else "user"
    if tg_user:
        profile_meta["telegram"] = tg_user
    if not profile_meta.get("stats"):
        profile_meta["stats"] = {"plays": 0, "uniqueTracks": [], "totalMinutes": 0}

    cur.execute("UPDATE users SET last_seen = ?, name = ?, picture = ? WHERE email = ?", 
                (now_seen, user.name, user.picture, user.email))
    conn.commit()
    conn.close()

    return {
        "id": user_id,
        "playlists": playlists,
        "state": state,
        "profile_meta": profile_meta,
        "reg_date": reg_date,
        "last_seen": now_seen,
        "telegram": tg_user
    }

# ==================== АВТОРИЗАЦИЯ И ПРИВЯЗКА ЧЕРЕЗ @turovfyaubot ====================

@app.post("/api/telegram/generate-code")
async def generate_tg_link_code(data: dict):
    email = data.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email обязателен")
    
    code = generate_tf_key()
    now = int(time.time())
    
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("REPLACE INTO auth_keys (code, telegram_id, telegram_username, first_name, expires) VALUES (?, ?, ?, ?, ?)",
                (code, "", "", email, now + 600))
    conn.commit()
    conn.close()
    
    return {"code": code, "bot_username": TELEGRAM_BOT_USERNAME}

@app.get("/api/telegram/check-status")
async def check_telegram_link_status(code: str, email: str = ""):
    code = code.strip().upper()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT telegram_id, telegram_username, first_name, expires FROM auth_keys WHERE code = ?", (code,))
    row = cur.fetchone()

    if not row:
        conn.close()
        return {"status": "not_found"}
    
    tg_id, tg_username, stored_email_or_name, expires = row
    if expires < time.time():
        conn.close()
        return {"status": "expired"}

    if tg_id:
        target_email = email or (stored_email_or_name if "@" in stored_email_or_name else "")
        if target_email:
            cur.execute("UPDATE users SET telegram_id = ?, telegram_username = ? WHERE email = ?", 
                        (tg_id, tg_username, target_email))
            conn.commit()
        conn.close()
        return {"status": "linked", "telegram_username": tg_username}

    conn.close()
    return {"status": "pending"}

@app.post("/api/user/auth-telegram-key")
async def auth_via_telegram_key(payload: TelegramKeyAuthPayload):
    code = payload.code.strip().upper()
    now = int(time.time())

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT telegram_id, telegram_username, first_name, expires FROM auth_keys WHERE code = ?", (code,))
    row = cur.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="Ключ не найден. Запросите ключ в боте @turovfyaubot")
    
    tg_id, tg_username, first_name, expires = row
    if expires < now:
        conn.close()
        raise HTTPException(status_code=400, detail="Срок действия ключа истёк. Получите новый в боте!")

    if not tg_id:
        conn.close()
        raise HTTPException(status_code=400, detail="Ключ ещё не подтверждён в боте. Откройте @turovfyaubot и нажмите СТАРТ!")

    now_dt = datetime.now()
    now_seen = format_ru_datetime(now_dt)

    cur.execute("SELECT rowid, email, name, picture, playlists, state, profile_meta, reg_date FROM users WHERE telegram_id = ?", (tg_id,))
    u_row = cur.fetchone()

    if not u_row:
        gen_email = f"tg_{tg_id}@turovfy.local"
        name = first_name or tg_username or "Пользователь"
        default_playlists = json.dumps({"Любимое": []})
        default_state = json.dumps({
            "currentTrack": None,
            "currentTime": 0,
            "volume": 1.0,
            "eqBands": [0, 0, 0, 0, 0],
            "activePreset": "flat"
        })
        reg_date = format_ru_date(now_dt)
        def_meta = json.dumps({
            "nickname": name,
            "username": tg_username.lower() if tg_username else f"id{tg_id}",
            "bio": "Пользователь TurovFy",
            "status": "",
            "telegram": tg_username,
            "balance": 0,
            "xp": 0,
            "level": 1,
            "stats": {"plays": 0, "uniqueTracks": [], "totalMinutes": 0}
        })
        cur.execute(
            """INSERT INTO users (email, name, picture, playlists, state, profile_meta, reg_date, last_seen, telegram_id, telegram_username) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (gen_email, name, "", default_playlists, default_state, def_meta, reg_date, now_seen, tg_id, tg_username)
        )
        user_id = cur.lastrowid
        cur.execute("DELETE FROM auth_keys WHERE code = ?", (code,))
        conn.commit()
        conn.close()

        return {
            "id": user_id,
            "email": gen_email,
            "name": name,
            "picture": "",
            "playlists": json.loads(default_playlists),
            "state": json.loads(default_state),
            "profile_meta": json.loads(def_meta),
            "reg_date": reg_date,
            "last_seen": now_seen,
            "telegram": tg_username
        }

    user_id, email, name, pic, pls, st, meta, reg_date = u_row
    playlists = json.loads(pls) if pls else {"Любимое": []}
    state = json.loads(st) if st else {}
    profile_meta = json.loads(meta) if meta else {}
    if tg_username:
        profile_meta["telegram"] = tg_username

    cur.execute("UPDATE users SET last_seen = ?, telegram_username = ? WHERE rowid = ?", (now_seen, tg_username, user_id))
    cur.execute("DELETE FROM auth_keys WHERE code = ?", (code,))
    conn.commit()
    conn.close()

    return {
        "id": user_id,
        "email": email,
        "name": name,
        "picture": pic,
        "playlists": playlists,
        "state": state,
        "profile_meta": profile_meta,
        "reg_date": reg_date,
        "last_seen": now_seen,
        "telegram": tg_username
    }

@app.post("/api/telegram/unlink")
async def unlink_telegram_endpoint(data: dict):
    email = data.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email обязателен")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("UPDATE users SET telegram_id = NULL, telegram_username = NULL WHERE email = ?", (email,))
    conn.commit()
    conn.close()
    return {"status": "unlinked"}

@app.post("/api/user/sync")
async def sync_data(data: SyncPayload):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now_seen = format_ru_datetime(datetime.now())
    if data.profile_meta:
        cur.execute(
            "UPDATE users SET playlists = ?, state = ?, profile_meta = ?, last_seen = ? WHERE email = ?",
            (json.dumps(data.playlists), json.dumps(data.state), json.dumps(data.profile_meta), now_seen, data.email)
        )
    else:
        cur.execute(
            "UPDATE users SET playlists = ?, state = ?, last_seen = ? WHERE email = ?",
            (json.dumps(data.playlists), json.dumps(data.state), now_seen, data.email)
        )
    conn.commit()
    conn.close()
    return {"status": "synced", "last_seen": now_seen}

@app.get("/api/search")
async def search_tracks(query: str):
    if not query or not query.strip():
        query = random.choice(CATALOG_DEFAULT_QUERIES)
    try:
        loop = asyncio.get_running_loop()
        results = await loop.run_in_executor(
            None, 
            lambda: ytmusic.search(query=query, filter="songs", limit=24)
        )
        tracks = []
        for item in results:
            vid = item.get("videoId")
            if not vid:
                continue
            thumbnails = item.get("thumbnails", [])
            raw_cover = thumbnails[-1]["url"] if thumbnails else ""
            cover = clean_cover_url(raw_cover, vid)
            artists = ", ".join([a["name"] for a in item.get("artists", [])])

            tracks.append({
                "id": vid,
                "title": item.get("title", "Без названия"),
                "artist": artists or "Исполнитель",
                "duration": item.get("duration", "3:00"),
                "cover": cover
            })
        return {"results": tracks}
    except Exception:
        return {"results": []}

@app.post("/api/playlist/import")
async def import_playlist_endpoint(payload: ImportPayload):
    if payload.url:
        raise HTTPException(status_code=503, detail="Импорт по ссылке временно в разработке. Используйте 'Импорт списка'")

    if not payload.text_list:
        raise HTTPException(status_code=400, detail="Список треков пуст")

    loop = asyncio.get_running_loop()
    lines = [line.strip() for line in payload.text_list.split("\n") if len(line.strip()) > 1]
    queries_to_search = lines[:1000]

    sem = asyncio.Semaphore(15)

    async def find_one_track(q):
        async with sem:
            try:
                res = await loop.run_in_executor(None, lambda: ytmusic.search(query=q, filter="songs", limit=1))
                if res:
                    item = res[0]
                    vid = item.get("videoId")
                    if vid:
                        thumbs = item.get("thumbnails", [])
                        raw_cover = thumbs[-1]["url"] if thumbs else ""
                        return {
                            "id": vid,
                            "title": item.get("title", q),
                            "artist": ", ".join([a["name"] for a in item.get("artists", [])]) or "Исполнитель",
                            "duration": item.get("duration", "3:00"),
                            "cover": clean_cover_url(raw_cover, vid)
                        }
            except Exception:
                pass
            return None

    tasks = [find_one_track(q) for q in queries_to_search]
    imported_results = await asyncio.gather(*tasks)
    final_tracks = [t for t in imported_results if t is not None]

    if not final_tracks:
        raise HTTPException(status_code=404, detail="Не удалось найти треки в базе")

    default_cover = final_tracks[0]["cover"]

    return {
        "title": "Импортированный список",
        "cover": default_cover,
        "tracks": final_tracks
    }

@app.get("/api/wave")
async def get_my_wave(seed_id: str = "", artist: str = "", queries: str = "", exclude: str = ""):
    excluded_ids = set([x.strip() for x in exclude.split(",") if x.strip()])
    user_queries = [q.strip() for q in queries.split("||") if q.strip()]

    target_pool = []
    if artist and len(artist) > 1:
        target_pool.append(artist.split(",")[0].strip())
    if user_queries:
        for q in user_queries:
            if len(q) > 2:
                target_pool.append(q)

    while len(target_pool) < 6:
        art = random.choice(CHART_TOP_ARTISTS)
        if art not in target_pool:
            target_pool.append(art)

    loop = asyncio.get_running_loop()
    raw_candidates = []

    if seed_id and seed_id not in excluded_ids:
        try:
            watch_data = await loop.run_in_executor(
                None,
                lambda: ytmusic.get_watch_playlist(videoId=seed_id, limit=20)
            )
            for item in watch_data.get("tracks", []):
                vid = item.get("videoId")
                if not vid or vid in excluded_ids:
                    continue
                thumbs = item.get("thumbnail", [])
                raw_cover = thumbs[-1]["url"] if thumbs else ""
                raw_candidates.append({
                    "id": vid,
                    "title": item.get("title", ""),
                    "artist": ", ".join([a["name"] for a in item.get("artists", [])]) or "Исполнитель",
                    "duration": item.get("length", "3:00"),
                    "cover": clean_cover_url(raw_cover, vid)
                })
        except Exception:
            pass

    random.shuffle(target_pool)
    for target in target_pool[:4]:
        try:
            search_query = f"{target} хиты"
            search_res = await loop.run_in_executor(
                None,
                lambda q=search_query: ytmusic.search(query=q, filter="songs", limit=10)
            )
            for item in search_res:
                vid = item.get("videoId")
                if not vid or vid in excluded_ids or any(c["id"] == vid for c in raw_candidates):
                    continue
                raw_candidates.append({
                    "id": vid,
                    "title": item.get("title", ""),
                    "artist": ", ".join([a["name"] for a in item.get("artists", [])]) or target,
                    "duration": item.get("duration", "3:00"),
                    "cover": clean_cover_url(item.get("thumbnails", [{}])[-1].get("url", ""), vid)
                })
        except Exception:
            pass

    artist_counts = {}
    final_tracks = []
    random.shuffle(raw_candidates)

    for track in raw_candidates:
        main_artist = track["artist"].split(",")[0].strip().lower()
        if artist_counts.get(main_artist, 0) < 2:
            artist_counts[main_artist] = artist_counts.get(main_artist, 0) + 1
            final_tracks.append(track)
        if len(final_tracks) >= 30:
            break

    return {"results": final_tracks if final_tracks else raw_candidates[:25]}

@app.get("/api/artist")
async def get_artist_page(query: str):
    try:
        loop = asyncio.get_running_loop()
        artist_search = await loop.run_in_executor(None, lambda: ytmusic.search(query=query, filter="artists", limit=1))
        artist_name = query
        artist_thumb = ""

        if artist_search:
            artist_item = artist_search[0]
            artist_name = artist_item.get("artist", query)
            thumbs = artist_item.get("thumbnails", [])
            if thumbs:
                artist_thumb = clean_cover_url(thumbs[-1]["url"])

        songs_search = await loop.run_in_executor(None, lambda: ytmusic.search(query=artist_name, filter="songs", limit=30))
        tracks = []
        for s in songs_search:
            vid = s.get("videoId")
            if not vid:
                continue
            artists_list = [a["name"] for a in s.get("artists", [])]
            artists_str = ", ".join(artists_list)
            thumbs = s.get("thumbnails", [])
            cover = clean_cover_url(thumbs[-1]["url"] if thumbs else "", vid)

            tracks.append({
                "id": vid,
                "title": s.get("title", "Трек"),
                "artist": artists_str or artist_name,
                "duration": s.get("duration", "3:00"),
                "cover": cover
            })

        if not artist_thumb and tracks:
            artist_thumb = tracks[0]["cover"]

        return {"name": artist_name, "avatar": artist_thumb, "tracks": tracks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lyrics")
async def get_track_lyrics(track: str, artist: str):
    try:
        clean_track = re.sub(r"\(.*?\)|\[.*?\]", "", track).strip()
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(
                "https://lrclib.net/api/get",
                params={"track_name": clean_track, "artist_name": artist}
            )
            if res.status_code == 200:
                data = res.json()
                if data.get("syncedLyrics"):
                    return {"type": "synced", "lyrics": data["syncedLyrics"]}
                elif data.get("plainLyrics"):
                    return {"type": "plain", "lyrics": data["plainLyrics"]}
        return {"type": "none", "lyrics": "Текст песни отсутствует."}
    except Exception:
        return {"type": "none", "lyrics": "Текст песни отсутствует."}

@app.get("/api/listen/{video_id}")
async def listen_track(video_id: str, request: Request, quality: str = "medium"):
    if not video_id or video_id.startswith("sc_"):
        raise HTTPException(status_code=400, detail="Неверный ID трека")

    cache_path = get_track_cache_path(video_id, quality)
    range_header = request.headers.get("range")

    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 100000:
        file_size = os.path.getsize(cache_path)
        start = 0
        end = file_size - 1

        if range_header:
            match = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if match:
                start = int(match.group(1))
                if match.group(2):
                    end = int(match.group(2))

        chunk_size = (end - start) + 1

        def file_chunks():
            with open(cache_path, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    read_bytes = min(64 * 1024, remaining)
                    data = f.read(read_bytes)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": "audio/mp4",
            "Access-Control-Allow-Origin": "*",
        }
        return StreamingResponse(file_chunks(), status_code=206 if range_header else 200, headers=headers)

    loop = asyncio.get_running_loop()
    direct_url = await loop.run_in_executor(None, fetch_direct_audio_url, video_id, quality)

    fetch_key = f"{video_id}_{quality}"
    if fetch_key not in ACTIVE_FETCHES:
        ACTIVE_FETCHES[fetch_key] = asyncio.create_task(download_file_in_background(video_id, direct_url, quality))

    client = httpx.AsyncClient(timeout=10.0, follow_redirects=True)
    req = client.build_request("GET", direct_url, headers={"Range": range_header or "bytes=0-"})
    upstream = await client.send(req, stream=True)

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": upstream.headers.get("Content-Type", "audio/mp4"),
        "Access-Control-Allow-Origin": "*",
    }
    if "Content-Range" in upstream.headers:
        headers["Content-Range"] = upstream.headers["Content-Range"]
    if "Content-Length" in upstream.headers:
        headers["Content-Length"] = upstream.headers["Content-Length"]

    async def stream_audio():
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=64 * 1024):
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(stream_audio(), status_code=upstream.status_code, headers=headers)

@app.get("/api/prefetch/{video_id}")
async def prefetch_track(video_id: str, quality: str = "medium"):
    if not video_id or video_id.startswith("sc_"):
        return {"status": "ignored"}

    cache_path = get_track_cache_path(video_id, quality)
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 100000:
        return {"status": "cached"}

    loop = asyncio.get_running_loop()
    def bg():
        try:
            url = fetch_direct_audio_url(video_id, quality)
            asyncio.run(download_file_in_background(video_id, url, quality))
        except Exception:
            pass

    loop.run_in_executor(None, bg)
    return {"status": "prefetching"}