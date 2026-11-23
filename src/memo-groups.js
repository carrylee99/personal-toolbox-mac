(function (root) {
  "use strict";
  const colors = ["#9bafff", "#80d2aa", "#e9c27d", "#c0a6ef", "#e6a8c4", "#86cbd8", "#a1a3ae"];

  // 只识别首行、行首或空白之后的符号；C#、URL 片段和详情中的 # 保留为正文。
  function extract(value, separator = "#", dateSeparator = "---") {
    const text = String(value || "");
    const line = text.split("\n")[0];
    const tokens = [];
    for (let index = 0; index < line.length; index++) {
      if (!line.startsWith(separator, index) || (index && !/\s/.test(line[index - 1]))) continue;
      const start = index;
      let cursor = index + separator.length;
      let query = "";
      let closed = true;
      if (line[cursor] === '"') {
        const end = line.indexOf('"', cursor + 1);
        closed = end >= 0;
        query = line.slice(cursor + 1, closed ? end : undefined);
        cursor = closed ? end + 1 : line.length;
      } else {
        const from = cursor;
        while (cursor < line.length && !/\s/.test(line[cursor]) && !line.startsWith(dateSeparator, cursor)) cursor++;
        query = line.slice(from, cursor);
      }
      tokens.push({ start, end: cursor, query, closed });
      index = cursor - 1;
    }
    return { tokens, content: tokens.reduceRight((result, token) => result.slice(0, token.start) + result.slice(token.end), text).replace(/[ \t]+$/m, "") };
  }

  function matches(note, selected) {
    return selected === "all" || (note.groupId || "") === selected;
  }

  function createBar(container, { compact = false, onSelect, onManage }) {
    let data = { groups: [], notes: [], selected: "all" };
    const row = document.createElement("div");
    row.className = "memo-group-tabs";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "待办分组");
    const more = document.createElement("button");
    more.type = "button";
    more.className = "group-more";
    more.setAttribute("aria-label", "更多分组");
    more.setAttribute("aria-expanded", "false");
    const popup = document.createElement("div");
    popup.className = "group-popup";
    popup.hidden = true;
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "搜索分组";
    search.setAttribute("aria-label", "搜索分组");
    const options = document.createElement("div");
    options.className = "group-options";
    popup.append(search, options);
    container.classList.add("memo-group-bar");
    container.classList.toggle("is-compact", compact);
    container.append(row, ...(compact ? [more] : []), popup);
    function reveal(item) {
      if (!compact || !item) return;
      const edge = row.getBoundingClientRect();
      const bounds = item.getBoundingClientRect();
      if (bounds.left < edge.left) row.scrollLeft += bounds.left - edge.left;
      else if (bounds.right > edge.right) row.scrollLeft += bounds.right - edge.right;
    }
    if (compact) {
      row.title = "滚动切换分组，也可点击右侧更多";
      // 滚轮仅在分组栏内转为横向滚动；触控板的水平滚动沿用浏览器原生行为。
      row.addEventListener("wheel", (event) => {
        if (event.ctrlKey || row.scrollWidth <= row.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? row.clientWidth : 1;
        row.scrollLeft += event.deltaY * unit;
      }, { passive: false });
      row.addEventListener("focusin", (event) => reveal(event.target.closest("button")));
      row.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(row.querySelectorAll("button"));
        const current = buttons.indexOf(document.activeElement);
        if (current < 0) return;
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
        buttons[index].focus({ preventScroll: true });
        reveal(buttons[index]);
      });
    }
    function close(focus = false) {
      popup.hidden = true;
      more.setAttribute("aria-expanded", "false");
      if (focus) more.focus();
    }
    function choose(id) {
      const fromPopup = popup.contains(document.activeElement);
      close();
      onSelect(id);
      if (fromPopup) {
        const target = Array.from(row.querySelectorAll("button")).find((item) => item.dataset.groupId === id) || more;
        target.focus({ preventScroll: true });
        if (target !== more) reveal(target);
      }
    }
    function button(id, name, color, count = true) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "group-tab";
      item.setAttribute("aria-pressed", String(id === data.selected));
      item.dataset.groupId = id;
      item.title = name;
      if (color) {
        const dot = document.createElement("span");
        dot.className = "group-dot";
        dot.style.backgroundColor = color;
        dot.setAttribute("aria-hidden", "true");
        item.append(dot);
      }
      const label = document.createElement("span");
      label.className = "group-label";
      label.textContent = name;
      item.append(label);
      if (count) {
        const badge = document.createElement("span");
        badge.className = "group-count";
        badge.textContent = data.notes.filter((note) => matches(note, id)).length;
        item.append(badge);
      }
      item.addEventListener("click", () => choose(id));
      return item;
    }
    function renderOptions() {
      const query = search.value.trim().toLocaleLowerCase();
      options.replaceChildren();
      for (const group of [{ id: "all", name: "全部" }, { id: "", name: "未分组" }, ...data.groups]) {
        if (!group.name.toLocaleLowerCase().includes(query)) continue;
        options.append(button(group.id, group.name, group.color));
      }
      if (!options.childElementCount) {
        const empty = document.createElement("p");
        empty.textContent = "没有匹配分组";
        options.append(empty);
      }
      if (onManage) {
        const manage = document.createElement("button");
        manage.type = "button";
        manage.textContent = "管理分组";
        manage.className = "group-manage-link";
        manage.addEventListener("click", () => { close(); onManage(); });
        options.append(manage);
      }
    }
    more.addEventListener("click", () => {
      popup.hidden = !popup.hidden;
      more.setAttribute("aria-expanded", String(!popup.hidden));
      if (!popup.hidden) { search.value = ""; renderOptions(); search.focus(); }
    });
    search.addEventListener("input", renderOptions);
    popup.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(options.querySelectorAll("button"));
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1) + buttons.length) % buttons.length]?.focus();
      }
    });
    document.addEventListener("pointerdown", (event) => { if (!container.contains(event.target)) close(); });
    return {
      close,
      update(next) {
        const focusedId = container.contains(document.activeElement) ? document.activeElement.dataset.groupId : undefined;
        const focusedPopup = popup.contains(document.activeElement);
        const focusedMore = document.activeElement === more;
        const previousSelected = data.selected;
        const scrollLeft = row.scrollLeft;
        const optionsScrollTop = options.scrollTop;
        data = next;
        row.replaceChildren(button("all", "全部", null, !compact));
        // 刘海不再按数量截断，全部自定义分组可横向浏览；主窗口保持原来的常用组布局。
        const pinned = compact ? data.groups : data.groups.filter((group) => group.pinned).slice(0, 3);
        for (const group of pinned) row.append(button(group.id, group.name, compact ? null : group.color, !compact));
        if (compact || pinned.length < 3) row.append(button("", "未分组", null, !compact));
        const selectedHidden = data.selected !== "all" && !pinned.some((group) => group.id === data.selected) && (compact || data.selected !== "" || pinned.length >= 3);
        more.textContent = compact ? "⋯" : selectedHidden ? (data.groups.find((group) => group.id === data.selected)?.name || "未分组") : "更多分组";
        more.title = "更多分组";
        more.classList.toggle("is-selected", !compact && selectedHidden);
        if (!compact) row.append(more);
        if (!compact && onManage) {
          const add = document.createElement("button");
          add.type = "button";
          add.className = "group-manage-link";
          add.textContent = "新建 / 管理分组";
          add.addEventListener("click", onManage);
          row.append(add);
        }
        row.scrollLeft = scrollLeft;
        if (!popup.hidden) { renderOptions(); options.scrollTop = optionsScrollTop; }
        if (compact && previousSelected !== data.selected) reveal(Array.from(row.children).find((item) => item.dataset.groupId === data.selected));
        if (focusedMore) more.focus({ preventScroll: true });
        if (focusedId !== undefined) {
          const target = Array.from((focusedPopup ? options : row).querySelectorAll("button")).find((item) => item.dataset.groupId === focusedId);
          (target || (focusedPopup ? search : more)).focus({ preventScroll: true });
        }
        // 数据刷新恢复焦点会触发 focusin；用户主动滚开的浏览位置仍应保留。
        if (compact && previousSelected === data.selected) row.scrollLeft = scrollLeft;
      }
    };
  }
  const api = { colors, extract, matches, createBar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.memoGroups = api;
})(typeof window === "undefined" ? globalThis : window);
