const audio = document.getElementById('audioElement');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const progressBar = document.getElementById('progressBar');
const volumeSlider = document.getElementById('volumeSlider');
const volumeIcon = document.getElementById('volumeIcon');
const dockHeartBtn = document.getElementById('dockHeartBtn');
const lyricsBtn = document.getElementById('lyricsBtn');

const fullscreenPlayer = document.getElementById('fullscreenPlayer');
const fsCover = document.getElementById('fsCover');
const fsCanvasVideo = document.getElementById('fsCanvasVideo');
const fsTitle = document.getElementById('fsTitle');
const fsArtist = document.getElementById('fsArtist');
const fsProgressBar = document.getElementById('fsProgressBar');
const fsCurrentTime = document.getElementById('fsCurrentTime');
const fsDuration = document.getElementById('fsDuration');
const fsPlayIcon = document.getElementById('fsPlayIcon');
const fsHeartBtn = document.getElementById('fsHeartBtn');

const karaokeOverlay = document.getElementById('karaokeOverlay');
const kCover = document.getElementById('kCover');
const kCanvasVideo = document.getElementById('kCanvasVideo');
const kTitle = document.getElementById('kTitle');
const kArtist = document.getElementById('kArtist');
const kPlayIcon = document.getElementById('kPlayIcon');
const kHeartBtn = document.getElementById('kHeartBtn');
const kProgressBar = document.getElementById('kProgressBar');
const kCurrentTime = document.getElementById('kCurrentTime');
const kDuration = document.getElementById('kDuration');
const karaokeLinesContainer = document.getElementById('karaokeLinesContainer');

const mKCover = document.getElementById('mKCover');
const mKTitle = document.getElementById('mKTitle');
const mKArtist = document.getElementById('mKArtist');
const mKPlayIcon = document.getElementById('mKPlayIcon');
const mKHeartBtn = document.getElementById('mKHeartBtn');
const mKProgressBar = document.getElementById('mKProgressBar');
const mKCurrentTime = document.getElementById('mKCurrentTime');
const mKDuration = document.getElementById('mKDuration');

let currentQueue = [];
let currentIndex = -1;
let lastVolume = 1.0;
let currentLyricsData = [];
let isKaraokeOpen = false;

let audioCtx = null;
let eqFilters = [];
let gainNode = null;
let compressorNode = null;
const EQ_FREQUENCIES = [60, 250, 1000, 4000, 12000];
let currentEqBands = [0, 0, 0, 0, 0];
let currentPreset = 'flat';

const OFFLINE_CACHE_NAME = 'turovfy_offline_media';
const OFFLINE_LYRICS_KEY = 'turovfy_cached_lyrics';

// Переменные для точного подсчета статистики
let currentTrackPlayedSeconds = 0;
let currentTrackRecorded = false;
let lastPlaySecondMark = -1;

function extractDominantColor(imgSrc) {
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = imgSrc;
  img.onload = () => {
    try {
      const canvas = document.getElementById('paletteCanvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 16;
      canvas.height = 16;
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] + data[i+1] + data[i+2] > 70) {
          r += data[i];
          g += data[i+1];
          b += data[i+2];
          count++;
        }
      }
      if (count > 0) {
        const colorRgb = `rgb(${Math.floor(r/count)}, ${Math.floor(g/count)}, ${Math.floor(b/count)})`;
        document.documentElement.style.setProperty('--accent-theme', colorRgb);
      }
    } catch (e) {
      document.documentElement.style.setProperty('--accent-theme', '#8b2635');
    }
  };
}

function saveQueueToStorage() {
  if (appPrefs.restoreQueue) {
    localStorage.setItem('turovfy_saved_queue', JSON.stringify({
      queue: currentQueue,
      index: currentIndex
    }));
  } else {
    localStorage.removeItem('turovfy_saved_queue');
  }
}

function applyCanvasState() {
  const isCanvas = !!appPrefs.canvas;
  if (fsCanvasVideo) {
    if (isCanvas && currentQueue[currentIndex]) {
      fsCanvasVideo.classList.add('active');
      if (fsCanvasVideo.paused) fsCanvasVideo.play().catch(() => {});
    } else {
      fsCanvasVideo.classList.remove('active');
      fsCanvasVideo.pause();
    }
  }
  if (kCanvasVideo) {
    if (isCanvas && currentQueue[currentIndex]) {
      kCanvasVideo.classList.add('active');
      if (kCanvasVideo.paused) kCanvasVideo.play().catch(() => {});
    } else {
      kCanvasVideo.classList.remove('active');
      kCanvasVideo.pause();
    }
  }
}

function loadCanvasForTrack(track) {
  if (!appPrefs.canvas) return;
  const sampleCanvases = [
    "https://assets.mixkit.co/videos/preview/mixkit-abstract-laser-lights-background-animation-41584-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-liquid-neon-substance-fluid-motion-41581-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-retro-futuristic-grid-tunnel-41583-large.mp4"
  ];
  let charSum = 0;
  for (let i = 0; i < track.id.length; i++) charSum += track.id.charCodeAt(i);
  const chosenVideo = sampleCanvases[charSum % sampleCanvases.length];

  if (fsCanvasVideo) {
    fsCanvasVideo.src = chosenVideo;
    fsCanvasVideo.play().catch(() => {});
  }
  if (kCanvasVideo) {
    kCanvasVideo.src = chosenVideo;
    kCanvasVideo.play().catch(() => {});
  }
}

function updateProgressVisual(percent) {
  progressBar.value = percent;
  progressBar.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${percent}%, rgba(255, 255, 255, 0.15) ${percent}%, rgba(255, 255, 255, 0.15) 100%)`;

  if (fsProgressBar) {
    fsProgressBar.value = percent;
    fsProgressBar.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${percent}%, rgba(255, 255, 255, 0.15) ${percent}%, rgba(255, 255, 255, 0.15) 100%)`;
  }
  if (kProgressBar) {
    kProgressBar.value = percent;
    kProgressBar.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${percent}%, rgba(255, 255, 255, 0.15) ${percent}%, rgba(255, 255, 255, 0.15) 100%)`;
  }
  if (mKProgressBar) {
    mKProgressBar.value = percent;
    mKProgressBar.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${percent}%, rgba(255, 255, 255, 0.15) ${percent}%, rgba(255, 255, 255, 0.15) 100%)`;
  }
}

function updateVolumeVisual(val) {
  val = parseFloat(val);
  volumeSlider.value = val;
  const pct = val * 100;
  volumeSlider.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pct}%, rgba(255, 255, 255, 0.15) ${pct}%, rgba(255, 255, 255, 0.15) 100%)`;

  if (val === 0) {
    volumeIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/>
      <line x1="17" y1="9" x2="23" y2="15"/>
    `;
  } else if (val < 0.5) {
    volumeIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    `;
  } else {
    volumeIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    `;
  }
}

function toggleMute() {
  if (audio.volume > 0) {
    lastVolume = audio.volume;
    audio.volume = 0;
    updateVolumeVisual(0);
  } else {
    audio.volume = lastVolume || 1.0;
    updateVolumeVisual(audio.volume);
  }
  queueDatabaseSync();
}

function openFullscreenPlayer() {
  if (!currentQueue[currentIndex]) return;
  fullscreenPlayer.classList.add('active');
  applyCanvasState();
}

function closeFullscreenPlayer() {
  fullscreenPlayer.classList.remove('active');
}

function toggleKaraoke() {
  if (currentIndex < 0 || !currentQueue[currentIndex]) {
    showToast("Сначала выберите трек!");
    return;
  }
  isKaraokeOpen = !isKaraokeOpen;
  if (isKaraokeOpen) {
    karaokeOverlay.classList.add('active');
    lyricsBtn.classList.add('active');
    closeFullscreenPlayer();
    applyCanvasState();
  } else {
    karaokeOverlay.classList.remove('active');
    lyricsBtn.classList.remove('active');
  }
}

async function loadLyricsForCurrentTrack(track) {
  kTitle.innerText = track.title;
  kArtist.innerText = track.artist;
  kCover.src = track.cover || '';

  if (mKTitle) mKTitle.innerText = track.title;
  if (mKArtist) mKArtist.innerText = track.artist;
  if (mKCover) mKCover.src = track.cover || '';

  karaokeLinesContainer.innerHTML = `<div class="k-line active">Загрузка текста...</div>`;

  const cacheKey = `${track.title}__${track.artist}`.toLowerCase();
  const cachedLyricsStore = JSON.parse(localStorage.getItem(OFFLINE_LYRICS_KEY) || '{}');

  if (cachedLyricsStore[cacheKey]) {
    const d = cachedLyricsStore[cacheKey];
    parseLyrics(d.lyrics, d.type);
    return;
  }

  try {
    const res = await fetch(`/api/lyrics?track=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`);
    const data = await res.json();
    
    if (appPrefs.cachingEnabled && data && data.lyrics) {
      cachedLyricsStore[cacheKey] = data;
      localStorage.setItem(OFFLINE_LYRICS_KEY, JSON.stringify(cachedLyricsStore));
      if (typeof updateStorageStatsUI === 'function') updateStorageStatsUI();
    }

    parseLyrics(data.lyrics, data.type);
  } catch (e) {
    karaokeLinesContainer.innerHTML = `<div class="k-line active">Текст недоступен оффлайн</div>`;
    currentLyricsData = [];
  }
}

function parseLyrics(rawText, type) {
  currentLyricsData = [];
  karaokeLinesContainer.innerHTML = '';

  if (type === 'synced') {
    const lines = rawText.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    lines.forEach(line => {
      const match = timeRegex.exec(line);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millis = parseInt(match[3].padEnd(3, '0'), 10);
        const totalSec = minutes * 60 + seconds + millis / 1000;
        const text = line.replace(timeRegex, '').trim();
        if (text) {
          currentLyricsData.push({ time: totalSec, text: text });
        }
      }
    });
  }

  if (currentLyricsData.length === 0) {
    const plainLines = rawText.split('\n');
    let t = 0;
    plainLines.forEach(l => {
      const trimmed = l.trim();
      if (trimmed) {
        currentLyricsData.push({ time: t, text: trimmed });
        t += 4;
      }
    });
  }

  if (currentLyricsData.length === 0) {
    karaokeLinesContainer.innerHTML = `<div class="k-line active">Нет текста для этого трека</div>`;
    return;
  }

  currentLyricsData.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = `k-line ${idx === 0 ? 'active' : ''}`;
    div.innerText = item.text;
    div.dataset.time = item.time;
    karaokeLinesContainer.appendChild(div);
  });
}

function updateKaraokeHighlight(currentTime) {
  if (!isKaraokeOpen || currentLyricsData.length === 0) return;

  let activeIdx = 0;
  for (let i = 0; i < currentLyricsData.length; i++) {
    if (currentTime >= currentLyricsData[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }

  const lineElements = karaokeLinesContainer.querySelectorAll('.k-line');
  lineElements.forEach((el, idx) => {
    if (idx === activeIdx) {
      if (!el.classList.contains('active')) {
        el.classList.add('active');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      el.classList.remove('active');
    }
  });
}

function setupEqualizer() {
  if (audioCtx) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioCtx = new AudioContextClass();
    const source = audioCtx.createMediaElementSource(audio);

    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

    compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.setValueAtTime(-18, audioCtx.currentTime);
    compressorNode.knee.setValueAtTime(12, audioCtx.currentTime);
    compressorNode.ratio.setValueAtTime(4, audioCtx.currentTime);
    compressorNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);

    let prevNode = source;
    eqFilters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.0;
      filter.gain.value = currentEqBands[i] || 0;
      prevNode.connect(filter);
      prevNode = filter;
      return filter;
    });

    updateAudioChainRouting(prevNode);
  } catch (err) {
    console.warn("Equalizer initialization bypassed:", err);
  }
}

function updateAudioChainRouting(lastFilterNode) {
  if (!audioCtx || !eqFilters.length) return;
  const filterOut = lastFilterNode || eqFilters[eqFilters.length - 1];
  try {
    filterOut.disconnect();
    if (compressorNode) compressorNode.disconnect();
    if (gainNode) gainNode.disconnect();

    if (appPrefs.normalization) {
      filterOut.connect(compressorNode);
      compressorNode.connect(gainNode);
    } else {
      filterOut.connect(gainNode);
    }
    gainNode.connect(audioCtx.destination);
  } catch (e) {
    console.warn("Ошибка реконфигурации аудиотракта:", e);
  }
}

function changeEqBand(index, gain) {
  if (!audioCtx) setupEqualizer();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (eqFilters[index]) {
    eqFilters[index].gain.value = gain;
    currentEqBands[index] = Number(gain);
    document.getElementById(`eqVal${index}`).innerText = `${gain > 0 ? '+' : ''}${gain} dB`;
    
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    currentPreset = 'custom';
    queueDatabaseSync();
  }
}

function applyPreset(preset) {
  const presets = {
    flat: [0, 0, 0, 0, 0],
    bass: [9, 6, 0, -1, 1],
    vocal: [-2, 1, 5, 4, 1],
    electro: [7, 4, -1, 3, 6]
  };
  currentPreset = preset;
  const values = presets[preset] || presets.flat;
  const sliders = document.querySelectorAll('.eq-slider');

  values.forEach((val, i) => {
    sliders[i].value = val;
    if (!audioCtx) setupEqualizer();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (eqFilters[i]) eqFilters[i].gain.value = val;
    currentEqBands[i] = val;
    document.getElementById(`eqVal${i}`).innerText = `${val > 0 ? '+' : ''}${val} dB`;
  });

  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`btnPreset-${preset}`);
  if (activeBtn) activeBtn.classList.add('active');

  queueDatabaseSync();
}

function syncTrackToUI(track) {
  document.getElementById('dockTitle').innerText = track.title;
  document.getElementById('dockArtist').innerText = track.artist;
  document.getElementById('dockCover').src = track.cover || '';

  if (fsTitle) fsTitle.innerText = track.title;
  if (fsArtist) fsArtist.innerText = track.artist;
  if (fsCover) fsCover.src = track.cover || '';

  if (kTitle) kTitle.innerText = track.title;
  if (kArtist) kArtist.innerText = track.artist;
  if (kCover) kCover.src = track.cover || '';

  if (mKTitle) mKTitle.innerText = track.title;
  if (mKArtist) mKArtist.innerText = track.artist;
  if (mKCover) mKCover.src = track.cover || '';

  extractDominantColor(track.cover || '');

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'TurovFy',
      artwork: [
        { src: track.cover || '', sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
  }

  updateDockHeartState();
  applyCanvasState();
}

function playIndex(index) {
  if (index < 0 || index >= currentQueue.length) return;
  
  const doFade = appPrefs.crossfade && audioCtx && gainNode && !audio.paused;
  if (doFade) {
    gainNode.gain.setValueAtTime(gainNode.gain.value, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    setTimeout(() => startTrackStream(index, true), 350);
  } else {
    startTrackStream(index, false);
  }
}

async function resolveTrackAudioUrl(trackId, quality) {
  const url = `/api/listen/${trackId}?quality=${encodeURIComponent(quality)}`;
  if (!('caches' in window)) return url;

  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const matched = await cache.match(url);
    if (matched) {
      const blob = await matched.blob();
      return URL.createObjectURL(blob);
    }

    if (appPrefs.cachingEnabled) {
      fetch(url)
        .then(response => {
          if (response.status === 200) {
            cache.put(url, response.clone());
            if (typeof updateStorageStatsUI === 'function') setTimeout(updateStorageStatsUI, 800);
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    console.warn("Кэш недоступен:", err);
  }
  return url;
}

async function startTrackStream(index, wasFaded) {
  currentIndex = index;
  const track = currentQueue[index];

  // Сброс счетчиков текущего трека
  currentTrackPlayedSeconds = 0;
  currentTrackRecorded = false;
  lastPlaySecondMark = -1;

  syncTrackToUI(track);
  loadLyricsForCurrentTrack(track);
  loadCanvasForTrack(track);

  audio.currentTime = 0;
  updateProgressVisual(0);
  document.getElementById('currentTime').innerText = '0:00';
  if (fsCurrentTime) fsCurrentTime.innerText = '0:00';
  if (kCurrentTime) kCurrentTime.innerText = '0:00';
  if (mKCurrentTime) mKCurrentTime.innerText = '0:00';

  const q = appPrefs.audioQuality || "medium";
  audio.src = await resolveTrackAudioUrl(track.id, q);
  
  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        setPlayState(true);
        if (!audioCtx) setupEqualizer();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

        if (wasFaded && gainNode && audioCtx) {
          gainNode.gain.setValueAtTime(0.01, audioCtx.currentTime);
          gainNode.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + 0.6);
        } else if (gainNode && audioCtx) {
          gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
        }
      })
      .catch((err) => {
        console.warn("Autoplay deferred by browser:", err);
        setPlayState(false);
      });
  }

  saveQueueToStorage();
  queueDatabaseSync();

  if (typeof isWaveActive !== 'undefined' && isWaveActive && currentIndex >= currentQueue.length - 3) {
    const exParam = Array.from(dislikedTracks).join(',');
    const queriesParam = userSearchHistory.join('||');
    const currentArtist = track.artist || "";
    fetch(`/api/wave?seed_id=${track.id}&artist=${encodeURIComponent(currentArtist)}&queries=${encodeURIComponent(queriesParam)}&exclude=${encodeURIComponent(exParam)}`)
      .then(r => r.json())
      .then(data => {
        if (data.results) {
          const fresh = data.results.filter(t => !dislikedTracks.has(t.id) && !currentQueue.some(q => q.id === t.id));
          currentQueue.push(...fresh);
          saveQueueToStorage();
        }
      });
  } else if (appPrefs.similarTracks && currentIndex >= currentQueue.length - 2) {
    if (typeof appendSimilarTracksIfNeeded === 'function') appendSimilarTracksIfNeeded(track);
  }

  if (currentIndex + 1 < currentQueue.length) {
    const qPrefetch = appPrefs.audioQuality || "medium";
    fetch(`/api/prefetch/${currentQueue[currentIndex + 1].id}?quality=${encodeURIComponent(qPrefetch)}`);
  }
}

function togglePlay() {
  if (!audio.src) return;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  if (audio.paused) {
    audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
  } else {
    audio.pause();
    setPlayState(false);
  }
}

function setPlayState(isPlaying) {
  const isMobile = window.innerWidth <= 768;
  let iconMarkup = '';

  if (isPlaying) {
    iconMarkup = isMobile
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<rect x="4" y="3" width="4" height="18"/><rect x="16" y="3" width="4" height="18"/>';
    if (fsCanvasVideo && appPrefs.canvas) fsCanvasVideo.play().catch(() => {});
    if (kCanvasVideo && appPrefs.canvas) kCanvasVideo.play().catch(() => {});
  } else {
    iconMarkup = isMobile
      ? '<polygon points="7 4 19 12 7 20 7 4"/>'
      : '<polygon points="5 3 19 12 5 21 5 3"/>';
    if (fsCanvasVideo) fsCanvasVideo.pause();
    if (kCanvasVideo) kCanvasVideo.pause();
  }

  playIcon.innerHTML = iconMarkup;

  const waveBigIcon = document.getElementById('waveBigIcon');
  if (waveBigIcon) {
    waveBigIcon.innerHTML = isPlaying 
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' 
      : '<polygon points="6 4 20 12 6 20 6 4"/>';
  }

  const fsIconMarkup = isPlaying 
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' 
    : '<polygon points="6 4 20 12 6 20 6 4"/>';

  if (fsPlayIcon) fsPlayIcon.innerHTML = fsIconMarkup;
  if (kPlayIcon) kPlayIcon.innerHTML = fsIconMarkup;

  const mKIconMarkup = isPlaying
    ? '<rect x="6" y="5" width="3" height="14"/><rect x="13" y="5" width="3" height="14"/>'
    : '<polygon points="7 5 17 12 7 19 7 5"/>';
  if (mKPlayIcon) mKPlayIcon.innerHTML = mKIconMarkup;
}

function nextTrack() {
  if (currentIndex + 1 < currentQueue.length) {
    playIndex(currentIndex + 1);
  } else if (typeof isWaveActive !== 'undefined' && isWaveActive) {
    startMyWave(currentQueue[currentIndex]?.id || "");
  } else if (appPrefs.similarTracks && currentQueue[currentIndex]) {
    showToast("Подбираем похожие треки...");
    appendSimilarTracksIfNeeded(currentQueue[currentIndex]).then(() => {
      if (currentIndex + 1 < currentQueue.length) {
        playIndex(currentIndex + 1);
      }
    });
  }
}

function prevTrack() {
  if (currentIndex - 1 >= 0) playIndex(currentIndex - 1);
}

audio.ontimeupdate = () => {
  if (!audio.duration) return;
  const percent = (audio.currentTime / audio.duration) * 100;
  updateProgressVisual(percent);

  const formattedCur = formatTime(audio.currentTime);
  const formattedDur = formatTime(audio.duration);

  document.getElementById('currentTime').innerText = formattedCur;
  document.getElementById('duration').innerText = formattedDur;

  if (fsCurrentTime) fsCurrentTime.innerText = formattedCur;
  if (fsDuration) fsDuration.innerText = formattedDur;

  if (kCurrentTime) kCurrentTime.innerText = formattedCur;
  if (kDuration) kDuration.innerText = formattedDur;

  if (mKCurrentTime) mKCurrentTime.innerText = formattedCur;
  if (mKDuration) mKDuration.innerText = formattedDur;

  updateKaraokeHighlight(audio.currentTime);
  
  const currentSec = Math.floor(audio.currentTime);

  // Каждую секунду прослушивания учитываем время в статистике
  if (currentSec !== lastPlaySecondMark && !audio.paused) {
    lastPlaySecondMark = currentSec;
    currentTrackPlayedSeconds++;

    if (!dotifyProfile.stats) {
      dotifyProfile.stats = { plays: 0, uniqueTracks: [], totalMinutes: 0 };
    }
    
    // Прибавляем секунду ко времени (в минутах)
    dotifyProfile.stats.totalMinutes = (dotifyProfile.stats.totalMinutes || 0) + (1 / 60);

    // Засчитываем прослушивание трека после 10 секунд
    if (currentTrackPlayedSeconds >= 10 && !currentTrackRecorded && currentQueue[currentIndex]) {
      currentTrackRecorded = true;
      const track = currentQueue[currentIndex];
      
      dotifyProfile.stats.plays = (dotifyProfile.stats.plays || 0) + 1;
      dotifyProfile.balance = (dotifyProfile.balance || 0) + 1;

      if (!dotifyProfile.stats.uniqueTracks) dotifyProfile.stats.uniqueTracks = [];
      if (!dotifyProfile.stats.uniqueTracks.includes(track.id)) {
        dotifyProfile.stats.uniqueTracks.push(track.id);
      }

      saveDotifyProfileToStorage();
    }
  }

  // Начисление XP за регулярное прослушивание
  if (currentSec > 0 && currentSec % 15 === 0 && currentSec !== lastXpGivenSecond) {
    lastXpGivenSecond = currentSec;
    addExperience(5);
  }

  if (currentSec % 5 === 0) {
    queueDatabaseSync();
  }
};

progressBar.oninput = () => {
  if (!audio.duration) return;
  const val = progressBar.value;
  audio.currentTime = (val / 100) * audio.duration;
  updateProgressVisual(val);
  queueDatabaseSync();
};

if (fsProgressBar) {
  fsProgressBar.oninput = () => {
    if (!audio.duration) return;
    const val = fsProgressBar.value;
    audio.currentTime = (val / 100) * audio.duration;
    updateProgressVisual(val);
    queueDatabaseSync();
  };
}

if (kProgressBar) {
  kProgressBar.oninput = () => {
    if (!audio.duration) return;
    const val = kProgressBar.value;
    audio.currentTime = (val / 100) * audio.duration;
    updateProgressVisual(val);
    queueDatabaseSync();
  };
}

if (mKProgressBar) {
  mKProgressBar.oninput = () => {
    if (!audio.duration) return;
    const val = mKProgressBar.value;
    audio.currentTime = (val / 100) * audio.duration;
    updateProgressVisual(val);
    queueDatabaseSync();
  };
}

volumeSlider.oninput = (e) => { 
  const val = parseFloat(e.target.value);
  audio.volume = val;
  updateVolumeVisual(val);
  queueDatabaseSync();
};

audio.onended = () => {
  // Если трек доиграл до конца, гарантированно фиксируем прослушивание
  if (!currentTrackRecorded && currentQueue[currentIndex]) {
    currentTrackRecorded = true;
    const track = currentQueue[currentIndex];
    if (!dotifyProfile.stats) dotifyProfile.stats = { plays: 0, uniqueTracks: [], totalMinutes: 0 };
    dotifyProfile.stats.plays = (dotifyProfile.stats.plays || 0) + 1;
    dotifyProfile.balance = (dotifyProfile.balance || 0) + 1;
    if (!dotifyProfile.stats.uniqueTracks) dotifyProfile.stats.uniqueTracks = [];
    if (!dotifyProfile.stats.uniqueTracks.includes(track.id)) {
      dotifyProfile.stats.uniqueTracks.push(track.id);
    }
    saveDotifyProfileToStorage();
  }
  nextTrack();
};

function formatTime(secs) {
  const min = Math.floor(secs / 60) || 0;
  const sec = Math.floor(secs % 60) || 0;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function restoreSavedState(state) {
  if (!state) return;

  if (state.volume !== undefined) {
    audio.volume = state.volume;
    updateVolumeVisual(state.volume);
  } else {
    updateVolumeVisual(1.0);
  }

  if (state.eqBands) {
    currentEqBands = state.eqBands;
    const sliders = document.querySelectorAll('.eq-slider');
    state.eqBands.forEach((b, i) => {
      if (sliders[i]) {
        sliders[i].value = b;
        document.getElementById(`eqVal${i}`).innerText = `${b > 0 ? '+' : ''}${b} dB`;
      }
    });
  }

  if (state.activePreset) {
    currentPreset = state.activePreset;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`btnPreset-${currentPreset}`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  if (appPrefs.restoreQueue && state.queue && state.queue.length > 0) {
    currentQueue = state.queue;
    currentIndex = state.queueIndex !== undefined ? state.queueIndex : 0;
  } else if (state.currentTrack) {
    currentQueue = [state.currentTrack];
    currentIndex = 0;
  }

  if (currentQueue[currentIndex]) {
    const track = currentQueue[currentIndex];
    syncTrackToUI(track);
    loadLyricsForCurrentTrack(track);
    loadCanvasForTrack(track);

    const q = appPrefs.audioQuality || "medium";
    resolveTrackAudioUrl(track.id, q).then(url => {
      audio.src = url;

      const onInitialLoad = () => {
        if (state.currentTime) {
          audio.currentTime = state.currentTime;
          const pct = (state.currentTime / (audio.duration || 1)) * 100;
          updateProgressVisual(pct);
          document.getElementById('currentTime').innerText = formatTime(state.currentTime);
          if (fsCurrentTime) fsCurrentTime.innerText = formatTime(state.currentTime);
          if (kCurrentTime) kCurrentTime.innerText = formatTime(state.currentTime);
        }
        if (appPrefs.autoPlay) {
          const p = audio.play();
          if (p) {
            p.then(() => setPlayState(true)).catch(() => setPlayState(false));
          }
        }
        audio.removeEventListener('loadedmetadata', onInitialLoad);
      };
      audio.addEventListener('loadedmetadata', onInitialLoad);
    });
  }
}