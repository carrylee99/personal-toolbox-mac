const fs = require("node:fs/promises");
const path = require("node:path");

const NOTE_PREFIX = "memo/note/";
const DEFAULT_MARKDOWN_FOLDER = "Daily Memos";
const DEFAULT_DAILY_SETTINGS = {
  enabled: true,
  pushTime: "09:00",
  lastPushedDate: null,
  markdownFolder: DEFAULT_MARKDOWN_FOLDER
};

function createId(prefix) {
  return prefix + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

function parseDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return null;
  }
  const parts = String(value).split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return getLocalDateKey(date) === value ? date : null;
}

function getYesterdayDateKey(now) {
  const base = now || new Date();
  return getLocalDateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1));
}

function getDayRange(dateKey) {
  const startDate = parseDateKey(dateKey) || parseDateKey(getYesterdayDateKey());
  const endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1);
  return {
    start: startDate.getTime(),
    end: endDate.getTime()
  };
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeDetail(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function splitMemoContent(value) {
  const lines = String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const title = cleanText(lines.shift() || "");
  return {
    title,
    detail: normalizeDetail(lines.join("\n"))
  };
}

function buildMemoContent(title, detail) {
  return [cleanText(title), normalizeDetail(detail)].filter(Boolean).join("\n");
}

function normalizeNotePayload(value) {
  if (typeof value === "string") {
    return splitMemoContent(value);
  }
  const payload = value || {};
  if (Object.prototype.hasOwnProperty.call(payload, "title") || Object.prototype.hasOwnProperty.call(payload, "detail")) {
    return {
      title: cleanText(payload.title),
      detail: normalizeDetail(payload.detail)
    };
  }
  return splitMemoContent(payload.content);
}

function normalizeFolder(value) {
  const normalized = cleanText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => part.replace(/[\\/:*?"<>|#[\]^]/g, "-").trim())
    .filter(Boolean)
    .join("/");
  return normalized || DEFAULT_MARKDOWN_FOLDER;
}

function normalizeNote(note) {
  const now = Date.now();
  const payload = normalizeNotePayload(note || {});
  const fallback = splitMemoContent(note && note.content);
  const title = payload.title || fallback.title;
  const detail = Object.prototype.hasOwnProperty.call(note || {}, "detail") ? payload.detail : fallback.detail;
  return {
    id: note && note.id ? String(note.id) : note && note._id ? String(note._id) : createId(NOTE_PREFIX),
    title,
    detail,
    content: buildMemoContent(title, detail),
    createdAt: Number((note && note.createdAt) || now),
    updatedAt: Number((note && note.updatedAt) || (note && note.createdAt) || now),
    completed: Boolean(note && note.completed),
    completedAt: note && note.completedAt ? Number(note.completedAt) : null
  };
}

function normalizeDailySettings(settings) {
  return {
    enabled: typeof (settings && settings.enabled) === "boolean" ? settings.enabled : DEFAULT_DAILY_SETTINGS.enabled,
    pushTime: isValidTime(settings && settings.pushTime) ? settings.pushTime : DEFAULT_DAILY_SETTINGS.pushTime,
    lastPushedDate: parseDateKey(settings && settings.lastPushedDate) ? settings.lastPushedDate : DEFAULT_DAILY_SETTINGS.lastPushedDate,
    markdownFolder: normalizeFolder(settings && settings.markdownFolder)
  };
}

function normalizeStore(raw) {
  const store = raw || {};
  return {
    settings: normalizeDailySettings(store.settings || {}),
    notes: Array.isArray(store.notes) ? store.notes.map(normalizeNote) : []
  };
}

function sortNotes(notes) {
  return notes.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

function buildDailyReportFromNotes(dateKey, sourceNotes) {
  const reportDate = parseDateKey(dateKey) ? dateKey : getYesterdayDateKey();
  const range = getDayRange(reportDate);
  const notes = sortNotes(sourceNotes.filter((note) => note.updatedAt >= range.start && note.updatedAt < range.end));
  const todoCount = notes.filter((note) => !note.completed).length;
  return {
    date: reportDate,
    notes,
    todoCount,
    doneCount: notes.length - todoCount
  };
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatDateTitle(dateKey) {
  const date = parseDateKey(dateKey) || new Date();
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function compactContent(value, maxLength) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength - 1) + "..." : normalized;
}

function markdownNoteLine(note) {
  const marker = note.completed ? "x" : " ";
  const title = cleanText(note.title || splitMemoContent(note.content).title) || "未填写";
  const detail = normalizeDetail(note.detail || splitMemoContent(note.content).detail)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = ["- [" + marker + "] " + title + "  "];
  lines.push("  - 更新：" + formatTime(note.updatedAt));
  if (note.completed && note.completedAt) {
    lines.push("  - 完成：" + formatTime(note.completedAt));
  }
  detail.forEach((line) => {
    lines.push("  - " + line);
  });
  return lines.join("\n");
}

function buildDailyMemoMarkdown(dateKey, notes) {
  const report = buildDailyReportFromNotes(dateKey, notes);
  const todoNotes = report.notes.filter((note) => !note.completed);
  const doneNotes = report.notes.filter((note) => note.completed);
  const lines = [
    "---",
    "type: daily-memo",
    "date: " + JSON.stringify(report.date),
    "updated: " + JSON.stringify(new Date().toISOString()),
    "total: " + report.notes.length,
    "todo: " + report.todoCount,
    "done: " + report.doneCount,
    "---",
    "",
    "# " + formatDateTitle(report.date) + " 备忘",
    "",
    "## 摘要",
    "",
    "- 更新：" + report.notes.length + " 条",
    "- 待办：" + report.todoCount + " 条",
    "- 完成：" + report.doneCount + " 条",
    "",
    "## 待办",
    ""
  ];

  if (todoNotes.length) {
    lines.push(...todoNotes.map(markdownNoteLine));
  } else {
    lines.push("> 暂无待办。");
  }

  lines.push("", "## 已完成", "");
  if (doneNotes.length) {
    lines.push(...doneNotes.map(markdownNoteLine));
  } else {
    lines.push("> 暂无已完成。");
  }

  return lines.join("\n") + "\n";
}

function buildDailyNotificationBody(report) {
  const preview = report.notes
    .slice(0, 3)
    .map((note) => compactContent(note.title || note.content, 18))
    .filter(Boolean)
    .join("、");
  const suffix = report.notes.length > 3 ? " 等" : "";
  return "昨天更新了 " + report.notes.length + " 条备忘" + (preview ? "：" + preview + suffix : "");
}

function isAtOrAfterPushTime(pushTime, now) {
  const parts = String(pushTime || DEFAULT_DAILY_SETTINGS.pushTime).split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= parts[0] * 60 + parts[1];
}

class MemoStore {
  constructor(configStore) {
    this.configStore = configStore;
  }

  async getDataPath() {
    const vaultPath = await this.configStore.getVaultPath();
    return path.join(vaultPath, ".personal-toolbox", "memo.json");
  }

  async readStore() {
    const dataPath = await this.getDataPath();
    let raw = {};
    let missing = false;
    try {
      raw = JSON.parse(await fs.readFile(dataPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      missing = true;
    }
    const store = normalizeStore(raw);
    if (missing || JSON.stringify(raw) !== JSON.stringify(store)) {
      await this.saveStore(store);
    }
    return store;
  }

  async saveStore(store) {
    const dataPath = await this.getDataPath();
    const normalized = normalizeStore(store);
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
    return normalized;
  }

  async listNotes() {
    const store = await this.readStore();
    return sortNotes(store.notes);
  }

  async createNote(payload) {
    const value = normalizeNotePayload(payload);
    if (!value.title) {
      throw new Error("Note title is empty");
    }
    const store = await this.readStore();
    const now = Date.now();
    const note = normalizeNote({
      id: createId(NOTE_PREFIX),
      title: value.title,
      detail: value.detail,
      createdAt: now,
      updatedAt: now,
      completed: false,
      completedAt: null
    });
    store.notes.push(note);
    await this.saveStore(store);
    await this.writeDailyMemo(getLocalDateKey(new Date(note.updatedAt)));
    return note;
  }

  async toggleNote(id, completed) {
    const store = await this.readStore();
    const note = store.notes.find((item) => item.id === id);
    if (!note) {
      throw new Error("Note not found");
    }
    const oldDateKey = getLocalDateKey(new Date(note.updatedAt));
    const now = Date.now();
    note.completed = Boolean(completed);
    note.completedAt = note.completed ? now : null;
    note.updatedAt = now;
    const newDateKey = getLocalDateKey(new Date(note.updatedAt));
    await this.saveStore(store);
    await this.writeDailyMemo(oldDateKey);
    if (newDateKey !== oldDateKey) {
      await this.writeDailyMemo(newDateKey);
    }
    return normalizeNote(note);
  }

  async updateNote(id, patch) {
    const store = await this.readStore();
    const note = store.notes.find((item) => item.id === id);
    if (!note) {
      throw new Error("Note not found");
    }
    const normalizedNote = normalizeNote(note);
    const payload = typeof patch === "string"
      ? normalizeNotePayload(patch)
      : {
        title: Object.prototype.hasOwnProperty.call(patch || {}, "title") ? cleanText(patch.title) : normalizedNote.title,
        detail: Object.prototype.hasOwnProperty.call(patch || {}, "detail") ? normalizeDetail(patch.detail) : normalizedNote.detail
      };
    if (!payload.title) {
      throw new Error("Note title is empty");
    }
    const oldDateKey = getLocalDateKey(new Date(note.updatedAt));
    note.title = payload.title;
    note.detail = payload.detail;
    note.content = buildMemoContent(note.title, note.detail);
    note.updatedAt = Date.now();
    const newDateKey = getLocalDateKey(new Date(note.updatedAt));
    await this.saveStore(store);
    await this.writeDailyMemo(oldDateKey);
    if (newDateKey !== oldDateKey) {
      await this.writeDailyMemo(newDateKey);
    }
    return normalizeNote(note);
  }

  async deleteNote(id) {
    const store = await this.readStore();
    const note = store.notes.find((item) => item.id === id);
    if (!note) {
      return;
    }
    const dateKey = getLocalDateKey(new Date(note.updatedAt));
    store.notes = store.notes.filter((item) => item.id !== id);
    await this.saveStore(store);
    await this.writeDailyMemo(dateKey);
  }

  async getDailyReportSettings() {
    const store = await this.readStore();
    return store.settings;
  }

  async saveDailyReportSettings(settings) {
    const store = await this.readStore();
    const patch = settings || {};
    store.settings = normalizeDailySettings({
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : store.settings.enabled,
      pushTime: patch.pushTime || store.settings.pushTime,
      lastPushedDate: Object.prototype.hasOwnProperty.call(patch, "lastPushedDate") ? patch.lastPushedDate : store.settings.lastPushedDate,
      markdownFolder: patch.markdownFolder || store.settings.markdownFolder
    });
    const next = await this.saveStore(store);
    return next.settings;
  }

  async getDailyReport(dateKey) {
    const store = await this.readStore();
    return buildDailyReportFromNotes(dateKey || getYesterdayDateKey(), store.notes);
  }

  async getNotificationCandidate(now) {
    const store = await this.readStore();
    const current = now || new Date();
    const todayKey = getLocalDateKey(current);
    if (!store.settings.enabled || store.settings.lastPushedDate === todayKey || !isAtOrAfterPushTime(store.settings.pushTime, current)) {
      return null;
    }
    const report = buildDailyReportFromNotes(getYesterdayDateKey(current), store.notes);
    if (report.notes.length === 0) {
      return null;
    }
    return {
      todayKey,
      report,
      title: "昨日报",
      body: buildDailyNotificationBody(report)
    };
  }

  async markDailyNotificationPushed(dateKey) {
    return this.saveDailyReportSettings({ lastPushedDate: dateKey });
  }

  async writeDailyMemo(dateKey) {
    const store = await this.readStore();
    const vaultPath = await this.configStore.getVaultPath();
    const folder = normalizeFolder(store.settings.markdownFolder);
    const targetPath = path.join(vaultPath, folder, dateKey + ".md");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buildDailyMemoMarkdown(dateKey, store.notes), "utf8");
  }
}

module.exports = {
  MemoStore,
  DEFAULT_DAILY_SETTINGS,
  buildDailyReportFromNotes,
  getYesterdayDateKey,
  getLocalDateKey
};
