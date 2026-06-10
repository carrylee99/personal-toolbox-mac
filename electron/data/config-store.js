const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_VAULT_PATH = path.join(os.homedir(), "Documents");
const DEFAULT_SHORTCUTS = {
  quickMemo: "Alt+Q",
  openMain: "Alt+M"
};

class ConfigStore {
  constructor(app) {
    this.app = app;
    this.configPath = path.join(app.getPath("userData"), "config.json");
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
        : DEFAULT_VAULT_PATH,
      shortcuts: Object.assign({}, DEFAULT_SHORTCUTS, this.normalizeShortcuts(config && config.shortcuts))
    };
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
}

module.exports = {
  ConfigStore,
  DEFAULT_VAULT_PATH,
  DEFAULT_SHORTCUTS
};
