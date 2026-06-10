const path = require("node:path");
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification } = require("electron");
const { ConfigStore } = require("./data/config-store");
const { SmokeStore } = require("./data/smoke-store");
const { MemoStore } = require("./data/memo-store");
const { DailyPoemService } = require("./data/daily-poem-service");

app.setName("个人工具箱");
app.setAppUserModelId("com.lixuhui.personal-toolbox");

let mainWindow = null;
let quickMemoWindow = null;
let configStore = null;
let smokeStore = null;
let memoStore = null;
let dailyPoemService = null;
let memoReminderTimer = null;
let memoReminderRunning = false;
let registeredQuickMemoShortcut = "";
let registeredOpenMainShortcut = "";
let lastQuickMemoClosedAt = 0;
let quickMemoSaving = false;

function sanitizeExportFileName(value) {
  return String(value || "冒烟记录")
    .trim()
    .replace(/[\\/:*?"<>|#[\]^]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "冒烟记录";
}

function notifyMemoChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("memo:changed");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: "个人工具箱",
    backgroundColor: "#f4f5f7",
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
  });
  return mainWindow;
}

function createQuickMemoWindow() {
  if (quickMemoWindow && !quickMemoWindow.isDestroyed()) {
    quickMemoWindow.show();
    quickMemoWindow.focus();
    quickMemoWindow.webContents.send("quickMemo:focus");
    return quickMemoWindow;
  }

  quickMemoSaving = false;
  quickMemoWindow = new BrowserWindow({
    width: 520,
    height: 150,
    minWidth: 520,
    minHeight: 150,
    maxWidth: 520,
    maxHeight: 150,
    center: true,
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

  quickMemoWindow.loadFile(path.join(__dirname, "..", "src", "quick-memo.html"));
  quickMemoWindow.once("ready-to-show", () => {
    if (!quickMemoWindow || quickMemoWindow.isDestroyed()) {
      return;
    }
    quickMemoWindow.show();
    quickMemoWindow.focus();
    quickMemoWindow.webContents.send("quickMemo:focus");
  });
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
    const config = await configStore.setVaultPath(vaultPath);
    return Object.assign({}, config, { configPath: configStore.configPath });
  });
  ipcMain.handle("config:setShortcuts", async (_event, shortcuts) => setShortcuts(shortcuts));
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
    const config = await configStore.setVaultPath(result.filePaths[0]);
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

  ipcMain.handle("memo:listNotes", () => memoStore.listNotes());
  ipcMain.handle("memo:createNote", async (_event, content) => {
    const note = await memoStore.createNote(content);
    notifyMemoChanged();
    return note;
  });
  ipcMain.handle("memo:updateNote", async (_event, noteId, content) => {
    const note = await memoStore.updateNote(noteId, content);
    notifyMemoChanged();
    return note;
  });
  ipcMain.handle("memo:toggleNote", async (_event, noteId, completed) => {
    const note = await memoStore.toggleNote(noteId, completed);
    notifyMemoChanged();
    return note;
  });
  ipcMain.handle("memo:deleteNote", async (_event, noteId) => {
    await memoStore.deleteNote(noteId);
    notifyMemoChanged();
  });
  ipcMain.handle("memo:getDailySettings", () => memoStore.getDailyReportSettings());
  ipcMain.handle("memo:saveDailySettings", (_event, settings) => memoStore.saveDailyReportSettings(settings));
  ipcMain.handle("memo:getDailyReport", (_event, dateKey) => memoStore.getDailyReport(dateKey));
  ipcMain.handle("poem:getDaily", (_event, dateKey) => dailyPoemService.getDailyPoem(dateKey));
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
    openMain: validateShortcut(shortcuts && shortcuts.openMain, "打开主窗口快捷键")
  };
  if (pair.quickMemo === pair.openMain) {
    throw new Error("极速备忘和打开主窗口不能使用同一个快捷键");
  }
  return pair;
}

function unregisterRegisteredShortcuts() {
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
  } catch (error) {
    console.error("Failed to restore shortcuts", error);
    unregisterRegisteredShortcuts();
  }
}

async function registerConfiguredShortcuts() {
  const config = await configStore.getConfig();
  try {
    unregisterRegisteredShortcuts();
    const registered = registerShortcutPair(config.shortcuts);
    registeredQuickMemoShortcut = registered.quickMemo;
    registeredOpenMainShortcut = registered.openMain;
  } catch (error) {
    console.error("Failed to register configured shortcuts", error);
  }
}

async function setShortcuts(shortcuts) {
  const current = await configStore.getConfig();
  const nextShortcuts = normalizeShortcutPair(Object.assign({}, current.shortcuts, shortcuts || {}));
  const previousRegistered = {
    quickMemo: registeredQuickMemoShortcut,
    openMain: registeredOpenMainShortcut
  };
  unregisterRegisteredShortcuts();
  try {
    const registered = registerShortcutPair(nextShortcuts);
    registeredQuickMemoShortcut = registered.quickMemo;
    registeredOpenMainShortcut = registered.openMain;
    const config = await configStore.setShortcuts(nextShortcuts);
    return Object.assign({}, config, { configPath: configStore.configPath });
  } catch (error) {
    unregisterRegisteredShortcuts();
    restoreRegisteredShortcuts(previousRegistered);
    throw error;
  }
}

async function runMemoReminderCheck() {
  if (memoReminderRunning) {
    return;
  }
  memoReminderRunning = true;
  try {
    const candidate = await memoStore.getNotificationCandidate(new Date());
    if (!candidate) {
      return;
    }
    if (Notification.isSupported()) {
      new Notification({
        title: candidate.title,
        body: candidate.body,
        icon: path.join(__dirname, "..", "assets", "logo.png")
      }).show();
    }
    await memoStore.markDailyNotificationPushed(candidate.todayKey);
  } catch (error) {
    console.error("Failed to run memo reminder check", error);
  } finally {
    memoReminderRunning = false;
  }
}

function startMemoReminderScheduler() {
  if (memoReminderTimer) {
    return;
  }
  setTimeout(runMemoReminderCheck, 1500);
  memoReminderTimer = setInterval(runMemoReminderCheck, 60 * 1000);
}

app.whenReady().then(() => {
  configStore = new ConfigStore(app);
  smokeStore = new SmokeStore(configStore);
  memoStore = new MemoStore(configStore);
  dailyPoemService = new DailyPoemService(app);
  registerIpcHandlers();
  createWindow();
  registerConfiguredShortcuts();
  startMemoReminderScheduler();

  app.on("activate", () => {
    if (Date.now() - lastQuickMemoClosedAt < 1200) {
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (memoReminderTimer) {
    clearInterval(memoReminderTimer);
    memoReminderTimer = null;
  }
  globalShortcut.unregisterAll();
});
