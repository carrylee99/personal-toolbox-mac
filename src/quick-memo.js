(function () {
  "use strict";

  const bridgeApi = window.toolbox || window.api;
  const bridgeUnavailableMessage = "应用桥接未加载，请重启 App 或重新安装最新版。";
  const fallbackApi = {
    config: {
      get: async () => ({ theme: "dark", memo: { quickMemoEnterToSave: true } }),
      onChanged: () => () => {}
    },
    memo: {
      listData: async () => { throw new Error(bridgeUnavailableMessage); },
      saveGroup: async () => { throw new Error(bridgeUnavailableMessage); },
      onChanged: () => () => {},
      createNote: async () => {
        throw new Error(bridgeUnavailableMessage);
      }
    },
    quickMemo: {
      loadTimeRules: async () => { throw new Error(bridgeUnavailableMessage); },
      recordUnknownTime: async () => { throw new Error(bridgeUnavailableMessage); },
      createNote: async () => { throw new Error(bridgeUnavailableMessage); },
      getContext: async () => ({ dueAt: null }),
      close: async () => {},
      setSaving: async () => {},
      onFocus: () => () => {}
    }
  };
  function mergeModuleApi(fallbackModule, sourceModule) {
    if (!sourceModule || typeof sourceModule !== "object") {
      return fallbackModule;
    }
    return Object.keys(fallbackModule).reduce((merged, key) => {
      merged[key] = typeof sourceModule[key] === "function" ? sourceModule[key] : fallbackModule[key];
      return merged;
    }, {});
  }
  const api = {
    config: mergeModuleApi(fallbackApi.config, bridgeApi && bridgeApi.config),
    memo: mergeModuleApi(fallbackApi.memo, bridgeApi && bridgeApi.memo),
    quickMemo: mergeModuleApi(fallbackApi.quickMemo, bridgeApi && bridgeApi.quickMemo)
  };
  const form = document.getElementById("quickMemoForm");
  const input = document.getElementById("quickMemoInput");
  const status = document.getElementById("quickMemoStatus");
  api.config.onChanged(applyConfig);
  input.value = "";
  input.setAttribute("autocomplete", "off");
  const dateInput = document.getElementById("quickMemoDue");
  const dateHint = document.getElementById("quickMemoDateHint");
  const dateMessage = document.getElementById("quickMemoDateMessage");
  const withoutDate = document.getElementById("quickMemoWithoutDate");
  let timeRules = [];
  let rulesReady = false;
  let recordTimer = null;
  let recordQueue = Promise.resolve();
  const unknownExpressions = [];
  const recordedExpressions = new Set();
  let referenceAt = Date.now();
  let isSaved = false;
  let dueAt = null;
  let baseDueAt = null;
  let expressionKey = null;
  let expressionDueAt = null;
  let manualOverride = false;
  let extracted = window.QuickMemoDate.extract("");
  let contextReady = false;
  let isSaving = false;
  let statusTimer = null;
  let quickMemoEnterToSave = true;
  let dateSeparator = "---";
  let configReady = false;
  let groupsReady = false;
  let groups = [];
  let groupId = "";
  let groupSeparator = "#";
  let groupLoadId = 0;
  let candidateIndex = 0;
  let pickerRequested = false;
  let dismissedQuery = null;
  const groupButton = document.getElementById("quickMemoGroup");
  const groupPopup = document.getElementById("quickGroupPopup");
  const groupOptions = document.getElementById("quickGroupOptions");
  function groupInput() { return window.memoGroups.extract(input.value, groupSeparator, dateSeparator); }
  function hideGroups() {
    groupPopup.hidden = true;
    pickerRequested = false;
    dismissedQuery = input.value;
    groupButton.setAttribute("aria-expanded", "false");
  }
  function chooseGroup(group) {
    if (groupInput().tokens.length > 1) {
      setStatus("每条备忘只能选择一个分组，请保留一个分组标记", "error", false);
      return;
    }
    groupId = group.id;
    input.value = groupInput().content;
    hideGroups();
    updateDeadline();
    focusInput();
  }
  function markCandidate() {
    Array.from(groupOptions.children).forEach((button, index) => button.setAttribute("aria-selected", String(index === candidateIndex)));
    groupOptions.children[candidateIndex]?.scrollIntoView({ block: "nearest" });
  }
  function updateGroups() {
    const selected = groups.find((group) => group.id === groupId);
    groupButton.textContent = selected?.name || (groupId ? "分组已删除" : "未分组");
    groupButton.title = selected ? selected.name + " · 点击更改" : "选择分组";
    const tokens = groupInput().tokens;
    const token = tokens[0];
    const show = groupsReady && !isSaving && (pickerRequested || (token && input.value !== dismissedQuery));
    groupPopup.hidden = !show;
    groupButton.setAttribute("aria-expanded", String(Boolean(show)));
    if (!show) return;
    const query = (token?.query || "").trim().normalize("NFC");
    const choices = groups.filter((group) => group.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    groupOptions.replaceChildren();
    function add(label, action, color) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = label;
      if (color) button.style.borderLeftColor = color;
      button.addEventListener("click", action);
      groupOptions.append(button);
    }
    if (!query) add("未分组", () => chooseGroup({ id: "" }));
    choices.forEach((group) => add(group.name, () => chooseGroup(group), group.color));
    if (query && !groups.some((group) => group.name.toLocaleLowerCase() === query.toLocaleLowerCase())) {
      add("新建「" + query + "」", async () => {
        if (isSaving) return;
        isSaving = true;
        input.disabled = true;
        groupButton.disabled = true;
        groupOptions.querySelectorAll("button").forEach((button) => button.disabled = true);
        await setSavingState(true);
        try {
          // 新名称需要明确选择“新建”，避免拼写错误静默产生分组。
          const group = await api.memo.saveGroup({ name: query });
          if (!groups.some((item) => item.id === group.id)) groups.push(group);
          chooseGroup(group);
          setStatus("", "hint", false);
        } catch (error) {
          console.error("Failed to create quick memo group", error);
          setStatus(error.message, "error", false);
        } finally {
          isSaving = false;
          input.disabled = false;
          groupButton.disabled = false;
          await setSavingState(false);
          updateGroups();
          focusInput();
        }
      });
    }
    candidateIndex = 0;
    markCandidate();
  }
  async function loadGroups() {
    const id = ++groupLoadId;
    try {
      const data = await api.memo.listData();
      if (id !== groupLoadId) return;
      groups = data.groups;
      groupsReady = true;
      updateGroups();
    } catch (error) {
      console.error("Failed to load quick memo groups", error);
      groupsReady = false;
      setStatus("分组读取失败，请关闭后重试", "error", false);
    }
  }
  groupButton.addEventListener("click", () => {
    if (!groupPopup.hidden) { hideGroups(); return; }
    pickerRequested = true;
    updateGroups();
    groupOptions.querySelector("button")?.focus();
  });
  // 弹层的 Escape 只关闭选组；再次 Escape 才关闭备忘，避免丢失正在输入的草稿。
  form.addEventListener("keydown", (event) => {
    if (event.isComposing || groupPopup.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); hideGroups(); focusInput();
    } else if (["ArrowDown", "ArrowUp"].includes(event.key) && event.target === input) {
      event.preventDefault(); event.stopImmediatePropagation();
      const count = groupOptions.childElementCount;
      if (count) candidateIndex = (candidateIndex + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      markCandidate();
    } else if (event.key === "Enter" && event.target === input && !event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      groupOptions.children[candidateIndex]?.click();
    }
  }, true);
  document.addEventListener("pointerdown", (event) => {
    if (!groupPopup.contains(event.target) && event.target !== groupButton && event.target !== input) hideGroups();
  });
  api.memo.onChanged(loadGroups);

  function formatLocalInput(timestamp) {
    if (timestamp === null) return "";
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function updateDeadline() {
    if (!configReady || !rulesReady) return;
    updateGroups();
    // 先去掉分组标记再解析时间，两种标记可自由排列，时间学习文档不会混入分组名。
    extracted = window.QuickMemoDate.extract(groupInput().content, dateSeparator);
    if (extracted.expression !== expressionKey) {
      window.clearTimeout(recordTimer);
      expressionKey = extracted.expression;
      referenceAt = Date.now();
      // 相对小时/分钟以本次表达输入完成时为准；改标题或重试保存不推迟截止时间。
      expressionDueAt = expressionKey === null ? null : window.QuickMemoDate.parseExpression(expressionKey, new Date(referenceAt), timeRules);
      manualOverride = false;
      // 输入停顿后记录，避免每个按键/输入法拼音都写入规则文档。
      if (expressionKey && expressionDueAt === null) {
        recordTimer = window.setTimeout(recordWithFeedback, 900);
      }
    }
    if (!manualOverride) dueAt = expressionKey === null ? baseDueAt : expressionDueAt;
    dateInput.value = formatLocalInput(dueAt);
    const invalid = expressionKey !== null && expressionDueAt === null && !manualOverride;
    input.setAttribute("aria-invalid", String(invalid));
    // 常态只在右上角展示日期，底部仅在识别失败时提示，避免重复说明占据输入区。
    dateHint.hidden = !invalid;
    dateMessage.textContent = invalid
      ? (expressionKey ? "时间未识别，可改写或手动设置" : `请在 ${dateSeparator} 后填写时间`)
      : "";
  }

  function persistUnknown(expression) {
    const operation = recordQueue.then(async () => {
      if (recordedExpressions.has(expression)) return;
      await api.quickMemo.recordUnknownTime(expression);
      recordedExpressions.add(expression);
    });
    // 队列恢复仅用于允许重试；调用方仍收到原始错误，保存前重试未落盘的表达。
    recordQueue = operation.catch(() => {});
    return operation;
  }

  function recordUnknown() {
    window.clearTimeout(recordTimer);
    const expression = expressionKey;
    if (!expression || expressionDueAt !== null) return recordQueue;
    const previousIndex = unknownExpressions.indexOf(expression);
    if (previousIndex >= 0) unknownExpressions.splice(previousIndex, 1);
    unknownExpressions.push(expression);
    return persistUnknown(expression);
  }

  function recordWithFeedback() {
    recordUnknown().catch((error) => {
      console.error("Failed to record unknown time", error);
      setStatus("时间表达记录失败，请重试", "error", false);
    });
  }

  input.addEventListener("blur", recordWithFeedback);
  input.addEventListener("compositionstart", () => window.clearTimeout(recordTimer));
  withoutDate.addEventListener("click", () => {
    if (isSaved) { closeWindow(); return; }
    if (isSaving) return;
    dueAt = null;
    baseDueAt = null;
    manualOverride = true;
    dateInput.value = "";
    saveMemo();
  });

  input.addEventListener("input", (event) => {
    if (!event.isComposing) updateDeadline();
  });
  input.addEventListener("compositionend", updateDeadline);
  dateInput.addEventListener("input", () => {
    if (dateInput.validity.badInput || !dateInput.validity.valid) return;
    dueAt = dateInput.value ? new Date(dateInput.value).getTime() : null;
    baseDueAt = dueAt;
    manualOverride = true;
    updateDeadline();
  });
  form.addEventListener("keydown", (event) => {
    if (event.target === input) return;
    if (event.key === "Escape" && (!isSaving || isSaved)) {
      event.preventDefault();
      closeWindow();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveMemo();
    }
  });

  function normalizeTheme(theme) {
    return ["dark", "natural", "classic"].includes(theme) ? theme : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = normalizeTheme(theme);
  }

  function applyConfig(config) {
    applyTheme(config.theme);
    quickMemoEnterToSave = config.memo?.quickMemoEnterToSave !== false;
    dateSeparator = config.memo?.quickMemoDateSeparator || "---";
    groupSeparator = config.memo?.quickMemoGroupSeparator || "#";
    configReady = true;
    if (!isSaving) updateDeadline();
  }

  async function loadConfig() {
    try {
      applyConfig(await api.config.get());
    } catch (error) {
      // 无法读取识别符时不按默认符号保存，避免把时间描述当成普通正文。
      console.error(error);
      setStatus("设置读取失败，请关闭后重试", "error", false);
    }
  }

  function focusInput() {
    window.requestAnimationFrame(() => {
      if (input.disabled) {
        return;
      }
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function setStatus(message, type, autoHide) {
    if (statusTimer) {
      window.clearTimeout(statusTimer);
      statusTimer = null;
    }
    form.classList.toggle("is-saving", type === "saving");
    form.classList.toggle("is-error", type === "error");
    status.textContent = message;
    status.hidden = !message;
    if (message && autoHide) {
      statusTimer = window.setTimeout(() => {
        status.hidden = true;
        status.textContent = "";
      }, 1400);
    }
  }

  async function setSavingState(value) {
    try {
      if (api.quickMemo.setSaving) {
        await api.quickMemo.setSaving(value);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function closeWindow() {
    await api.quickMemo.close();
  }

  function createMemoPayload(value) {
    const content = String(value || "").replace(/\r\n/g, "\n").trim();
    const lines = content.split("\n");
    const title = (lines.shift() || "").trim();
    return {
      title,
      detail: lines.join("\n").trim(),
      groupId,
      dueAt
    };
  }

  async function saveMemo() {
    if (isSaving || !contextReady || !configReady || !rulesReady || !groupsReady) {
      return;
    }

    const parsedGroup = groupInput();
    if (parsedGroup.tokens.length > 1) {
      setStatus("每条备忘只能选择一个分组，请保留一个分组标记", "error", false);
      return;
    }
    if (parsedGroup.tokens.length) {
      const token = parsedGroup.tokens[0];
      const selected = token.closed && groups.find((group) => group.name.toLocaleLowerCase() === token.query.trim().normalize("NFC").toLocaleLowerCase());
      if (!selected) { dismissedQuery = null; updateGroups(); setStatus("请先选择或新建分组", "error", false); return; }
      chooseGroup(selected);
    }
    if (groupId && !groups.some((group) => group.id === groupId)) {
      setStatus("原分组已删除，请选择其他分组或未分组", "error", false);
      pickerRequested = true; updateGroups(); return;
    }
    if (!dateInput.validity.valid) {
      setStatus("请填写完整有效的截止时间", "error", false);
      dateInput.focus();
      return;
    }
    updateDeadline();
    if (expressionKey !== null && expressionDueAt === null && !manualOverride) {
      recordWithFeedback();
      setStatus("请先确认截止时间，再保存", "error", false);
      focusInput();
      return;
    }
    // 仅在识别成功时清理时间后缀；失败或手动兜底不会丢掉原文。
    const payload = createMemoPayload(expressionDueAt !== null ? extracted.content : input.value);
    if (!payload.title) {
      setStatus("写点内容再保存", "hint", true);
      focusInput();
      return;
    }

    isSaving = true;
    input.disabled = true;
    groupButton.disabled = true;
    hideGroups();
    dateInput.disabled = true;
    withoutDate.disabled = true;
    setStatus("保存中...", "saving", false);
    await setSavingState(true);

    try {
      await recordUnknown();
      for (const expression of unknownExpressions) await persistUnknown(expression);
      const result = await api.quickMemo.createNote(payload, {
        expressions: unknownExpressions,
        correction: !manualOverride && expressionDueAt !== null ? expressionKey : null,
        referenceAt
      });
      isSaved = true;
      if (result.learningError) {
        // 保存和规则学习是两个结果；已保存后禁止再次提交，避免生成重复备忘。
        dateHint.hidden = false;
        dateMessage.textContent = "备忘已保存，时间规则学习失败";
        withoutDate.textContent = "关闭";
        withoutDate.disabled = false;
        setStatus("原表达保留在待学习文档中", "error", false);
        await setSavingState(false);
      } else {
        await closeWindow();
      }
    } catch (error) {
      console.error(error);
      if (isSaved) {
        setStatus("备忘已保存，请按 Esc 关闭", "error", false);
        await setSavingState(false);
        return;
      }
      isSaving = false;
      withoutDate.disabled = false;
      input.disabled = false;
      groupButton.disabled = false;
      dateInput.disabled = false;
      await setSavingState(false);
      setStatus("保存失败，再试一下", "error", false);
      focusInput();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveMemo();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!isSaving || isSaved) {
        closeWindow();
      }
      return;
    }

    if (event.key !== "Enter" || event.isComposing) {
      return;
    }

    if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
      return;
    }

    if (quickMemoEnterToSave || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      saveMemo();
    }
  });

  async function loadContext() {
    try {
      const context = await api.quickMemo.getContext();
      baseDueAt = context.dueAt || null;
      groupId = context.groupId || "";
      updateGroups();
      updateDeadline();
      dateInput.disabled = false;
      contextReady = true;
    } catch (error) {
      // 日期上下文失败时不降级为无期限保存，防止任务从用户选中的日期消失。
      console.error("Failed to load quick memo date", error);
      setStatus("日期读取失败，请关闭后重试", "error", false);
    }
  }
  async function loadRules() {
    try {
      timeRules = await api.quickMemo.loadTimeRules();
      rulesReady = true;
      updateDeadline();
    } catch (error) {
      console.error("Failed to load time rules", error);
      setStatus("时间规则读取失败，请检查规则文档后重试", "error", false);
    }
  }
  api.quickMemo.onFocus(focusInput);
  Promise.all([loadConfig(), loadContext(), loadRules(), loadGroups()]).finally(focusInput);
})();
