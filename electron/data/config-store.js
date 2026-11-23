const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const LEGACY_APP_SUPPORT_NAME = "个人工具箱";
const LEGACY_DEFAULT_VAULT_PATH = path.join(os.homedir(), "Documents");
const DEFAULT_SHORTCUTS = {
  quickMemo: "Alt+Q",
  openMain: "Alt+M",
  notch: "Alt+T"
};
const DEFAULT_OPEN_AT_LOGIN = false;
const DEFAULT_NOTCH_HOVER_DELAY_MS = 2000;
const VALID_THEMES = new Set(["dark", "natural", "classic"]);
const DEFAULT_THEME = "dark";
const VALID_FEISHU_PUSH_SCOPES = new Set(["all_pending", "today_created_pending"]);
const DEFAULT_MEMO_SETTINGS = {
  quickMemoEnterToSave: true,
  quickMemoDateSeparator: "---",
  quickMemoGroupSeparator: "#",
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
    this.legacyConfigPath = path.join(app.getPath("appData"), LEGACY_APP_SUPPORT_NAME, "config.json");
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
        // 读取失败时保留原文件，不能把一次磁盘/解析错误变成覆盖用户配置。
        throw error;
      } else {
        const migratedConfig = await this.readLegacyConfig();
        if (migratedConfig) {
          return migratedConfig;
        }
      }
      const config = this.normalizeConfig({});
      await fs.mkdir(config.vaultPath, { recursive: true });
      await this.writeConfig(config);
      return config;
    }
  }

  async readLegacyConfig() {
    if (!this.legacyConfigPath || this.legacyConfigPath === this.configPath) {
      return null;
    }
    try {
      const raw = await fs.readFile(this.legacyConfigPath, "utf8");
      const config = this.normalizeConfig(JSON.parse(raw));
      await this.writeConfig(config);
      return config;
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to migrate legacy config, using defaults", error);
      }
      return null;
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
      openAtLogin: Object.prototype.hasOwnProperty.call(config || {}, "openAtLogin")
        ? config.openAtLogin === true
        : DEFAULT_OPEN_AT_LOGIN,
      // 首次升级采用新深色外观；版本标记保证用户之后选择的旧主题不会再次被覆盖。
      appearanceVersion: 1,
      theme: config && config.appearanceVersion === 1 ? this.normalizeTheme(config.theme) : DEFAULT_THEME,
      notch: {
        enabled: config?.notch?.enabled !== false,
        // 旧配置默认等待 2 秒，避免升级后仍然快速弹出。
        hoverDelayMs: Number.isInteger(config?.notch?.hoverDelayMs) && config.notch.hoverDelayMs >= 0
          && config.notch.hoverDelayMs <= 10000 && config.notch.hoverDelayMs % 100 === 0
          ? config.notch.hoverDelayMs : DEFAULT_NOTCH_HOVER_DELAY_MS
      },
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
        : DEFAULT_SHORTCUTS.openMain,
      notch: typeof (shortcuts && shortcuts.notch) === "string" && shortcuts.notch.trim()
        ? shortcuts.notch.trim()
        : DEFAULT_SHORTCUTS.notch
    };
  }

  normalizeMemoSettings(settings) {
    const memoSettings = settings || {};
    return {
      quickMemoEnterToSave: Object.prototype.hasOwnProperty.call(memoSettings, "quickMemoEnterToSave")
        ? memoSettings.quickMemoEnterToSave !== false
        : DEFAULT_MEMO_SETTINGS.quickMemoEnterToSave,
      // 旧版配置没有识别符字段，读取时兼容默认值，不修改既有备忘。
      quickMemoGroupSeparator: typeof memoSettings.quickMemoGroupSeparator === "string" && /^[#@!$%&*+~^|:;?=]{1,8}$/.test(memoSettings.quickMemoGroupSeparator)
        ? memoSettings.quickMemoGroupSeparator : Array.from("#@!$%&*+~^|:;?=").concat(["##", "@@"]).find((symbol) => !String(memoSettings.quickMemoDateSeparator || "---").includes(symbol) && !symbol.includes(memoSettings.quickMemoDateSeparator || "---")),
      quickMemoDateSeparator: typeof memoSettings.quickMemoDateSeparator === "string" && /^\S{1,16}$/.test(memoSettings.quickMemoDateSeparator)
        ? memoSettings.quickMemoDateSeparator : DEFAULT_MEMO_SETTINGS.quickMemoDateSeparator,
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

  async setOpenAtLogin(openAtLogin) {
    const config = await this.readConfig();
    config.openAtLogin = openAtLogin === true;
    return this.writeConfig(config);
  }

  async setNotchEnabled(enabled) {
    const config = await this.readConfig();
    config.notch.enabled = enabled === true;
    return this.writeConfig(config);
  }

  async setNotchHoverDelay(hoverDelayMs) {
    if (!Number.isInteger(hoverDelayMs) || hoverDelayMs < 0 || hoverDelayMs > 10000 || hoverDelayMs % 100 !== 0) {
      throw new Error("悬停时间须为 0–10 秒，最多一位小数");
    }
    const config = await this.readConfig();
    config.notch.hoverDelayMs = hoverDelayMs;
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
    if (Object.prototype.hasOwnProperty.call(patch, "quickMemoDateSeparator")) {
      const separator = patch.quickMemoDateSeparator;
      if (typeof separator !== "string" || !/^\S{1,16}$/.test(separator)) {
        throw new Error("截止时间识别符须为 1–16 个字符，不能包含空格或换行");
      }
      nextMemo.quickMemoDateSeparator = separator;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "quickMemoGroupSeparator")) {
      const separator = patch.quickMemoGroupSeparator;
      if (typeof separator !== "string" || !/^[#@!$%&*+~^|:;?=]{1,8}$/.test(separator)) throw new Error("分组识别符支持 1–8 个符号，例如 #、@、@@");
      nextMemo.quickMemoGroupSeparator = separator;
    }
    if (nextMemo.quickMemoGroupSeparator.includes(nextMemo.quickMemoDateSeparator)
      || nextMemo.quickMemoDateSeparator.includes(nextMemo.quickMemoGroupSeparator)) throw new Error("分组识别符与截止时间识别符不能相同或互相包含");
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
  DEFAULT_OPEN_AT_LOGIN,
  DEFAULT_THEME,
  DEFAULT_MEMO_SETTINGS
};
