const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Notification, dialog, globalShortcut, ipcMain, screen } = require("electron");
const Diff = require("diff");
const { ConfigStore } = require("./data/config-store");
const { SmokeStore } = require("./data/smoke-store");
const { MemoStore } = require("./data/memo-store");
const { TimeRuleStore } = require("./data/time-rule-store");
const { createNotchController } = require("./notch-window");
const { DailyPoemService } = require("./data/daily-poem-service");
const { filterTodoNotes, sendDeadlineReminders, sendTestMessage, sendTodoNotes, toLocalDateKey } = require("./data/feishu-bot-service");

app.setName("记性不好");
app.setAppUserModelId("com.lixuhui.personal-toolbox");

let mainWindow = null;
let quickMemoWindow = null;
let configStore = null;
let smokeStore = null;
let memoStore = null;
let timeRuleStore = null;
let dailyPoemService = null;
let registeredQuickMemoShortcut = "";
let registeredOpenMainShortcut = "";
let registeredNotchShortcut = "";
let notchController = null;
let mainRendererReady = false;
let pendingMemoId = "";
let memoQueue = Promise.resolve();
let lastQuickMemoClosedAt = 0;
let quickMemoSaving = false;
let quickMemoDueAt = null;
let quickMemoGroupId = "";
let memoDataWatcher = null;
let memoDataWatchPath = "";
let memoDataWatchTimer = null;
let feishuAutoPushTimer = null;
let feishuAutoPushRunning = false;
let memoDeadlineTimer = null;
let memoDeadlineRunning = false;

function sanitizeExportFileName(value) {
  return String(value || "冒烟记录")
    .trim()
    .replace(/[\\/:*?"<>|#[\]^]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "冒烟记录";
}

function todayKey() {
  return toLocalDateKey(new Date());
}

function currentMinuteKey() {
  const now = new Date();
  return [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0")].join(":");
}

function currentMinuteTimestamp() {
  return Math.floor(Date.now() / 60000) * 60000;
}

function formatLocalDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return [
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-"),
    [String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0")].join(":")
  ].join(" ");
}

// 多窗口会同时读改写 memo.json；串行化整次存储操作，避免完成任务覆盖新建任务。
function queueMemoOperation(operation) {
  const result = memoQueue.then(operation);
  // 只恢复队列可用性，操作错误仍通过 result 交给原调用方显示/记录。
  memoQueue = result.catch(() => {});
  return result;
}

function notifyConfigChanged(config) {
  for (const window of [mainWindow, quickMemoWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send("config:changed", config);
    }
  }
}

function notifyMemoChanged() {
  if (notchController) {
    notchController.notifyChanged();
  }
  for (const window of [mainWindow, quickMemoWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("memo:changed");
  }
}

function applyOpenAtLogin(openAtLogin) {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: openAtLogin === true,
    openAsHidden: false
  });
}

async function applyConfiguredOpenAtLogin() {
  if (!configStore) {
    return;
  }
  try {
    const config = await configStore.getConfig();
    applyOpenAtLogin(config.openAtLogin);
  } catch (error) {
    console.error("Failed to apply configured login item settings", error);
  }
}

function stopMemoDataWatcher() {
  if (memoDataWatchTimer) {
    clearTimeout(memoDataWatchTimer);
    memoDataWatchTimer = null;
  }
  if (memoDataWatcher) {
    memoDataWatcher.close();
    memoDataWatcher = null;
  }
  memoDataWatchPath = "";
}

function scheduleExternalMemoRefresh() {
  if (memoDataWatchTimer) {
    clearTimeout(memoDataWatchTimer);
  }
  memoDataWatchTimer = setTimeout(() => {
    memoDataWatchTimer = null;
    notifyMemoChanged();
  }, 120);
}

async function startMemoDataWatcher() {
  if (!memoStore) {
    return;
  }
  try {
    const dataPath = await memoStore.getDataPath();
    const watchDir = path.dirname(dataPath);
    if (memoDataWatcher && memoDataWatchPath === dataPath) {
      return;
    }
    stopMemoDataWatcher();
    await fs.promises.mkdir(watchDir, { recursive: true });
    memoDataWatchPath = dataPath;
    memoDataWatcher = fs.watch(watchDir, (eventType, filename) => {
      if (!filename || filename.toString() === path.basename(dataPath)) {
        scheduleExternalMemoRefresh();
      }
    });
    memoDataWatcher.on("error", (error) => {
      console.error("Failed to watch memo data file", error);
      stopMemoDataWatcher();
    });
  } catch (error) {
    console.error("Failed to start memo data watcher", error);
  }
}

function getFeishuSettings(config) {
  return config && config.memo && config.memo.feishu ? config.memo.feishu : {};
}

function getDeadlineNotifySettings(config) {
  const settings = config && config.memo && config.memo.deadlineNotify ? config.memo.deadlineNotify : {};
  const channels = settings.channels || {};
  return {
    enabled: settings.enabled === true,
    channels: {
      macos: channels.macos !== false,
      feishu: channels.feishu === true
    }
  };
}

function getMemoTitle(note) {
  const title = String((note && note.title) || "").trim();
  if (title) {
    return title;
  }
  return String((note && note.content) || "").split(/\r?\n/)[0].trim() || "未命名备忘";
}

function getMemoDetail(note) {
  if (typeof (note && note.detail) === "string") {
    return note.detail.trim();
  }
  const lines = String((note && note.content) || "").replace(/\r\n/g, "\n").split("\n");
  lines.shift();
  return lines.join("\n").trim();
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim().replace(/\s*\n+\s*/g, " / ");
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + "...";
}

function normalizeTextDiffMode(value) {
  return value === "word" || value === "char" ? value : "line";
}

function normalizeTextDiffOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  return {
    ignoreWhitespace: source.ignoreWhitespace !== false,
    ignoreCase: source.ignoreCase !== false,
    stripTrailingCr: source.stripTrailingCr !== false
  };
}

function normalizeTextForDiff(value, options) {
  const text = String(value || "");
  if (!options.stripTrailingCr) {
    return text;
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function tokenizeTextForDiff(value, mode, options) {
  const text = normalizeTextForDiff(value, options);
  if (!text) {
    return [];
  }
  if (mode === "char") {
    return Array.from(text);
  }
  if (mode === "word") {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      return Array.from(new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(text), (segment) => segment.segment);
    }
    return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) || [];
  }
  return text.match(/[^\n]*\n|[^\n]+/g) || [];
}

function normalizeTextDiffToken(token, mode, options) {
  let value = String(token || "");
  if (options.ignoreWhitespace) {
    if (mode === "line") {
      value = value.replace(/\n$/g, "").trim();
    } else if (/^\s+$/u.test(value)) {
      value = "";
    }
  }
  if (options.ignoreCase) {
    value = value.toLocaleLowerCase("zh-CN");
  }
  return value;
}

function compactTextDiffParts(parts) {
  return parts.reduce((list, part) => {
    if (!part.value) {
      return list;
    }
    const previous = list[list.length - 1];
    if (previous && previous.type === part.type) {
      previous.value += part.value;
      return list;
    }
    list.push({ type: part.type, value: part.value });
    return list;
  }, []);
}

function countTextDiffStats(changes) {
  const stats = { added: 0, removed: 0, changed: 0 };
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const next = changes[index + 1];
    if (change.removed && next && next.added) {
      stats.changed += 1;
      index += 1;
    } else if (change.removed) {
      stats.removed += 1;
    } else if (change.added) {
      stats.added += 1;
    }
  }
  return stats;
}

function getTextDiffChangeCount(change) {
  return change.count || (Array.isArray(change.value) ? change.value.length : 0);
}

function getTextDiffTokenValue(tokens, start, count) {
  return tokens.slice(start, start + count).join("");
}

function createTextDiffBlocks(changes, leftTokens, rightTokens) {
  const blocks = [];
  let leftIndex = 0;
  let rightIndex = 0;

  const addBlock = (type, leftParts, rightParts, unifiedParts) => {
    blocks.push({
      type,
      left: compactTextDiffParts(leftParts),
      right: compactTextDiffParts(rightParts),
      unified: compactTextDiffParts(unifiedParts)
    });
  };

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const count = getTextDiffChangeCount(change);
    const next = changes[index + 1];

    if (change.removed && next && next.added) {
      const nextCount = getTextDiffChangeCount(next);
      const leftValue = getTextDiffTokenValue(leftTokens, leftIndex, count);
      const rightValue = getTextDiffTokenValue(rightTokens, rightIndex, nextCount);
      addBlock(
        "changed",
        [{ type: "removed", value: leftValue }],
        [{ type: "added", value: rightValue }],
        [
          { type: "removed", value: leftValue },
          { type: "added", value: rightValue }
        ]
      );
      leftIndex += count;
      rightIndex += nextCount;
      index += 1;
      continue;
    }

    if (change.removed) {
      const value = getTextDiffTokenValue(leftTokens, leftIndex, count);
      addBlock("removed", [{ type: "removed", value }], [], [{ type: "removed", value }]);
      leftIndex += count;
      continue;
    }

    if (change.added) {
      const value = getTextDiffTokenValue(rightTokens, rightIndex, count);
      addBlock("added", [], [{ type: "added", value }], [{ type: "added", value }]);
      rightIndex += count;
      continue;
    }

    const leftValue = getTextDiffTokenValue(leftTokens, leftIndex, count);
    const rightValue = getTextDiffTokenValue(rightTokens, rightIndex, count);
    addBlock(
      "equal",
      [{ type: "equal", value: leftValue }],
      [{ type: "equal", value: rightValue }],
      [{ type: "equal", value: rightValue || leftValue }]
    );
    leftIndex += count;
    rightIndex += count;
  }

  return blocks;
}

function flattenTextDiffBlocks(blocks, key) {
  return compactTextDiffParts((Array.isArray(blocks) ? blocks : []).flatMap((block) => block[key] || []));
}

function appendUnifiedDiffLines(lines, prefix, value) {
  const text = String(value || "");
  if (!text) {
    return;
  }
  const hasTrailingNewline = text.endsWith("\n");
  const parts = text.split("\n");
  if (hasTrailingNewline) {
    parts.pop();
  }
  parts.forEach((line) => {
    lines.push(prefix + line);
  });
  if (hasTrailingNewline && parts.length === 0) {
    lines.push(prefix);
  }
}

function createUnifiedTextDiff(parts) {
  const lines = ["--- 原文本", "+++ 新文本"];
  parts.forEach((part) => {
    const prefix = part.type === "added" ? "+" : part.type === "removed" ? "-" : " ";
    appendUnifiedDiffLines(lines, prefix, part.value);
  });
  return lines.join("\n");
}

function compareTextDiff(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const mode = normalizeTextDiffMode(source.mode);
  const options = normalizeTextDiffOptions(source.options);
  const leftTokens = tokenizeTextForDiff(source.left, mode, options);
  const rightTokens = tokenizeTextForDiff(source.right, mode, options);
  const changes = Diff.diffArrays(leftTokens, rightTokens, {
    comparator: (left, right) => normalizeTextDiffToken(left, mode, options) === normalizeTextDiffToken(right, mode, options)
  });

  const stats = countTextDiffStats(changes);
  const blocks = createTextDiffBlocks(changes, leftTokens, rightTokens);
  let diffIndex = 0;
  const indexedBlocks = blocks.map((block) => {
    if (block.type === "equal") {
      return block;
    }
    diffIndex += 1;
    return Object.assign({ diffIndex }, block);
  });
  const compactUnifiedParts = flattenTextDiffBlocks(indexedBlocks, "unified");
  return {
    mode,
    options,
    stats,
    isEqual: stats.added === 0 && stats.removed === 0 && stats.changed === 0,
    parts: {
      left: flattenTextDiffBlocks(indexedBlocks, "left"),
      right: flattenTextDiffBlocks(indexedBlocks, "right"),
      unified: compactUnifiedParts
    },
    blocks: indexedBlocks,
    unifiedText: createUnifiedTextDiff(compactUnifiedParts)
  };
}

function getFeishuPushTimes(feishu) {
  if (Array.isArray(feishu && feishu.pushTimes) && feishu.pushTimes.length) {
    return feishu.pushTimes;
  }
  return feishu && feishu.pushTime ? [feishu.pushTime] : [];
}

function getFeishuPushedTimesForDate(feishu, dateKey) {
  if (!feishu || feishu.lastPushedDate !== dateKey) {
    return [];
  }
  return Array.isArray(feishu.lastPushedTimes) ? feishu.lastPushedTimes : [];
}

async function pushMemoTodosToFeishu(trigger) {
  const config = await configStore.getConfig();
  const feishu = getFeishuSettings(config);
  const notes = await queueMemoOperation(() => memoStore.listNotes());
  const targetNotes = filterTodoNotes(notes, feishu.pushScope, new Date());
  if (!targetNotes.length) {
    return {
      skipped: true,
      reason: "empty",
      noteCount: 0,
      pushScope: feishu.pushScope || "all_pending",
      trigger: trigger || "manual"
    };
  }
  const result = await sendTodoNotes(feishu, targetNotes, { trigger: trigger || "manual" });
  return Object.assign({ skipped: false, trigger: trigger || "manual" }, result);
}

async function checkFeishuAutoPush() {
  if (feishuAutoPushRunning || !configStore || !memoStore) {
    return;
  }
  feishuAutoPushRunning = true;
  try {
    const config = await configStore.getConfig();
    const feishu = getFeishuSettings(config);
    const today = todayKey();
    const currentTime = currentMinuteKey();
    const pushTimes = getFeishuPushTimes(feishu);
    const pushedTimes = getFeishuPushedTimesForDate(feishu, today);
    if (!feishu.enabled || !feishu.webhookUrl || !pushTimes.includes(currentTime) || pushedTimes.includes(currentTime)) {
      return;
    }
    const result = await pushMemoTodosToFeishu("auto");
    if (!result.skipped) {
      await configStore.setMemoSettings({ feishu: { lastPushedDate: today, lastPushedTimes: pushedTimes.concat(currentTime) } });
    }
  } catch (error) {
    console.error("Failed to auto push memo todos to Feishu", error);
  } finally {
    feishuAutoPushRunning = false;
  }
}

function getDueReminderNotes(notes) {
  const nowMinute = currentMinuteTimestamp();
  return (Array.isArray(notes) ? notes : []).filter((note) => {
    if (!note || note.completed || !note.dueAt || note.deadlineNotifiedAt) {
      return false;
    }
    return Number(note.dueAt) <= nowMinute;
  });
}

function showMacosDeadlineNotification(notes) {
  if (!Notification.isSupported() || !notes.length) {
    return false;
  }
  const first = notes[0];
  const title = notes.length === 1 ? "任务到期：" + getMemoTitle(first) : "有 " + notes.length + " 个任务到期";
  const bodyLines = notes.length === 1
    ? [
      "截止时间：" + formatLocalDateTime(first.dueAt),
      truncateText(getMemoDetail(first), 90)
    ].filter(Boolean)
    : notes.slice(0, 5).map((note, index) => (index + 1) + ". " + getMemoTitle(note));
  const notification = new Notification({
    title,
    body: bodyLines.join("\n"),
    silent: false
  });
  notification.show();
  return true;
}

async function checkMemoDeadlineNotifications() {
  if (memoDeadlineRunning || !configStore || !memoStore) {
    return;
  }
  memoDeadlineRunning = true;
  try {
    const config = await configStore.getConfig();
    const deadlineNotify = getDeadlineNotifySettings(config);
    if (!deadlineNotify.enabled) {
      return;
    }
    const notes = getDueReminderNotes(await queueMemoOperation(() => memoStore.listNotes()));
    if (!notes.length) {
      return;
    }
    let notified = false;
    if (deadlineNotify.channels.macos) {
      try {
        notified = showMacosDeadlineNotification(notes) || notified;
      } catch (error) {
        console.error("Failed to show memo deadline notification", error);
      }
    }
    if (deadlineNotify.channels.feishu) {
      const feishu = getFeishuSettings(config);
      if (feishu.webhookUrl) {
        try {
          await sendDeadlineReminders(feishu, notes, { now: new Date() });
          notified = true;
        } catch (error) {
          console.error("Failed to send memo deadline reminder to Feishu", error);
        }
      }
    }
    if (notified) {
      await queueMemoOperation(() => memoStore.markDeadlineNotified(notes.map((note) => note.id), Date.now()));
      notifyMemoChanged();
    }
  } catch (error) {
    console.error("Failed to check memo deadline notifications", error);
  } finally {
    memoDeadlineRunning = false;
  }
}

function startFeishuAutoPushTimer() {
  if (feishuAutoPushTimer) {
    clearInterval(feishuAutoPushTimer);
  }
  feishuAutoPushTimer = setInterval(checkFeishuAutoPush, 60 * 1000);
  checkFeishuAutoPush();
}

function startMemoDeadlineTimer() {
  if (memoDeadlineTimer) {
    clearInterval(memoDeadlineTimer);
  }
  memoDeadlineTimer = setInterval(checkMemoDeadlineNotifications, 60 * 1000);
  checkMemoDeadlineNotifications();
}

function stopFeishuAutoPushTimer() {
  if (feishuAutoPushTimer) {
    clearInterval(feishuAutoPushTimer);
    feishuAutoPushTimer = null;
  }
}

function stopMemoDeadlineTimer() {
  if (memoDeadlineTimer) {
    clearInterval(memoDeadlineTimer);
    memoDeadlineTimer = null;
  }
}

function createWindow() {
  mainRendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: "记性不好",
    backgroundColor: "#161719",
    icon: path.join(__dirname, "..", "assets", "logo.png"),
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
    mainRendererReady = false;
  });
  return mainWindow;
}

function showQuickMemoWindow() {
  if (!quickMemoWindow || quickMemoWindow.isDestroyed()) {
    return;
  }
  quickMemoWindow.show();
  quickMemoWindow.focus();
  quickMemoWindow.webContents.send("quickMemo:focus");
}

function loadQuickMemoContent(retryCount) {
  if (!quickMemoWindow || quickMemoWindow.isDestroyed()) {
    return;
  }
  const windowRef = quickMemoWindow;
  const htmlPath = path.join(__dirname, "..", "src", "quick-memo.html");
  windowRef.webContents.once("did-finish-load", async () => {
    if (!windowRef || windowRef.isDestroyed()) {
      return;
    }
    try {
      const isValid = await windowRef.webContents.executeJavaScript(
        "Boolean(document.querySelector('.quick-shell') && document.getElementById('quickMemoInput'))",
        true
      );
      if (!isValid && retryCount > 0) {
        loadQuickMemoContent(retryCount - 1);
        return;
      }
      showQuickMemoWindow();
    } catch (error) {
      console.error("Failed to validate quick memo page", error);
      if (retryCount > 0) {
        loadQuickMemoContent(retryCount - 1);
        return;
      }
      showQuickMemoWindow();
    }
  });
  windowRef.loadFile(htmlPath, {
    query: {
      v: String(Date.now())
    }
  });
}

function createQuickMemoWindow(dueAt = null, workArea = null, groupId = "") {
  if (quickMemoWindow && !quickMemoWindow.isDestroyed()) {
    showQuickMemoWindow();
    return quickMemoWindow;
  }

  // 已打开的草稿复用原上下文；只为新窗口设置日期，防止改掉用户正在编辑的截止时间。
  quickMemoDueAt = dueAt;
  quickMemoGroupId = groupId;
  quickMemoSaving = false;
  quickMemoWindow = new BrowserWindow({
    width: 520,
    height: 190,
    minWidth: 520,
    minHeight: 190,
    maxWidth: 520,
    maxHeight: 190,
    // 从副屏刘海新增时留在来源屏幕；已打开的草稿仍复用原窗口与日期。
    ...(workArea ? {
      x: Math.round(workArea.x + (workArea.width - 520) / 2),
      y: Math.round(workArea.y + (workArea.height - 190) / 2)
    } : { center: true }),
    frame: false,
    transparent: true,
    vibrancy: "popover",
    visualEffectState: "active",
    hasShadow: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: "极速备忘",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  loadQuickMemoContent(1);
  quickMemoWindow.on("blur", () => {
    if (quickMemoSaving) {
      return;
    }
    if (quickMemoWindow && !quickMemoWindow.isDestroyed()) {
      quickMemoWindow.close();
    }
  });
  quickMemoWindow.on("closed", () => {
    lastQuickMemoClosedAt = Date.now();
    quickMemoSaving = false;
    quickMemoWindow = null;
  });
  return quickMemoWindow;
}

function registerIpcHandlers() {
  ipcMain.handle("config:get", () => configStore.getConfig());
  ipcMain.handle("config:setVaultPath", async (_event, vaultPath) => {
    const config = await queueMemoOperation(() => configStore.setVaultPath(vaultPath));
    await startMemoDataWatcher();
    notifyMemoChanged();
    return Object.assign({}, config, { configPath: configStore.configPath });
  });
  ipcMain.handle("config:setNotchEnabled", async (_event, enabled) => {
    const config = await configStore.setNotchEnabled(enabled);
    notchController.setEnabled(config.notch.enabled);
    return Object.assign({}, config, { configPath: configStore.configPath });
  });
  ipcMain.handle("config:setNotchHoverDelay", async (_event, hoverDelayMs) => {
    // 先持久化，再更新所有屏幕；写入失败时继续使用原等待时长。
    const config = await configStore.setNotchHoverDelay(hoverDelayMs);
    notchController.setHoverDelay(config.notch.hoverDelayMs);
    return Object.assign({}, config, { configPath: configStore.configPath });
  });
  ipcMain.handle("notch:ready", (event) => {
    if (notchController.isSender(event.sender)) {
      notchController.sendState(event.sender);
    }
  });
  ipcMain.handle("notch:toggle", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      notchController.toggle();
    }
  });
  ipcMain.handle("notch:collapse", (event) => {
    if (notchController.isSender(event.sender)) {
      notchController.collapse(event.sender);
    }
  });
  ipcMain.handle("notch:quickMemo", (event, dueAt, groupId) => {
    if (notchController.isSender(event.sender)) {
      if (dueAt != null && (typeof dueAt !== "number" || dueAt <= 0 || !Number.isFinite(new Date(dueAt).getTime()))) {
        throw new Error("无效的截止日期");
      }
      notchController.collapse(event.sender);
      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      const sourceDisplay = screen.getDisplayMatching(sourceWindow.getBounds());
      createQuickMemoWindow(dueAt == null ? null : dueAt, sourceDisplay.workArea, typeof groupId === "string" ? groupId : "");
    }
  });
  ipcMain.handle("notch:openNote", (event, noteId) => {
    if (notchController.isSender(event.sender)) {
      pendingMemoId = typeof noteId === "string" ? noteId : "";
      notchController.collapse(event.sender);
      focusMainWindow();
      deliverPendingMemo();
    }
  });
  ipcMain.handle("memo:ready", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      mainRendererReady = true;
      deliverPendingMemo();
    }
  });
  ipcMain.handle("config:setShortcuts", async (_event, shortcuts) => setShortcuts(shortcuts));
  ipcMain.handle("config:setTheme", async (_event, theme) => {
    const config = await configStore.setTheme(theme);
    notifyConfigChanged(config);
    return Object.assign({}, config, { configPath: configStore.configPath });
  });
  ipcMain.handle("config:setOpenAtLogin", async (_event, openAtLogin) => {
    const enabled = openAtLogin === true;
    applyOpenAtLogin(enabled);
    const config = await configStore.setOpenAtLogin(enabled);
    return Object.assign({}, config, { configPath: configStore.configPath });
  });
  ipcMain.handle("config:setMemoSettings", async (_event, settings) => {
    const config = await configStore.setMemoSettings(settings);
    notifyConfigChanged(config);
    checkMemoDeadlineNotifications();
    return Object.assign({}, config, { configPath: configStore.configPath });
  });
  ipcMain.handle("config:selectVaultPath", async () => {
    const current = await configStore.getVaultPath();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择 Obsidian Vault",
      defaultPath: current,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths.length) {
      return configStore.getConfig();
    }
    const config = await queueMemoOperation(() => configStore.setVaultPath(result.filePaths[0]));
    await startMemoDataWatcher();
    notifyMemoChanged();
    return Object.assign({}, config, { configPath: configStore.configPath });
  });

  ipcMain.handle("smoke:list", () => smokeStore.list());
  ipcMain.handle("smoke:importRunPlan", async () => {
    const vaultPath = await configStore.getVaultPath();
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: "导入 smoke-run-plan.md",
      defaultPath: vaultPath,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }
    return smokeStore.importRunPlan(result.filePaths[0]);
  });
  ipcMain.handle("smoke:exportCurrentVersion", async () => {
    const vaultPath = await configStore.getVaultPath();
    const store = await smokeStore.list();
    const version = store.versions.find((item) => item.id === store.selectedVersionId) || store.versions[0];
    if (!version) {
      throw new Error("当前没有可导出的版本");
    }
    const defaultName = sanitizeExportFileName(version.name) + "-冒烟记录导出.md";
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      title: "导出冒烟记录 Markdown",
      defaultPath: path.join(vaultPath, defaultName),
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const targetPath = /\.m(?:arkdown|d)$/i.test(result.filePath) ? result.filePath : result.filePath + ".md";
    return smokeStore.exportCurrentVersion(targetPath);
  });
  ipcMain.handle("smoke:saveSettings", (_event, settings) => smokeStore.saveSettings(settings));
  ipcMain.handle("smoke:createScene", (_event, payload) => smokeStore.createScene(payload));
  ipcMain.handle("smoke:createVersion", (_event, payload) => smokeStore.createVersion(payload));
  ipcMain.handle("smoke:updateVersion", (_event, versionId, patch) => smokeStore.updateVersion(versionId, patch));
  ipcMain.handle("smoke:deleteVersion", (_event, versionId) => smokeStore.deleteVersion(versionId));
  ipcMain.handle("smoke:selectVersion", (_event, versionId) => smokeStore.selectVersion(versionId));
  ipcMain.handle("smoke:updateScene", (_event, sceneId, patch) => smokeStore.updateScene(sceneId, patch));
  ipcMain.handle("smoke:deleteScene", (_event, sceneId) => smokeStore.deleteScene(sceneId));
  ipcMain.handle("smoke:deleteScenes", (_event, sceneIds) => smokeStore.deleteScenes(sceneIds));
  ipcMain.handle("smoke:createCase", (_event, payload) => smokeStore.createCase(payload));
  ipcMain.handle("smoke:updateCase", (_event, caseId, patch) => smokeStore.updateCase(caseId, patch));
  ipcMain.handle("smoke:duplicateCase", (_event, caseId) => smokeStore.duplicateCase(caseId));
  ipcMain.handle("smoke:deleteCase", (_event, caseId) => smokeStore.deleteCase(caseId));
  ipcMain.handle("smoke:deleteCases", (_event, caseIds) => smokeStore.deleteCases(caseIds));
  ipcMain.handle("smoke:selectScene", (_event, sceneId) => smokeStore.selectScene(sceneId));
  ipcMain.handle("smoke:selectCase", (_event, caseId) => smokeStore.selectCase(caseId));

  ipcMain.handle("memo:listData", () => queueMemoOperation(() => memoStore.listData()));
  for (const method of ["saveGroup", "moveGroup", "deleteGroup"]) {
    ipcMain.handle("memo:" + method, async (_event, ...args) => {
      const result = await queueMemoOperation(() => memoStore[method](...args));
      notifyMemoChanged();
      return result;
    });
  }
  ipcMain.handle("memo:listNotes", () => queueMemoOperation(() => memoStore.listNotes()));
  ipcMain.handle("memo:createNote", async (_event, content) => {
    const note = await queueMemoOperation(() => memoStore.createNote(content));
    notifyMemoChanged();
    checkMemoDeadlineNotifications();
    return note;
  });
  ipcMain.handle("memo:updateNote", async (_event, noteId, content) => {
    const note = await queueMemoOperation(() => memoStore.updateNote(noteId, content));
    notifyMemoChanged();
    checkMemoDeadlineNotifications();
    return note;
  });
  ipcMain.handle("memo:toggleNote", async (_event, noteId, completed) => {
    const note = await queueMemoOperation(() => memoStore.toggleNote(noteId, completed));
    notifyMemoChanged();
    checkMemoDeadlineNotifications();
    return note;
  });
  ipcMain.handle("memo:deleteNote", async (_event, noteId) => {
    await queueMemoOperation(() => memoStore.deleteNote(noteId));
    notifyMemoChanged();
  });
  ipcMain.handle("memo:importNotes", async () => {
    const vaultPath = await configStore.getVaultPath();
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: "导入备忘录 JSON",
      defaultPath: vaultPath,
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }
    const summary = await queueMemoOperation(() => memoStore.importNotes(result.filePaths[0]));
    notifyMemoChanged();
    checkMemoDeadlineNotifications();
    return Object.assign({ canceled: false }, summary);
  });
  ipcMain.handle("memo:exportNotes", async () => {
    const vaultPath = await configStore.getVaultPath();
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      title: "导出备忘录 JSON",
      defaultPath: path.join(vaultPath, "memo-export-" + todayKey() + ".json"),
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const targetPath = /\.json$/i.test(result.filePath) ? result.filePath : result.filePath + ".json";
    return queueMemoOperation(() => memoStore.exportNotes(targetPath));
  });
  ipcMain.handle("memo:saveImportSample", async () => {
    const vaultPath = await configStore.getVaultPath();
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      title: "保存备忘录导入样例",
      defaultPath: path.join(vaultPath, "memo-import-sample.json"),
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const targetPath = /\.json$/i.test(result.filePath) ? result.filePath : result.filePath + ".json";
    return memoStore.writeImportSample(targetPath);
  });
  ipcMain.handle("memo:pushToFeishu", async () => pushMemoTodosToFeishu("manual"));
  ipcMain.handle("memo:testFeishuBot", async () => {
    const config = await configStore.getConfig();
    return sendTestMessage(getFeishuSettings(config));
  });
  ipcMain.handle("poem:getDaily", (_event, dateKey) => dailyPoemService.getDailyPoem(dateKey));
  ipcMain.handle("textDiff:compare", (_event, payload) => compareTextDiff(payload));
  function requireQuickMemo(event) {
    if (!quickMemoWindow || event.sender !== quickMemoWindow.webContents) throw new Error("仅极速备忘可维护时间规则");
  }
  ipcMain.handle("quickMemo:loadTimeRules", (event) => {
    requireQuickMemo(event);
    return queueMemoOperation(() => timeRuleStore.loadRules());
  });
  ipcMain.handle("quickMemo:recordUnknownTime", (event, expression) => {
    requireQuickMemo(event);
    return queueMemoOperation(() => timeRuleStore.record(expression));
  });
  ipcMain.handle("quickMemo:createNote", async (event, content, learning) => {
    requireQuickMemo(event);
    if (!learning || !Array.isArray(learning.expressions) || learning.expressions.length > 100
      || learning.expressions.some((value) => typeof value !== "string" || value.length > 200)
      || (learning.correction !== null && typeof learning.correction !== "string")
      || !Number.isFinite(learning.referenceAt)) throw new Error("时间学习参数无效");
    const result = await queueMemoOperation(async () => {
      const note = await memoStore.createNote(content);
      let learningError = false;
      if (learning.expressions.length) {
        try {
          await timeRuleStore.learn({ ...learning, dueAt: note.dueAt });
        } catch (error) {
          // 备忘已经落盘，学习失败不能作为保存失败返回，否则重试会重复创建待办。
          console.error("Memo saved but time rule learning failed", error);
          learningError = true;
        }
      }
      return { note, learningError };
    });
    notifyMemoChanged();
    checkMemoDeadlineNotifications();
    return result;
  });
  ipcMain.handle("quickMemo:getContext", (event) => {
    return quickMemoWindow && event.sender === quickMemoWindow.webContents ? { dueAt: quickMemoDueAt, groupId: quickMemoGroupId } : { dueAt: null, groupId: "" };
  });
  ipcMain.handle("quickMemo:close", () => {
    if (quickMemoWindow && !quickMemoWindow.isDestroyed()) {
      quickMemoWindow.close();
    }
  });
  ipcMain.handle("quickMemo:setSaving", (event, saving) => {
    if (quickMemoWindow && !quickMemoWindow.isDestroyed() && event.sender === quickMemoWindow.webContents) {
      quickMemoSaving = Boolean(saving);
    }
  });
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  if (typeof mainWindow.moveTop === "function") {
    mainWindow.moveTop();
  }
  if (typeof app.focus === "function") {
    app.focus({ steal: true });
  }
  mainWindow.focus();
}

function deliverPendingMemo() {
  if (pendingMemoId && mainRendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("memo:openNote", pendingMemoId);
    pendingMemoId = "";
  }
}

function triggerNotch() {
  if (notchController) {
    notchController.toggle();
  }
}

function openMainWindow() {
  focusMainWindow();
}

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }
  openMainWindow();
}

function triggerQuickMemo() {
  createQuickMemoWindow();
}

function triggerOpenMain() {
  toggleMainWindow();
}

function validateShortcut(accelerator, label) {
  const shortcut = String(accelerator || "").trim().replace(/\s*\+\s*/g, "+");
  if (!shortcut) {
    throw new Error((label || "快捷键") + "不能为空");
  }
  if (!/(Command|Cmd|Control|Ctrl|Alt|Option|Shift|Super|Meta)\+/i.test(shortcut)) {
    throw new Error((label || "快捷键") + "至少需要包含一个修饰键");
  }
  return shortcut.replace(/\bOption\b/gi, "Alt").replace(/\bCmd\b/gi, "Command").replace(/\bCtrl\b/gi, "Control");
}

function normalizeShortcutPair(shortcuts) {
  const pair = {
    quickMemo: validateShortcut(shortcuts && shortcuts.quickMemo, "极速备忘快捷键"),
    openMain: validateShortcut(shortcuts && shortcuts.openMain, "打开主窗口快捷键"),
    notch: validateShortcut(shortcuts && shortcuts.notch, "刘海待办快捷键")
  };
  const canonical = Object.values(pair).map((value) => value.toLowerCase().split("+").sort().join("+"));
  if (new Set(canonical).size !== canonical.length) {
    throw new Error("极速备忘、主窗口和刘海待办不能使用同一个快捷键");
  }
  return pair;
}

function unregisterRegisteredShortcuts() {
  if (registeredNotchShortcut) {
    globalShortcut.unregister(registeredNotchShortcut);
    registeredNotchShortcut = "";
  }
  if (registeredQuickMemoShortcut) {
    globalShortcut.unregister(registeredQuickMemoShortcut);
    registeredQuickMemoShortcut = "";
  }
  if (registeredOpenMainShortcut) {
    globalShortcut.unregister(registeredOpenMainShortcut);
    registeredOpenMainShortcut = "";
  }
}

function registerShortcutOrThrow(shortcut, callback, label) {
  const ok = globalShortcut.register(shortcut, callback);
  if (!ok) {
    throw new Error(label + "注册失败，可能已被其他应用占用");
  }
}

function registerShortcutPair(shortcuts) {
  const pair = normalizeShortcutPair(shortcuts);
  const registered = [];
  try {
    registerShortcutOrThrow(pair.quickMemo, triggerQuickMemo, "极速备忘快捷键");
    registered.push(pair.quickMemo);
    registerShortcutOrThrow(pair.openMain, triggerOpenMain, "打开主窗口快捷键");
    registered.push(pair.openMain);
    registerShortcutOrThrow(pair.notch, triggerNotch, "刘海待办快捷键");
    registered.push(pair.notch);
    return pair;
  } catch (error) {
    registered.forEach((shortcut) => globalShortcut.unregister(shortcut));
    throw error;
  }
}

function restoreRegisteredShortcuts(previous) {
  try {
    if (previous.quickMemo) {
      registerShortcutOrThrow(previous.quickMemo, triggerQuickMemo, "极速备忘快捷键");
      registeredQuickMemoShortcut = previous.quickMemo;
    }
    if (previous.openMain) {
      registerShortcutOrThrow(previous.openMain, triggerOpenMain, "打开主窗口快捷键");
      registeredOpenMainShortcut = previous.openMain;
    }
    if (previous.notch) {
      registerShortcutOrThrow(previous.notch, triggerNotch, "刘海待办快捷键");
      registeredNotchShortcut = previous.notch;
    }
  } catch (error) {
    console.error("Failed to restore shortcuts", error);
    unregisterRegisteredShortcuts();
  }
}

async function registerConfiguredShortcuts() {
  const config = await configStore.getConfig();
  // 启动时逐项注册：新刘海快捷键被其他应用占用，不得使原有两个快捷键失效。
  for (const [key, callback, label] of [
    ["quickMemo", triggerQuickMemo, "极速备忘快捷键"],
    ["openMain", triggerOpenMain, "打开主窗口快捷键"],
    ["notch", triggerNotch, "刘海待办快捷键"]
  ]) {
    try {
      registerShortcutOrThrow(config.shortcuts[key], callback, label);
      if (key === "quickMemo") registeredQuickMemoShortcut = config.shortcuts[key];
      if (key === "openMain") registeredOpenMainShortcut = config.shortcuts[key];
      if (key === "notch") registeredNotchShortcut = config.shortcuts[key];
    } catch (error) {
      console.error("Failed to register " + key + " shortcut", error);
      dialog.showErrorBox(label + "不可用", "组合键可能已被占用，请在设置 → 快捷键中修改。其他可用快捷键不受影响。");
    }
  }
}

async function setShortcuts(shortcuts) {
  const current = await configStore.getConfig();
  const nextShortcuts = normalizeShortcutPair(Object.assign({}, current.shortcuts, shortcuts || {}));
  const previousRegistered = {
    quickMemo: registeredQuickMemoShortcut,
    openMain: registeredOpenMainShortcut,
    notch: registeredNotchShortcut
  };
  unregisterRegisteredShortcuts();
  try {
    const registered = registerShortcutPair(nextShortcuts);
    registeredQuickMemoShortcut = registered.quickMemo;
    registeredOpenMainShortcut = registered.openMain;
    registeredNotchShortcut = registered.notch;
    const config = await configStore.setShortcuts(nextShortcuts);
    return Object.assign({}, config, { configPath: configStore.configPath });
  } catch (error) {
    unregisterRegisteredShortcuts();
    restoreRegisteredShortcuts(previousRegistered);
    throw error;
  }
}

app.whenReady().then(async () => {
  configStore = new ConfigStore(app);
  // 初始化和外观迁移先完成，再启动多窗口和定时任务，避免首次配置并发写入。
  const initialConfig = await configStore.getConfig();
  await configStore.writeConfig(initialConfig);
  smokeStore = new SmokeStore(configStore);
  memoStore = new MemoStore(configStore);
  timeRuleStore = new TimeRuleStore(configStore);
  dailyPoemService = new DailyPoemService(app);
  notchController = createNotchController();
  registerIpcHandlers();
  createWindow();
  notchController.setHoverDelay(initialConfig.notch.hoverDelayMs);
  notchController.setEnabled(initialConfig.notch.enabled);
  startMemoDataWatcher();
  startFeishuAutoPushTimer();
  startMemoDeadlineTimer();
  registerConfiguredShortcuts();
  applyConfiguredOpenAtLogin();

  app.on("activate", () => {
    if (Date.now() - lastQuickMemoClosedAt < 1200) {
      return;
    }
    // 快捷键激活刘海面板时同样可能触发 activate，不可再把焦点抢回主窗口。
    if (!notchController.isExpanded() && (!quickMemoWindow || !quickMemoWindow.isVisible())) {
      focusMainWindow();
    }
  });
}).catch((error) => {
  console.error("Failed to initialize application", error);
  dialog.showErrorBox("启动失败", "无法读取或保存应用配置，请检查数据目录后重试。\n" + error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (notchController) notchController.destroy();
  stopMemoDataWatcher();
  stopFeishuAutoPushTimer();
  stopMemoDeadlineTimer();
  globalShortcut.unregisterAll();
});
