(function () {
  "use strict";
  const api = window.toolbox;
  const content = document.getElementById("notchContent");
  const list = document.getElementById("notchList");
  const calendar = window.notchCalendar;
  const days = document.getElementById("calendarDays");
  const monthLabel = document.getElementById("calendarMonth");
  const agendaDate = document.getElementById("agendaDate");
  const summary = document.getElementById("agendaSummary");
  const unscheduled = document.getElementById("unscheduledToggle");
  let today = calendar.dateKey(new Date());
  let selectedDate = today;
  let filterMode = "all";
  const errorBox = document.getElementById("notchError");
  const close = document.getElementById("notchClose");
  let notes = [];
  let groups = [];
  let selectedGroup = localStorage.getItem("personalToolbox.notchGroupId") ?? "all";
  const groupBar = window.memoGroups.createBar(document.getElementById("notchGroups"), {
    compact: true,
    onSelect(id) {
      selectedGroup = id;
      localStorage.setItem("personalToolbox.notchGroupId", id);
      list.scrollTop = 0;
      render();
    }
  });
  let refreshId = 0;
  let expanded = false;
  const saving = new Set();

  function showError(message) {
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  }

  function selectDate(date, focusDay = false) {
    selectedDate = calendar.dateKey(date);
    filterMode = "date";
    list.scrollTop = 0;
    render();
    if (focusDay) days.querySelector('[data-date="' + selectedDate + '"]').focus({ preventScroll: true });
  }

  function renderCalendar(pending) {
    const focusedDate = document.activeElement?.dataset.date;
    const selected = calendar.fromKey(selectedDate);
    const dueCounts = new Map();
    pending.forEach((note) => {
      const key = calendar.dueKey(note);
      if (key) dueCounts.set(key, (dueCounts.get(key) || 0) + 1);
    });
    monthLabel.textContent = selected.getFullYear() + "年" + (selected.getMonth() + 1) + "月";
    days.replaceChildren();
    calendar.monthDays(selected).forEach((date) => {
      const key = calendar.dateKey(date);
      const amount = dueCounts.get(key) || 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      button.dataset.date = key;
      button.textContent = date.getDate();
      button.tabIndex = key === selectedDate ? 0 : -1;
      button.classList.toggle("is-outside", date.getMonth() !== selected.getMonth());
      button.classList.toggle("is-today", key === today);
      button.classList.toggle("is-selected", key === selectedDate && filterMode === "date");
      button.classList.toggle("has-tasks", amount > 0);
      button.setAttribute("aria-pressed", String(key === selectedDate && filterMode === "date"));
      if (key === today) button.setAttribute("aria-current", "date");
      button.setAttribute("aria-label", new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(date) + (key === today ? "，今天" : "") + "，" + amount + "项待办");
      button.addEventListener("click", () => selectDate(date, true));
      button.addEventListener("keydown", (event) => {
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        let next = new Date(date);
        if (delta) next.setDate(date.getDate() + delta);
        else if (event.key === "Home") next.setDate(date.getDate() - (date.getDay() + 6) % 7);
        else if (event.key === "End") next.setDate(date.getDate() + 6 - (date.getDay() + 6) % 7);
        else if (event.key === "PageUp" || event.key === "PageDown") next = calendar.shiftMonth(date, event.key === "PageUp" ? -1 : 1);
        else return;
        event.preventDefault();
        selectDate(next, true);
      });
      days.append(button);
    });
    if (focusedDate && expanded) {
      const next = Array.from(days.children).find((button) => button.dataset.date === focusedDate)
        || Array.from(days.children).find((button) => button.dataset.date === selectedDate);
      next.focus({ preventScroll: true });
    }
  }

  function render() {
    const nextToday = calendar.dateKey(new Date());
    if (today !== nextToday) {
      if (selectedDate === today) selectedDate = nextToday;
      today = nextToday;
    }
    const ordinary = window.memoUtils.pendingNotes(notes);
    groupBar.update({ groups, notes: ordinary, selected: selectedGroup });
    const allPending = ordinary.filter((note) => window.memoGroups.matches(note, selectedGroup));
    renderCalendar(allPending);
    const pending = filterMode === "all" ? allPending : allPending.filter((note) => filterMode === "unscheduled" ? !calendar.dueKey(note) : calendar.dueKey(note) === selectedDate);
    const unscheduledCount = allPending.filter((note) => !calendar.dueKey(note)).length;
    const selected = calendar.fromKey(selectedDate);
    agendaDate.textContent = filterMode === "all" ? "全部待办" : filterMode === "unscheduled" ? "未安排" : (selected.getMonth() + 1) + "月" + selected.getDate() + "日";
    const calendarHint = document.getElementById("calendarHint");
    calendarHint.textContent = calendar.lunarDate(selected);
    calendarHint.title = selectedDate + " · " + calendarHint.textContent;
    summary.textContent = "· " + pending.length;
    summary.setAttribute("aria-label", pending.length + "项未完成待办");
    unscheduled.textContent = filterMode !== "all" ? "全部待办" : "未安排" + (unscheduledCount ? " " + unscheduledCount : "");
    unscheduled.setAttribute("aria-pressed", String(filterMode === "unscheduled"));
    list.setAttribute("aria-label", filterMode === "all" ? "全部普通未完成待办" : filterMode === "unscheduled" ? "未设置截止日期的待办" : selectedDate + "的未完成待办");
    // 数据通知不应把键盘焦点从用户正在操作的任务上移走。
    const focused = document.activeElement;
    const focusedId = focused && focused.dataset.noteId;
    const focusedAction = focused && focused.dataset.action;
    const oldIndex = focusedId ? Array.from(list.children).findIndex((row) => row.dataset.noteId === focusedId) : -1;
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    if (!pending.length) {
      const empty = document.createElement("div");
      empty.className = "notch-empty";
      const title = document.createElement("strong");
      title.textContent = filterMode === "all" ? "暂无待办" : filterMode === "unscheduled" ? "没有未安排的待办" : "当天暂无待办";
      const help = document.createElement("span");
      help.textContent = "有新想法，随时记下来";
      empty.append(title, help);
      list.append(empty);
    }
    pending.forEach((note) => {
      const title = note.title || String(note.content || "").split("\n")[0];
      const row = document.createElement("div");
      row.className = "notch-row";
      row.dataset.noteId = note.id;
      const check = document.createElement("button");
      check.className = "notch-check";
      check.type = "button";
      check.dataset.noteId = note.id;
      check.dataset.action = "complete";
      check.setAttribute("aria-label", "完成：" + title);
      check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>';
      check.disabled = saving.has(note.id);
      check.addEventListener("click", async () => {
        if (saving.has(note.id)) return;
        const retainFocus = document.activeElement === check;
        const rowIndex = pending.findIndex((item) => item.id === note.id);
        saving.add(note.id);
        check.disabled = true;
        showError("");
        try {
          await api.memo.toggleNote(note.id, true);
          await refresh();
        } catch (error) {
          console.error("Failed to complete notch todo", error);
          showError("完成失败，请重试。任务已保留。");
        } finally {
          saving.delete(note.id);
          render();
          // disabled 会让按钮失去焦点；完成后把键盘操作接续到相邻任务。
          if (retainFocus && expanded) {
            const checks = Array.from(list.querySelectorAll(".notch-check"));
            const next = checks[Math.min(rowIndex, checks.length - 1)] || document.getElementById("notchAdd");
            next.focus({ preventScroll: true });
          }
        }
      });
      const task = document.createElement("button");
      task.className = "notch-task";
      task.type = "button";
      task.dataset.noteId = note.id;
      task.dataset.action = "open";
      task.title = title;
      task.addEventListener("click", () => api.notch.openNote(note.id).catch((error) => {
        console.error("Failed to open memo", error);
        showError("无法打开任务，请重试。");
      }));
      const label = document.createElement("span");
      label.className = "notch-title";
      label.textContent = title;
      task.append(label);
      if (note.dueAt) {
        const due = document.createElement("span");
        const overdue = Number(note.dueAt) <= Date.now();
        due.className = "notch-due" + (overdue ? " is-overdue" : "");
        const dueDate = new Date(note.dueAt);
        const isToday = calendar.dueKey(note) === today;
        const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(dueDate);
        const day = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(dueDate);
        // 同行显示简短期限，完整日期/时间仍保留在悬停提示和无障碍名称中。
        due.textContent = (overdue ? "逾期 " : "") + (filterMode === "date" ? time : isToday ? "今天 " + time : day);
        const deadline = (overdue ? "已逾期，" : "") + "截止 " + new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeStyle: "short" }).format(dueDate);
        task.title = title + "\n" + deadline;
        task.setAttribute("aria-label", title + "，" + deadline);
        task.append(due);
      }
      row.append(check, task);
      list.append(row);
    });
    list.scrollTop = scrollTop;
    if (focusedId && expanded) {
      const targets = Array.from(list.querySelectorAll("button"));
      const next = targets.find((button) => button.dataset.noteId === focusedId && button.dataset.action === focusedAction)
        || list.children[Math.min(Math.max(oldIndex, 0), pending.length - 1)]?.querySelector("button")
        || document.getElementById("notchAdd");
      next.focus({ preventScroll: true });
    }
  }

  async function refresh() {
    const id = ++refreshId;
    try {
      const loaded = await api.memo.listData();
      if (id === refreshId) {
        notes = loaded.notes;
        groups = loaded.groups;
        if (selectedGroup && selectedGroup !== "all" && !groups.some((group) => group.id === selectedGroup)) selectedGroup = "all";
        render();
      }
    } catch (error) {
      console.error("Failed to refresh notch todos", error);
      showError("读取待办失败，请稍后重试。");
    }
  }

  close.addEventListener("click", () => api.notch.collapse());
  document.getElementById("notchAdd").addEventListener("click", () => {
    // 仅用户主动按日期筛选时带入期限；默认全部待办和未安排均不强加日期。
    api.notch.quickMemo(filterMode === "date" ? calendar.endOfDay(selectedDate) : null, selectedGroup === "all" ? "" : selectedGroup).catch((error) => {
      console.error("Failed to open quick memo", error);
      showError("无法打开极速备忘，请重试。");
    });
  });
  document.getElementById("previousMonth").addEventListener("click", () => selectDate(calendar.shiftMonth(calendar.fromKey(selectedDate), -1)));
  document.getElementById("nextMonth").addEventListener("click", () => selectDate(calendar.shiftMonth(calendar.fromKey(selectedDate), 1)));
  document.getElementById("calendarToday").addEventListener("click", () => selectDate(new Date()));
  unscheduled.addEventListener("click", () => {
    filterMode = filterMode === "all" ? "unscheduled" : "all";
    list.scrollTop = 0;
    render();
  });
  api.notch.onState((state) => {
    const opening = state.expanded && !expanded;
    expanded = state.expanded;
    if (!expanded) groupBar.close();
    document.documentElement.style.setProperty("--notch-inset", state.inset + "px");
    // 保留 DOM 到退出动画完成，inert 立即移除隐藏内容的键盘/鼠标操作能力。
    content.inert = !expanded;
    content.setAttribute("aria-hidden", String(!expanded));
    document.body.classList.toggle("is-expanded", expanded);
    if (opening) {
      // 每次唤出恢复全部待办，避免上次日期筛选把任务藏起来。
      filterMode = "all";
      list.scrollTop = 0;
      render();
      refresh();
      if (state.keyboardOpened) {
        close.focus();
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); api.notch.collapse(); }
  });
  api.memo.onChanged(refresh);
  // 使用相同时间窗口，保持跨过七天延期边界时主列表与刘海一致。
  setInterval(() => expanded && render(), 30000);
  refresh();
  api.notch.ready();
})();
