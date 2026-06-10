(function () {
  "use strict";

  const api = window.toolbox || {
    memo: {
      createNote: async () => {}
    },
    quickMemo: {
      close: async () => {},
      setSaving: async () => {},
      onFocus: () => () => {}
    }
  };
  const form = document.getElementById("quickMemoForm");
  const input = document.getElementById("quickMemoInput");
  const status = document.getElementById("quickMemoStatus");
  let isSaving = false;
  let statusTimer = null;

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
  focusInput();
})();
