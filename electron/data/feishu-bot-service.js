const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");

const MAX_TODO_ITEMS = 30;
const MAX_DETAIL_LENGTH = 120;

function cleanText(value) {
  return String(value || "").trim();
}

function normalizePushScope(value) {
  return value === "today_created_pending" ? "today_created_pending" : "all_pending";
}

function toLocalDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatLocalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return [
    toLocalDateKey(date),
    [String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0")].join(":")
  ].join(" ");
}

function getMemoTitle(note) {
  const title = cleanText(note && note.title);
  if (title) {
    return title;
  }
  return cleanText(String((note && note.content) || "").split(/\r?\n/)[0]) || "未命名备忘";
}

function getMemoDetail(note) {
  if (typeof (note && note.detail) === "string") {
    return cleanText(note.detail);
  }
  const lines = String((note && note.content) || "").replace(/\r\n/g, "\n").split("\n");
  lines.shift();
  return cleanText(lines.join("\n"));
}

function truncate(value, maxLength) {
  const text = cleanText(value).replace(/\s*\n+\s*/g, " / ");
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + "...";
}

function filterTodoNotes(notes, pushScope, now) {
  const scope = normalizePushScope(pushScope);
  const today = toLocalDateKey(now || new Date());
  return (Array.isArray(notes) ? notes : []).filter((note) => {
    if (!note || note.completed) {
      return false;
    }
    if (scope !== "today_created_pending") {
      return true;
    }
    return toLocalDateKey(note.createdAt) === today;
  });
}

function createSign(timestamp, secret) {
  const stringToSign = timestamp + "\n" + secret;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

function createPostPayload(title, lines) {
  return {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title,
          content: lines.map((line) => [{ tag: "text", text: line }])
        }
      }
    }
  };
}

function createTodoPayload(notes, options) {
  const now = options && options.now ? options.now : new Date();
  const scope = normalizePushScope(options && options.pushScope);
  const scopeLabel = scope === "today_created_pending" ? "今日新增未完成" : "全部未完成";
  const lines = [
    scopeLabel + " " + notes.length + " 条 · " + formatLocalDateTime(now)
  ];
  notes.slice(0, MAX_TODO_ITEMS).forEach((note, index) => {
    lines.push((index + 1) + ". " + getMemoTitle(note));
    const detail = truncate(getMemoDetail(note), MAX_DETAIL_LENGTH);
    if (detail) {
      lines.push("   " + detail);
    }
  });
  if (notes.length > MAX_TODO_ITEMS) {
    lines.push("还有 " + (notes.length - MAX_TODO_ITEMS) + " 条未展示，请打开个人工具箱查看。");
  }
  return createPostPayload("个人工具箱待办提醒", lines);
}

function createTestPayload() {
  return createPostPayload("个人工具箱飞书机器人测试", [
    "配置验证成功。",
    "后续可以把待办从个人工具箱推送到这个飞书群。"
  ]);
}

function createSignedPayload(payload, settings, now) {
  const secret = cleanText(settings && settings.secret);
  if (!secret) {
    return payload;
  }
  const timestamp = String(Math.floor((now || new Date()).getTime() / 1000));
  return Object.assign({
    timestamp,
    sign: createSign(timestamp, secret)
  }, payload);
}

function validateWebhookUrl(value) {
  const webhookUrl = cleanText(value);
  if (!webhookUrl) {
    throw new Error("飞书机器人 Webhook 不能为空");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch (error) {
    throw new Error("飞书机器人 Webhook 格式不正确");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("飞书机器人 Webhook 必须是 HTTP 或 HTTPS 地址");
  }
  return parsedUrl;
}

function postJson(url, payload) {
  const parsedUrl = validateWebhookUrl(url);
  const body = JSON.stringify(payload);
  const client = parsedUrl.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.request(parsedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 10000
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (error) {
          reject(new Error("飞书机器人返回了无法解析的响应"));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error("飞书机器人请求失败 HTTP " + response.statusCode));
          return;
        }
        const code = Number(Object.prototype.hasOwnProperty.call(data, "code") ? data.code : data.StatusCode);
        if (Number.isFinite(code) && code !== 0) {
          reject(new Error("飞书机器人返回错误 " + code + "：" + (data.msg || data.StatusMessage || "未知错误")));
          return;
        }
        resolve(data);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("飞书机器人请求超时"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function sendFeishuMessage(settings, payload, now) {
  const webhookUrl = cleanText(settings && settings.webhookUrl);
  const signedPayload = createSignedPayload(payload, settings, now);
  await postJson(webhookUrl, signedPayload);
}

async function sendTodoNotes(settings, notes, options) {
  const now = options && options.now ? options.now : new Date();
  await sendFeishuMessage(settings, createTodoPayload(notes, {
    now,
    pushScope: settings && settings.pushScope
  }), now);
  return {
    noteCount: notes.length,
    pushScope: normalizePushScope(settings && settings.pushScope),
    sentAt: now.toISOString()
  };
}

async function sendTestMessage(settings) {
  const now = new Date();
  await sendFeishuMessage(settings, createTestPayload(), now);
  return {
    sentAt: now.toISOString()
  };
}

module.exports = {
  filterTodoNotes,
  normalizePushScope,
  sendTodoNotes,
  sendTestMessage,
  toLocalDateKey
};
