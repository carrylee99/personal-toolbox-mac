(function () {
  "use strict";
  window.createGroupManager = function ({ api, getGroups, refresh }) {
    const dialog = document.getElementById("groupManager");
    const list = document.getElementById("groupManagerList");
    const form = document.getElementById("groupEditor");
    const name = document.getElementById("groupName");
    const color = document.getElementById("groupColor");
    const pinned = document.getElementById("groupPinned");
    const status = document.getElementById("groupManagerStatus");
    const remove = document.getElementById("deleteMemoGroup");
    let editing = "";
    let busy = false;
    let confirmDelete = false;
    window.memoGroups.colors.forEach((value, index) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = ["蓝紫", "薄荷", "琥珀", "淡紫", "玫瑰", "青蓝", "石墨"][index];
      color.append(option);
    });
    function message(text, error = false) { status.textContent = text; status.classList.toggle("is-error", error); }
    function edit(group) {
      editing = group?.id || "";
      name.value = group?.name || "";
      color.value = group?.color || window.memoGroups.colors[0];
      pinned.checked = group?.pinned !== false;
      remove.hidden = !editing;
      remove.textContent = "删除分组";
      confirmDelete = false;
      document.getElementById("saveMemoGroup").textContent = editing ? "保存修改" : "创建分组";
      message("");
      name.focus();
    }
    function render() {
      list.replaceChildren();
      const groups = getGroups();
      if (!groups.length) {
        const empty = document.createElement("p");
        empty.textContent = "还没有分组，在下方创建第一个。";
        list.append(empty);
      }
      groups.forEach((group, index) => {
        const row = document.createElement("div");
        row.className = "group-manager-row";
        const select = document.createElement("button");
        select.type = "button";
        select.className = "group-edit";
        select.style.setProperty("--group-color", group.color);
        select.textContent = group.name + (group.pinned ? " · 常用" : "");
        select.addEventListener("click", () => edit(group));
        row.append(select);
        for (const direction of ["up", "down"]) {
          const move = document.createElement("button");
          move.type = "button";
          move.textContent = direction === "up" ? "上移" : "下移";
          move.setAttribute("aria-label", group.name + move.textContent);
          move.disabled = direction === "up" ? index === 0 : index === groups.length - 1;
          move.addEventListener("click", () => operate(() => api.memo.moveGroup(group.id, direction), "顺序已保存"));
          row.append(move);
        }
        list.append(row);
      });
    }
    async function operate(action, success, reset = false) {
      if (busy) return;
      busy = true;
      const controls = Array.from(dialog.querySelectorAll("button,input,select"));
      const disabled = controls.map((control) => control.disabled);
      controls.forEach((control) => control.disabled = true);
      message("保存中…");
      try {
        await action();
        if (reset) edit(null);
        await refresh();
        render();
        message(success);
      } catch (error) {
        console.error("Group operation failed", error);
        message(error.message, true);
      } finally {
        busy = false;
        controls.forEach((control, index) => control.disabled = disabled[index]);
      }
    }
    document.getElementById("closeGroupManager").addEventListener("click", () => dialog.close());
    document.getElementById("newMemoGroup").addEventListener("click", () => edit(null));
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      operate(() => api.memo.saveGroup({ id: editing || undefined, name: name.value, color: color.value, pinned: pinned.checked }), editing ? "分组已更新" : "分组已创建", true);
    });
    remove.addEventListener("click", () => {
      if (!confirmDelete) {
        confirmDelete = true;
        remove.textContent = "确认删除，待办移入未分组";
        message("只删除分组，保留其中的全部备忘。");
        return;
      }
      operate(() => api.memo.deleteGroup(editing), "分组已删除，备忘已移入未分组", true);
    });
    return { open() { render(); edit(null); dialog.showModal(); name.focus(); } };
  };
})();
