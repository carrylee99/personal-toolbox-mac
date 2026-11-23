(function (root) {
  "use strict";

  const digits = "零一二三四五六七八九";
  function number(text) {
    if (/^\d+$/.test(text)) return Number(text);
    text = text.replace(/两/g, "二");
    if (/^[零一二三四五六七八九]+$/.test(text)) {
      return Number([...text].map((char) => digits.indexOf(char)).join(""));
    }
    const match = text.match(/^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/);
    return match ? (match[1] ? digits.indexOf(match[1]) : 1) * 10 + (match[2] ? digits.indexOf(match[2]) : 0) : NaN;
  }

  function localDate(year, month, day, hour = 23, minute = 59) {
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    // 禁止 Date 自动把 2 月 30 日或不存在的夏令时时刻进位成另一天。
    return year >= 1000 && year <= 9999 && date.getFullYear() === year && date.getMonth() === month - 1
      && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute ? date : null;
  }

  function normalizeExpression(expression) {
    return expression.trim().replace(/(\d)\s+(?=\d)/g, "$1T").replace(/\s+/g, "").replace(/：/g, ":")
      .replace(/[。.!！]+$/, "").replace(/^(?:截止到?|到期时间[:：]?)/, "")
      .replace(/(?:之前|以前|前)(?:截止|到期)$|(?:截止|到期)?(?:之前|以前|前)?$/, "")
      .replace(/^今晚/, "今天晚上").replace(/^明晚/, "明天晚上").replace(/^今早/, "今天早上").replace(/^明早/, "明天早上");
  }

  function parseExpression(expression, now = new Date(), rules = []) {
    const key = normalizeExpression(expression);
    const learned = rules.find((rule) => rule.status === "learned" && rule.expression === key);
    // 规则只保存可解析的表达式，不执行文档中的代码；目标直接走内建解析，杜绝别名循环。
    let text = learned ? normalizeExpression(learned.target) : key;
    text = text.replace(/[零〇一二两三四五六七八九十]+/g, (part) => String(number(part.replace(/〇/g, "零"))));
    const relative = text.match(/^(\d+|半)(?:个)?(分钟|小时|天|周|星期)(?:以)?后$/);
    if (relative) {
      const amount = relative[1] === "半" ? 0.5 : Number(relative[1]);
      if (!Number.isSafeInteger(amount) && amount !== 0.5) return null;
      const unit = relative[2];
      if (["分钟", "小时"].includes(unit)) {
        const date = new Date(Math.floor((now.getTime() + amount * (unit === "小时" ? 3600000 : 60000)) / 60000) * 60000);
        return date.getFullYear() <= 9999 ? date.getTime() : null;
      }
      if (!Number.isInteger(amount) || amount > 36500) return null;
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + amount * (["周", "星期"].includes(unit) ? 7 : 1), 23, 59);
      return date.getTime();
    }

    let date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
    let hasDate = false;
    let match;
    const days = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3, 昨天: -1 };
    if ((match = text.match(/^(大后天|今天|今日|明天|明日|后天|昨天)/))) {
      date.setDate(date.getDate() + days[match[1]]);
    } else if ((match = text.match(/^(\d+)(天|周|星期)(?:以)?后/))) {
      const amount = Number(match[1]);
      if (amount > 36500) return null;
      date.setDate(date.getDate() + amount * (match[2] === "天" ? 1 : 7));
    } else if ((match = text.match(/^(本|这|下下|下)?(?:周|星期|礼拜)([1-6日天])/))) {
      const target = /[日天]/.test(match[2]) ? 7 : Number(match[2]);
      const current = now.getDay() || 7;
      const offset = match[1] === "下下" ? 14 : match[1] === "下" ? 7 : !match[1] && target < current ? 7 : 0;
      date.setDate(date.getDate() + target - current + offset);
    } else if ((match = text.match(/^(本月月底|这个月底|本月底|月底|下个月底|下月底)/))) {
      date = new Date(now.getFullYear(), now.getMonth() + (match[1].startsWith("下") ? 2 : 1), 0, 23, 59);
    } else if ((match = text.match(/^(\d{4})([-/])(\d{1,2})\2(\d{1,2})/))) {
      date = localDate(Number(match[1]), Number(match[3]), Number(match[4]));
    } else if ((match = text.match(/^(?:(\d{4}|今年|明年)年?)?(\d{1,2})月(\d{1,2})(?:日|号)?/))) {
      const year = match[1] === "明年" ? now.getFullYear() + 1 : !match[1] || match[1] === "今年" ? now.getFullYear() : Number(match[1]);
      date = localDate(year, Number(match[2]), Number(match[3]));
    } else if ((match = text.match(/^(\d{1,2})([-/])(\d{1,2})/))) {
      date = localDate(now.getFullYear(), Number(match[1]), Number(match[3]));
    }
    if (match) {
      if (!date) return null;
      hasDate = true;
      text = text.slice(match[0].length);
    }
    if (!text) return hasDate ? date.getTime() : null;
    text = text.replace(/^[T的]/, "");
    const time = text.match(/^(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间|今晚)?(?:(\d{1,2}):(\d{2})|(\d{1,2})(?:点|时)(?:(半|1刻|3刻)|(\d{1,2})(?:分)?)?)$/);
    if (!time) return null;
    let hour = Number(time[2] || time[4]);
    const minute = time[3] ? Number(time[3]) : time[5] === "半" ? 30 : time[5] === "1刻" ? 15 : time[5] === "3刻" ? 45 : Number(time[6] || 0);
    const period = time[1];
    if (period) {
      if (hour > 23) return null;
      if (["早上", "早晨", "上午", "凌晨"].includes(period) && hour > 12) return null;
      if (["下午", "傍晚", "晚上", "晚间", "今晚", "中午"].includes(period) && hour === 0) return null;
      // 晚上十二点是次日零点；日期预览明确显示跨日结果。
      if (["晚上", "晚间", "今晚"].includes(period) && hour === 12) {
        date.setDate(date.getDate() + 1);
        hour = 0;
      }
      if (["下午", "傍晚", "晚上", "晚间", "今晚"].includes(period) && hour > 0 && hour < 12) hour += 12;
      if (period === "凌晨" && hour === 12) hour = 0;
      if (period === "中午" && hour < 11) {
        if (hour > 2) return null;
        hour += 12;
      }
    }
    if (hour > 23 || minute > 59) return null;
    return localDate(date.getFullYear(), date.getMonth() + 1, date.getDate(), hour, minute)?.getTime() ?? null;
  }

  function extract(value, separator = "---") {
    const content = String(value || "").replace(/\r\n/g, "\n");
    // 使用字面匹配；取首次识别符，避免单个 -、: 等符号与后面的日期/时刻冲突。
    const index = separator ? content.indexOf(separator) : -1;
    if (index < 0) return { content, expression: null };
    const end = content.indexOf("\n", index);
    return {
      expression: content.slice(index + separator.length, end < 0 ? undefined : end).trim(),
      // 只移除分隔符所在行的时间描述，后续多行详情照常保留。
      content: content.slice(0, index).trimEnd() + (end < 0 ? "" : content.slice(end))
    };
  }

  // 学习只补全缺失的时刻，日期仍由原表达解析；不把“今天”保存成固定日期。
  function periodTarget(expression, dueAt = null, now = new Date()) {
    const text = normalizeExpression(expression);
    const match = text.match(/^(.*?)(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间)$/);
    if (!match) return null;
    const datePart = match[1].replace(/的$/, "") || "今天";
    const day = parseExpression(datePart, now);
    if (day === null) return null;
    // 模糊时段必须由用户提供具体时刻；没有确认依据时只记录，绝不猜测。
    if (dueAt === null) return null;
    const manual = new Date(dueAt);
    const expected = new Date(day);
    if (manual.toDateString() !== expected.toDateString()) return null;
    const time = `${String(manual.getHours()).padStart(2, "0")}:${String(manual.getMinutes()).padStart(2, "0")}`;
    return datePart + "T" + time;
  }

  const api = { extract, parseExpression, normalizeExpression, periodTarget };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QuickMemoDate = api;
})(typeof window === "undefined" ? globalThis : window);
