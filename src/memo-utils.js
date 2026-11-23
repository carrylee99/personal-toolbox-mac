(function (root) {
  "use strict";
  const delayedWindowMs = 7 * 24 * 60 * 60 * 1000;

  function updatedTime(note) {
    const value = Number(note && (note.updatedAt || note.createdAt));
    return Number.isFinite(value) ? value : 0;
  }

  function isDelayed(note, now = Date.now()) {
    const updatedAt = updatedTime(note);
    return Boolean(note && !note.completed && updatedAt && now - updatedAt >= delayedWindowMs);
  }

  function pendingNotes(notes, now = Date.now()) {
    return notes.filter((note) => !note.completed && !isDelayed(note, now))
      .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  }

  const utils = { updatedTime, isDelayed, pendingNotes };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = utils;
  } else {
    root.memoUtils = utils;
  }
})(typeof window === "undefined" ? globalThis : window);
