const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const SOURCE_BASE_URL = "https://yunshuwu.cn";
const CATALOG_URL = SOURCE_BASE_URL + "/chaps/861.html";
const SOURCE_NAME = "云书屋";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_FILE_NAME = "daily-poem-cache.json";

class DailyPoemService {
  constructor(appOrOptions) {
    const options = appOrOptions || {};
    this.cachePath = options.cachePath || (options.getPath ? path.join(options.getPath("userData"), CACHE_FILE_NAME) : "");
    this.inflight = new Map();
  }

  async getDailyPoem(dateKey) {
    const normalizedDateKey = normalizeDateKey(dateKey);
    const cached = await this.getCachedPoem(normalizedDateKey);
    if (cached) {
      return Object.assign({}, cached, { cached: true });
    }

    if (this.inflight.has(normalizedDateKey)) {
      return this.inflight.get(normalizedDateKey);
    }

    const pending = this.fetchAndCacheDailyPoem(normalizedDateKey);
    this.inflight.set(normalizedDateKey, pending);
    try {
      return await pending;
    } finally {
      this.inflight.delete(normalizedDateKey);
    }
  }

  async fetchAndCacheDailyPoem(normalizedDateKey) {
    const catalogHtml = await fetchText(CATALOG_URL);
    const works = parseCatalog(catalogHtml);
    if (!works.length) {
      throw new Error("未读取到诗词目录");
    }

    const selected = works[hashText(normalizedDateKey) % works.length];
    const sourceUrl = new URL(selected.href, SOURCE_BASE_URL).toString();
    const detailHtml = await fetchText(sourceUrl);
    const detail = parsePoemDetail(detailHtml, selected.title);

    const poem = {
      dateKey: normalizedDateKey,
      title: detail.title,
      content: detail.content,
      sourceName: SOURCE_NAME,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      cached: false
    };
    await this.saveCachedPoem(poem);
    return poem;
  }

  async getCachedPoem(dateKey) {
    const cache = await this.readCache();
    const poem = cache.poems && cache.poems[dateKey];
    if (!poem || !poem.title || !poem.content) {
      return null;
    }
    return normalizeCachedPoem(poem, dateKey);
  }

  async saveCachedPoem(poem) {
    if (!this.cachePath) {
      return;
    }
    const cache = await this.readCache();
    cache.poems[poem.dateKey] = normalizeCachedPoem(poem, poem.dateKey);
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    await fs.writeFile(this.cachePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
  }

  async readCache() {
    if (!this.cachePath) {
      return createEmptyCache();
    }
    try {
      const raw = JSON.parse(await fs.readFile(this.cachePath, "utf8"));
      return normalizeCache(raw);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to read daily poem cache, using empty cache", error);
      }
      return createEmptyCache();
    }
  }
}

function createEmptyCache() {
  return {
    schemaVersion: 1,
    poems: {}
  };
}

function normalizeCache(raw) {
  const cache = createEmptyCache();
  const poems = raw && raw.poems && typeof raw.poems === "object" ? raw.poems : {};
  Object.keys(poems).forEach((dateKey) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return;
    }
    const poem = normalizeCachedPoem(poems[dateKey], dateKey);
    if (poem.title && poem.content) {
      cache.poems[dateKey] = poem;
    }
  });
  return cache;
}

function normalizeCachedPoem(poem, dateKey) {
  return {
    dateKey,
    title: String((poem && poem.title) || ""),
    content: String((poem && poem.content) || ""),
    sourceName: String((poem && poem.sourceName) || SOURCE_NAME),
    sourceUrl: String((poem && poem.sourceUrl) || ""),
    fetchedAt: String((poem && poem.fetchedAt) || new Date().toISOString())
  };
}

function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;
    const request = client.get(parsedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 PersonalToolbox/0.1",
        "Accept": "text/html;charset=utf-8"
      }
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume();
        if (redirectCount >= 4) {
          reject(new Error("网页重定向次数过多"));
          return;
        }
        resolve(fetchText(new URL(location, parsedUrl).toString(), redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error("网页请求失败：" + statusCode));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("网页响应过大"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        decodeResponse(buffer, response.headers["content-encoding"], (error, decoded) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(decoded.toString("utf8"));
        });
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("联网读取诗词超时"));
    });
    request.on("error", reject);
  });
}

function decodeResponse(buffer, encoding, callback) {
  const normalized = String(encoding || "").toLowerCase();
  if (normalized.includes("br")) {
    zlib.brotliDecompress(buffer, callback);
    return;
  }
  if (normalized.includes("gzip")) {
    zlib.gunzip(buffer, callback);
    return;
  }
  if (normalized.includes("deflate")) {
    zlib.inflate(buffer, callback);
    return;
  }
  callback(null, buffer);
}

function parseCatalog(html) {
  const works = [];
  const seen = new Set();
  const linkPattern = /<a\s+href=["'](\/chap\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = linkPattern.exec(html);
  while (match) {
    const href = match[1];
    const title = cleanInlineText(stripTags(match[2]));
    if (title && !seen.has(href)) {
      seen.add(href);
      works.push({ href, title });
    }
    match = linkPattern.exec(html);
  }
  return works;
}

function parsePoemDetail(html, fallbackTitle) {
  const titleMatch = html.match(/<span\b[^>]*id=["']chaptitle["'][^>]*>([\s\S]*?)<\/span>/i);
  const title = cleanInlineText(stripTags(titleMatch ? titleMatch[1] : fallbackTitle));
  const contentMatch = html.match(/<p\b[^>]*id=["']chapcont["'][^>]*>([\s\S]*?)<\/p>/i);
  const contentHtml = contentMatch ? contentMatch[1] : html;
  const plainText = htmlToText(contentHtml);
  const content = extractOriginalText(plainText, title);

  if (!content) {
    throw new Error("未解析到诗词正文");
  }
  return { title: title || fallbackTitle || "每日诗词", content };
}

function extractOriginalText(text, title) {
  let value = String(text || "");
  const originalIndex = value.indexOf("【原文】");
  if (originalIndex >= 0) {
    value = value.slice(originalIndex + "【原文】".length);
  }

  const cutMarkers = ["作品赏析", "【注释】", "【译文】", "【赏析】", "作者简介"];
  const cutAt = cutMarkers.reduce((current, marker) => {
    const index = value.indexOf(marker);
    if (index < 0) {
      return current;
    }
    return current < 0 ? index : Math.min(current, index);
  }, -1);
  if (cutAt >= 0) {
    value = value.slice(0, cutAt);
  }

  const normalizedTitle = cleanInlineText(title);
  return value
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => cleanInlineText(line))
    .filter((line) => line && line !== normalizedTitle)
    .join("\n")
    .trim();
}

function htmlToText(html) {
  return decodeHtmlEntities(String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, ""));
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, ""));
}

function cleanInlineText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t　]+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function normalizeDateKey(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return String(value);
  }
  const date = new Date();
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function hashText(value) {
  return String(value || "").split("").reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) >>> 0;
  }, 2166136261);
}

module.exports = {
  DailyPoemService,
  parseCatalog,
  parsePoemDetail,
  normalizeCache
};
