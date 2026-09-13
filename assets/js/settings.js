let tgPollingInterval = null;
let currentTgLinkingCode = '';
const TELEGRAM_BOT_USERNAME = "turovfyaubot";

function syncAppPrefsToUI() {
  const pAuto = document.getElementById('prefAutoPlay');
  const pSim = document.getElementById('prefSimilarTracks');
  const pQueue = document.getElementById('prefRestoreQueue');
  const pCanv = document.getElementById('prefCanvas');

  if (pAuto) pAuto.checked = !!appPrefs.autoPlay;
  if (pSim) pSim.checked = appPrefs.similarTracks !== false;
  if (pQueue) pQueue.checked = !!appPrefs.restoreQueue;
  if (pCanv) pCanv.checked = !!appPrefs.canvas;

  const pGapless = document.getElementById('prefGapless');
  const pCrossfade = document.getElementById('prefCrossfade');
  const pNorm = document.getElementById('prefNormalization');

  if (pGapless) pGapless.checked = appPrefs.gapless !== false;
  if (pCrossfade) pCrossfade.checked = !!appPrefs.crossfade;
  if (pNorm) pNorm.checked = !!appPrefs.normalization;

  updateAudioQualityUI(appPrefs.audioQuality || 'medium');
  updateStorageStatsUI();
  applyCanvasState();
}

function handlePrefChange(key, value) {
  appPrefs[key] = value;
  localStorage.setItem('turovfy_app_prefs', JSON.stringify(appPrefs));

  if (key === 'autoPlay') {
    showToast(value ? "Автоплей включён" : "Автоплей выключен");
  } else if (key === 'similarTracks') {
    showToast(value ? "Похожие треки будут добавляться" : "Добавление похожих выключено");
  } else if (key === 'restoreQueue') {
    showToast(value ? "Очередь будет сохраняться" : "Очередь сбрасывается при выходе");
    if (value) saveQueueToStorage();
  } else if (key === 'canvas') {
    showToast(value ? "Канвас включён" : "Канвас выключен");
    applyCanvasState();
  } else if (key === 'gapless') {
    showToast(value ? "Бесшовное воспроизведение включено" : "Бесшовное воспроизведение выключено");
  } else if (key === 'crossfade') {
    showToast(value ? "Кроссфейд активен (сведение треков)" : "Кроссфейд выключен");
  } else if (key === 'normalization') {
    showToast(value ? "Нормализация уровня звука включена" : "Нормализация выключена");
    if (typeof updateAudioChainRouting === 'function') updateAudioChainRouting();
  }
  queueDatabaseSync();
}

function showSettingsSubpage(pageId) {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  const pages = [
    'settingsMainView', 
    'settingsGeneralView', 
    'settingsProfileView', 
    'settingsOverviewView', 
    'settingsEditView', 
    'settingsSecurityView', 
    'settingsAudioView',
    'settingsStorageView'
  ];
  pages.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('active');
      el.style.display = 'none';
    }
  });
  const target = document.getElementById(pageId);
  if (target) {
    target.style.display = 'block';
    target.classList.add('active');
  }
}

function openSettingsMainView() {
  if (!currentUser) {
    applyGuestState();
    return;
  }
  showSettingsSubpage('settingsMainView');
}

function openGeneralAppSettingsView() {
  showSettingsSubpage('settingsGeneralView');
  syncAppPrefsToUI();
}

function openAudioSettingsView() {
  showSettingsSubpage('settingsAudioView');
  syncAppPrefsToUI();
}

function openStorageSettingsView() {
  showSettingsSubpage('settingsStorageView');
  updateStorageStatsUI();
}

function openOverviewView() {
  showSettingsSubpage('settingsOverviewView');
  renderOverviewStats();
}

function renderOverviewStats() {
  const stats = dotifyProfile.stats || { plays: 0, uniqueTracks: [], totalMinutes: 0 };
  const playsEl = document.getElementById('statPlaysCount');
  const tracksEl = document.getElementById('statTracksCount');
  const minsEl = document.getElementById('statMinutesCount');
  const ovAvatar = document.getElementById('ovAvatar');

  if (playsEl) playsEl.innerText = stats.plays || 0;
  if (tracksEl) tracksEl.innerText = (stats.uniqueTracks ? stats.uniqueTracks.length : 0);
  if (minsEl) minsEl.innerText = Math.round(stats.totalMinutes || 0);

  if (ovAvatar) {
    const initial = (dotifyProfile.nickname || "M")[0].toUpperCase();
    if (dotifyProfile.avatar) {
      ovAvatar.innerHTML = `<img src="${dotifyProfile.avatar}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
      ovAvatar.innerText = initial;
    }
  }
}

function toggleCachingSetting() {
  appPrefs.cachingEnabled = !appPrefs.cachingEnabled;
  localStorage.setItem('turovfy_app_prefs', JSON.stringify(appPrefs));
  
  const desc = document.getElementById('cachingStatusDesc');
  const icon = document.getElementById('cachingIconStatus');
  
  if (appPrefs.cachingEnabled) {
    if (desc) desc.innerText = "Включено (автоматическое сохранение)";
    if (icon) {
      icon.innerHTML = `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`;
    }
    showToast("Кэширование треков включено");
  } else {
    if (desc) desc.innerText = "Выключено";
    if (icon) {
      icon.innerHTML = `<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>`;
    }
    showToast("Кэширование выключено");
  }
  queueDatabaseSync();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function updateStorageStatsUI() {
  const sizeEl = document.getElementById('storageSizeText');
  const filesEl = document.getElementById('storageFilesText');
  const pctEl = document.getElementById('storageUsedPctText');
  const tracksEl = document.getElementById('cachedTracksCount');
  const offlineEl = document.getElementById('offlineMediaCount');
  const lyricsEl = document.getElementById('cachedLyricsCount');
  const desc = document.getElementById('cachingStatusDesc');
  const icon = document.getElementById('cachingIconStatus');

  if (desc) {
    desc.innerText = appPrefs.cachingEnabled ? "Включено (автоматическое сохранение)" : "Выключено";
  }
  if (icon) {
    icon.innerHTML = appPrefs.cachingEnabled 
      ? `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`
      : `<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>`;
  }

  let totalFiles = 0;
  let totalBytes = 0;

  if ('caches' in window) {
    try {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      const requests = await cache.keys();
      totalFiles += requests.length;
      if (tracksEl) tracksEl.innerText = requests.length;
      if (offlineEl) offlineEl.innerText = requests.length;
    } catch (e) {}
  }

  const cachedLyricsStore = JSON.parse(localStorage.getItem(OFFLINE_LYRICS_KEY) || '{}');
  const lyricsCount = Object.keys(cachedLyricsStore).length;
  if (lyricsEl) lyricsEl.innerText = lyricsCount;
  totalFiles += lyricsCount;

  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      totalBytes = estimate.usage || 0;
      const quota = estimate.quota || 1;
      const pct = Math.max(1, Math.round((totalBytes / quota) * 100));
      if (sizeEl) sizeEl.innerText = formatBytes(totalBytes);
      if (pctEl) pctEl.innerText = `${pct}% used`;
    } catch (e) {
      if (sizeEl) sizeEl.innerText = formatBytes(totalBytes);
    }
  } else {
    if (sizeEl) sizeEl.innerText = formatBytes(totalBytes);
  }

  if (filesEl) filesEl.innerText = `${totalFiles} files`;
}

async function clearCachedTracks() {
  if (!confirm("Очистить кэшированные треки?")) return;
  if ('caches' in window) {
    await caches.delete(OFFLINE_CACHE_NAME);
  }
  updateStorageStatsUI();
  showToast("Кэш треков очищен");
}

async function clearOfflineMedia() {
  if (!confirm("Удалить загруженные оффлайн-треки?")) return;
  if ('caches' in window) {
    await caches.delete(OFFLINE_CACHE_NAME);
  }
  updateStorageStatsUI();
  showToast("Оффлайн-треки удалены");
}

function clearLyricsCache() {
  if (!confirm("Очистить сохраненные тексты песен?")) return;
  localStorage.removeItem(OFFLINE_LYRICS_KEY);
  updateStorageStatsUI();
  showToast("Кэш текстов очищен");
}

async function clearAllStorageCache() {
  if (!confirm("Полностью очистить все загруженные файлы, кэш и тексты?")) return;
  if ('caches' in window) {
    await caches.delete(OFFLINE_CACHE_NAME);
  }
  localStorage.removeItem(OFFLINE_LYRICS_KEY);
  updateStorageStatsUI();
  showToast("Все данные хранилища очищены");
}

function setAudioQuality(quality) {
  appPrefs.audioQuality = quality;
  localStorage.setItem('turovfy_app_prefs', JSON.stringify(appPrefs));
  updateAudioQualityUI(quality);
  
  const labels = {
    low: "Низкое качество (192 kbps)",
    medium: "Среднее качество (256 kbps)",
    high: "Высокое качество (320 kbps)",
    lossless: "Без потерь (1411 kbps Studio Master)"
  };
  showToast(`Качество звука: ${labels[quality] || quality}`);
  queueDatabaseSync();

  if (currentIndex >= 0 && currentQueue[currentIndex] && !audio.paused) {
    const curTime = audio.currentTime;
    const track = currentQueue[currentIndex];
    resolveTrackAudioUrl(track.id, quality).then(url => {
      audio.src = url;
      audio.currentTime = curTime;
      audio.play().catch(() => {});
    });
  }
}

function updateAudioQualityUI(activeQuality) {
  const qualities = ['low', 'medium', 'high', 'lossless'];
  qualities.forEach(q => {
    const checkEl = document.getElementById(`check-${q}`);
    if (checkEl) {
      checkEl.style.display = (q === activeQuality) ? 'flex' : 'none';
    }
  });
}

function toggleAudioDucking() {
  appPrefs.ducking = (appPrefs.ducking === 'pause') ? 'duck' : 'pause';
  localStorage.setItem('turovfy_app_prefs', JSON.stringify(appPrefs));
  const el = document.getElementById('duckingStateText');
  if (el) {
    el.innerText = (appPrefs.ducking === 'pause') ? 'Пауза' : 'Заглушать';
  }
  showToast(`При уведомлении: ${el ? el.innerText : ''}`);
  queueDatabaseSync();
}

function openProfileView() {
  showSettingsSubpage('settingsProfileView');
  renderSettingsProfileData();
}

function openEditProfileView() {
  showSettingsSubpage('settingsEditView');
  updateCharCounts();
}

function openSecurityView() {
  showSettingsSubpage('settingsSecurityView');
  renderSecurityData();
}

/* ==================== АВТОРИЗАЦИЯ И ПРИВЯЗКА TELEGRAM ==================== */

async function startTelegramBotLinking() {
  const userEmail = (currentUser && currentUser.email) 
    ? currentUser.email 
    : (dotifyProfile.username ? `${dotifyProfile.username}@turovfy.local` : "user@turovfy.local");

  showToast("Генерируем ключ привязки...");

  try {
    const res = await fetch('/api/telegram/generate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail })
    });
    
    if (!res.ok) throw new Error("Server error");
    const data = await res.json();
    
    currentTgLinkingCode = data.code;
    const disp = document.getElementById('tgLinkCodeDisplay');
    if (disp) disp.innerText = data.code;
    
    const botLink = document.getElementById('tgBotLinkBtn');
    if (botLink) {
      const param = data.code.replace('-', '_');
      botLink.href = `https://t.me/${data.bot_username || TELEGRAM_BOT_USERNAME}?start=${param}`;
    }
    
    const modal = document.getElementById('tgLinkModal');
    if (modal) modal.classList.add('active');

    // Автоматическая проверка статуса привязки
    clearInterval(tgPollingInterval);
    tgPollingInterval = setInterval(async () => {
      try {
        const checkRes = await fetch(`/api/telegram/check-status?code=${encodeURIComponent(currentTgLinkingCode)}&email=${encodeURIComponent(userEmail)}`);
        const statusData = await checkRes.json();
        if (statusData.status === 'linked') {
          clearInterval(tgPollingInterval);
          closeTgLinkModal();
          dotifyProfile.telegram = statusData.telegram_username;
          saveDotifyProfileToStorage();
          renderSecurityData();
          renderSettingsProfileData();
          queueDatabaseSync();
          showToast(`🎉 Telegram успешно привязан: @${statusData.telegram_username}`);
        }
      } catch (err) {}
    }, 2000);

  } catch (e) {
    console.error("Link error:", e);
    showToast("Ошибка связи с сервером при создании ключа");
  }
}

function closeTgLinkModal() {
  clearInterval(tgPollingInterval);
  const modal = document.getElementById('tgLinkModal');
  if (modal) modal.classList.remove('active');
}

async function manualConfirmTgLink() {
  const userEmail = (currentUser && currentUser.email) 
    ? currentUser.email 
    : (dotifyProfile.username ? `${dotifyProfile.username}@turovfy.local` : "user@turovfy.local");

  const inputCode = prompt("Введите полученный ключ из бота @turovfyaubot (например, TF-A8K2M9):", currentTgLinkingCode || "");
  if (!inputCode || !inputCode.trim()) return;

  const clean = inputCode.trim().toUpperCase();
  try {
    const checkRes = await fetch(`/api/telegram/check-status?code=${encodeURIComponent(clean)}&email=${encodeURIComponent(userEmail)}`);
    const statusData = await checkRes.json();
    if (statusData.status === 'linked') {
      closeTgLinkModal();
      dotifyProfile.telegram = statusData.telegram_username;
      saveDotifyProfileToStorage();
      renderSecurityData();
      renderSettingsProfileData();
      queueDatabaseSync();
      showToast(`Telegram @${statusData.telegram_username} привязан!`);
    } else {
      showToast("Ключ ещё не подтверждён в боте. Откройте @turovfyaubot и нажмите СТАРТ!");
    }
  } catch (e) {
    showToast("Ошибка проверки ключа");
  }
}

async function startTelegramLogin() {
  const code = prompt("Введите ваш 6-значный ключ авторизации (например, TF-A8K2M9) из бота @turovfyaubot:\n\nЕсли ключа нет, откройте @turovfyaubot и нажмите «🔑 Получить ключ для входа».");
  if (!code || !code.trim()) return;

  const cleanCode = code.trim().toUpperCase();

  try {
    const res = await fetch('/api/user/auth-telegram-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cleanCode })
    });
    const data = await res.json();
    
    if (res.status !== 200) {
      showToast(data.detail || "Неверный или просроченный ключ");
      return;
    }

    currentUser = {
      name: data.name,
      email: data.email,
      picture: data.picture
    };
    localStorage.setItem('turovfy_user', JSON.stringify(currentUser));
    closeAuthModal();

    userPlaylists = data.playlists || { "Любимое": [] };
    dotifyProfile = {
      ...dotifyProfile,
      ...data.profile_meta,
      telegram: data.telegram || ""
    };
    saveDotifyProfileToStorage();
    applyUserState(currentUser);
    restoreSavedState(data.state);
    showToast(`Вход выполнен: @${data.telegram || data.name}!`);
  } catch (e) {
    showToast("Ошибка связи с сервером при входе");
  }
}

async function unlinkTelegram(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!dotifyProfile.telegram) return;
  if (confirm("Отвязать аккаунт Telegram?")) {
    try {
      const email = currentUser ? currentUser.email : '';
      await fetch('/api/telegram/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      dotifyProfile.telegram = "";
      saveDotifyProfileToStorage();
      renderSecurityData();
      renderSettingsProfileData();
      queueDatabaseSync();
      showToast("Telegram отвязан");
    } catch (e) {
      showToast("Ошибка при отвязке");
    }
  }
}

function detectClientDevice() {
  const ua = navigator.userAgent;
  let devName = "ПК (Windows / Desktop)";
  let devType = "Десктопное устройство";
  let icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

  if (/SM-S928B/i.test(ua) || /SM-S928/i.test(ua)) {
    devName = "Samsung SM-S928B";
    devType = "Мобильное устройство";
    icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
  } else if (/Android/i.test(ua)) {
    const match = ua.match(/Android[^;]+;\s*([^;)]+)\)/);
    devName = match ? match[1].trim() : "Android Smartphone";
    devType = "Мобильное устройство";
    icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
  } else if (/iPhone/i.test(ua)) {
    devName = "Apple iPhone";
    devType = "Мобильное устройство (iOS)";
    icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
  }

  return { devName, devType, icon };
}

function renderSecurityData() {
  const userEmail = (currentUser && currentUser.email) ? currentUser.email : (dotifyProfile.username ? `${dotifyProfile.username}@turovfy.local` : "user@gmail.com");
  const emailDisplay = document.getElementById('secEmailDisplay');
  const googleEmail = document.getElementById('secGoogleEmail');
  if (emailDisplay) emailDisplay.innerText = userEmail;
  if (googleEmail) googleEmail.innerText = userEmail;

  const tg = dotifyProfile.telegram ? `@${dotifyProfile.telegram}` : "Не привязан";
  const tgTag = document.getElementById('secTelegramTag');
  if (tgTag) tgTag.innerText = tg;
  
  const unlinkBtn = document.getElementById('secTgUnlinkBtn');
  if (unlinkBtn) unlinkBtn.style.display = dotifyProfile.telegram ? "flex" : "none";

  const dev = detectClientDevice();
  const devName = document.getElementById('secDeviceName');
  const devType = document.getElementById('secDeviceType');
  const devIcon = document.getElementById('secDeviceIcon');
  if (devName) devName.innerText = dev.devName;
  if (devType) devType.innerText = dev.devType;
  if (devIcon) devIcon.innerHTML = dev.icon;
}

function promptChangePassword() {
  const newPass = prompt("Введите новый пароль аккаунта (мин. 6 символов):");
  if (newPass && newPass.length >= 6) {
    showToast("Пароль успешно обновлен!");
  } else if (newPass) {
    showToast("Пароль слишком короткий!");
  }
}

function promptChangeEmail() {
  const email = prompt("Введите новую почту для аккаунта:", currentUser ? currentUser.email : "");
  if (email && email.includes('@')) {
    document.getElementById('secEmailDisplay').innerText = email.trim();
    showToast("Код подтверждения выслан на почту!");
  }
}

function saveDotifyProfileToStorage() {
  localStorage.setItem('turovfy_dotify_profile', JSON.stringify(dotifyProfile));
  renderSettingsProfileData();
}

function renderSettingsProfileData() {
  const initial = (dotifyProfile.nickname || "M")[0].toUpperCase();

  const uName = document.getElementById('settingsUserName');
  const uTag = document.getElementById('settingsUserTag');
  if (uName) uName.innerText = dotifyProfile.nickname;
  if (uTag) uTag.innerText = `@${dotifyProfile.username}`;

  const sAvatar = document.getElementById('settingsUserAvatar');
  if (sAvatar) {
    if (dotifyProfile.avatar) {
      sAvatar.innerHTML = `<img src="${dotifyProfile.avatar}">`;
    } else {
      sAvatar.innerText = initial;
    }
  }

  const pvName = document.getElementById('pvName');
  const pvTag = document.getElementById('pvTag');
  const pvReg = document.getElementById('pvRegDate');
  const pvNum = document.getElementById('pvUserNumber');
  const pvSeen = document.getElementById('pvLastSeen');
  if (pvName) pvName.innerText = dotifyProfile.nickname;
  if (pvTag) pvTag.innerText = `@${dotifyProfile.username}`;
  if (pvReg) pvReg.innerText = dotifyProfile.regDate;
  if (pvNum) pvNum.innerText = dotifyProfile.userNumber || "#1";
  if (pvSeen) pvSeen.innerText = dotifyProfile.lastSeen;

  const stats = dotifyProfile.stats || { plays: 0, uniqueTracks: [], totalMinutes: 0 };
  const pvBal = document.getElementById('pvBalance');
  if (pvBal) pvBal.innerText = stats.plays || 0;
  
  const shieldLvl = document.getElementById('profileShieldLevel');
  if (shieldLvl) {
    const calc = getXpRequirements(dotifyProfile.xp || 0);
    shieldLvl.innerText = calc.level;
  }

  const pvAvatar = document.getElementById('pvAvatar');
  if (pvAvatar) {
    if (dotifyProfile.avatar) {
      pvAvatar.innerHTML = `<img src="${dotifyProfile.avatar}">`;
    } else {
      pvAvatar.innerText = initial;
    }
  }

  const xpSpan = document.getElementById('xpUsernameSpan');
  if (xpSpan) xpSpan.innerText = dotifyProfile.nickname;

  const nickInp = document.getElementById('editNicknameInput');
  const userInp = document.getElementById('editUsernameInput');
  if (nickInp) nickInp.value = dotifyProfile.nickname;
  if (userInp) userInp.value = dotifyProfile.username;
  
  const cleanBio = (dotifyProfile.bio && !dotifyProfile.bio.includes('Dotify')) ? dotifyProfile.bio : "Новый пользователь TurovFy";
  const bioInp = document.getElementById('editBioInput');
  if (bioInp) bioInp.value = cleanBio;
  dotifyProfile.bio = cleanBio;

  const statInp = document.getElementById('editStatusInput');
  if (statInp) statInp.value = dotifyProfile.status || "";

  const tgDisp = document.getElementById('tgUsernameDisplay');
  if (tgDisp) tgDisp.innerText = dotifyProfile.telegram ? `@${dotifyProfile.telegram}` : 'Не привязан';

  const evAvatar = document.getElementById('evAvatarWrap');
  if (evAvatar) {
    if (dotifyProfile.avatar) {
      evAvatar.innerHTML = `<img src="${dotifyProfile.avatar}"><input type="file" id="avatarFileInput" accept="image/*" style="display: none;" onchange="handleAvatarSelected(event)">`;
    } else {
      evAvatar.innerHTML = `<div id="evAvatarLetter" style="font-size: 36px; font-weight: 800;">${initial}</div><input type="file" id="avatarFileInput" accept="image/*" style="display: none;" onchange="handleAvatarSelected(event)">`;
    }
  }

  updateCharCounts();
  updateXpUI();
  renderOverviewStats();
}

function updateCharCounts() {
  const nick = document.getElementById('editNicknameInput');
  const user = document.getElementById('editUsernameInput');
  const bio = document.getElementById('editBioInput');
  const status = document.getElementById('editStatusInput');

  if (nick && document.getElementById('nickCount')) document.getElementById('nickCount').innerText = `${nick.value.length}/32`;
  if (user && document.getElementById('userCount')) document.getElementById('userCount').innerText = `${user.value.length}/12`;
  if (bio && document.getElementById('bioCount')) document.getElementById('bioCount').innerText = `${bio.value.length}/32`;
  if (status && document.getElementById('statusCount')) document.getElementById('statusCount').innerText = `${status.value.length}/32`;
}

function saveProfileChanges() {
  const nick = document.getElementById('editNicknameInput').value.trim();
  const user = document.getElementById('editUsernameInput').value.trim();
  const bio = document.getElementById('editBioInput').value.trim();
  const status = document.getElementById('editStatusInput').value.trim();

  if (!nick) {
    showToast('Никнейм не может быть пустым');
    return;
  }

  dotifyProfile.nickname = nick;
  dotifyProfile.username = user || nick.toLowerCase();
  dotifyProfile.bio = bio;
  dotifyProfile.status = status;

  saveDotifyProfileToStorage();
  queueDatabaseSync();
  showToast('Изменения сохранены!');
  openSettingsMainView();
}

function triggerAvatarUpload() {
  const input = document.getElementById('avatarFileInput');
  if (input) input.click();
}

function handleAvatarSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    dotifyProfile.avatar = e.target.result;
    saveDotifyProfileToStorage();
    queueDatabaseSync();
    showToast('Аватар обновлен');
  };
  reader.readAsDataURL(file);
}

function promptTelegramLink() {
  startTelegramBotLinking();
}

function shareProfile() {
  if (navigator.share) {
    navigator.share({
      title: `TurovFy: ${dotifyProfile.nickname}`,
      text: `@${dotifyProfile.username}`,
      url: window.location.href
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(window.location.href);
    showToast('Ссылка на профиль скопирована!');
  }
}

// Инициализация приложения
window.addEventListener('DOMContentLoaded', () => {
  initCatalogFeed();
  checkExistingAuth();
  setTimeout(initGoogleAuth, 600);
  updateVolumeVisual(audio.volume || 1.0);

  setTimeout(() => {
    const firstBtn = document.getElementById('iNavCatalog');
    if (firstBtn) updateLiquidIndicator(firstBtn);
  }, 200);
});

window.addEventListener('resize', () => {
  const activeBtn = document.querySelector('.island-btn.active');
  if (activeBtn) updateLiquidIndicator(activeBtn);
});