(() => {
  const STORAGE_KEY = "focus-tomato-timer:v1";
  const DRIVE_FILE_NAME = "focus-tomato-timer-state.json";
  const GOOGLE_SYNC_SCOPE =
    "openid email profile https://www.googleapis.com/auth/drive.appdata";
  const SYNC_DEBOUNCE_MS = 1200;
  const googleConfig = window.FOCUS_TIMER_CONFIG || {};
  const googleClientId = String(googleConfig.googleClientId || "").trim();

  const defaults = {
    settings: {
      workMinutes: 25,
      shortMinutes: 5,
      longMinutes: 15,
      longEvery: 4,
      autoLoop: false,
      soundEnabled: true,
      notifyEnabled: false,
    },
    history: [],
    roundCount: 0,
    updatedAt: 0,
  };

  const modeMeta = {
    work: {
      label: "工作时间",
      title: "工作",
      setting: "workMinutes",
      notification: "番茄时间完成",
      nextText: "休息一下",
    },
    shortBreak: {
      label: "短休息",
      title: "短休息",
      setting: "shortMinutes",
      notification: "短休息结束",
      nextText: "回到工作",
    },
    longBreak: {
      label: "长休息",
      title: "长休息",
      setting: "longMinutes",
      notification: "长休息结束",
      nextText: "回到工作",
    },
  };

  const statusText = {
    idle: "准备开始",
    running: "进行中",
    paused: "已暂停",
  };

  const resultText = {
    completed: "完成",
    running: "进行中",
    paused: "暂停",
    stopped: "停止",
    skipped: "跳过",
  };

  const elements = {
    body: document.body,
    statusPill: document.querySelector("#statusPill"),
    modeTabs: [...document.querySelectorAll("[data-mode]")],
    modeLabel: document.querySelector("#modeLabel"),
    timeReadout: document.querySelector("#timeReadout"),
    timerRing: document.querySelector("#timerRing"),
    currentTask: document.querySelector("#currentTask"),
    taskInput: document.querySelector("#taskInput"),
    primaryButton: document.querySelector("#primaryButton"),
    stopButton: document.querySelector("#stopButton"),
    skipButton: document.querySelector("#skipButton"),
    todayCount: document.querySelector("#todayCount"),
    todayMinutes: document.querySelector("#todayMinutes"),
    roundCount: document.querySelector("#roundCount"),
    workMinutes: document.querySelector("#workMinutes"),
    shortMinutes: document.querySelector("#shortMinutes"),
    longMinutes: document.querySelector("#longMinutes"),
    longEvery: document.querySelector("#longEvery"),
    autoLoop: document.querySelector("#autoLoop"),
    soundEnabled: document.querySelector("#soundEnabled"),
    notifyEnabled: document.querySelector("#notifyEnabled"),
    historyList: document.querySelector("#historyList"),
    clearHistory: document.querySelector("#clearHistory"),
    syncBadge: document.querySelector("#syncBadge"),
    accountAvatar: document.querySelector("#accountAvatar"),
    accountName: document.querySelector("#accountName"),
    accountEmail: document.querySelector("#accountEmail"),
    accountId: document.querySelector("#accountId"),
    googleButtonHost: document.querySelector("#googleButtonHost"),
    googleSignIn: document.querySelector("#googleSignIn"),
    syncNow: document.querySelector("#syncNow"),
    googleSignOut: document.querySelector("#googleSignOut"),
    syncNote: document.querySelector("#syncNote"),
  };

  const store = loadStore();
  const authState = {
    configured: isGoogleConfigured(),
    ready: false,
    tokenClient: null,
    accessToken: "",
    tokenExpiresAt: 0,
    user: null,
    driveFileId: "",
    syncing: false,
    syncStatus: "未登录",
    syncTone: "",
    retryCount: 0,
    signInButtonRendered: false,
  };
  let audioContext;
  let tickerId;
  let autoStartId;
  let syncTimerId;

  const state = {
    mode: "work",
    status: "idle",
    totalSeconds: getDurationSeconds("work"),
    remainingSeconds: getDurationSeconds("work"),
    endAt: 0,
    activeId: null,
  };

  function loadStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") {
        return cloneDefaults();
      }

      return normalizeStore(saved);
    } catch {
      return cloneDefaults();
    }
  }

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaults));
  }

  function normalizeStore(value) {
    const source = value && typeof value === "object" ? value : {};
    const history = Array.isArray(source.history)
      ? source.history
          .filter((item) => item && typeof item === "object" && item.startedAt)
          .map(normalizeHistoryItem)
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, 100)
      : [];

    return {
      settings: {
        ...defaults.settings,
        ...(source.settings || {}),
      },
      history,
      roundCount: Number.isFinite(source.roundCount) ? source.roundCount : 0,
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
    };
  }

  function normalizeHistoryItem(item) {
    const startedAt = Number(item.startedAt) || Date.now();
    const endedAt = item.endedAt ? Number(item.endedAt) : null;

    return {
      id: String(item.id || startedAt),
      mode: modeMeta[item.mode] ? item.mode : "work",
      title: String(item.title || "专注任务"),
      startedAt,
      endedAt,
      durationSeconds: Number(item.durationSeconds) || defaults.settings.workMinutes * 60,
      actualSeconds: Number(item.actualSeconds) || 0,
      status: resultText[item.status] ? item.status : "completed",
      updatedAt: Number(item.updatedAt) || endedAt || startedAt,
    };
  }

  function saveStore(options = {}) {
    const { sync = true, touch = true } = options;
    if (touch) {
      store.updatedAt = Date.now();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    if (sync) {
      scheduleCloudSync();
    }
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function getDurationSeconds(mode) {
    return store.settings[modeMeta[mode].setting] * 60;
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, totalSeconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;

    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function formatClock(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function dateKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function renderIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function renderSettings() {
    elements.workMinutes.value = store.settings.workMinutes;
    elements.shortMinutes.value = store.settings.shortMinutes;
    elements.longMinutes.value = store.settings.longMinutes;
    elements.longEvery.value = store.settings.longEvery;
    elements.autoLoop.checked = store.settings.autoLoop;
    elements.soundEnabled.checked = store.settings.soundEnabled;
    elements.notifyEnabled.checked = store.settings.notifyEnabled;
  }

  function renderTimer() {
    const elapsed = state.totalSeconds - state.remainingSeconds;
    const progress = state.totalSeconds > 0 ? (elapsed / state.totalSeconds) * 100 : 0;
    const activeTask = getActiveTaskTitle();

    elements.body.dataset.activeMode = state.mode;
    elements.modeLabel.textContent = modeMeta[state.mode].label;
    elements.timeReadout.textContent = formatTime(state.remainingSeconds);
    elements.timerRing.style.setProperty("--progress", `${Math.min(100, Math.max(0, progress))}%`);
    elements.statusPill.textContent = statusText[state.status];
    elements.currentTask.textContent =
      state.status === "idle" ? getIdleTaskText() : activeTask;

    elements.modeTabs.forEach((tab) => {
      const isActive = tab.dataset.mode === state.mode;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.disabled = state.status !== "idle";
    });

    if (state.status === "running") {
      elements.primaryButton.innerHTML = '<i data-lucide="pause" aria-hidden="true"></i><span>暂停</span>';
    } else if (state.status === "paused") {
      elements.primaryButton.innerHTML = '<i data-lucide="play" aria-hidden="true"></i><span>继续</span>';
    } else {
      elements.primaryButton.innerHTML = '<i data-lucide="play" aria-hidden="true"></i><span>开始</span>';
    }

    elements.stopButton.disabled = state.status === "idle";
    document.title =
      state.status === "idle"
        ? "番茄专注钟"
        : `${formatTime(state.remainingSeconds)} - ${modeMeta[state.mode].title}`;

    renderIcons();
  }

  function getIdleTaskText() {
    if (state.mode === "work") {
      return elements.taskInput.value.trim() || "选择任务后开始专注";
    }
    return modeMeta[state.mode].title;
  }

  function getActiveTaskTitle() {
    const active = store.history.find((item) => item.id === state.activeId);
    if (active) {
      return active.title;
    }
    return state.mode === "work"
      ? elements.taskInput.value.trim() || "专注任务"
      : modeMeta[state.mode].title;
  }

  function renderStats() {
    const today = dateKey(Date.now());
    const completedToday = store.history.filter(
      (item) =>
        item.mode === "work" &&
        item.status === "completed" &&
        item.endedAt &&
        dateKey(item.endedAt) === today,
    );

    const minutes = completedToday.reduce(
      (sum, item) => sum + Math.round((item.actualSeconds || item.durationSeconds) / 60),
      0,
    );

    elements.todayCount.textContent = String(completedToday.length);
    elements.todayMinutes.textContent = String(minutes);
    elements.roundCount.textContent = String(store.roundCount);
  }

  function renderHistory() {
    const items = store.history.slice(0, 20);

    if (items.length === 0) {
      elements.historyList.innerHTML = '<li class="empty-state">还没有任务记录</li>';
      return;
    }

    elements.historyList.innerHTML = items
      .map((item) => {
        const started = formatClock(item.startedAt);
        const ended = item.endedAt ? formatClock(item.endedAt) : "未结束";
        const minutes = Math.max(1, Math.round((item.durationSeconds || 60) / 60));
        const title = escapeHtml(item.title);
        const status = resultText[item.status] || item.status;

        return `
          <li class="history-item">
            <div class="history-title">
              <span>${title}</span>
              <span class="badge ${item.status}">${status}</span>
            </div>
            <div class="history-meta">
              <span>${modeMeta[item.mode]?.title || "番茄"}</span>
              <span>${minutes} 分钟</span>
              <span>${started} - ${ended}</span>
            </div>
          </li>
        `;
      })
      .join("");
  }

  function renderAuth() {
    const badgeTone = authState.syncTone ? ` ${authState.syncTone}` : "";
    elements.syncBadge.className = `sync-badge${badgeTone}`;
    elements.syncBadge.textContent = authState.syncStatus;

    if (!authState.configured) {
      elements.accountAvatar.textContent = "G";
      elements.accountName.textContent = "需要配置 Google Client ID";
      elements.accountEmail.textContent = "当前仅保存到此浏览器";
      elements.accountId.hidden = true;
      elements.googleButtonHost.hidden = true;
      elements.googleSignIn.disabled = true;
      elements.googleSignIn.hidden = false;
      elements.googleSignIn.innerHTML =
        '<i data-lucide="lock-keyhole" aria-hidden="true"></i><span>未配置登录</span>';
      elements.syncNow.disabled = true;
      elements.googleSignOut.hidden = true;
      elements.syncNote.textContent =
        "在 config.js 填入 Google OAuth Web Client ID 后，登录和云端同步才会启用。";
      renderIcons();
      return;
    }

    if (!authState.ready) {
      elements.accountAvatar.textContent = "G";
      elements.accountName.textContent = "Google 登录加载中";
      elements.accountEmail.textContent = "正在准备登录组件";
      elements.accountId.hidden = true;
      elements.googleButtonHost.hidden = true;
      elements.googleSignIn.disabled = true;
      elements.googleSignIn.hidden = false;
      elements.googleSignIn.innerHTML =
        '<i data-lucide="loader-circle" aria-hidden="true"></i><span>加载中</span>';
      elements.syncNow.disabled = true;
      elements.googleSignOut.hidden = true;
      elements.syncNote.textContent = "Google Identity Services 加载完成后即可登录。";
      renderIcons();
      return;
    }

    if (!authState.user) {
      elements.accountAvatar.textContent = "G";
      elements.accountName.textContent = "本地记录";
      elements.accountEmail.textContent = "登录后同步到 Google Drive";
      elements.accountId.hidden = true;
      elements.googleButtonHost.hidden = false;
      elements.googleSignIn.disabled = false;
      elements.googleSignIn.hidden = authState.signInButtonRendered;
      elements.googleSignIn.innerHTML =
        '<i data-lucide="log-in" aria-hidden="true"></i><span>使用 Google 登录</span>';
      elements.syncNow.disabled = true;
      elements.googleSignOut.hidden = true;
      elements.syncNote.textContent =
        "点击 Google 登录按钮后选择账号，并授权 Drive appData 用于保存设置和历史。";
      renderIcons();
      return;
    }

    elements.accountName.textContent = authState.user.name || "Google 用户";
    elements.accountEmail.textContent = authState.user.email || "已登录";
    elements.accountId.textContent = authState.user.sub ? `Google ID: ${authState.user.sub}` : "";
    elements.accountId.hidden = !authState.user.sub;
    if (authState.user.picture) {
      elements.accountAvatar.innerHTML = `<img src="${escapeHtml(authState.user.picture)}" alt="" />`;
    } else {
      elements.accountAvatar.textContent = getInitial(authState.user.name || authState.user.email);
    }
    elements.googleButtonHost.hidden = true;
    elements.googleSignIn.disabled = authState.syncing;
    elements.googleSignIn.hidden = false;
    elements.googleSignIn.innerHTML =
      '<i data-lucide="key-round" aria-hidden="true"></i><span>授权同步</span>';
    elements.syncNow.disabled = authState.syncing || !authState.accessToken;
    elements.googleSignOut.hidden = false;
    elements.syncNote.textContent = authState.syncing
      ? "正在同步 Google Drive appData 中的专注记录。"
      : "已登录。设置和任务历史会与该 Google ID 关联并同步。";
    renderIcons();
  }

  function render() {
    renderTimer();
    renderStats();
    renderHistory();
    renderAuth();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return map[char];
    });
  }

  function getInitial(value) {
    const text = String(value || "G").trim();
    return text ? text.slice(0, 1).toUpperCase() : "G";
  }

  function selectMode(mode) {
    if (!modeMeta[mode] || state.status !== "idle") {
      return;
    }
    clearTimeout(autoStartId);
    state.mode = mode;
    state.totalSeconds = getDurationSeconds(mode);
    state.remainingSeconds = state.totalSeconds;
    render();
  }

  function isGoogleConfigured() {
    return Boolean(
      googleClientId &&
        !googleClientId.includes("YOUR_") &&
        googleClientId.endsWith(".apps.googleusercontent.com"),
    );
  }

  function initGoogleAuth() {
    if (!authState.configured) {
      authState.syncStatus = "未配置";
      authState.syncTone = "error";
      renderAuth();
      return;
    }

    if (window.google?.accounts?.oauth2 && window.google?.accounts?.id) {
      authState.ready = true;
      authState.syncStatus = "未登录";
      authState.syncTone = "";
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleCredentialResponse,
        cancel_on_tap_outside: true,
      });
      authState.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: GOOGLE_SYNC_SCOPE,
        callback: (response) => {
          handleTokenResponse(response);
        },
        error_callback: () => {
          setSyncStatus("登录失败", "error");
        },
      });
      renderGoogleSignInButton();
      renderAuth();
      return;
    }

    authState.retryCount += 1;
    if (authState.retryCount > 50) {
      setSyncStatus("登录加载失败", "error");
      return;
    }

    setTimeout(initGoogleAuth, 200);
  }

  function renderGoogleSignInButton() {
    if (authState.signInButtonRendered || !elements.googleButtonHost) {
      return;
    }

    elements.googleButtonHost.innerHTML = "";
    elements.googleButtonHost.hidden = false;
    window.google.accounts.id.renderButton(elements.googleButtonHost, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: 320,
    });
    authState.signInButtonRendered = true;
  }

  function handleCredentialResponse(response) {
    if (!response?.credential) {
      setSyncStatus("登录失败", "error");
      return;
    }

    try {
      const profile = decodeJwtPayload(response.credential);
      authState.user = {
        sub: profile.sub || "",
        name: profile.name || profile.email || "Google 用户",
        email: profile.email || "",
        picture: profile.picture || "",
      };
      setSyncStatus("等待授权", "syncing");
      requestGoogleAccessToken("consent");
    } catch (error) {
      console.error(error);
      setSyncStatus("登录失败", "error");
    }
  }

  function decodeJwtPayload(token) {
    const payload = token.split(".")[1];
    if (!payload) {
      throw new Error("Google credential is missing a payload");
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function signInWithGoogle() {
    if (!authState.configured || !authState.tokenClient) {
      setSyncStatus("未配置", "error");
      return;
    }

    setSyncStatus("等待授权", "syncing");
    requestGoogleAccessToken(authState.accessToken ? "" : "consent");
  }

  function requestGoogleAccessToken(prompt) {
    authState.tokenClient.requestAccessToken({
      prompt,
    });
  }

  async function handleTokenResponse(response) {
    if (!response || response.error || !response.access_token) {
      setSyncStatus("登录失败", "error");
      return;
    }

    authState.accessToken = response.access_token;
    authState.tokenExpiresAt = Date.now() + ((response.expires_in || 3600) - 60) * 1000;

    try {
      setSyncStatus("读取账号", "syncing");
      authState.user = await fetchGoogleProfile();
      renderAuth();
      await syncWithDrive({ mergeRemote: true });
    } catch (error) {
      console.error(error);
      setSyncStatus("同步失败", "error");
    }
  }

  async function fetchGoogleProfile() {
    const response = await googleFetch("https://www.googleapis.com/oauth2/v3/userinfo");
    const profile = await response.json();

    return {
      sub: profile.sub || "",
      name: profile.name || profile.email || "Google 用户",
      email: profile.email || "",
      picture: profile.picture || "",
    };
  }

  function setSyncStatus(status, tone = "") {
    authState.syncStatus = status;
    authState.syncTone = tone;
    renderAuth();
  }

  function scheduleCloudSync() {
    if (!authState.user || !authState.accessToken) {
      return;
    }

    clearTimeout(syncTimerId);
    syncTimerId = setTimeout(() => {
      syncWithDrive({ mergeRemote: false }).catch((error) => {
        console.error(error);
        setSyncStatus("同步失败", "error");
      });
    }, SYNC_DEBOUNCE_MS);
  }

  async function syncWithDrive(options = {}) {
    const { mergeRemote = false } = options;
    if (!authState.user || !authState.accessToken) {
      return;
    }

    if (Date.now() > authState.tokenExpiresAt) {
      authState.accessToken = "";
      setSyncStatus("需重新登录", "error");
      return;
    }

    if (authState.syncing) {
      return;
    }

    authState.syncing = true;
    setSyncStatus("同步中", "syncing");

    try {
      if (mergeRemote) {
        const remoteStore = await readRemoteStore();
        if (remoteStore) {
          mergeRemoteStore(remoteStore);
          saveStore({ sync: false, touch: false });
          renderSettings();
          render();
        }
      } else if (!authState.driveFileId) {
        await findRemoteStoreFile();
      }

      await uploadStoreToDrive();
      setSyncStatus(`已同步 ${formatClock(Date.now())}`, "ready");
    } finally {
      authState.syncing = false;
      renderAuth();
    }
  }

  async function readRemoteStore() {
    const file = await findRemoteStoreFile();
    if (!file) {
      return null;
    }

    authState.driveFileId = file.id;
    const response = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    );
    return response.json();
  }

  async function findRemoteStoreFile() {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("spaces", "appDataFolder");
    url.searchParams.set("q", `name = '${DRIVE_FILE_NAME}'`);
    url.searchParams.set("fields", "files(id,name,modifiedTime)");
    url.searchParams.set("pageSize", "10");

    const response = await googleFetch(url.toString());
    const data = await response.json();
    const file = Array.isArray(data.files) ? data.files[0] : null;
    authState.driveFileId = file?.id || "";
    return file;
  }

  function mergeRemoteStore(remoteValue) {
    const localStore = normalizeStore(store);
    const remoteStore = normalizeStore(remoteValue);
    const remoteIsNewer = remoteStore.updatedAt > localStore.updatedAt;
    const historyById = new Map();

    [...localStore.history, ...remoteStore.history].forEach((item) => {
      const existing = historyById.get(item.id);
      if (!existing || getHistoryTimestamp(item) >= getHistoryTimestamp(existing)) {
        historyById.set(item.id, item);
      }
    });

    store.settings = remoteIsNewer ? remoteStore.settings : localStore.settings;
    store.roundCount = remoteIsNewer ? remoteStore.roundCount : localStore.roundCount;
    store.history = [...historyById.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 100);
    store.updatedAt = Math.max(localStore.updatedAt, remoteStore.updatedAt, Date.now());
  }

  function getHistoryTimestamp(item) {
    return Number(item.updatedAt) || Number(item.endedAt) || Number(item.startedAt) || 0;
  }

  async function uploadStoreToDrive() {
    const payload = JSON.stringify(getCloudStorePayload(), null, 2);

    if (authState.driveFileId) {
      const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        authState.driveFileId,
      )}?uploadType=media&fields=id,modifiedTime`;
      await googleFetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: payload,
      });
      return;
    }

    const boundary = `focus_timer_${Date.now()}`;
    const metadata = {
      name: DRIVE_FILE_NAME,
      parents: ["appDataFolder"],
      mimeType: "application/json",
    };
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      payload,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await googleFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime",
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    const data = await response.json();
    authState.driveFileId = data.id || "";
  }

  function getCloudStorePayload() {
    return {
      version: 1,
      updatedAt: store.updatedAt || Date.now(),
      settings: store.settings,
      history: store.history,
      roundCount: store.roundCount,
    };
  }

  async function googleFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${authState.accessToken}`,
    };
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      authState.accessToken = "";
      setSyncStatus("需重新登录", "error");
      throw new Error("Google access token expired");
    }

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Google request failed: ${response.status} ${details}`);
    }

    return response;
  }

  function signOutGoogle() {
    clearTimeout(syncTimerId);
    const token = authState.accessToken;
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => {});
    }

    authState.accessToken = "";
    authState.tokenExpiresAt = 0;
    authState.user = null;
    authState.driveFileId = "";
    authState.syncing = false;
    setSyncStatus("未登录", "");
  }

  function beginOrToggle() {
    unlockAudio();

    if (state.status === "running") {
      pauseSession();
      return;
    }

    if (state.status === "paused") {
      resumeSession();
      return;
    }

    startSession();
  }

  function startSession() {
    clearTimeout(autoStartId);
    state.status = "running";
    state.totalSeconds = getDurationSeconds(state.mode);
    state.remainingSeconds = state.totalSeconds;
    state.endAt = Date.now() + state.remainingSeconds * 1000;
    state.activeId = createHistoryItem();
    startTicker();
    saveStore();
    render();
  }

  function createHistoryItem() {
    const now = Date.now();
    const title =
      state.mode === "work"
        ? elements.taskInput.value.trim() || "专注任务"
        : modeMeta[state.mode].title;
    const item = {
      id: String(now),
      mode: state.mode,
      title,
      startedAt: now,
      endedAt: null,
      durationSeconds: state.totalSeconds,
      actualSeconds: 0,
      status: "running",
      updatedAt: now,
    };

    store.history.unshift(item);
    store.history = store.history.slice(0, 100);
    return item.id;
  }

  function startTicker() {
    clearInterval(tickerId);
    tick();
    tickerId = setInterval(tick, 250);
  }

  function tick() {
    if (state.status !== "running") {
      return;
    }

    const nextRemaining = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
    if (nextRemaining !== state.remainingSeconds) {
      state.remainingSeconds = nextRemaining;
      updateActiveHistory("running");
      renderTimer();
    }

    if (nextRemaining <= 0) {
      completeSession();
    }
  }

  function pauseSession() {
    state.remainingSeconds = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
    state.status = "paused";
    clearInterval(tickerId);
    updateActiveHistory("paused");
    saveStore();
    render();
  }

  function resumeSession() {
    state.status = "running";
    state.endAt = Date.now() + state.remainingSeconds * 1000;
    updateActiveHistory("running");
    saveStore();
    startTicker();
    render();
  }

  function stopSession(status = "stopped") {
    if (state.status === "idle") {
      return;
    }

    clearInterval(tickerId);
    finishActiveHistory(status);
    state.status = "idle";
    state.activeId = null;
    state.totalSeconds = getDurationSeconds(state.mode);
    state.remainingSeconds = state.totalSeconds;
    saveStore();
    render();
  }

  function skipSession() {
    if (state.status !== "idle") {
      const skippedMode = state.mode;
      stopSession("skipped");
      advanceToNextMode(skippedMode, false);
      return;
    }

    advanceToNextMode(state.mode, false);
  }

  function completeSession() {
    const completedMode = state.mode;
    clearInterval(tickerId);
    state.remainingSeconds = 0;
    finishActiveHistory("completed");

    if (completedMode === "work") {
      store.roundCount += 1;
    } else {
      store.roundCount = Math.max(0, store.roundCount);
    }

    saveStore();
    playCompletionSound();
    showNotification(completedMode);
    advanceToNextMode(completedMode, store.settings.autoLoop);
  }

  function advanceToNextMode(finishedMode, shouldAutoStart) {
    const nextMode =
      finishedMode === "work"
        ? store.roundCount > 0 && store.roundCount % store.settings.longEvery === 0
          ? "longBreak"
          : "shortBreak"
        : "work";

    state.mode = nextMode;
    state.status = "idle";
    state.activeId = null;
    state.totalSeconds = getDurationSeconds(nextMode);
    state.remainingSeconds = state.totalSeconds;
    state.endAt = 0;
    render();

    if (shouldAutoStart) {
      autoStartId = setTimeout(() => {
        if (state.status === "idle") {
          startSession();
        }
      }, 900);
    }
  }

  function updateActiveHistory(status) {
    const item = store.history.find((entry) => entry.id === state.activeId);
    if (!item) {
      return;
    }

    item.status = status;
    item.actualSeconds = Math.max(0, item.durationSeconds - state.remainingSeconds);
    item.updatedAt = Date.now();
  }

  function finishActiveHistory(status) {
    const item = store.history.find((entry) => entry.id === state.activeId);
    if (!item) {
      return;
    }

    item.status = status;
    item.endedAt = Date.now();
    item.actualSeconds =
      status === "completed"
        ? item.durationSeconds
        : Math.max(0, item.durationSeconds - state.remainingSeconds);
    item.updatedAt = item.endedAt;
  }

  function updateSetting(key, value) {
    const limits = {
      workMinutes: [1, 180],
      shortMinutes: [1, 60],
      longMinutes: [1, 120],
      longEvery: [2, 12],
    };

    if (limits[key]) {
      const [min, max] = limits[key];
      store.settings[key] = clampNumber(value, min, max, defaults.settings[key]);
    } else {
      store.settings[key] = Boolean(value);
    }

    if (key === "notifyEnabled" && store.settings.notifyEnabled) {
      requestNotificationPermission();
    }

    if (state.status === "idle") {
      state.totalSeconds = getDurationSeconds(state.mode);
      state.remainingSeconds = state.totalSeconds;
    }

    saveStore();
    renderSettings();
    render();
  }

  function requestNotificationPermission() {
    if (!("Notification" in window)) {
      store.settings.notifyEnabled = false;
      return;
    }

    if (Notification.permission === "default") {
      Notification.requestPermission().then((permission) => {
        store.settings.notifyEnabled = permission === "granted";
        saveStore();
        renderSettings();
      });
    } else if (Notification.permission !== "granted") {
      store.settings.notifyEnabled = false;
    }
  }

  function showNotification(mode) {
    if (
      !store.settings.notifyEnabled ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    const title = modeMeta[mode].notification;
    const nextMode =
      mode === "work"
        ? store.roundCount > 0 && store.roundCount % store.settings.longEvery === 0
          ? "longBreak"
          : "shortBreak"
        : "work";
    const body =
      mode === "work"
        ? `${modeMeta[mode].nextText}，下一段是 ${modeMeta[nextMode].title}。`
        : modeMeta[mode].nextText;

    new Notification(title, {
      body,
      icon: "assets/focus-desk.webp",
    });
  }

  function unlockAudio() {
    if (!audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioContext = new AudioContext();
      }
    }

    if (audioContext?.state === "suspended") {
      audioContext.resume();
    }
  }

  function playCompletionSound() {
    if (!store.settings.soundEnabled || !audioContext) {
      return;
    }

    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    gain.connect(audioContext.destination);

    [660, 880, 990].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.13);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.13);
      oscillator.stop(now + 0.45 + index * 0.13);
    });
  }

  function clearHistory() {
    if (store.history.length === 0) {
      return;
    }

    const confirmed = window.confirm("确认清空所有任务记录吗？");
    if (!confirmed) {
      return;
    }

    store.history = [];
    store.roundCount = 0;
    state.activeId = null;
    state.status = "idle";
    state.totalSeconds = getDurationSeconds(state.mode);
    state.remainingSeconds = state.totalSeconds;
    clearInterval(tickerId);
    saveStore();
    render();
  }

  function bindEvents() {
    elements.modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => selectMode(tab.dataset.mode));
    });

    elements.primaryButton.addEventListener("click", beginOrToggle);
    elements.stopButton.addEventListener("click", () => stopSession("stopped"));
    elements.skipButton.addEventListener("click", skipSession);
    elements.clearHistory.addEventListener("click", clearHistory);
    elements.googleSignIn.addEventListener("click", signInWithGoogle);
    elements.googleSignOut.addEventListener("click", signOutGoogle);
    elements.syncNow.addEventListener("click", () => {
      syncWithDrive({ mergeRemote: true }).catch((error) => {
        console.error(error);
        setSyncStatus("同步失败", "error");
      });
    });

    elements.taskInput.addEventListener("input", () => {
      if (state.status === "idle") {
        renderTimer();
      }
    });

    elements.workMinutes.addEventListener("change", (event) =>
      updateSetting("workMinutes", event.target.value),
    );
    elements.shortMinutes.addEventListener("change", (event) =>
      updateSetting("shortMinutes", event.target.value),
    );
    elements.longMinutes.addEventListener("change", (event) =>
      updateSetting("longMinutes", event.target.value),
    );
    elements.longEvery.addEventListener("change", (event) =>
      updateSetting("longEvery", event.target.value),
    );
    elements.autoLoop.addEventListener("change", (event) =>
      updateSetting("autoLoop", event.target.checked),
    );
    elements.soundEnabled.addEventListener("change", (event) =>
      updateSetting("soundEnabled", event.target.checked),
    );
    elements.notifyEnabled.addEventListener("change", (event) =>
      updateSetting("notifyEnabled", event.target.checked),
    );

    window.addEventListener("beforeunload", (event) => {
      if (state.status === "idle") {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    });
  }

  function init() {
    renderSettings();
    bindEvents();
    render();
    initGoogleAuth();
  }

  init();
})();
