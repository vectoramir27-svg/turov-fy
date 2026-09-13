const searchInput = document.getElementById('searchInput');
const forYouCarousel = document.getElementById('forYouCarousel');
const releasesCarousel = document.getElementById('releasesCarousel');
const nicheCarousel = document.getElementById('nicheCarousel');
const popularCarousel = document.getElementById('popularCarousel');
const searchResultsArea = document.getElementById('searchResultsArea');
const searchResultsList = document.getElementById('searchResultsList');
const standardCatalogArea = document.getElementById('standardCatalogArea');
const catalogWaveContainer = document.getElementById('catalogWaveContainer');
const waveCard = document.getElementById('waveCard');

const artistAvatar = document.getElementById('artistAvatar');
const artistNameTitle = document.getElementById('artistNameTitle');
const artistTracksGrid = document.getElementById('artistTracksGrid');

let artistQueue = [];
let searchDebounce = null;
let isWaveActive = false;

// Состояние импорта
let importedPlaylistData = null;
let currentImportTarget = 'new'; // 'new' или 'favs'

function isTrackLiked(trackId) {
  const favs = userPlaylists['Любимое'] || [];
  return favs.some(t => t.id === trackId);
}

function toggleTrackLike(track, event) {
  if (event) event.stopPropagation();
  if (!currentUser) {
    openAuthModal();
    return;
  }

  if (!userPlaylists['Любимое']) userPlaylists['Любимое'] = [];

  const index = userPlaylists['Любимое'].findIndex(t => t.id === track.id);

  if (index > -1) {
    userPlaylists['Любимое'].splice(index, 1);
    showToast(`Удалено из Любимого`);
  } else {
    userPlaylists['Любимое'].unshift(track);
    showToast(`Добавлено в Любимое`);
  }

  queueDatabaseSync();

  if (currentQueue[currentIndex] && currentQueue[currentIndex].id === track.id) {
    updateDockHeartState();
  }

  updateHeartIcons();
  updateMediaCounters();
}

function toggleCurrentTrackLike() {
  if (currentIndex < 0 || !currentQueue[currentIndex]) return;
  toggleTrackLike(currentQueue[currentIndex], null);
}

function updateDockHeartState() {
  if (currentIndex >= 0 && currentQueue[currentIndex]) {
    const liked = isTrackLiked(currentQueue[currentIndex].id);
    dockHeartBtn.classList.toggle('liked', liked);
    if (fsHeartBtn) fsHeartBtn.classList.toggle('liked', liked);
    if (kHeartBtn) kHeartBtn.classList.toggle('liked', liked);
    if (mKHeartBtn) mKHeartBtn.classList.toggle('liked', liked);
  }
}

function updateHeartIcons() {
  document.querySelectorAll('.tfc-heart-btn, .sri-heart-btn').forEach(btn => {
    const id = btn.dataset.trackId;
    const liked = isTrackLiked(id);
    btn.classList.toggle('liked', liked);
  });
}

function updateMediaCounters() {
  const favsCount = (userPlaylists['Любимое'] || []).length;
  const favsEl = document.getElementById('favsTracksCountText');
  if (favsEl) favsEl.innerText = `${favsCount} треков`;

  const downEl = document.getElementById('downloadedTracksCountText');
  if (downEl) {
    if ('caches' in window) {
      caches.open('turovfy_offline_media').then(c => c.keys()).then(keys => {
        downEl.innerText = `${keys.length} треков`;
      }).catch(() => { downEl.innerText = `0 треков`; });
    } else {
      downEl.innerText = `0 треков`;
    }
  }
}

function createFeedCard(track, onPlayClick) {
  const card = document.createElement('div');
  card.className = 'track-feed-card';
  const liked = isTrackLiked(track.id);

  card.innerHTML = `
    <div class="tfc-thumb-box">
      <img class="tfc-img" referrerpolicy="no-referrer" src="${track.cover || ''}" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${track.id}/hqdefault.jpg'">
      <button class="tfc-heart-btn ${liked ? 'liked' : ''}" data-track-id="${track.id}" title="Нравится">
        <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
    </div>
    <div class="tfc-meta">
      <span class="tfc-title">${track.title}</span>
      <span class="tfc-artist">${track.artist}</span>
    </div>
  `;

  card.querySelector('.tfc-heart-btn').onclick = (e) => toggleTrackLike(track, e);

  const artistEl = card.querySelector('.tfc-artist');
  artistEl.onclick = (e) => {
    e.stopPropagation();
    openArtistByName(track.artist);
  };

  card.onclick = onPlayClick;
  return card;
}

function createSearchRow(track, onPlayClick) {
  const row = document.createElement('div');
  row.className = 'search-row-item';
  const liked = isTrackLiked(track.id);

  row.innerHTML = `
    <div class="sri-left">
      <img class="sri-cover" referrerpolicy="no-referrer" src="${track.cover || ''}" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${track.id}/hqdefault.jpg'">
      <div class="sri-meta">
        <span class="sri-title">${track.title}</span>
        <span class="sri-artist">${track.artist}</span>
      </div>
    </div>
    <div class="sri-right">
      <span class="sri-duration">${track.duration || '3:00'}</span>
      <button class="sri-heart-btn ${liked ? 'liked' : ''}" data-track-id="${track.id}" title="Нравится">
        <svg width="17" height="17" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
    </div>
  `;

  row.querySelector('.sri-heart-btn').onclick = (e) => toggleTrackLike(track, e);

  const artistEl = row.querySelector('.sri-artist');
  artistEl.onclick = (e) => {
    e.stopPropagation();
    openArtistByName(track.artist);
  };

  row.onclick = onPlayClick;
  return row;
}

function resetSearchDisplay() {
  if (searchResultsArea) searchResultsArea.style.display = 'none';
  if (searchResultsList) searchResultsList.innerHTML = '';
  if (standardCatalogArea) standardCatalogArea.style.display = 'block';
  if (catalogWaveContainer) catalogWaveContainer.style.display = 'block';
}

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const val = e.target.value.trim();
    if (!val) {
      resetSearchDisplay();
      return;
    }
    recordSearchQuery(val);
    searchDebounce = setTimeout(() => executeSearch(val), 300);
  });
}

async function executeSearch(query) {
  try {
    const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      renderSearchResults(data.results);
    } else {
      searchResultsList.innerHTML = `<div style="text-align:center; padding:30px 10px; color:var(--text-muted); font-size:14px;">Ничего не найдено</div>`;
    }
  } catch (err) {
    console.error('Ошибка поиска:', err);
  }
}

function renderSearchResults(tracks) {
  if (!searchResultsArea || !searchResultsList) return;
  if (standardCatalogArea) standardCatalogArea.style.display = 'none';
  if (catalogWaveContainer) catalogWaveContainer.style.display = 'none';
  searchResultsArea.style.display = 'block';
  searchResultsList.innerHTML = '';

  tracks.forEach((track, index) => {
    const row = createSearchRow(track, () => {
      isWaveActive = false;
      if (waveCard) waveCard.classList.remove('playing');
      currentQueue = tracks;
      playIndex(index);
    });
    searchResultsList.appendChild(row);
  });
}

function populateShelf(container, tracks) {
  if (!container) return;
  container.innerHTML = '';
  tracks.forEach((track, index) => {
    const item = document.createElement('div');
    item.className = 'carousel-item';
    item.appendChild(createFeedCard(track, () => {
      isWaveActive = false;
      if (waveCard) waveCard.classList.remove('playing');
      currentQueue = tracks;
      playIndex(index);
    }));
    container.appendChild(item);
  });
}

async function initCatalogFeed() {
  fetch(`/api/search?query=${encodeURIComponent('Чарт Яндекс Музыка')}`)
    .then(r => r.json())
    .then(d => { if (d.results) populateShelf(forYouCarousel, d.results.slice(0, 10)); })
    .catch(() => {});

  fetch(`/api/search?query=${encodeURIComponent('Новинки рэпа 2026 хиты')}`)
    .then(r => r.json())
    .then(d => { if (d.results) populateShelf(releasesCarousel, d.results.slice(0, 10)); })
    .catch(() => {});

  fetch(`/api/search?query=${encodeURIComponent('Aggressive Drift Phonk Slowed')}`)
    .then(r => r.json())
    .then(d => { if (d.results) populateShelf(nicheCarousel, d.results.slice(0, 10)); })
    .catch(() => {});

  fetch(`/api/search?query=${encodeURIComponent('Топ треки ВК Музыка')}`)
    .then(r => r.json())
    .then(d => { if (d.results) populateShelf(popularCarousel, d.results.slice(0, 10)); })
    .catch(() => {});
}

async function appendSimilarTracksIfNeeded(track) {
  if (!appPrefs.similarTracks || isWaveActive) return;
  try {
    const exParam = Array.from(dislikedTracks).join(',');
    const queriesParam = userSearchHistory.join('||');
    const res = await fetch(`/api/wave?seed_id=${track.id}&artist=${encodeURIComponent(track.artist || "")}&queries=${encodeURIComponent(queriesParam)}&exclude=${encodeURIComponent(exParam)}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const fresh = data.results.filter(t => !dislikedTracks.has(t.id) && !currentQueue.some(q => q.id === t.id));
      if (fresh.length > 0) {
        currentQueue.push(...fresh.slice(0, 10));
        saveQueueToStorage();
      }
    }
  } catch (e) {}
}

async function startMyWave(seedId = "") {
  isWaveActive = true;
  if (waveCard) waveCard.classList.add('playing');
  showToast("Моя волна: подбираем чарты...");
  
  const exParam = Array.from(dislikedTracks).join(',');
  const queriesParam = userSearchHistory.join('||');
  const currentArtist = (isWaveActive && currentQueue[currentIndex]) ? (currentQueue[currentIndex].artist || "") : "";
  
  try {
    const res = await fetch(`/api/wave?seed_id=${encodeURIComponent(seedId)}&artist=${encodeURIComponent(currentArtist)}&queries=${encodeURIComponent(queriesParam)}&exclude=${encodeURIComponent(exParam)}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      currentQueue = data.results.filter(t => !dislikedTracks.has(t.id));
      playIndex(0);
    }
  } catch (e) {
    showToast("Ошибка запуска волны");
  }
}

function toggleWavePlay() {
  if (!isWaveActive || currentQueue.length === 0) {
    startMyWave();
  } else {
    togglePlay();
  }
}

function dislikeCurrentTrack() {
  if (currentIndex < 0 || !currentQueue[currentIndex]) return;
  const track = currentQueue[currentIndex];
  dislikedTracks.add(track.id);
  localStorage.setItem('turovfy_dislikes', JSON.stringify(Array.from(dislikedTracks)));
  showToast("Убрали из Моей волны");
  nextTrack();
}

async function openArtistByName(name) {
  if (!name || name === 'Выберите трек из каталога') return;
  const cleanName = name.split(',')[0].trim();
  recordSearchQuery(cleanName);
  showToast(`Загрузка артиста ${cleanName}...`);

  try {
    const res = await fetch(`/api/artist?query=${encodeURIComponent(cleanName)}`);
    const data = await res.json();
    
    artistNameTitle.innerText = data.name;
    artistAvatar.src = data.avatar || '';
    artistQueue = data.tracks;

    renderArtistGrid(artistQueue);

    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.island-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tabArtist').classList.add('active');
  } catch (err) {
    console.error("Ошибка загрузки артиста:", err);
    showToast("Не удалось загрузить данные артиста");
  }
}

function renderArtistGrid(tracks) {
  artistTracksGrid.innerHTML = '';
  tracks.forEach((track, index) => {
    const card = createFeedCard(track, () => {
      isWaveActive = false;
      if (waveCard) waveCard.classList.remove('playing');
      currentQueue = tracks;
      playIndex(index);
    });
    artistTracksGrid.appendChild(card);
  });
}

function playAllArtistTracks() {
  if (artistQueue.length > 0) {
    isWaveActive = false;
    if (waveCard) waveCard.classList.remove('playing');
    currentQueue = artistQueue;
    playIndex(0);
  }
}

/* =================================================================
   ЛОГИКА МЕДИАТЕКИ И ПЛЕЙЛИСТОВ
   ================================================================= */
function createPlaylist() {
  const name = prompt("Введите название нового плейлиста:");
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  if (!userPlaylists[cleanName]) {
    userPlaylists[cleanName] = [];
    renderPlaylists();
    showToast(`Плейлист "${cleanName}" создан`);
    queueDatabaseSync();
  } else {
    showToast("Плейлист с таким именем уже существует");
  }
}

function deletePlaylist(name, event) {
  if (event) event.stopPropagation();
  if (name === 'Любимое') return;
  if (confirm(`Удалить плейлист "${name}"?`)) {
    delete userPlaylists[name];
    renderPlaylists();
    showToast(`Плейлист "${name}" удален`);
    queueDatabaseSync();
  }
}

function filterPlaylistsView(filter) {
  const btnAll = document.getElementById('plFilterAll');
  const btnPl = document.getElementById('plFilterPlaylists');
  if (filter === 'all') {
    if (btnAll) btnAll.classList.add('active');
    if (btnPl) btnPl.classList.remove('active');
  } else {
    if (btnAll) btnAll.classList.remove('active');
    if (btnPl) btnPl.classList.add('active');
  }
  renderPlaylists();
}

function renderPlaylists() {
  const grid = document.getElementById('playlistsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  closePlaylistView();

  const isAll = document.getElementById('plFilterAll')?.classList.contains('active') !== false;

  Object.entries(userPlaylists).forEach(([name, tracks]) => {
    if (!isAll && name === 'Любимое') return;

    const card = document.createElement('div');
    card.className = 'track-feed-card';

    let coverImg = '/assets/favorite.png';
    if (name !== 'Любимое') {
      coverImg = tracks.length > 0 && tracks[0].cover 
        ? tracks[0].cover 
        : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
    }

    const delBtnHtml = name !== 'Любимое'
      ? `<button class="tfc-heart-btn" onclick="deletePlaylist('${name}', event)" title="Удалить плейлист">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
         </button>`
      : '';

    card.innerHTML = `
      <div class="tfc-thumb-box">
        <img class="tfc-img" src="${coverImg}">
        ${delBtnHtml}
      </div>
      <div class="tfc-meta">
        <span class="tfc-title">${name}</span>
        <span class="tfc-artist">${tracks.length} треков</span>
      </div>
    `;
    card.onclick = () => openPlaylist(name, tracks);
    grid.appendChild(card);
  });

  updateMediaCounters();
}

function openFavoritesPlaylist() {
  const tracks = userPlaylists['Любимое'] || [];
  openPlaylist('Любимые', tracks);
}

async function openDownloadedPlaylist() {
  showToast("Загрузка оффлайн-медиатеки...");
  const downloadedTracks = [];
  if ('caches' in window) {
    try {
      const cache = await caches.open('turovfy_offline_media');
      const requests = await cache.keys();
      requests.forEach((req, idx) => {
        const u = req.url;
        const match = u.match(/\/api\/listen\/([a-zA-Z0-9_\-]+)/);
        const vid = match ? match[1] : `cached_${idx}`;
        downloadedTracks.push({
          id: vid,
          title: `Оффлайн трек ${idx + 1}`,
          artist: "Сохранено на устройстве",
          duration: "3:00",
          cover: "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80"
        });
      });
    } catch (e) {}
  }
  openPlaylist('Скачанные', downloadedTracks);
}

function openPlaylist(name, tracks) {
  if (tracks.length === 0) {
    showToast(`Плейлист "${name}" пока пуст.`);
    return;
  }
  document.getElementById('playlistsGrid').style.display = 'none';
  const view = document.getElementById('playlistTracksView');
  view.style.display = 'block';
  document.getElementById('openedPlaylistTitle').innerText = `${name} (${tracks.length})`;

  const grid = document.getElementById('playlistTracksGrid');
  grid.innerHTML = '';
  tracks.forEach((track, index) => {
    const card = createFeedCard(track, () => {
      isWaveActive = false;
      if (waveCard) waveCard.classList.remove('playing');
      currentQueue = tracks;
      playIndex(index);
    });
    grid.appendChild(card);
  });
}

function closePlaylistView() {
  document.getElementById('playlistsGrid').style.display = 'grid';
  document.getElementById('playlistTracksView').style.display = 'none';
}

/* =================================================================
   ЛОГИКА ИМПОРТА ПЛЕЙЛИСТОВ
   ================================================================= */
function openImportOptionsModal() {
  const m = document.getElementById('importOptionsModal');
  if (m) m.classList.add('active');
}
function closeImportOptionsModal() {
  const m = document.getElementById('importOptionsModal');
  if (m) m.classList.remove('active');
}

function openImportUrlInputModal() {
  closeImportOptionsModal();
  const m = document.getElementById('importUrlModal');
  if (m) {
    m.classList.add('active');
    const inp = document.getElementById('importPlaylistUrlInput');
    if (inp) {
      inp.value = '';
      handleImportUrlInput('');
      setTimeout(() => inp.focus(), 150);
    }
  }
}
function closeImportUrlModal() {
  const m = document.getElementById('importUrlModal');
  if (m) m.classList.remove('active');
}

function openImportTextInputModal() {
  closeImportOptionsModal();
  const m = document.getElementById('importTextModal');
  if (m) {
    m.classList.add('active');
    const t = document.getElementById('importTextListInput');
    if (t) {
      t.value = '';
      setTimeout(() => t.focus(), 150);
    }
  }
}
function closeImportTextModal() {
  const m = document.getElementById('importTextModal');
  if (m) m.classList.remove('active');
}

function handleImportUrlInput(val) {
  const logoWrap = document.getElementById('importServiceLogoWrap');
  const badge = document.getElementById('inputServiceBadge');
  if (!logoWrap) return;

  val = val.trim().toLowerCase();

  // Яндекс Музыка (Желтая звезда-искра как на видео)
  if (val.includes('yandex') || val.includes('music.yandex') || val.includes('ya.ru')) {
    logoWrap.innerHTML = `
      <svg width="105" height="105" viewBox="0 0 100 100" fill="none">
        <path d="M50 0 L58 35 L95 20 L68 48 L100 65 L63 68 L75 100 L48 74 L25 98 L34 63 L0 60 L32 44 L10 15 L44 32 Z" fill="#FFCC00"/>
      </svg>
    `;
    if (badge) {
      badge.innerText = "Yandex Music";
      badge.style.background = "rgba(255, 204, 0, 0.2)";
      badge.style.color = "#ffcc00";
    }
  } 
  // Spotify (Зеленый логотип)
  else if (val.includes('spotify.com')) {
    logoWrap.innerHTML = `
      <svg width="90" height="90" viewBox="0 0 24 24" fill="#1DB954">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.495 17.303c-.216.354-.678.468-1.032.253-2.827-1.728-6.386-2.119-10.578-1.163-.404.093-.812-.162-.905-.566-.093-.404.162-.812.566-.905 4.562-1.042 8.487-.597 11.696 1.349.354.215.468.678.253 1.032zm1.467-3.26c-.272.443-.852.585-1.295.313-3.236-1.989-8.17-2.565-11.998-1.402-.497.151-1.032-.132-1.183-.629-.151-.497.132-1.032.629-1.183 4.378-1.33 9.807-.687 13.534 1.606.443.272.585.852.313 1.295zm.127-3.393c-3.882-2.305-10.293-2.518-14.01-1.39-.597.181-1.23-.162-1.411-.759-.181-.597.162-1.23.759-1.411 4.269-1.296 11.354-1.05 15.823 1.604.538.32.713 1.016.393 1.554-.32.538-1.016.713-1.554.402z"/>
      </svg>
    `;
    if (badge) {
      badge.innerText = "Spotify";
      badge.style.background = "rgba(29, 185, 84, 0.2)";
      badge.style.color = "#1db954";
    }
  } 
  // VK Музыка
  else if (val.includes('vk.com') || val.includes('vk.ru')) {
    logoWrap.innerHTML = `
      <svg width="90" height="90" viewBox="0 0 24 24" fill="#0077FF">
        <path d="M15.684 0H8.316C2.992 0 0 2.992 0 8.316v7.368C0 21.008 2.992 24 8.316 24h7.368C21.008 24 24 21.008 24 15.684V8.316C24 2.992 21.008 0 15.684 0zm3.602 17.154h-1.637c-.62 0-.81-.493-1.927-1.61-1.03-1.006-1.488-1.135-1.745-1.135-.36 0-.463.103-.463.597v1.487c0 .392-.124.628-1.194.628-1.769 0-3.733-1.07-5.111-3.064-2.078-2.92-2.654-5.123-2.654-5.577 0-.247.103-.473.597-.473h1.636c.442 0 .607.206.782.68.854 2.49 2.294 4.67 2.89 4.67.226 0 .329-.103.329-.669V11.87c-.072-1.204-.71-1.307-.71-1.739 0-.206.175-.412.453-.412h2.572c.36 0 .494.185.494.617v3.313c0 .36.165.494.268.494.226 0 .412-.134.833-.556 1.286-1.44 2.202-3.663 2.202-3.663.124-.247.33-.473.772-.473h1.636c.494 0 .607.247.494.617-.227.978-2.264 3.869-2.367 4.033-.206.33-.288.473 0 .865.206.288.895.875 1.358 1.41 1.05 1.194 1.862 2.192 2.078 2.882.134.422-.113.638-.525.638z"/>
      </svg>
    `;
    if (badge) {
      badge.innerText = "VK Музыка";
      badge.style.background = "rgba(0, 119, 255, 0.2)";
      badge.style.color = "#0077ff";
    }
  } 
  // По умолчанию
  else {
    logoWrap.innerHTML = `
      <svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="#2c2c2e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/>
        <polygon points="18 10 23 15 18 20 18 10" fill="#2c2c2e"/>
      </svg>
    `;
    if (badge) {
      badge.innerText = "";
      badge.style.background = "transparent";
    }
  }
}

async function startDownloadImport() {
  const inp = document.getElementById('importPlaylistUrlInput');
  const btn = document.getElementById('btnStartDownloadImport');
  const url = inp ? inp.value.trim() : '';

  if (!url) {
    showToast("Вставьте ссылку на плейлист!");
    return;
  }

  if (btn) {
    btn.innerHTML = `<span style="display:inline-block; animation: spin 0.8s linear infinite;">⏳</span> Извлекаем треки...`;
    btn.disabled = true;
  }

  showToast("Парсим и находим треки...");

  try {
    const res = await fetch('/api/playlist/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });
    const data = await res.json();

    if (btn) {
      btn.innerHTML = `Загрузить`;
      btn.disabled = false;
    }

    if (!data.tracks || data.tracks.length === 0) {
      showToast("Не удалось извлечь треки из плейлиста");
      return;
    }

    importedPlaylistData = data;
    closeImportUrlModal();
    openImportConfirmModal(data);
  } catch (err) {
    if (btn) {
      btn.innerHTML = `Загрузить`;
      btn.disabled = false;
    }
    console.error(err);
    showToast("Ошибка при импорте плейлиста");
  }
}

async function startTextImport() {
  const inp = document.getElementById('importTextListInput');
  const btn = document.getElementById('btnStartTextImport');
  const text = inp ? inp.value.trim() : '';

  if (!text) {
    showToast("Вставьте список треков!");
    return;
  }

  if (btn) {
    btn.innerHTML = `Поиск треков...`;
    btn.disabled = true;
  }

  showToast("Ищем треки по списку...");

  try {
    const res = await fetch('/api/playlist/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_list: text })
    });
    const data = await res.json();

    if (btn) {
      btn.innerHTML = `Импортировать`;
      btn.disabled = false;
    }

    if (!data.tracks || data.tracks.length === 0) {
      showToast("Треки не найдены");
      return;
    }

    importedPlaylistData = data;
    closeImportTextModal();
    openImportConfirmModal(data);
  } catch (e) {
    if (btn) {
      btn.innerHTML = `Импортировать`;
      btn.disabled = false;
    }
    showToast("Ошибка импорта списка");
  }
}

function openImportConfirmModal(data) {
  const m = document.getElementById('importConfirmModal');
  const img = document.getElementById('importPreviewImg');
  const title = document.getElementById('importPreviewTitle');
  const cnt = document.getElementById('importPreviewTracksCount');

  if (img) img.src = data.cover || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80';
  if (title) title.innerText = data.title || "Мой плейлист";
  if (cnt) cnt.innerText = `${data.tracks.length} треков`;

  currentImportTarget = 'new';
  selectImportTarget('new');

  if (m) m.classList.add('active');
}
function closeImportConfirmModal() {
  const m = document.getElementById('importConfirmModal');
  if (m) m.classList.remove('active');
}

function selectImportTarget(target) {
  currentImportTarget = target;
  const checkNew = document.getElementById('checkImportTargetNew');
  const checkFavs = document.getElementById('checkImportTargetFavs');

  if (target === 'new') {
    if (checkNew) checkNew.style.display = 'flex';
    if (checkFavs) checkFavs.style.display = 'none';
  } else {
    if (checkNew) checkNew.style.display = 'none';
    if (checkFavs) checkFavs.style.display = 'flex';
  }
}

function confirmImportPlaylist() {
  if (!importedPlaylistData || !importedPlaylistData.tracks) return;

  if (currentImportTarget === 'new') {
    const plName = importedPlaylistData.title || `Импорт ${new Date().toLocaleDateString()}`;
    userPlaylists[plName] = importedPlaylistData.tracks;
    showToast(`Плейлист "${plName}" (${importedPlaylistData.tracks.length} треков) сохранен!`);
  } else {
    if (!userPlaylists['Любимое']) userPlaylists['Любимое'] = [];
    importedPlaylistData.tracks.forEach(t => {
      if (!userPlaylists['Любимое'].some(fav => fav.id === t.id)) {
        userPlaylists['Любимое'].push(t);
      }
    });
    showToast(`Добавлено ${importedPlaylistData.tracks.length} треков в Любимое!`);
  }

  closeImportConfirmModal();
  renderPlaylists();
  queueDatabaseSync();
}