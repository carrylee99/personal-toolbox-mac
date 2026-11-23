(function (root) {
  "use strict";

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

  const calendar = { dateKey, fromKey, dueKey, monthDays, shiftMonth, endOfDay };
  if (typeof module !== "undefined" && module.exports) module.exports = calendar;
  else root.notchCalendar = calendar;
})(typeof window === "undefined" ? globalThis : window);
