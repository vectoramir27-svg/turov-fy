const GOOGLE_CLIENT_ID = "626469255866-clqnscvcv71s9baj7rs32u49ekmmertk.apps.googleusercontent.com";

// =========================================================================
// ВРЕМЕННЫЙ ТУННЕЛЬ ДЛЯ МОБИЛЬНОГО ПРИЛОЖЕНИЯ (Cloudflare Tunnel URL)
// Как только получишь ссылку в консоли Cloudflare, вставь её сюда вместо пустой строки:
// Пример: const API_BASE_URL = "https://your-tunnel-name.trycloudflare.com";
// =========================================================================
const API_BASE_URL = ""; 

// Глобальные переменные состояния
let currentUser = null;
let toastTimeout = null;
let syncDebounce = null;
let userPlaylists = { "Любимое": [] };
let lastXpGivenSecond = -1;

let userSearchHistory = JSON.parse(localStorage.getItem('turovfy_searches') || '[]');
let dislikedTracks = new Set(JSON.parse(localStorage.getItem('turovfy_dislikes') || '[]'));

let appPrefs = JSON.parse(localStorage.getItem('turovfy_app_prefs') || JSON.stringify({
  autoPlay: false,
  similarTracks: true,
  restoreQueue: false,
  canvas: false,
  audioQuality: 'medium',
  gapless: true,
  crossfade: false,
  normalization: false,
  cachingEnabled: false
}));

let dotifyProfile = JSON.parse(localStorage.getItem('turovfy_dotify_profile') || JSON.stringify({
  nickname: "maestrov",
  username: "maestrov",
  bio: "Новый пользователь TurovFy",
  status: "",
  telegram: "",
  regDate: "11 сентября 2026 г.",
  userNumber: "#1",
  lastSeen: "11 сентября, 11:06",
  balance: 0,
  avatar: "",
  xp: 0,
  level: 1,
  stats: {
    plays: 0,
    uniqueTracks: [],
    totalMinutes: 0
  }
}));

if (!dotifyProfile.stats) {
  dotifyProfile.stats = { plays: 0, uniqueTracks: [], totalMinutes: 0 };
}

// DOM элементы общих модулей
const authModal = document.getElementById('authModal');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const liquidIndicator = document.getElementById('liquidIndicator');

function showToast(text) {
  clearTimeout(toastTimeout);
  toastMsg.innerText = text;
  toast.classList.add('show');
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2600);
}

// Прогрессивная система опыта: с каждым новым уровнем требуется больше XP
function getXpRequirements(currentTotalXp) {
  let level = 1;
  let accumulatedXp = 0;
  
  while (true) {
    const xpForNextLevel = 100 * level + 50 * (level - 1);
    if (currentTotalXp < accumulatedXp + xpForNextLevel) {
      return {
        level: level,
        currentInLevel: currentTotalXp - accumulatedXp,
        neededForNext: xpForNextLevel
      };
    }
    accumulatedXp += xpForNextLevel;
    level++;
  }
}

function addExperience(amount) {
  const oldCalc = getXpRequirements(dotifyProfile.xp || 0);
  dotifyProfile.xp = (dotifyProfile.xp || 0) + amount;
  const newCalc = getXpRequirements(dotifyProfile.xp);

  if (newCalc.level > oldCalc.level) {
    dotifyProfile.level = newCalc.level;
    showToast(`🎉 Поздравляем! Достигнут ${newCalc.level} уровень!`);
  }
  saveDotifyProfileToStorage();
  updateXpUI();
}

function updateXpUI() {
  const totalXp = dotifyProfile.xp || 0;
  const calc = getXpRequirements(totalXp);
  const pct = Math.min(100, Math.round((calc.currentInLevel / calc.neededForNext) * 100));
  
  const lvlBadge = document.getElementById('xpCurrentLevelBadge');
  const nxtBadge = document.getElementById('xpNextLevelBadge');
  const barFill = document.getElementById('xpBarFill');
  const progText = document.getElementById('xpProgressText');
  const shieldLvl = document.getElementById('profileShieldLevel');

  if (lvlBadge) lvlBadge.innerText = calc.level;
  if (nxtBadge) nxtBadge.innerText = calc.level + 1;
  if (shieldLvl) shieldLvl.innerText = calc.level;
  if (barFill) barFill.style.width = `${pct}%`;
  if (progText) progText.innerText = `${calc.currentInLevel} / ${calc.neededForNext} XP`;
}

function recordSearchQuery(query) {
  if (!query || query.length < 2) return;
  userSearchHistory = [query, ...userSearchHistory.filter(q => q !== query)].slice(0, 5);
  localStorage.setItem('turovfy_searches', JSON.stringify(userSearchHistory));
}

function queueDatabaseSync() {
  if (!currentUser) return;
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(async () => {
    const payload = {
      email: currentUser.email,
      playlists: userPlaylists,
      profile_meta: {
        ...dotifyProfile,
        appPrefs: appPrefs
      },
      state: {
        currentTrack: currentQueue[currentIndex] || null,
        queue: appPrefs.restoreQueue ? currentQueue : [],
        queueIndex: currentIndex,
        currentTime: audio.currentTime || 0,
        volume: audio.volume,
        eqBands: currentEqBands,
        activePreset: currentPreset
      }
    };
    try {
      const res = await fetch(`${API_BASE_URL}/api/user/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const ans = await res.json();
      if (ans.last_seen) {
        dotifyProfile.lastSeen = ans.last_seen;
        const lastSeenEl = document.getElementById('pvLastSeen');
        if (lastSeenEl) lastSeenEl.innerText = ans.last_seen;
      }
    } catch (e) {
      console.error("Ошибка синхронизации:", e);
    }
  }, 500);
}

function initGoogleAuth() {
  const btnSlot = document.getElementById("googleBtnSlot");
  if (!btnSlot) return;

  if (window.google && google.accounts && google.accounts.id) {
    try {
      google.accounts.id.cancel();
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });

      btnSlot.innerHTML = "";
      google.accounts.id.renderButton(
        btnSlot,
        { theme: "filled_black", size: "large", shape: "pill", width: 280, text: "continue_with" }
      );
    } catch (err) {
      console.warn("Google Auth инициализация:", err);
    }
  }
}

async function handleCredentialResponse(response) {
  const payload = parseJwt(response.credential);
  currentUser = {
    name: payload.name,
    email: payload.email,
    picture: payload.picture
  };
  localStorage.setItem('turovfy_user', JSON.stringify(currentUser));
  closeAuthModal();

  try {
    const res = await fetch(`${API_BASE_URL}/api/user/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentUser)
    });
    const dbData = await res.json();
    userPlaylists = dbData.playlists || { "Любимое": [] };
    
    dotifyProfile.userNumber = `#${dbData.id || 1}`;
    if (dbData.reg_date) dotifyProfile.regDate = dbData.reg_date;
    if (dbData.last_seen) dotifyProfile.lastSeen = dbData.last_seen;
    
    if (dbData.profile_meta && Object.keys(dbData.profile_meta).length > 0) {
      dotifyProfile.nickname = dbData.profile_meta.nickname || currentUser.name.split(' ')[0];
      dotifyProfile.username = dbData.profile_meta.username || currentUser.email.split('@')[0].toLowerCase();
      dotifyProfile.bio = (dbData.profile_meta.bio && !dbData.profile_meta.bio.includes('Dotify')) ? dbData.profile_meta.bio : "Новый пользователь TurovFy";
      dotifyProfile.status = dbData.profile_meta.status || "";
      dotifyProfile.telegram = dbData.profile_meta.telegram || "";
      dotifyProfile.balance = dbData.profile_meta.balance || 0;
      dotifyProfile.xp = dbData.profile_meta.xp || 0;
      dotifyProfile.level = dbData.profile_meta.level || 1;
      dotifyProfile.stats = dbData.profile_meta.stats || { plays: 0, uniqueTracks: [], totalMinutes: 0 };
      if (dbData.profile_meta.appPrefs) {
        appPrefs = { ...appPrefs, ...dbData.profile_meta.appPrefs };
        localStorage.setItem('turovfy_app_prefs', JSON.stringify(appPrefs));
      }
    } else {
      dotifyProfile.nickname = currentUser.name.split(' ')[0];
      dotifyProfile.username = currentUser.email.split('@')[0].toLowerCase();
      dotifyProfile.bio = "Новый пользователь TurovFy";
    }
    dotifyProfile.avatar = currentUser.picture;
    saveDotifyProfileToStorage();

    applyUserState(currentUser);
    restoreSavedState(dbData.state);
    syncAppPrefsToUI();
    showToast(`Добро пожаловать, ${dotifyProfile.nickname}!`);
  } catch (e) {
    console.error("Ошибка соединения с БД:", e);
    showToast("Ошибка авторизации на сервере");
  }
}

function parseJwt(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
  return JSON.parse(jsonPayload);
}

async function checkExistingAuth() {
  const saved = localStorage.getItem('turovfy_user');
  if (saved) {
    currentUser = JSON.parse(saved);
    try {
      const res = await fetch(`${API_BASE_URL}/api/user/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentUser)
      });
      const dbData = await res.json();
      userPlaylists = dbData.playlists || { "Любимое": [] };
      dotifyProfile.userNumber = `#${dbData.id || 1}`;
      if (dbData.reg_date) dotifyProfile.regDate = dbData.reg_date;
      if (dbData.last_seen) dotifyProfile.lastSeen = dbData.last_seen;
      if (dbData.profile_meta && Object.keys(dbData.profile_meta).length > 0) {
        dotifyProfile.nickname = dbData.profile_meta.nickname || dotifyProfile.nickname;
        dotifyProfile.username = dbData.profile_meta.username || dotifyProfile.username;
        dotifyProfile.bio = (dbData.profile_meta.bio && !dbData.profile_meta.bio.includes('Dotify')) ? dbData.profile_meta.bio : "Новый пользователь TurovFy";
        dotifyProfile.status = dbData.profile_meta.status || dotifyProfile.status;
        dotifyProfile.telegram = dbData.profile_meta.telegram || dotifyProfile.telegram;
        dotifyProfile.balance = dbData.profile_meta.balance || dotifyProfile.balance;
        dotifyProfile.xp = dbData.profile_meta.xp || 0;
        dotifyProfile.level = dbData.profile_meta.level || 1;
        dotifyProfile.stats = dbData.profile_meta.stats || { plays: 0, uniqueTracks: [], totalMinutes: 0 };
        if (dbData.profile_meta.appPrefs) {
          appPrefs = { ...appPrefs, ...dbData.profile_meta.appPrefs };
          localStorage.setItem('turovfy_app_prefs', JSON.stringify(appPrefs));
        }
      }
      saveDotifyProfileToStorage();
      applyUserState(currentUser);
      restoreSavedState(dbData.state);
    } catch (e) {
      console.error("Ошибка восстановления БД:", e);
      applyUserState(currentUser);
    }
  } else {
    applyGuestState();
  }
  renderSettingsProfileData();
  syncAppPrefsToUI();
}

function applyUserState(user) {
  const container = document.getElementById('authContainer');
  const avatarHtml = user.picture 
    ? `<img src="${user.picture}" class="user-avatar">` 
    : `<div class="user-avatar" style="background:var(--card-inner); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700;">${user.name[0]}</div>`;
  
  container.innerHTML = `
    <div class="auth-btn" style="padding: 4px 12px 4px 6px;" onclick="switchTab('settings')">
      ${avatarHtml}
      <span>${user.name.split(' ')[0]}</span>
    </div>
  `;

  document.getElementById('settingsGuestView').style.display = 'none';
  document.getElementById('settingsMainView').style.display = 'block';

  const sAuthBtn = document.getElementById('settingsAuthActionBtn');
  if (sAuthBtn) {
    sAuthBtn.innerText = 'Выйти из аккаунта Google';
    sAuthBtn.style.background = 'rgba(255, 69, 58, 0.2)';
    sAuthBtn.style.color = '#ff453a';
    sAuthBtn.onclick = logoutUser;
  }
  renderSettingsProfileData();
}

function applyGuestState() {
  currentUser = null;
  const container = document.getElementById('authContainer');
  container.innerHTML = `
    <button class="auth-btn" onclick="openAuthModal()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
      Войти
    </button>
  `;

  document.getElementById('settingsGuestView').style.display = 'flex';
  document.getElementById('settingsMainView').style.display = 'none';
  document.getElementById('settingsGeneralView').classList.remove('active');
  document.getElementById('settingsProfileView').classList.remove('active');
  document.getElementById('settingsEditView').classList.remove('active');
  document.getElementById('settingsSecurityView').classList.remove('active');
  const ovView = document.getElementById('settingsOverviewView');
  if (ovView) ovView.classList.remove('active');
}

function logoutUser() {
  localStorage.removeItem('turovfy_user');
  localStorage.removeItem('turovfy_dotify_profile');
  localStorage.removeItem('turovfy_saved_queue');
  applyGuestState();
  goToHome();
  showToast("Вы вышли из аккаунта");
}

function openAuthModal() { 
  authModal.classList.add('active'); 
  initGoogleAuth();
}
function closeAuthModal() { authModal.classList.remove('active'); }

function openXpModal() {
  updateXpUI();
  document.getElementById('xpModal').classList.add('active');
}
function closeXpModal() {
  document.getElementById('xpModal').classList.remove('active');
}

function updateLiquidIndicator(activeBtn) {
  if (!activeBtn || !liquidIndicator) return;
  const offsetLeft = activeBtn.offsetLeft;
  liquidIndicator.style.transform = `translateX(${offsetLeft}px)`;
}

function switchTab(tab) {
  if ((tab === 'playlists' || tab === 'settings') && !currentUser) {
    openAuthModal();
    return;
  }

  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.island-btn').forEach(b => b.classList.remove('active'));

  let activeBtn = null;

  if (tab === 'catalog') {
    document.getElementById('tabCatalog').classList.add('active');
    document.getElementById('tabNavCatalog')?.classList.add('active');
    activeBtn = document.getElementById('iNavCatalog');
  } else if (tab === 'playlists') {
    document.getElementById('tabPlaylists').classList.add('active');
    document.getElementById('tabNavPlaylists')?.classList.add('active');
    activeBtn = document.getElementById('iNavPlaylists');
    renderPlaylists();
  } else if (tab === 'eq') {
    document.getElementById('tabEq').classList.add('active');
    document.getElementById('tabNavEq')?.classList.add('active');
    activeBtn = document.getElementById('iNavEq');
    if (!audioCtx) setupEqualizer();
  } else if (tab === 'settings') {
    document.getElementById('tabSettings').classList.add('active');
    document.getElementById('tabNavSettings')?.classList.add('active');
    activeBtn = document.getElementById('iNavSettings');
    openSettingsMainView();
  }

  if (activeBtn) {
    activeBtn.classList.add('active');
    updateLiquidIndicator(activeBtn);
  }
}

function goToHome() {
  switchTab('catalog');
  isWaveActive = false;
  if (typeof waveCard !== 'undefined' && waveCard) waveCard.classList.remove('playing');
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  if (typeof resetSearchDisplay === 'function') resetSearchDisplay();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (typeof closeFullscreenPlayer === 'function') closeFullscreenPlayer();
    if (typeof isKaraokeOpen !== 'undefined' && isKaraokeOpen && typeof toggleKaraoke === 'function') toggleKaraoke();
    closeXpModal();
  }
});