const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeExpression, parseExpression, periodTarget } = require("../../src/quick-memo-date");

// 与备忘共用 Vault 和主进程串行队列；文档只记录时间表达，不记录备忘正文。
class TimeRuleStore {
  constructor(configStore) {
    this.configStore = configStore;
  }

  async getDataPath() {
    return path.join(await this.configStore.getVaultPath(), ".personal-toolbox", "time-rules.json");
  }

  async read() {
    try {
      const document = JSON.parse(await fs.readFile(await this.getDataPath(), "utf8"));
      if (document.version !== 1 || !Array.isArray(document.rules)
        || document.rules.some((rule) => typeof rule.expression !== "string"
          || !["pending", "learned"].includes(rule.status)
          || (rule.status === "learned" && typeof rule.target !== "string"))) {
        throw new Error("时间规则文档格式无效");
      }
      return document;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { version: 1, description: "pending：待学习；learned：已学习。target 保留相对日期，每次新建时重新计算。", rules: [] };
    }
  }

  async write(document) {
    const file = await this.getDataPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + ".tmp-" + process.pid;
    // 原子替换，写入失败保留旧规则；错误由调用方显示，不能假装已记录。
    await fs.writeFile(temporary, JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temporary, file);
  }

  async record(expression) {
    if (typeof expression !== "string" || !expression.trim() || expression.length > 200) {
      throw new Error("时间表达应为 1–200 个字符");
    }
    const document = await this.read();
    const key = normalizeExpression(expression);
    if (parseExpression(key, new Date(), document.rules) !== null) return;
    if (!document.rules.some((rule) => rule.expression === key)) {
      document.rules.push({ expression: key, original: expression, status: "pending", firstSeenAt: new Date().toISOString() });
      await this.write(document);
    }
  }

  async learn({ expressions, correction, dueAt, referenceAt }) {
    const document = await this.read();
    const now = new Date(referenceAt);
    const latest = expressions[expressions.length - 1];
    for (const expression of expressions) {
      const rule = document.rules.find((item) => item.expression === normalizeExpression(expression));
      if (!rule || rule.status === "learned") continue;
      // 只有最后一次未识别表达与最终修正建立对应；无截止时间不产生解析规则。
      if (expression !== latest || dueAt === null) continue;
      const period = /(?:凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间)$/.test(normalizeExpression(expression));
      const target = period ? periodTarget(expression, dueAt, now)
        : correction && parseExpression(correction, now) !== null ? normalizeExpression(correction) : null;
      if (target && parseExpression(target, now) !== null) {
        Object.assign(rule, { status: "learned", target, source: "user-correction", learnedAt: new Date().toISOString() });
      }
    }
    await this.write(document);
  }

  async loadRules() {
    // 每次新建都重新读取文档；待学习项没有人工确认的时刻，不能自动晋升。
    return (await this.read()).rules;
  }
}

module.exports = { TimeRuleStore };
