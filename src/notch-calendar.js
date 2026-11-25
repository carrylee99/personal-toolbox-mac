(function (root) {
  "use strict";

  const lunarFormatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" });
  const lunarDigits = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

  function lunarDate(date) {
    // 沿用月历的本地日期；内置农历保留“闰月”，仅将数字日转为惯用中文。
    const parts = lunarFormatter.formatToParts(date);
    const month = parts.find((part) => part.type === "month").value;
    const day = Number(parts.find((part) => part.type === "day").value);
    const label = day <= 10 ? "初" + lunarDigits[day - 1]
      : day < 20 ? "十" + lunarDigits[day - 11]
      : day === 20 ? "二十"
      : day < 30 ? "廿" + lunarDigits[day - 21] : "三十";
    return "农历" + month + label;
  }

  function dateKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function fromKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    // 使用本地中午，避免把 ISO 日期解析为 UTC，或夏令时切换时落到前一天。
    return new Date(year, month - 1, day, 12);
  }

  function dueKey(note) {
    const time = Number(note.dueAt);
    return time > 0 && Number.isFinite(new Date(time).getTime()) ? dateKey(new Date(time)) : null;
  }

  function monthDays(date) {
    const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const offset = (first.getDay() + 6) % 7;
    const length = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + index, 12));
  }

  function shiftMonth(date, amount) {
    const first = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(date.getDate(), lastDay));
    return first;
  }

  function endOfDay(key) {
    const date = fromKey(key);
    date.setHours(23, 59, 0, 0);
    return date.getTime();
  }

  const calendar = { dateKey, fromKey, dueKey, monthDays, shiftMonth, endOfDay, lunarDate };
  if (typeof module !== "undefined" && module.exports) module.exports = calendar;
  else root.notchCalendar = calendar;
})(typeof window === "undefined" ? globalThis : window);
