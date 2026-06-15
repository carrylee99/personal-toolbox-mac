const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const LEGACY_DEFAULT_VAULT_PATH = path.join(os.homedir(), "Documents");
const DEFAULT_SHORTCUTS = {
  quickMemo: "Alt+Q",
  openMain: "Alt+M"
};
const VALID_THEMES = new Set(["natural", "classic"]);
const DEFAULT_THEME = "natural";
const VALID_FEISHU_PUSH_SCOPES = new Set(["all_pending", "today_created_pending"]);
const DEFAULT_MEMO_SETTINGS = {
  quickMemoEnterToSave: true,
  deadlineNotify: {
    enabled: false,
    channels: {
      macos: true,
      feishu: false
    }
  },
  feishu: {
    enabled: false,
    webhookUrl: "",
    secret: "",
    pushScope: "all_pending",
    pushTime: "09:00",
    pushTimes: ["09:00"],
    lastPushedDate: "",
    lastPushedTimes: []
  }
};

class ConfigStore {
  constructor(app) {
    this.app = app;
    this.configPath = path.join(app.getPath("userData"), "config.json");
  }

  getDefaultVaultPath() {
    return path.join(this.app.getPath("userData"), "Vault");
  }

  async readConfig() {
    try {
      const raw = await fs.readFile(this.configPath, "utf8");
      return this.normalizeConfig(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to read config, using defaults", error);
      }
      const config = this.normalizeConfig({});
      await fs.mkdir(config.vaultPath, { recursive: true });
      await this.writeConfig(config);
      return config;
    }
  }

  async writeConfig(config) {
    const normalized = this.normalizeConfig(config);
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
    return normalized;
  }

  normalizeConfig(config) {
    return {
      vaultPath: typeof (config && config.vaultPath) === "string" && config.vaultPath.trim()
        ? config.vaultPath.trim()
        : this.getDefaultVaultPath(),
      shortcuts: Object.assign({}, DEFAULT_SHORTCUTS, this.normalizeShortcuts(config && config.shortcuts)),
      theme: this.normalizeTheme(config && config.theme),
      memo: Object.assign({}, DEFAULT_MEMO_SETTINGS, this.normalizeMemoSettings(config && config.memo))
    };
  }

  normalizeTheme(theme) {
    const normalized = String(theme || "").trim();
    return VALID_THEMES.has(normalized) ? normalized : DEFAULT_THEME;
  }

  normalizeShortcuts(shortcuts) {
    return {
      quickMemo: typeof (shortcuts && shortcuts.quickMemo) === "string" && shortcuts.quickMemo.trim()
        ? shortcuts.quickMemo.trim()
        : DEFAULT_SHORTCUTS.quickMemo,
      openMain: typeof (shortcuts && shortcuts.openMain) === "string" && shortcuts.openMain.trim()
        ? shortcuts.openMain.trim()
        : DEFAULT_SHORTCUTS.openMain
    };
  }

  normalizeMemoSettings(settings) {
    const memoSettings = settings || {};
    return {
      quickMemoEnterToSave: Object.prototype.hasOwnProperty.call(memoSettings, "quickMemoEnterToSave")
        ? memoSettings.quickMemoEnterToSave !== false
        : DEFAULT_MEMO_SETTINGS.quickMemoEnterToSave,
      deadlineNotify: this.normalizeDeadlineNotifySettings(memoSettings.deadlineNotify),
      feishu: this.normalizeFeishuSettings(memoSettings.feishu)
    };
  }

  normalizeDeadlineNotifySettings(settings) {
    const deadlineNotify = settings || {};
    const channels = deadlineNotify.channels || {};
    return {
      enabled: deadlineNotify.enabled === true,
      channels: {
        macos: Object.prototype.hasOwnProperty.call(channels, "macos")
          ? channels.macos !== false
          : DEFAULT_MEMO_SETTINGS.deadlineNotify.channels.macos,
        feishu: channels.feishu === true
      }
    };
  }

  normalizeFeishuSettings(settings) {
    const feishu = settings || {};
    const pushScope = String(feishu.pushScope || "").trim();
    const pushTimes = this.normalizeFeishuPushTimes(feishu);
    return {
      enabled: feishu.enabled === true,
      webhookUrl: typeof feishu.webhookUrl === "string" ? feishu.webhookUrl.trim() : DEFAULT_MEMO_SETTINGS.feishu.webhookUrl,
      secret: typeof feishu.secret === "string" ? feishu.secret.trim() : DEFAULT_MEMO_SETTINGS.feishu.secret,
      pushScope: VALID_FEISHU_PUSH_SCOPES.has(pushScope) ? pushScope : DEFAULT_MEMO_SETTINGS.feishu.pushScope,
      pushTime: pushTimes[0],
      pushTimes,
      lastPushedDate: typeof feishu.lastPushedDate === "string" ? feishu.lastPushedDate.trim() : DEFAULT_MEMO_SETTINGS.feishu.lastPushedDate,
      lastPushedTimes: Array.isArray(feishu.lastPushedTimes) ? this.normalizeTimeList(feishu.lastPushedTimes) : DEFAULT_MEMO_SETTINGS.feishu.lastPushedTimes
    };
  }

  normalizeFeishuPushTimes(settings) {
    const feishu = settings || {};
    const candidates = Array.isArray(feishu.pushTimes) && feishu.pushTimes.length
      ? feishu.pushTimes
      : [feishu.pushTime || DEFAULT_MEMO_SETTINGS.feishu.pushTime];
    const pushTimes = this.normalizeTimeList(candidates);
    return pushTimes.length ? pushTimes : DEFAULT_MEMO_SETTINGS.feishu.pushTimes.slice();
  }

  normalizeTimeList(values) {
    const seen = new Set();
    const normalized = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const time = this.normalizeTime(value);
      if (time && !seen.has(time)) {
        seen.add(time);
        normalized.push(time);
      }
    });
    return normalized;
  }

  normalizeTime(value) {
    const time = String(value || "").trim();
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!match) {
      return "";
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return "";
    }
    return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  }

  async getConfig() {
    const config = await this.readConfig();
    return Object.assign({}, config, {
      configPath: this.configPath
    });
  }

  async getVaultPath() {
    return (await this.readConfig()).vaultPath;
  }

  async setVaultPath(vaultPath) {
    const nextPath = String(vaultPath || "").trim();
    if (!nextPath) {
      throw new Error("Vault path is empty");
    }
    const stat = await fs.stat(nextPath);
    if (!stat.isDirectory()) {
      throw new Error("Vault path is not a directory");
    }
    const config = await this.readConfig();
    config.vaultPath = nextPath;
    return this.writeConfig(config);
  }

  async setShortcuts(shortcuts) {
    const config = await this.readConfig();
    config.shortcuts = this.normalizeShortcuts(shortcuts);
    return this.writeConfig(config);
  }

  async setTheme(theme) {
    const config = await this.readConfig();
    config.theme = this.normalizeTheme(theme);
    return this.writeConfig(config);
  }

  async setMemoSettings(settings) {
    const config = await this.readConfig();
    const currentMemo = this.normalizeMemoSettings(config.memo);
    const patch = settings || {};
    const nextMemo = Object.assign({}, currentMemo);
    if (Object.prototype.hasOwnProperty.call(patch, "quickMemoEnterToSave")) {
      nextMemo.quickMemoEnterToSave = patch.quickMemoEnterToSave !== false;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "deadlineNotify")) {
      const currentDeadlineNotify = currentMemo.deadlineNotify || {};
      const patchDeadlineNotify = patch.deadlineNotify || {};
      nextMemo.deadlineNotify = this.normalizeDeadlineNotifySettings(Object.assign({}, currentDeadlineNotify, patchDeadlineNotify, {
        channels: Object.assign({}, currentDeadlineNotify.channels || {}, patchDeadlineNotify.channels || {})
      }));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "feishu")) {
      nextMemo.feishu = this.normalizeFeishuSettings(Object.assign({}, currentMemo.feishu, patch.feishu || {}));
    }
    config.memo = this.normalizeMemoSettings(nextMemo);
    return this.writeConfig(config);
  }
}

module.exports = {
  ConfigStore,
  LEGACY_DEFAULT_VAULT_PATH,
  DEFAULT_SHORTCUTS,
  DEFAULT_THEME,
  DEFAULT_MEMO_SETTINGS
};
