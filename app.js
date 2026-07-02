(() => {
  const STORAGE_KEY = "focus-tomato-timer:v1";

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
  };

  const store = loadStore();
  let audioContext;
  let tickerId;
  let autoStartId;

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

      return {
        settings: {
          ...defaults.settings,
          ...(saved.settings || {}),
        },
        history: Array.isArray(saved.history) ? saved.history.slice(0, 100) : [],
        roundCount: Number.isFinite(saved.roundCount) ? saved.roundCount : 0,
      };
    } catch {
      return cloneDefaults();
    }
  }

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaults));
  }

  function saveStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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

  function render() {
    renderTimer();
    renderStats();
    renderHistory();
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
  }

  init();
})();
