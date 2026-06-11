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
      theme: this.normalizeTheme(config && config.theme)
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
}

module.exports = {
  ConfigStore,
  LEGACY_DEFAULT_VAULT_PATH,
  DEFAULT_SHORTCUTS,
  DEFAULT_THEME
};
