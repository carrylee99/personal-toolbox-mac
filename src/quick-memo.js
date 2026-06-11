(function () {
  "use strict";

  const bridgeApi = window.toolbox || window.api;
  const bridgeUnavailableMessage = "应用桥接未加载，请重启 App 或重新安装最新版。";
  const fallbackApi = {
    config: {
      get: async () => ({ theme: "natural" })
    },
    memo: {
      createNote: async () => {
        throw new Error(bridgeUnavailableMessage);
      }
    },
    quickMemo: {
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
  let isSaving = false;
  let statusTimer = null;

  function normalizeTheme(theme) {
    return theme === "classic" ? "classic" : "natural";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = normalizeTheme(theme);
  }

  async function loadTheme() {
    try {
      const config = await api.config.get();
      applyTheme(config && config.theme);
    } catch (error) {
      console.error(error);
      applyTheme("natural");
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

  async function saveMemo() {
    if (isSaving) {
      return;
    }

    const content = input.value.trim();
    if (!content) {
      setStatus("写点内容再保存", "hint", true);
      focusInput();
      return;
    }

    isSaving = true;
    input.disabled = true;
    setStatus("保存中...", "saving", false);
    await setSavingState(true);

    try {
      await api.memo.createNote(content);
      await closeWindow();
    } catch (error) {
      console.error(error);
      isSaving = false;
      input.disabled = false;
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
      if (!isSaving) {
        closeWindow();
      }
      return;
    }

    if (event.key === "Enter" && event.metaKey && !event.isComposing) {
      event.preventDefault();
      saveMemo();
    }
  });

  api.quickMemo.onFocus(focusInput);
  loadTheme().finally(focusInput);
})();
