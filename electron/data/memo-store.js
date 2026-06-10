const fs = require("node:fs/promises");
const path = require("node:path");

const NOTE_PREFIX = "memo/note/";
const EXPORT_SCHEMA_VERSION = 1;

function createId(prefix) {
  return prefix + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
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

function parseTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
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

function normalizeNote(note) {
  const now = Date.now();
  const payload = normalizeNotePayload(note || {});
  const fallback = splitMemoContent(note && note.content);
  const title = payload.title || fallback.title;
  const detail = Object.prototype.hasOwnProperty.call(note || {}, "detail") ? payload.detail : fallback.detail;
  const createdAt = parseTimestamp(note && note.createdAt, now);
  const updatedAt = parseTimestamp(note && note.updatedAt, createdAt);
  return {
    id: note && note.id ? String(note.id) : note && note._id ? String(note._id) : createId(NOTE_PREFIX),
    title,
    detail,
    content: buildMemoContent(title, detail),
    createdAt,
    updatedAt,
    completed: Boolean(note && note.completed),
    completedAt: note && note.completedAt ? parseTimestamp(note.completedAt, null) : null
  };
}

function normalizeStore(raw) {
  const store = raw || {};
  return {
    notes: Array.isArray(store.notes) ? store.notes.map(normalizeNote) : []
  };
}

function getImportNotesPayload(raw) {
  if (Array.isArray(raw)) {
    return {
      notes: raw
    };
  }
  return {
    notes: Array.isArray(raw && raw.notes) ? raw.notes : []
  };
}

function getMemoImportSample() {
  return JSON.stringify({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: "2026-06-10T09:00:00.000+08:00",
    notes: [
      {
        title: "跟进双边履约冒烟结果",
        detail: "补充失败 case 的复现路径和截图。",
        completed: false,
        createdAt: "2026-06-10T09:00:00.000+08:00",
        updatedAt: "2026-06-10T09:20:00.000+08:00",
        completedAt: null
      },
      {
        title: "整理今日待办",
        detail: "导入时没有 id 会自动创建；有 id 会按 id 更新已有备忘。",
        completed: true,
        createdAt: "2026-06-10T08:30:00.000+08:00",
        updatedAt: "2026-06-10T10:00:00.000+08:00",
        completedAt: "2026-06-10T10:00:00.000+08:00"
      }
    ]
  }, null, 2) + "\n";
}

function sortNotes(notes) {
  return notes.slice().sort((a, b) => b.updatedAt - a.updatedAt);
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
    return note;
  }

  async toggleNote(id, completed) {
    const store = await this.readStore();
    const note = store.notes.find((item) => item.id === id);
    if (!note) {
      throw new Error("Note not found");
    }
    const now = Date.now();
    note.completed = Boolean(completed);
    note.completedAt = note.completed ? now : null;
    note.updatedAt = now;
    await this.saveStore(store);
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
    note.title = payload.title;
    note.detail = payload.detail;
    note.content = buildMemoContent(note.title, note.detail);
    note.updatedAt = Date.now();
    await this.saveStore(store);
    return normalizeNote(note);
  }

  async deleteNote(id) {
    const store = await this.readStore();
    const note = store.notes.find((item) => item.id === id);
    if (!note) {
      return;
    }
    store.notes = store.notes.filter((item) => item.id !== id);
    await this.saveStore(store);
  }

  async importNotes(filePath) {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    const payload = getImportNotesPayload(raw);
    const store = await this.readStore();
    const existingById = new Map(store.notes.map((note) => [note.id, note]));
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    payload.notes.forEach((item) => {
      const note = normalizeNote(item);
      if (!cleanText(note.title)) {
        skippedCount += 1;
        return;
      }
      const existing = existingById.get(note.id);
      if (existing) {
        Object.assign(existing, note);
        updatedCount += 1;
      } else {
        store.notes.push(note);
        existingById.set(note.id, note);
        createdCount += 1;
      }
    });

    await this.saveStore(store);

    return {
      createdCount,
      updatedCount,
      skippedCount,
      totalCount: store.notes.length
    };
  }

  async exportNotes(filePath) {
    const store = await this.readStore();
    const payload = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      notes: sortNotes(store.notes)
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return {
      filePath,
      noteCount: store.notes.length
    };
  }

  async writeImportSample(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, getMemoImportSample(), "utf8");
    return {
      filePath
    };
  }
}

module.exports = {
  MemoStore,
  getMemoImportSample
};
