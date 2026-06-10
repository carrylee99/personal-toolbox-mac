(function () {
  "use strict";

  const bridgeApi = window.toolbox || window.api;
  const bridgeUnavailableMessage = "应用桥接未加载，请重启 App 或重新安装最新版。";
  const api = createSafeBridgeApi(bridgeApi);
  const activeModuleStorageKey = "personalToolbox.activeModule";
  const settingsTabStorageKey = "personalToolbox.settingsTab";
  const validModules = new Set(["dashboard", "memo", "smoke", "settings"]);
  const validSettingsTabs = new Set(["general", "memo", "smoke"]);

  function createMissingBridgeApi() {
    const fail = async () => {
      throw new Error(bridgeUnavailableMessage);
    };
    return {
      config: {
        get: fail,
        setVaultPath: fail,
        setShortcuts: fail,
        selectVaultPath: fail
      },
      smoke: {
        list: fail,
        importRunPlan: fail,
        exportCurrentVersion: fail,
        saveSettings: fail,
        createVersion: fail,
        updateVersion: fail,
        deleteVersion: fail,
        selectVersion: fail,
        createScene: fail,
        updateScene: fail,
        deleteScene: fail,
        deleteScenes: fail,
        createCase: fail,
        updateCase: fail,
        duplicateCase: fail,
        deleteCase: fail,
        deleteCases: fail,
        selectScene: fail,
        selectCase: fail
      },
      memo: {
        listNotes: fail,
        createNote: fail,
        updateNote: fail,
        toggleNote: fail,
        deleteNote: fail,
        importNotes: fail,
        exportNotes: fail,
        saveImportSample: fail,
        onChanged: () => () => {}
      },
      poem: {
        getDaily: fail
      }
    };
  }

  function mergeModuleApi(fallbackModule, sourceModule) {
    if (!sourceModule || typeof sourceModule !== "object") {
      return fallbackModule;
    }
    return Object.keys(fallbackModule).reduce((merged, key) => {
      merged[key] = typeof sourceModule[key] === "function" ? sourceModule[key] : fallbackModule[key];
      return merged;
    }, {});
  }

  function createSafeBridgeApi(sourceApi) {
    const fallback = createMissingBridgeApi();
    if (!sourceApi || typeof sourceApi !== "object") {
      return fallback;
    }
    return {
      config: mergeModuleApi(fallback.config, sourceApi.config),
      smoke: mergeModuleApi(fallback.smoke, sourceApi.smoke),
      memo: mergeModuleApi(fallback.memo, sourceApi.memo),
      poem: mergeModuleApi(fallback.poem, sourceApi.poem)
    };
  }

  function readStoredActiveModule() {
    const stored = window.localStorage.getItem(activeModuleStorageKey);
    return validModules.has(stored) ? stored : "dashboard";
  }

  function readStoredSettingsTab() {
    const stored = window.localStorage.getItem(settingsTabStorageKey);
    return validSettingsTabs.has(stored) ? stored : "general";
  }

  const state = {
    activeModule: readStoredActiveModule(),
    config: null,
    smoke: null,
    smokeSearch: "",
    smokeSceneStatusFilters: [],
    selectedSceneIds: [],
    selectedCaseIds: [],
    sceneBulkDeleteMode: false,
    caseBulkDeleteMode: false,
    sidebarCollapsed: window.localStorage.getItem("personalToolbox.sidebarCollapsed") !== "false",
    scenesPanelCollapsed: false,
    memoNotes: [],
    memoSearch: "",
    selectedMemoId: "",
    memoDrawerOpen: false,
    dailyPoem: null,
    dailyPoemDateKey: "",
    dailyPoemLoading: false,
    settingsTab: readStoredSettingsTab()
  };

  const timers = new Map();
  const $ = (id) => document.getElementById(id);

  const refs = {
    appShell: document.querySelector(".app-shell"),
    sidebarToggleButton: $("sidebarToggleButton"),
    vaultLabel: $("vaultLabel"),
    toast: $("toast"),
    dashboardModule: $("dashboardModule"),
    dashboardSummary: $("dashboardSummary"),
    currentTimeText: $("currentTimeText"),
    currentDateText: $("currentDateText"),
    todayTodoTile: $("todayTodoTile"),
    todayTodoCount: $("todayTodoCount"),
    todayTodoSummary: $("todayTodoSummary"),
    dailyDiziguiText: $("dailyDiziguiText"),
    dailyDiziguiMeaning: $("dailyDiziguiMeaning"),
    dailyPoemTitle: $("dailyPoemTitle"),
    dailyPoemContent: $("dailyPoemContent"),
    dailyPoemSource: $("dailyPoemSource"),
    smokeModule: $("smokeModule"),
    smokeWorkspace: document.querySelector(".smoke-workspace"),
    memoModule: $("memoModule"),
    settingsModule: $("settingsModule"),
    smokeSummary: $("smokeSummary"),
    smokeVersionSelect: $("smokeVersionSelect"),
    newVersionButton: $("newVersionButton"),
    renameVersionButton: $("renameVersionButton"),
    deleteVersionButton: $("deleteVersionButton"),
    smokeSearchInput: $("smokeSearchInput"),
    importRunPlanButton: $("importRunPlanButton"),
    exportMarkdownButton: $("exportMarkdownButton"),
    toggleScenesPanelButton: $("toggleScenesPanelButton"),
    newSceneButton: $("newSceneButton"),
    sceneStatusFilterButton: $("sceneStatusFilterButton"),
    sceneStatusFilterMenu: $("sceneStatusFilterMenu"),
    deleteSelectedScenesButton: $("deleteSelectedScenesButton"),
    newCaseButton: $("newCaseButton"),
    deleteSelectedCasesButton: $("deleteSelectedCasesButton"),
    scenesList: $("scenesList"),
    sceneDetail: $("sceneDetail"),
    casesList: $("casesList"),
    caseEditor: $("caseEditor"),
    memoSummary: $("memoSummary"),
    memoSearchLabel: $("memoSearchLabel"),
    memoSearchInput: $("memoSearchInput"),
    memoForm: $("memoForm"),
    memoInput: $("memoInput"),
    memoListView: $("memoListView"),
    memoList: $("memoList"),
    memoDrawerBackdrop: $("memoDrawerBackdrop"),
    memoDrawer: $("memoDrawer"),
    settingsGeneralTab: $("settingsGeneralTab"),
    settingsMemoTab: $("settingsMemoTab"),
    settingsSmokeTab: $("settingsSmokeTab"),
    vaultPathInput: $("vaultPathInput"),
    saveVaultPathButton: $("saveVaultPathButton"),
    chooseVaultPathButton: $("chooseVaultPathButton"),
    configDataPathText: $("configDataPathText"),
    vaultRootPathText: $("vaultRootPathText"),
    smokeDataPathText: $("smokeDataPathText"),
    smokeDataPathTextMirror: $("smokeDataPathTextMirror"),
    smokeAutoWriteInput: $("smokeAutoWriteInput"),
    saveSmokeSettingsButton: $("saveSmokeSettingsButton"),
    smokeMarkdownFolderText: $("smokeMarkdownFolderText"),
    memoDataPathText: $("memoDataPathText"),
    memoDataPathTextMirror: $("memoDataPathTextMirror"),
    importMemoButton: $("importMemoButton"),
    exportMemoButton: $("exportMemoButton"),
    saveMemoSampleButton: $("saveMemoSampleButton"),
    quickMemoShortcutInput: $("quickMemoShortcutInput"),
    openMainShortcutInput: $("openMainShortcutInput"),
    saveQuickMemoShortcutButton: $("saveQuickMemoShortcutButton")
  };

  function cleanText(value) {
    return String(value || "").trim();
  }

  function setActiveModule(moduleName) {
    if (!validModules.has(moduleName)) {
      return;
    }
    state.activeModule = moduleName;
    window.localStorage.setItem(activeModuleStorageKey, moduleName);
  }

  function setSettingsTab(tabName) {
    if (!validSettingsTabs.has(tabName)) {
      return;
    }
    state.settingsTab = tabName;
    window.localStorage.setItem(settingsTabStorageKey, tabName);
  }

  function joinVaultPath(relativePath) {
    const root = state.config && state.config.vaultPath ? state.config.vaultPath.replace(/\/+$/g, "") : "";
    const relative = cleanText(relativePath).replace(/^\/+|\/+$/g, "");
    return relative ? root + "/" + relative : root;
  }

  function createId(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function setToast(message, isError) {
    window.clearTimeout(timers.get("toast"));
    refs.toast.textContent = message || "";
    refs.toast.classList.toggle("is-visible", Boolean(message));
    refs.toast.classList.toggle("is-error", Boolean(isError));
    if (message) {
      timers.set("toast", window.setTimeout(() => {
        refs.toast.classList.remove("is-visible", "is-error");
        refs.toast.textContent = "";
      }, 2400));
    }
  }

  function formatImportSummary(summary) {
    if (!summary) {
      return "导入完成";
    }
    return "导入完成：场景 +" +
      summary.createdSceneCount +
      "，Case +" +
      summary.createdCaseCount +
      "，更新 " +
      summary.updatedCaseCount +
      "，跳过 " +
      summary.skippedCaseCount;
  }

  function formatMemoImportSummary(summary) {
    if (!summary) {
      return "导入完成";
    }
    return "导入完成：新增 " +
      summary.createdCount +
      "，更新 " +
      summary.updatedCount +
      "，跳过 " +
      summary.skippedCount;
  }

  function formatTime(value) {
    if (!value) {
      return "";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function formatDateKey(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function getTodayKey() {
    return formatDateKey(new Date());
  }

  const caseStatusOptions = [
    { status: "passed", label: "成功" },
    { status: "failed", label: "失败" },
    { status: "incomplete", label: "未完成" },
    { status: "pending", label: "未执行" }
  ];

  const diziguiSentences = [
    { text: "弟子规，圣人训。首孝悌，次谨信。", meaning: "先学孝顺父母、友爱兄弟，再培养谨慎守信。" },
    { text: "泛爱众，而亲仁。有余力，则学文。", meaning: "广泛关爱他人，亲近有仁德的人；还有余力再学习文艺知识。" },
    { text: "父母呼，应勿缓。父母命，行勿懒。", meaning: "父母呼唤要及时回应，交代的事情要认真去做。" },
    { text: "父母教，须敬听。父母责，须顺承。", meaning: "面对父母教导与责备，应恭敬聆听、虚心接受。" },
    { text: "冬则温，夏则凊。晨则省，昏则定。", meaning: "关心父母冷暖，早晚问候，让他们安心。" },
    { text: "出必告，反必面。居有常，业无变。", meaning: "外出和回来都要告知父母，生活作息稳定，职责不轻易改变。" },
    { text: "事虽小，勿擅为。苟擅为，子道亏。", meaning: "即使小事也别任性妄为，否则有亏为人子女的本分。" },
    { text: "物虽小，勿私藏。苟私藏，亲心伤。", meaning: "东西再小也不要私自藏匿，以免伤害亲人信任。" },
    { text: "亲所好，力为具。亲所恶，谨为去。", meaning: "父母喜欢的尽力准备，父母厌恶的谨慎避免。" },
    { text: "身有伤，贻亲忧。德有伤，贻亲羞。", meaning: "身体受伤会让父母担忧，品德受损会让父母蒙羞。" },
    { text: "兄道友，弟道恭。兄弟睦，孝在中。", meaning: "兄长友爱、弟妹恭敬，手足和睦也是孝的一部分。" },
    { text: "财物轻，怨何生。言语忍，忿自泯。", meaning: "看轻财物、言语忍让，怨恨和怒气自然减少。" },
    { text: "或饮食，或坐走。长者先，幼者后。", meaning: "饮食、落座、行走等场合，要懂得礼让长者。" },
    { text: "称尊长，勿呼名。对尊长，勿见能。", meaning: "称呼长辈要尊敬，面对长辈不要炫耀逞能。" },
    { text: "朝起早，夜眠迟。老易至，惜此时。", meaning: "珍惜时间，勤勉自律，不要虚度光阴。" },
    { text: "冠必正，纽必结。袜与履，俱紧切。", meaning: "衣冠整洁得体，是对自己和他人的尊重。" },
    { text: "置冠服，有定位。勿乱顿，致污秽。", meaning: "衣物用品放在固定位置，不乱丢乱放。" },
    { text: "对饮食，勿拣择。食适可，勿过则。", meaning: "饮食不挑剔，适量即可，不要过度。" },
    { text: "步从容，立端正。揖深圆，拜恭敬。", meaning: "举止从容端正，待人行礼要真诚恭敬。" },
    { text: "缓揭帘，勿有声。宽转弯，勿触棱。", meaning: "做事轻缓细致，避免惊扰他人或碰撞损坏。" },
    { text: "凡出言，信为先。诈与妄，奚可焉。", meaning: "说话以诚信为先，欺诈虚妄不可取。" },
    { text: "话说多，不如少。惟其是，勿佞巧。", meaning: "话不必多，重要的是说真实、有用的话。" },
    { text: "见人善，即思齐。纵去远，以渐跻。", meaning: "见到别人的优点，要向其学习并逐步靠近。" },
    { text: "见人恶，即内省。有则改，无加警。", meaning: "看到别人的缺点，先反省自己，有则改之，无则警惕。" },
    { text: "闻过怒，闻誉乐。损友来，益友却。", meaning: "听到批评就生气、听到称赞就高兴，会招来损友、远离益友。" },
    { text: "闻誉恐，闻过欣。直谅士，渐相亲。", meaning: "面对称赞保持谨慎，听到批评愿意改进，正直朋友自然亲近。" }
  ];

  function acceleratorToDisplay(value) {
    return String(value || "")
      .replace(/\bAlt\b/g, "Option")
      .replace(/\bCommand\b/g, "Command")
      .replace(/\+/g, " + ");
  }

  function normalizeRecordedKey(event) {
    const ignored = ["Alt", "Control", "Meta", "Shift"];
    if (ignored.includes(event.key)) {
      return "";
    }

    const parts = [];
    if (event.metaKey) {
      parts.push("Command");
    }
    if (event.ctrlKey) {
      parts.push("Control");
    }
    if (event.altKey) {
      parts.push("Alt");
    }
    if (event.shiftKey) {
      parts.push("Shift");
    }

    let key = "";
    if (/^Key[A-Z]$/.test(event.code)) {
      key = event.code.slice(3);
    } else if (/^Digit[0-9]$/.test(event.code)) {
      key = event.code.slice(5);
    } else if (/^Numpad[0-9]$/.test(event.code)) {
      key = "num" + event.code.slice(6);
    } else {
      key = event.key;
    }

    if (key === " ") {
      key = "Space";
    } else if (key.length === 1) {
      key = key.toUpperCase();
    }

    if (!parts.length || !key) {
      return "";
    }
    parts.push(key);
    return parts.join("+");
  }

  function normalizeStatus(value) {
    return value === "passed" || value === "failed" ? value : "pending";
  }

  function normalizeStepSort(value) {
    return value === "asc" || value === "custom" ? value : "desc";
  }

  function statusLabel(status) {
    if (status === "passed") {
      return "成功";
    }
    if (status === "failed") {
      return "失败";
    }
    if (status === "incomplete") {
      return "未完成";
    }
    return "未执行";
  }

  function deriveCaseStatus(caseItem) {
    const steps = Array.isArray(caseItem && caseItem.steps) ? caseItem.steps : [];
    if (steps.some((step) => step.status === "failed")) {
      return "failed";
    }
    if (steps.length > 0 && steps.every((step) => step.status === "passed")) {
      return "passed";
    }
    if (steps.some((step) => step.status === "passed")) {
      return "incomplete";
    }
    return "pending";
  }

  function stepSortTime(step) {
    const time = Date.parse((step && step.createdAt) || (step && step.updatedAt) || "");
    return Number.isNaN(time) ? 0 : time;
  }

  function stepSortNumber(step) {
    const match = String((step && step.action) || "").match(/^\s*步骤\s*(\d+)[：:.\s]/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  }

  function sortStepsByCreatedAt(steps, direction) {
    const multiplier = direction === "asc" ? 1 : -1;
    return steps.slice().sort((a, b) => {
      const timeDiff = stepSortTime(a) - stepSortTime(b);
      if (timeDiff !== 0) {
        return timeDiff * multiplier;
      }
      const numberDiff = stepSortNumber(a) - stepSortNumber(b);
      if (numberDiff !== 0 && Number.isFinite(numberDiff)) {
        return numberDiff * multiplier;
      }
      return String(a.id || "").localeCompare(String(b.id || "")) * multiplier;
    });
  }

  function getOrderedSteps(caseItem) {
    const steps = Array.isArray(caseItem && caseItem.steps) ? caseItem.steps : [];
    const sort = normalizeStepSort(caseItem && caseItem.stepSort);
    return sort === "custom" ? steps.slice() : sortStepsByCreatedAt(steps, sort);
  }

  function getStepDisplayNumber(caseItem, index, count) {
    if (normalizeStepSort(caseItem && caseItem.stepSort) !== "desc") {
      return index + 1;
    }
    return count - index;
  }

  function createBlankStep() {
    const timestamp = nowIso();
    return {
      id: createId("step"),
      action: "",
      expected: "",
      status: "pending",
      failureReason: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function getActiveVersion() {
    if (!state.smoke || !Array.isArray(state.smoke.versions)) {
      return null;
    }
    return state.smoke.versions.find((version) => version.id === state.smoke.selectedVersionId) ||
      state.smoke.versions[0] ||
      null;
  }

  function getCasesForScene(sceneId) {
    const version = getActiveVersion();
    return (version ? version.cases : [])
      .filter((caseItem) => caseItem.sceneId === sceneId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function getActiveScene() {
    const version = getActiveVersion();
    if (!version) {
      return null;
    }
    return version.scenes.find((scene) => scene.id === version.selectedSceneId) || null;
  }

  function getActiveCase() {
    const version = getActiveVersion();
    if (!version) {
      return null;
    }
    return version.cases.find((caseItem) => caseItem.id === version.selectedCaseId) || null;
  }

  function getSceneStats(sceneId) {
    return getCasesForScene(sceneId).reduce(
      (stats, caseItem) => {
        const status = deriveCaseStatus(caseItem);
        stats.total += 1;
        stats[status] += 1;
        return stats;
      },
      { total: 0, passed: 0, failed: 0, incomplete: 0, pending: 0 }
    );
  }

  function createPill(text, status) {
    const pill = document.createElement("span");
    pill.className = "pill";
    if (status) {
      pill.classList.add("is-" + status);
    }
    pill.textContent = text;
    return pill;
  }

  function setSelectedId(kind, id, selected) {
    const key = kind === "scene" ? "selectedSceneIds" : "selectedCaseIds";
    const next = new Set(state[key]);
    if (selected) {
      next.add(id);
    } else {
      next.delete(id);
    }
    state[key] = Array.from(next);
  }

  function pruneBulkSelections() {
    const version = getActiveVersion();
    if (!version) {
      state.selectedSceneIds = [];
      state.selectedCaseIds = [];
      state.sceneBulkDeleteMode = false;
      state.caseBulkDeleteMode = false;
      return;
    }
    if (!state.sceneBulkDeleteMode) {
      state.selectedSceneIds = [];
    }
    if (!state.caseBulkDeleteMode) {
      state.selectedCaseIds = [];
    }
    const sceneIds = new Set(version.scenes.map((scene) => scene.id));
    state.selectedSceneIds = state.selectedSceneIds.filter((sceneId) => sceneIds.has(sceneId));

    const scene = getActiveScene();
    const visibleCaseIds = new Set(scene ? getCasesForScene(scene.id).filter(caseMatches).map((caseItem) => caseItem.id) : []);
    state.selectedCaseIds = state.selectedCaseIds.filter((caseId) => visibleCaseIds.has(caseId));
  }

  function createRecordCheckbox(kind, id, checked, label) {
    const input = document.createElement("input");
    input.className = "record-check";
    input.type = "checkbox";
    input.checked = checked;
    input.setAttribute("aria-label", label);
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => event.stopPropagation());
    input.addEventListener("change", (event) => {
      setSelectedId(kind, id, event.target.checked);
      renderSmokeLists();
    });
    return input;
  }

  function bindRecordActivation(item, handler) {
    item.addEventListener("click", handler);
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      handler();
    });
  }

  function createEmpty(text) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = text;
    return empty;
  }

  function openAppDialog(options) {
    return new Promise((resolve) => {
      const dialogOptions = options || {};
      const backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop";

      const form = document.createElement("form");
      form.className = "app-dialog";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input) {
          const value = cleanText(input.value);
          if (!value) {
            error.textContent = "内容不能为空";
            input.focus();
            return;
          }
          if (dialogOptions.requiredValue && value !== dialogOptions.requiredValue) {
            error.textContent = "请输入完整版本名后再删除";
            input.focus();
            return;
          }
          close(dialogOptions.requiredValue ? true : value);
          return;
        }
        close(true);
      });

      const title = document.createElement("h3");
      title.textContent = dialogOptions.title || "确认";
      form.append(title);

      if (dialogOptions.message) {
        const message = document.createElement("p");
        message.className = "dialog-message";
        message.textContent = dialogOptions.message;
        form.append(message);
      }

      let input = null;
      if (dialogOptions.inputLabel) {
        const label = document.createElement("label");
        label.className = "field";
        const labelText = document.createElement("span");
        labelText.textContent = dialogOptions.inputLabel;
        input = document.createElement("input");
        input.type = "text";
        input.value = dialogOptions.initialValue || "";
        input.placeholder = dialogOptions.placeholder || "";
        label.append(labelText, input);
        form.append(label);
      }

      const error = document.createElement("p");
      error.className = "dialog-error";
      form.append(error);

      const actions = document.createElement("div");
      actions.className = "dialog-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = dialogOptions.cancelText || "取消";
      const confirm = document.createElement("button");
      confirm.type = "submit";
      confirm.textContent = dialogOptions.confirmText || "确认";
      if (dialogOptions.danger) {
        confirm.className = "danger";
      } else {
        confirm.className = "primary";
      }
      cancel.addEventListener("click", () => close(null));
      actions.append(cancel, confirm);
      form.append(actions);

      function handleKeydown(event) {
        if (event.key === "Escape") {
          close(null);
        }
      }

      function close(value) {
        window.removeEventListener("keydown", handleKeydown);
        backdrop.remove();
        resolve(value);
      }

      backdrop.append(form);
      document.body.append(backdrop);
      window.addEventListener("keydown", handleKeydown);
      window.setTimeout(() => {
        if (input) {
          input.focus();
          input.select();
        } else {
          cancel.focus();
        }
      }, 0);
    });
  }

  async function inputDialog(title, label, initialValue) {
    return openAppDialog({
      title,
      inputLabel: label,
      initialValue,
      confirmText: "保存"
    });
  }

  async function confirmDialog(title, message, options) {
    return Boolean(await openAppDialog(Object.assign({
      title,
      message,
      confirmText: "确认"
    }, options || {})));
  }

  function sceneStatusMatches(scene) {
    if (!state.smokeSceneStatusFilters.length) {
      return true;
    }
    const selected = new Set(state.smokeSceneStatusFilters);
    return getCasesForScene(scene.id).some((caseItem) => selected.has(deriveCaseStatus(caseItem)));
  }

  function sceneMatches(scene) {
    if (!sceneStatusMatches(scene)) {
      return false;
    }
    const keyword = state.smokeSearch.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    if ((scene.name + " " + scene.description).toLowerCase().includes(keyword)) {
      return true;
    }
    return getCasesForScene(scene.id).some((caseItem) => caseMatches(caseItem));
  }

  function caseMatches(caseItem) {
    const keyword = state.smokeSearch.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    const stepText = caseItem.steps.map((step) => step.action + " " + step.expected + " " + step.failureReason).join(" ");
    return (caseItem.title + " " + caseItem.description + " " + stepText).toLowerCase().includes(keyword);
  }

  async function loadConfig() {
    state.config = await api.config.get();
  }

  async function loadSmoke() {
    state.smoke = await api.smoke.list();
  }

  async function loadMemo() {
    const notes = await api.memo.listNotes();
    state.memoNotes = notes;
    if (state.selectedMemoId && !state.memoNotes.some((note) => note.id === state.selectedMemoId)) {
      state.selectedMemoId = "";
      state.memoDrawerOpen = false;
    }
  }

  async function reloadAll() {
    try {
      await loadConfig();
      await Promise.all([loadSmoke(), loadMemo()]);
      renderAll();
    } catch (error) {
      console.error(error);
      if (!bridgeApi) {
        refs.vaultLabel.textContent = "应用桥接未加载";
      }
      setToast("读取数据失败：" + error.message, true);
    }
  }

  async function refreshMemoFromExternalChange() {
    try {
      await loadMemo();
      renderDashboard();
      renderMemo();
    } catch (error) {
      console.error(error);
    }
  }

  function renderAll() {
    renderShell();
    renderDashboard();
    renderSmoke();
    renderMemo();
    renderSettings();
  }

  function renderShell() {
    if (state.activeModule !== "memo" && state.memoDrawerOpen) {
      state.memoDrawerOpen = false;
      renderMemoDrawer();
    }
    refs.appShell.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
    refs.sidebarToggleButton.textContent = state.sidebarCollapsed ? "›" : "‹";
    refs.sidebarToggleButton.setAttribute("aria-label", state.sidebarCollapsed ? "展开侧栏" : "收起侧栏");
    refs.sidebarToggleButton.title = state.sidebarCollapsed ? "展开侧栏" : "收起侧栏";
    refs.vaultLabel.textContent = state.config ? state.config.vaultPath : "Vault 未连接";
    document.querySelectorAll(".nav-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.module === state.activeModule);
    });
    refs.dashboardModule.classList.toggle("is-active", state.activeModule === "dashboard");
    refs.smokeModule.classList.toggle("is-active", state.activeModule === "smoke");
    refs.memoModule.classList.toggle("is-active", state.activeModule === "memo");
    refs.settingsModule.classList.toggle("is-active", state.activeModule === "settings");
    refs.smokeWorkspace.classList.toggle("is-scenes-collapsed", state.scenesPanelCollapsed);
    refs.toggleScenesPanelButton.textContent = state.scenesPanelCollapsed ? "›" : "‹";
    refs.toggleScenesPanelButton.setAttribute("aria-label", state.scenesPanelCollapsed ? "展开场景列" : "收起场景列");
    refs.toggleScenesPanelButton.title = state.scenesPanelCollapsed ? "展开场景列" : "收起场景列";
  }

  function renderDashboard(options) {
    renderDashboardTime();
    renderDashboardTodo();
    renderDailyDizigui();
    renderDailyPoem();
    if (state.activeModule === "dashboard") {
      loadDailyPoem(Boolean(options && options.forcePoem));
    }
  }

  function renderDashboardTime() {
    const now = new Date();
    refs.currentTimeText.textContent = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
    refs.currentDateText.textContent = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(now);
    refs.dashboardSummary.textContent = "今天是 " + formatDateKey(now);
  }

  function renderDashboardTodo() {
    const todayKey = getTodayKey();
    const todoNotes = state.memoNotes.filter((note) => !note.completed);
    const todayTodo = todoNotes.filter((note) => {
      const noteDate = formatDateKey(note.updatedAt || note.createdAt);
      return noteDate === todayKey;
    });
    refs.todayTodoCount.textContent = String(todayTodo.length);
    refs.todayTodoSummary.textContent = "全部待办 " + todoNotes.length + " 条";
  }

  function renderDailyDizigui() {
    const todayKey = getTodayKey();
    const selected = diziguiSentences[hashString(todayKey) % diziguiSentences.length];
    refs.dailyDiziguiText.textContent = selected.text;
    refs.dailyDiziguiMeaning.textContent = selected.meaning;
  }

  function hashString(value) {
    return String(value || "").split("").reduce((hash, char) => {
      return (hash * 31 + char.charCodeAt(0)) >>> 0;
    }, 2166136261);
  }

  function renderDailyPoem() {
    if (state.dailyPoemLoading && !state.dailyPoem) {
      refs.dailyPoemTitle.textContent = "联网读取中";
      refs.dailyPoemContent.textContent = "正在从网页获取今日诗词...";
      refs.dailyPoemSource.textContent = "";
      return;
    }

    if (state.dailyPoem && state.dailyPoem.error) {
      refs.dailyPoemTitle.textContent = "每日一首诗";
      refs.dailyPoemContent.textContent = "联网读取失败";
      refs.dailyPoemSource.textContent = "请稍后重试：" + state.dailyPoem.error;
      return;
    }

    if (!state.dailyPoem) {
      refs.dailyPoemTitle.textContent = "每日一首诗";
      refs.dailyPoemContent.textContent = "等待联网读取...";
      refs.dailyPoemSource.textContent = "";
      return;
    }

    refs.dailyPoemTitle.textContent = state.dailyPoem.title + " · 毛泽东";
    refs.dailyPoemContent.textContent = state.dailyPoem.content || "-";
    refs.dailyPoemSource.textContent = (state.dailyPoem.cached ? "本地缓存" : "实时联网读取") + " · 来源：" +
      state.dailyPoem.sourceName +
      " · " +
      state.dailyPoem.sourceUrl;
  }

  async function loadDailyPoem(force) {
    const dateKey = getTodayKey();
    const dateChanged = Boolean(state.dailyPoemDateKey && state.dailyPoemDateKey !== dateKey);
    if (state.dailyPoemLoading) {
      return;
    }
    if (!force && state.dailyPoem && !state.dailyPoem.error && state.dailyPoemDateKey === dateKey) {
      return;
    }

    state.dailyPoemLoading = true;
    state.dailyPoemDateKey = dateKey;
    if (force || dateChanged) {
      state.dailyPoem = null;
    }
    renderDailyPoem();

    try {
      state.dailyPoem = await api.poem.getDaily(dateKey);
    } catch (error) {
      console.error(error);
      state.dailyPoem = { error: error.message || String(error) };
    } finally {
      state.dailyPoemLoading = false;
      renderDailyPoem();
    }
  }

  function showMemoList() {
    setActiveModule("memo");
    renderShell();
    renderMemo();
  }

  function showDashboard() {
    setActiveModule("dashboard");
    renderShell();
    renderDashboard({ forcePoem: true });
  }

  function renderSmoke() {
    if (!state.smoke) {
      return;
    }
    renderSmokeLists();
    renderCaseEditor();
  }

  function renderSmokeLists() {
    pruneBulkSelections();
    renderSmokeVersions();
    renderSceneStatusFilter();
    renderSmokeSummary();
    renderBulkActions();
    renderScenes();
    renderSceneDetail();
    renderCases();
  }

  function renderSmokeWithoutEditor() {
    pruneBulkSelections();
    renderSmokeVersions();
    renderSceneStatusFilter();
    renderSmokeSummary();
    renderBulkActions();
    renderScenes();
    renderCases();
  }

  function renderBulkActions() {
    const version = getActiveVersion();
    const visibleSceneCount = version ? version.scenes.filter(sceneMatches).length : 0;
    const scene = getActiveScene();
    const visibleCaseCount = scene ? getCasesForScene(scene.id).filter(caseMatches).length : 0;
    const sceneCount = state.selectedSceneIds.length;
    const caseCount = state.selectedCaseIds.length;
    if (state.sceneBulkDeleteMode && visibleSceneCount === 0) {
      state.sceneBulkDeleteMode = false;
      state.selectedSceneIds = [];
    }
    if (state.caseBulkDeleteMode && visibleCaseCount === 0) {
      state.caseBulkDeleteMode = false;
      state.selectedCaseIds = [];
    }

    refs.deleteSelectedScenesButton.disabled = !state.sceneBulkDeleteMode && visibleSceneCount === 0;
    refs.deleteSelectedCasesButton.disabled = !state.caseBulkDeleteMode && visibleCaseCount === 0;
    refs.deleteSelectedScenesButton.classList.toggle("is-active", state.sceneBulkDeleteMode);
    refs.deleteSelectedCasesButton.classList.toggle("is-active", state.caseBulkDeleteMode);
    refs.deleteSelectedScenesButton.textContent = state.sceneBulkDeleteMode
      ? (sceneCount ? "删除选中 " + sceneCount : "退出批量")
      : "批量删除";
    refs.deleteSelectedCasesButton.textContent = state.caseBulkDeleteMode
      ? (caseCount ? "删除选中 " + caseCount : "退出批量")
      : "批量删除";
  }

  function renderSmokeVersions() {
    const versions = state.smoke && Array.isArray(state.smoke.versions) ? state.smoke.versions : [];
    refs.smokeVersionSelect.replaceChildren();
    versions.forEach((version) => {
      const option = document.createElement("option");
      option.value = version.id;
      option.textContent = version.name;
      refs.smokeVersionSelect.append(option);
    });
    refs.smokeVersionSelect.value = state.smoke ? state.smoke.selectedVersionId : "";
    const hasVersion = versions.length > 0;
    refs.smokeVersionSelect.disabled = !hasVersion;
    refs.renameVersionButton.disabled = !hasVersion;
    refs.deleteVersionButton.disabled = !hasVersion;
  }

  function renderSceneStatusFilter() {
    const selected = new Set(state.smokeSceneStatusFilters);
    const isOpen = !refs.sceneStatusFilterMenu.hidden;
    refs.sceneStatusFilterMenu.replaceChildren();

    const head = document.createElement("div");
    head.className = "scene-status-menu-head";
    const title = document.createElement("span");
    title.textContent = "Case 状态";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "small";
    clear.textContent = "清空";
    clear.disabled = selected.size === 0;
    clear.addEventListener("click", () => {
      state.smokeSceneStatusFilters = [];
      renderSmoke();
    });
    head.append(title, clear);
    refs.sceneStatusFilterMenu.append(head);

    caseStatusOptions.forEach((option) => {
      const label = document.createElement("label");
      label.className = "scene-status-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = option.status;
      input.checked = selected.has(option.status);
      input.addEventListener("change", () => {
        if (input.checked) {
          state.smokeSceneStatusFilters = Array.from(new Set(state.smokeSceneStatusFilters.concat(option.status)));
        } else {
          state.smokeSceneStatusFilters = state.smokeSceneStatusFilters.filter((status) => status !== option.status);
        }
        renderSmoke();
      });
      const labelText = document.createElement("span");
      labelText.textContent = option.label;
      label.append(input, labelText);
      refs.sceneStatusFilterMenu.append(label);
    });

    refs.sceneStatusFilterMenu.hidden = !isOpen;
    refs.sceneStatusFilterButton.classList.toggle("is-active", selected.size > 0);
    refs.sceneStatusFilterButton.textContent = selected.size ? "状态 " + selected.size : "状态筛选";
    refs.sceneStatusFilterButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function renderSmokeSummary() {
    const version = getActiveVersion();
    if (!version) {
      refs.smokeSummary.textContent = "还没有版本";
      return;
    }
    const stats = version.cases.reduce(
      (acc, caseItem) => {
        acc[deriveCaseStatus(caseItem)] += 1;
        return acc;
      },
      { passed: 0, failed: 0, incomplete: 0, pending: 0 }
    );
    refs.smokeSummary.textContent =
      version.name +
      " · " +
      version.scenes.length +
      " 个场景 · Case " +
      version.cases.length +
      " · 成功 " +
      stats.passed +
      " · 失败 " +
      stats.failed +
      " · 未完成 " +
      stats.incomplete +
      " · 未执行 " +
      stats.pending;
  }

  function renderScenes() {
    refs.scenesList.replaceChildren();
    const version = getActiveVersion();
    if (!version) {
      refs.scenesList.append(createEmpty("先新建一个版本"));
      return;
    }
    const scenes = version.scenes.filter(sceneMatches);
    if (!scenes.length) {
      refs.scenesList.append(createEmpty(version.scenes.length
        ? (state.smokeSceneStatusFilters.length ? "没有匹配状态的场景" : "没有匹配场景")
        : "还没有场景"));
      return;
    }

    scenes.forEach((scene) => {
      const stats = getSceneStats(scene.id);
      const item = document.createElement("article");
      const isSelected = state.selectedSceneIds.includes(scene.id);
      item.className = "record-button scene-record";
      item.role = "button";
      item.tabIndex = 0;
      item.classList.toggle("is-active", scene.id === version.selectedSceneId);
      item.classList.toggle("selectable-record", state.sceneBulkDeleteMode);
      item.classList.toggle("is-selected", state.sceneBulkDeleteMode && isSelected);
      bindRecordActivation(item, async () => {
        if (state.sceneBulkDeleteMode) {
          setSelectedId("scene", scene.id, !state.selectedSceneIds.includes(scene.id));
          renderSmokeLists();
          return;
        }
        state.smoke = await api.smoke.selectScene(scene.id);
        state.selectedCaseIds = [];
        renderSmoke();
      });

      const content = document.createElement("div");
      content.className = "record-main";
      const title = document.createElement("strong");
      title.textContent = scene.name;
      const desc = document.createElement("span");
      desc.textContent = scene.description || "暂无说明";
      content.append(title, desc);

      const metrics = document.createElement("div");
      metrics.className = "metric-row";
      metrics.append(
        createPill("Case " + stats.total),
        createPill("成功 " + stats.passed, "passed"),
        createPill("失败 " + stats.failed, "failed"),
        createPill("未完成 " + stats.incomplete, "incomplete"),
        createPill("未执行 " + stats.pending, "pending")
      );
      const body = document.createElement("div");
      body.className = "record-body";
      body.append(content, metrics);
      if (state.sceneBulkDeleteMode) {
        item.append(createRecordCheckbox("scene", scene.id, isSelected, "选择场景 " + scene.name));
      }
      item.append(body);
      refs.scenesList.append(item);
    });
  }

  function renderSceneDetail() {
    refs.sceneDetail.replaceChildren();
    const scene = getActiveScene();
    if (!scene) {
      refs.sceneDetail.append(createEmpty("先新建一个场景"));
      return;
    }

    const name = document.createElement("input");
    name.className = "text-input";
    name.type = "text";
    name.value = scene.name;
    name.addEventListener("input", () => {
      scene.name = cleanText(name.value) || "默认场景";
      scheduleSceneSave(scene);
    });

    const desc = document.createElement("textarea");
    desc.className = "text-area compact";
    desc.placeholder = "场景说明";
    desc.value = scene.description;
    desc.addEventListener("input", () => {
      scene.description = desc.value;
      scheduleSceneSave(scene);
    });

    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.type = "button";
    deleteButton.textContent = "删除场景";
    deleteButton.addEventListener("click", async () => {
      if (!await confirmDialog("删除场景", "确定删除这个场景和其中所有 Case 吗？", { danger: true, confirmText: "删除" })) {
        return;
      }
      state.smoke = await api.smoke.deleteScene(scene.id);
      state.selectedSceneIds = state.selectedSceneIds.filter((sceneId) => sceneId !== scene.id);
      state.selectedCaseIds = [];
      state.sceneBulkDeleteMode = false;
      state.caseBulkDeleteMode = false;
      setToast("场景已删除");
      renderSmoke();
    });
    actions.append(deleteButton);
    refs.sceneDetail.append(name, desc, actions);
  }

  function renderCases() {
    refs.casesList.replaceChildren();
    const scene = getActiveScene();
    if (!scene) {
      refs.casesList.append(createEmpty("先新建一个场景"));
      return;
    }
    const cases = getCasesForScene(scene.id).filter(caseMatches);
    if (!cases.length) {
      refs.casesList.append(createEmpty(getCasesForScene(scene.id).length ? "没有匹配 Case" : "这个场景还没有 Case"));
      return;
    }

    cases.forEach((caseItem) => {
      const status = deriveCaseStatus(caseItem);
      const item = document.createElement("article");
      const isSelected = state.selectedCaseIds.includes(caseItem.id);
      item.className = "record-button case-record";
      item.role = "button";
      item.tabIndex = 0;
      const version = getActiveVersion();
      item.classList.toggle("is-active", Boolean(version && caseItem.id === version.selectedCaseId));
      item.classList.toggle("selectable-record", state.caseBulkDeleteMode);
      item.classList.toggle("is-selected", state.caseBulkDeleteMode && isSelected);
      bindRecordActivation(item, async () => {
        if (state.caseBulkDeleteMode) {
          setSelectedId("case", caseItem.id, !state.selectedCaseIds.includes(caseItem.id));
          renderSmokeLists();
          return;
        }
        state.smoke = await api.smoke.selectCase(caseItem.id);
        renderSmoke();
      });

      const content = document.createElement("div");
      content.className = "record-main";
      const title = document.createElement("strong");
      title.textContent = caseItem.title;
      const desc = document.createElement("span");
      desc.textContent = caseItem.description || "暂无说明";
      content.append(title, desc);

      const metrics = document.createElement("div");
      metrics.className = "metric-row fixed";
      metrics.append(createPill(statusLabel(status), status), createPill("步骤 " + caseItem.steps.length));
      const body = document.createElement("div");
      body.className = "record-body";
      body.append(content, metrics);
      if (state.caseBulkDeleteMode) {
        item.append(createRecordCheckbox("case", caseItem.id, isSelected, "选择 Case " + caseItem.title));
      }
      item.append(body);
      refs.casesList.append(item);
    });
  }

  function renderCaseEditor() {
    refs.caseEditor.replaceChildren();
    const caseItem = getActiveCase();
    if (!caseItem) {
      refs.caseEditor.append(createEmpty("选择或新建一个 Case"));
      return;
    }

    const head = document.createElement("div");
    head.className = "editor-head";
    const titleInput = document.createElement("input");
    titleInput.className = "text-input title";
    titleInput.type = "text";
    titleInput.value = caseItem.title;
    titleInput.addEventListener("input", () => {
      caseItem.title = cleanText(titleInput.value) || "未命名 Case";
      scheduleCaseSave(caseItem);
    });

    const descInput = document.createElement("textarea");
    descInput.className = "text-area compact";
    descInput.placeholder = "Case 说明";
    descInput.value = caseItem.description;
    descInput.addEventListener("input", () => {
      caseItem.description = descInput.value;
      scheduleCaseSave(caseItem);
    });

    const meta = document.createElement("div");
    meta.className = "case-meta";
    meta.append(createPill(statusLabel(deriveCaseStatus(caseItem)), deriveCaseStatus(caseItem)));
    const updated = document.createElement("span");
    updated.textContent = "更新 " + formatTime(caseItem.updatedAt);
    meta.append(updated);
    head.append(titleInput, descInput, meta);

    const actions = document.createElement("div");
    actions.className = "toolbar-actions";
    actions.append(
      makeButton("全部成功", "pass", () => markCasePassed(caseItem)),
      makeButton("标记失败", "fail", () => markCaseFailed(caseItem)),
      makeButton("新增步骤", "", () => addStep(caseItem)),
      makeButton("复制 Case", "", () => duplicateCase(caseItem)),
      makeSortButton(caseItem, "desc"),
      makeSortButton(caseItem, "asc"),
      makeButton("删除 Case", "danger", () => deleteCase(caseItem))
    );

    const steps = document.createElement("div");
    steps.className = "steps-list";
    const orderedSteps = getOrderedSteps(caseItem);
    if (!orderedSteps.length) {
      steps.append(createEmpty("还没有步骤"));
    } else {
      orderedSteps.forEach((step, index) => {
        steps.append(createStepElement(caseItem, step, index, orderedSteps.length));
      });
    }
    refs.caseEditor.append(head, actions, steps);
  }

  function makeButton(text, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (className) {
      button.className = className;
    }
    button.addEventListener("click", handler);
    return button;
  }

  function makeSortButton(caseItem, direction) {
    const button = makeButton(direction === "asc" ? "步骤正序" : "步骤倒序", "", async () => {
      state.smoke = await api.smoke.updateCase(caseItem.id, { stepSort: direction });
      renderSmoke();
    });
    button.classList.toggle("is-active", normalizeStepSort(caseItem.stepSort) === direction);
    return button;
  }

  function createStepElement(caseItem, step, index, count) {
    const item = document.createElement("section");
    item.className = "step-item is-" + step.status;

    const head = document.createElement("div");
    head.className = "step-head";
    const title = document.createElement("div");
    title.className = "step-title";
    const indexNode = document.createElement("span");
    indexNode.className = "step-index";
    indexNode.textContent = String(getStepDisplayNumber(caseItem, index, count));
    title.append(indexNode, document.createTextNode("步骤"));

    const tools = document.createElement("div");
    tools.className = "step-tools";
    const up = makeButton("上移", "", () => moveStep(caseItem, index, -1));
    const down = makeButton("下移", "", () => moveStep(caseItem, index, 1));
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    tools.append(up, down, makeButton("删除", "danger", () => deleteStep(caseItem, step.id)));
    head.append(title, tools);

    const grid = document.createElement("div");
    grid.className = "step-grid";
    grid.append(
      createStepTextarea("操作流程", step.action, (value) => {
        step.action = value;
        step.updatedAt = nowIso();
        scheduleCaseStepsSave(caseItem);
      }),
      createStepTextarea("期望结果", step.expected, (value) => {
        step.expected = value;
        step.updatedAt = nowIso();
        scheduleCaseStepsSave(caseItem);
      })
    );

    const statusRow = document.createElement("div");
    statusRow.className = "step-status-row";
    statusRow.append(createPill(statusLabel(step.status), step.status));
    const statusActions = document.createElement("div");
    statusActions.className = "step-status-actions";
    statusActions.append(
      makeButton("未执行", "", () => setStepStatus(caseItem, step.id, "pending")),
      makeButton("成功", "pass", () => setStepStatus(caseItem, step.id, "passed")),
      makeButton("失败", "fail", () => setStepStatus(caseItem, step.id, "failed"))
    );
    statusRow.append(statusActions);
    item.append(head, grid, statusRow);

    if (step.status === "failed") {
      item.append(createStepTextarea("失败原因", step.failureReason, (value) => {
        step.failureReason = value;
        step.updatedAt = nowIso();
        scheduleCaseStepsSave(caseItem);
      }));
    }

    return item;
  }

  function createStepTextarea(labelText, value, onInput) {
    const label = document.createElement("label");
    label.className = "field";
    const labelNode = document.createElement("span");
    labelNode.textContent = labelText;
    const textarea = document.createElement("textarea");
    textarea.className = "text-area";
    textarea.value = value;
    textarea.rows = 2;
    textarea.addEventListener("input", () => onInput(textarea.value));
    label.append(labelNode, textarea);
    return label;
  }

  function scheduleSceneSave(scene) {
    schedule("scene:" + scene.id, async () => {
      state.smoke = await api.smoke.updateScene(scene.id, { name: scene.name, description: scene.description });
      renderSmokeWithoutEditor();
    });
  }

  function scheduleCaseSave(caseItem) {
    schedule("case:" + caseItem.id, async () => {
      state.smoke = await api.smoke.updateCase(caseItem.id, { title: caseItem.title, description: caseItem.description });
      renderSmokeWithoutEditor();
    });
  }

  function scheduleCaseStepsSave(caseItem) {
    schedule("case-steps:" + caseItem.id, async () => {
      state.smoke = await api.smoke.updateCase(caseItem.id, { steps: caseItem.steps });
      renderSmokeWithoutEditor();
    });
  }

  function schedule(key, job) {
    window.clearTimeout(timers.get(key));
    timers.set(key, window.setTimeout(async () => {
      try {
        await job();
      } catch (error) {
        console.error(error);
        setToast("保存失败：" + error.message, true);
      } finally {
        timers.delete(key);
      }
    }, 500));
  }

  async function addStep(caseItem) {
    const nextSteps = [createBlankStep()].concat(getOrderedSteps(caseItem));
    const stepSort = normalizeStepSort(caseItem.stepSort) === "desc" ? "desc" : "custom";
    state.smoke = await api.smoke.updateCase(caseItem.id, { steps: nextSteps, stepSort });
    renderSmoke();
  }

  async function markCasePassed(caseItem) {
    const timestamp = nowIso();
    const steps = (caseItem.steps.length ? caseItem.steps : [createBlankStep()]).map((step) =>
      Object.assign({}, step, { status: "passed", failureReason: "", updatedAt: timestamp })
    );
    state.smoke = await api.smoke.updateCase(caseItem.id, { steps });
    setToast("Case 已全部成功");
    renderSmoke();
  }

  async function markCaseFailed(caseItem) {
    const orderedSteps = getOrderedSteps(caseItem);
    let step = orderedSteps.find((item) => item.status === "failed") || orderedSteps.find((item) => item.status !== "passed");
    let steps = caseItem.steps;
    let stepSort = caseItem.stepSort;
    if (!step) {
      step = createBlankStep();
      steps = [step].concat(orderedSteps);
      stepSort = normalizeStepSort(caseItem.stepSort) === "desc" ? "desc" : "custom";
    }
    step.status = "failed";
    step.updatedAt = nowIso();
    state.smoke = await api.smoke.updateCase(caseItem.id, { steps, stepSort });
    setToast("已标记失败，请补充失败原因");
    renderSmoke();
  }

  async function moveStep(caseItem, index, direction) {
    const steps = getOrderedSteps(caseItem);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= steps.length) {
      return;
    }
    const [step] = steps.splice(index, 1);
    steps.splice(nextIndex, 0, step);
    state.smoke = await api.smoke.updateCase(caseItem.id, { steps, stepSort: "custom" });
    renderSmoke();
  }

  async function deleteStep(caseItem, stepId) {
    if (caseItem.steps.length === 1 && !await confirmDialog("删除步骤", "删除最后一个步骤后，这个 Case 会回到未执行状态。确定删除吗？", { danger: true, confirmText: "删除" })) {
      return;
    }
    state.smoke = await api.smoke.updateCase(caseItem.id, { steps: getOrderedSteps(caseItem).filter((step) => step.id !== stepId) });
    renderSmoke();
  }

  async function setStepStatus(caseItem, stepId, status) {
    const step = caseItem.steps.find((item) => item.id === stepId);
    if (!step) {
      return;
    }
    step.status = normalizeStatus(status);
    if (step.status !== "failed") {
      step.failureReason = "";
    }
    step.updatedAt = nowIso();
    state.smoke = await api.smoke.updateCase(caseItem.id, { steps: caseItem.steps });
    renderSmoke();
  }

  async function duplicateCase(caseItem) {
    state.smoke = await api.smoke.duplicateCase(caseItem.id);
    setToast("Case 已复制");
    renderSmoke();
  }

  async function deleteCase(caseItem) {
    if (!await confirmDialog("删除 Case", "确定删除这个 Case 吗？", { danger: true, confirmText: "删除" })) {
      return;
    }
    state.smoke = await api.smoke.deleteCase(caseItem.id);
    state.selectedCaseIds = state.selectedCaseIds.filter((caseId) => caseId !== caseItem.id);
    if (!state.selectedCaseIds.length) {
      state.caseBulkDeleteMode = false;
    }
    setToast("Case 已删除");
    renderSmoke();
  }

  async function deleteSelectedScenes() {
    if (!state.sceneBulkDeleteMode) {
      state.sceneBulkDeleteMode = true;
      state.selectedSceneIds = [];
      renderSmokeLists();
      return;
    }

    const version = getActiveVersion();
    const selected = state.selectedSceneIds.slice();
    if (!version || !selected.length) {
      state.sceneBulkDeleteMode = false;
      state.selectedSceneIds = [];
      renderSmokeLists();
      return;
    }
    const selectedSet = new Set(selected);
    const sceneCount = version.scenes.filter((scene) => selectedSet.has(scene.id)).length;
    const caseCount = version.cases.filter((caseItem) => selectedSet.has(caseItem.sceneId)).length;
    if (!sceneCount) {
      state.selectedSceneIds = [];
      renderSmokeLists();
      return;
    }
    const message = "确定删除选中的 " + sceneCount + " 个场景吗？会同时删除其中 " + caseCount + " 个 Case。删除前会自动备份数据文件。";
    if (!await confirmDialog("批量删除场景", message, { danger: true, confirmText: "批量删除" })) {
      return;
    }
    refs.deleteSelectedScenesButton.disabled = true;
    state.smoke = await api.smoke.deleteScenes(selected);
    state.selectedSceneIds = [];
    state.selectedCaseIds = [];
    state.sceneBulkDeleteMode = false;
    state.caseBulkDeleteMode = false;
    setToast("已删除 " + sceneCount + " 个场景");
    renderSmoke();
  }

  async function deleteSelectedCases() {
    if (!state.caseBulkDeleteMode) {
      state.caseBulkDeleteMode = true;
      state.selectedCaseIds = [];
      renderSmokeLists();
      return;
    }

    const selected = state.selectedCaseIds.slice();
    if (!selected.length) {
      state.caseBulkDeleteMode = false;
      state.selectedCaseIds = [];
      renderSmokeLists();
      return;
    }
    const message = "确定删除选中的 " + selected.length + " 个 Case 吗？删除前会自动备份数据文件。";
    if (!await confirmDialog("批量删除 Case", message, { danger: true, confirmText: "批量删除" })) {
      return;
    }
    refs.deleteSelectedCasesButton.disabled = true;
    state.smoke = await api.smoke.deleteCases(selected);
    state.selectedCaseIds = [];
    state.caseBulkDeleteMode = false;
    setToast("已删除 " + selected.length + " 个 Case");
    renderSmoke();
  }

  async function createVersionFromPrompt() {
    const name = cleanText(await inputDialog("新建版本", "版本名称", "新版本"));
    if (!name) {
      return;
    }
    state.smoke = await api.smoke.createVersion({ name, description: "" });
    setToast("版本已创建");
    renderSmoke();
  }

  async function renameActiveVersionFromPrompt() {
    const version = getActiveVersion();
    if (!version) {
      return;
    }
    const name = cleanText(await inputDialog("重命名版本", "版本名称", version.name));
    if (!name || name === version.name) {
      return;
    }
    state.smoke = await api.smoke.updateVersion(version.id, { name });
    setToast("版本已重命名");
    renderSmoke();
  }

  async function deleteActiveVersion() {
    const version = getActiveVersion();
    if (!version) {
      return;
    }
    const confirmed = await openAppDialog({
      title: "删除版本",
      message: "将删除版本「" + version.name + "」中的 " + version.scenes.length + " 个场景、" + version.cases.length + " 个 Case。删除前会自动备份 smoke.json。请输入完整版本名确认。",
      inputLabel: "输入版本名",
      placeholder: version.name,
      requiredValue: version.name,
      confirmText: "删除版本",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    state.smoke = await api.smoke.deleteVersion(version.id);
    setToast("版本已删除");
    renderSmoke();
  }

  function getFilteredMemoNotes() {
    const keyword = state.memoSearch.trim().toLowerCase();
    if (!keyword) {
      return state.memoNotes;
    }
    return state.memoNotes.filter((note) => getMemoSearchText(note).includes(keyword));
  }

  function getMemoNoteById(noteId) {
    return state.memoNotes.find((note) => note.id === noteId) || null;
  }

  function getMemoTitle(note) {
    const title = cleanText(note && note.title);
    if (title) {
      return title;
    }
    return cleanText(String((note && note.content) || "").split(/\r?\n/)[0]) || "未命名备忘";
  }

  function getMemoDetail(note) {
    if (typeof (note && note.detail) === "string") {
      return note.detail;
    }
    const lines = String((note && note.content) || "").replace(/\r\n/g, "\n").split("\n");
    lines.shift();
    return cleanText(lines.join("\n"));
  }

  function getMemoSearchText(note) {
    return (getMemoTitle(note) + "\n" + getMemoDetail(note)).toLowerCase();
  }

  function openMemoDrawer(noteId) {
    state.selectedMemoId = noteId;
    state.memoDrawerOpen = true;
    renderMemo();
  }

  function closeMemoDrawer() {
    state.memoDrawerOpen = false;
    renderMemo();
  }

  async function autoSaveMemoFields(noteId, patch) {
    const note = getMemoNoteById(noteId);
    if (!note) {
      return false;
    }
    const nextTitle = Object.prototype.hasOwnProperty.call(patch || {}, "title") ? cleanText(patch.title) : getMemoTitle(note);
    const nextDetail = Object.prototype.hasOwnProperty.call(patch || {}, "detail") ? cleanText(patch.detail) : getMemoDetail(note);
    if (!nextTitle) {
      setToast("标题不能为空", true);
      return false;
    }
    if (nextTitle === getMemoTitle(note) && nextDetail === getMemoDetail(note)) {
      return true;
    }
    try {
      await api.memo.updateNote(noteId, { title: nextTitle, detail: nextDetail });
    } catch (error) {
      console.error(error);
      setToast("自动保存失败：" + error.message, true);
      return false;
    }
    await loadMemo();
    renderDashboardTodo();
    renderMemoShell();
    renderMemoListView();
    setToast("已自动保存");
    return true;
  }

  async function toggleMemoNote(note) {
    await api.memo.toggleNote(note.id, !note.completed);
    state.selectedMemoId = note.id;
    await loadMemo();
    renderMemo();
    setToast(note.completed ? "已恢复到待办" : "已完成");
  }

  async function deleteMemoNote(note) {
    if (!await confirmDialog("删除备忘", "确定删除这条备忘吗？", { danger: true, confirmText: "删除" })) {
      return;
    }
    await api.memo.deleteNote(note.id);
    if (state.selectedMemoId === note.id) {
      state.selectedMemoId = "";
      state.memoDrawerOpen = false;
    }
    await loadMemo();
    renderMemo();
    setToast("备忘已删除");
  }

  async function createMemoFromComposer(showEmptyError) {
    const title = cleanText(refs.memoInput.value);
    if (!title) {
      if (showEmptyError) {
        setToast("标题不能为空", true);
        refs.memoInput.focus();
      }
      return;
    }
    refs.memoInput.value = "";
    const selectedBeforeCreate = state.selectedMemoId;
    const drawerOpenBeforeCreate = state.memoDrawerOpen;
    try {
      const note = await api.memo.createNote({ title, detail: "" });
      await loadMemo();
      if (state.selectedMemoId === selectedBeforeCreate && state.memoDrawerOpen === drawerOpenBeforeCreate) {
        state.selectedMemoId = note.id;
        state.memoDrawerOpen = false;
      }
      renderMemo();
      setToast("备忘已创建");
    } catch (error) {
      console.error(error);
      refs.memoInput.value = title;
      setToast("创建备忘失败：" + error.message, true);
      refs.memoInput.focus();
    }
  }

  function renderMemo() {
    renderDashboardTodo();
    renderMemoShell();
    renderMemoListView();
    renderMemoDrawer();
  }

  function renderMemoShell() {
    refs.memoListView.classList.add("is-active");
    refs.memoSearchLabel.hidden = false;
    const todo = state.memoNotes.filter((note) => !note.completed).length;
    refs.memoSummary.textContent = "待办 " + todo + " · 完成 " + (state.memoNotes.length - todo);
  }

  function renderMemoListView() {
    refs.memoList.replaceChildren();
    const filtered = getFilteredMemoNotes();
    if (!filtered.length) {
      refs.memoList.append(createEmpty(state.memoSearch ? "没有匹配备忘" : "还没有备忘"));
      return;
    }
    const todo = filtered.filter((note) => !note.completed);
    const done = filtered.filter((note) => note.completed);
    refs.memoList.append(createMemoGroup("待办", todo, "list"), createMemoGroup("已完成", done, "list"));
  }

  function createMemoGroup(title, notes, sourceView) {
    const group = document.createElement("section");
    group.className = "memo-group";
    const head = document.createElement("div");
    head.className = "memo-group-head";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const count = document.createElement("span");
    count.textContent = notes.length + " 条";
    head.append(heading, count);
    group.append(head);
    if (!notes.length) {
      group.append(createEmpty("暂无" + title));
      return group;
    }
    const list = document.createElement("div");
    list.className = "note-stack";
    notes.forEach((note) => list.append(createNoteItem(note, sourceView || "list")));
    group.append(list);
    return group;
  }

  function createNoteItem(note, sourceView) {
    const item = document.createElement("article");
    item.className = "note-item";
    item.classList.toggle("is-completed", note.completed);
    item.classList.toggle("is-selected", state.selectedMemoId === note.id);
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", "打开备忘详情");
    item.addEventListener("click", () => openMemoDrawer(note.id));
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      openMemoDrawer(note.id);
    });

    const toggle = document.createElement("button");
    toggle.className = "check-button";
    toggle.type = "button";
    toggle.setAttribute("aria-label", note.completed ? "恢复待办" : "标记完成");
    toggle.addEventListener("click", async (event) => {
      event.stopPropagation();
      await toggleMemoNote(note);
    });

    const content = document.createElement("div");
    content.className = "note-content";
    const title = document.createElement("strong");
    title.className = "note-title";
    title.textContent = getMemoTitle(note);
    const detail = document.createElement("p");
    detail.className = "note-preview";
    detail.textContent = getMemoDetail(note);
    const time = document.createElement("time");
    const timeValue = note.completed && note.completedAt ? note.completedAt : note.updatedAt;
    time.dateTime = new Date(timeValue).toISOString();
    time.textContent = (note.completed ? "完成于 " : "更新于 ") + formatTime(timeValue);
    content.append(title, detail, time);

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const del = makeButton("删除", "danger small", async (event) => {
      event.stopPropagation();
      await deleteMemoNote(note);
    });
    actions.append(del);
    item.append(toggle, content, actions);
    return item;
  }

  function renderMemoDrawer() {
    refs.memoDrawer.replaceChildren();
    refs.memoDrawer.hidden = !state.memoDrawerOpen;
    refs.memoDrawerBackdrop.hidden = !state.memoDrawerOpen;
    refs.memoDrawer.classList.toggle("is-open", state.memoDrawerOpen);
    refs.memoDrawerBackdrop.classList.toggle("is-open", state.memoDrawerOpen);
    if (!state.memoDrawerOpen) {
      return;
    }
    const note = getMemoNoteById(state.selectedMemoId);
    if (!note) {
      state.memoDrawerOpen = false;
      renderMemoDrawer();
      return;
    }

    const head = document.createElement("div");
    head.className = "memo-drawer-head";
    const titleBlock = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = "备忘详情";
    const status = createPill(note.completed ? "已完成" : "待办", note.completed ? "passed" : "pending");
    titleBlock.append(heading, status);
    const close = makeButton("×", "icon-button", () => closeMemoDrawer());
    close.setAttribute("aria-label", "关闭详情");
    head.append(titleBlock, close);

    const fields = document.createElement("div");
    fields.className = "memo-drawer-fields";

    const titleField = document.createElement("label");
    titleField.className = "field";
    const titleLabel = document.createElement("span");
    titleLabel.textContent = "标题";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = getMemoTitle(note);
    titleInput.autocomplete = "off";
    titleInput.addEventListener("blur", async () => {
      const ok = await autoSaveMemoFields(note.id, { title: titleInput.value });
      if (!ok) {
        titleInput.value = getMemoTitle(getMemoNoteById(note.id) || note);
      }
    });
    titleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        titleInput.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMemoDrawer();
      }
    });
    titleField.append(titleLabel, titleInput);

    const detailField = document.createElement("label");
    detailField.className = "field";
    const detailLabel = document.createElement("span");
    detailLabel.textContent = "详情";
    const detailInput = document.createElement("textarea");
    detailInput.value = getMemoDetail(note);
    detailInput.rows = 10;
    detailInput.addEventListener("blur", () => autoSaveMemoFields(note.id, { detail: detailInput.value }));
    detailInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMemoDrawer();
      }
    });
    detailField.append(detailLabel, detailInput);
    fields.append(titleField, detailField);

    const meta = document.createElement("dl");
    meta.className = "memo-drawer-meta";
    meta.append(
      createMetaRow("创建", formatTime(note.createdAt)),
      createMetaRow("更新", formatTime(note.updatedAt))
    );
    if (note.completed && note.completedAt) {
      meta.append(createMetaRow("完成", formatTime(note.completedAt)));
    }

    const actions = document.createElement("div");
    actions.className = "memo-drawer-actions";
    const toggle = makeButton(note.completed ? "恢复待办" : "标记完成", note.completed ? "" : "pass", async () => {
      await toggleMemoNote(note);
    });
    const del = makeButton("删除", "danger", async () => {
      await deleteMemoNote(note);
    });
    actions.append(toggle, del);

    refs.memoDrawer.append(head, fields, meta, actions);
    window.requestAnimationFrame(() => {
      titleInput.focus();
      titleInput.select();
    });
  }

  function createMetaRow(label, value) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value || "-";
    wrapper.append(dt, dd);
    return wrapper;
  }

  function renderSettings() {
    if (!state.config) {
      return;
    }
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.settingsTab === state.settingsTab);
    });
    refs.settingsGeneralTab.classList.toggle("is-active", state.settingsTab === "general");
    refs.settingsMemoTab.classList.toggle("is-active", state.settingsTab === "memo");
    refs.settingsSmokeTab.classList.toggle("is-active", state.settingsTab === "smoke");

    refs.vaultPathInput.value = state.config.vaultPath;
    refs.configDataPathText.textContent = state.config.configPath || "-";
    refs.vaultRootPathText.textContent = state.config.vaultPath;
    const smokeDataPath = state.config.vaultPath + "/.personal-toolbox/smoke.json";
    const memoDataPath = state.config.vaultPath + "/.personal-toolbox/memo.json";
    refs.smokeDataPathText.textContent = smokeDataPath;
    refs.memoDataPathText.textContent = memoDataPath;
    refs.smokeDataPathTextMirror.textContent = smokeDataPath;
    refs.memoDataPathTextMirror.textContent = memoDataPath;

    const smokeSettings = state.smoke && state.smoke.settings ? state.smoke.settings : {};
    const smokeMarkdownFolder = smokeSettings.folder || "Smoke Tests";
    refs.smokeAutoWriteInput.checked = smokeSettings.autoWriteNotes !== false;
    refs.smokeMarkdownFolderText.textContent = joinVaultPath(smokeMarkdownFolder);

    const quickMemoShortcut = state.config.shortcuts && state.config.shortcuts.quickMemo ? state.config.shortcuts.quickMemo : "Alt+Q";
    const openMainShortcut = state.config.shortcuts && state.config.shortcuts.openMain ? state.config.shortcuts.openMain : "Alt+M";
    refs.quickMemoShortcutInput.dataset.accelerator = quickMemoShortcut;
    refs.quickMemoShortcutInput.value = acceleratorToDisplay(quickMemoShortcut);
    refs.openMainShortcutInput.dataset.accelerator = openMainShortcut;
    refs.openMainShortcutInput.value = acceleratorToDisplay(openMainShortcut);
  }

  async function saveVaultPath(vaultPath) {
    state.config = await api.config.setVaultPath(vaultPath);
    await Promise.all([loadSmoke(), loadMemo()]);
    renderAll();
    setToast("Vault 路径已保存");
  }

  async function saveShortcuts() {
    const quickMemo = refs.quickMemoShortcutInput.dataset.accelerator || "Alt+Q";
    const openMain = refs.openMainShortcutInput.dataset.accelerator || "Alt+M";
    state.config = await api.config.setShortcuts({ quickMemo, openMain });
    renderSettings();
    setToast("快捷键已保存");
  }

  async function saveSmokeSettingsFromSettings() {
    state.smoke = await api.smoke.saveSettings({
      autoWriteNotes: refs.smokeAutoWriteInput.checked
    });
    renderSettings();
    setToast("冒烟记录设置已保存");
  }

  async function importMemoNotes() {
    refs.importMemoButton.disabled = true;
    try {
      const result = await api.memo.importNotes();
      if (!result || result.canceled) {
        setToast("已取消导入");
        return;
      }
      await loadMemo();
      renderAll();
      setToast(formatMemoImportSummary(result));
    } catch (error) {
      console.error(error);
      setToast("导入备忘录失败：" + error.message, true);
    } finally {
      refs.importMemoButton.disabled = false;
    }
  }

  async function exportMemoNotes() {
    refs.exportMemoButton.disabled = true;
    try {
      const result = await api.memo.exportNotes();
      if (!result || result.canceled) {
        setToast("已取消导出");
        return;
      }
      setToast("导出完成：备忘 " + result.noteCount + " 条");
    } catch (error) {
      console.error(error);
      setToast("导出备忘录失败：" + error.message, true);
    } finally {
      refs.exportMemoButton.disabled = false;
    }
  }

  async function saveMemoImportSample() {
    refs.saveMemoSampleButton.disabled = true;
    try {
      const result = await api.memo.saveImportSample();
      if (!result || result.canceled) {
        setToast("已取消保存样例");
        return;
      }
      setToast("导入样例已保存");
    } catch (error) {
      console.error(error);
      setToast("保存导入样例失败：" + error.message, true);
    } finally {
      refs.saveMemoSampleButton.disabled = false;
    }
  }

  function bindShortcutInput(input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        return;
      }
      event.preventDefault();
      const accelerator = normalizeRecordedKey(event);
      if (!accelerator) {
        return;
      }
      input.dataset.accelerator = accelerator;
      input.value = acceleratorToDisplay(accelerator);
    });
    input.addEventListener("focus", () => {
      input.select();
    });
  }

  function bindEvents() {
    document.querySelectorAll(".nav-button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.module === "dashboard") {
          showDashboard();
          return;
        }
        setActiveModule(button.dataset.module);
        renderShell();
      });
    });
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        setSettingsTab(button.dataset.settingsTab);
        renderSettings();
      });
    });

    refs.smokeSearchInput.addEventListener("input", () => {
      state.smokeSearch = refs.smokeSearchInput.value;
      renderSmoke();
    });

    refs.sidebarToggleButton.addEventListener("click", () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      window.localStorage.setItem("personalToolbox.sidebarCollapsed", String(state.sidebarCollapsed));
      renderShell();
    });

    refs.sceneStatusFilterButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = refs.sceneStatusFilterMenu.hidden;
      refs.sceneStatusFilterMenu.hidden = !willOpen;
      refs.sceneStatusFilterButton.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    refs.sceneStatusFilterMenu.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    document.addEventListener("click", () => {
      if (!refs.sceneStatusFilterMenu.hidden) {
        refs.sceneStatusFilterMenu.hidden = true;
        refs.sceneStatusFilterButton.setAttribute("aria-expanded", "false");
      }
    });

    refs.smokeVersionSelect.addEventListener("change", async () => {
      try {
        state.selectedSceneIds = [];
        state.selectedCaseIds = [];
        state.sceneBulkDeleteMode = false;
        state.caseBulkDeleteMode = false;
        state.smoke = await api.smoke.selectVersion(refs.smokeVersionSelect.value);
        renderSmoke();
      } catch (error) {
        console.error(error);
        setToast("切换版本失败：" + error.message, true);
      }
    });

    refs.newVersionButton.addEventListener("click", async () => {
      try {
        await createVersionFromPrompt();
      } catch (error) {
        console.error(error);
        setToast("新建版本失败：" + error.message, true);
      }
    });

    refs.renameVersionButton.addEventListener("click", async () => {
      try {
        await renameActiveVersionFromPrompt();
      } catch (error) {
        console.error(error);
        setToast("重命名版本失败：" + error.message, true);
      }
    });

    refs.deleteVersionButton.addEventListener("click", async () => {
      try {
        await deleteActiveVersion();
      } catch (error) {
        console.error(error);
        setToast("删除版本失败：" + error.message, true);
      }
    });

    refs.importRunPlanButton.addEventListener("click", async () => {
      refs.importRunPlanButton.disabled = true;
      try {
        const result = await api.smoke.importRunPlan();
        if (!result || result.canceled) {
          setToast("已取消导入");
          return;
        }
        state.smoke = result.store;
        state.selectedSceneIds = [];
        state.selectedCaseIds = [];
        state.sceneBulkDeleteMode = false;
        state.caseBulkDeleteMode = false;
        setActiveModule("smoke");
        renderAll();
        setToast(formatImportSummary(result.summary));
      } catch (error) {
        console.error(error);
        setToast("导入失败：" + error.message, true);
      } finally {
        refs.importRunPlanButton.disabled = false;
      }
    });

    refs.exportMarkdownButton.addEventListener("click", async () => {
      refs.exportMarkdownButton.disabled = true;
      try {
        const result = await api.smoke.exportCurrentVersion();
        if (!result || result.canceled) {
          setToast("已取消导出");
          return;
        }
        setToast("导出完成：" + result.versionName + " · 场景 " + result.sceneCount + " · Case " + result.caseCount);
      } catch (error) {
        console.error(error);
        setToast("导出失败：" + error.message, true);
      } finally {
        refs.exportMarkdownButton.disabled = false;
      }
    });

    refs.todayTodoTile.addEventListener("click", () => {
      showMemoList();
    });

    refs.toggleScenesPanelButton.addEventListener("click", () => {
      state.scenesPanelCollapsed = !state.scenesPanelCollapsed;
      renderShell();
    });

    refs.newSceneButton.addEventListener("click", async () => {
      state.smoke = await api.smoke.createScene({ name: "新场景", description: "" });
      state.selectedSceneIds = [];
      state.selectedCaseIds = [];
      state.sceneBulkDeleteMode = false;
      state.caseBulkDeleteMode = false;
      renderSmoke();
    });

    refs.deleteSelectedScenesButton.addEventListener("click", async () => {
      try {
        await deleteSelectedScenes();
      } catch (error) {
        console.error(error);
        setToast("批量删除场景失败：" + error.message, true);
        renderSmokeLists();
      }
    });

    refs.newCaseButton.addEventListener("click", async () => {
      const scene = getActiveScene();
      state.smoke = await api.smoke.createCase({ sceneId: scene ? scene.id : "", title: "未命名 Case" });
      state.selectedCaseIds = [];
      state.caseBulkDeleteMode = false;
      renderSmoke();
    });

    refs.deleteSelectedCasesButton.addEventListener("click", async () => {
      try {
        await deleteSelectedCases();
      } catch (error) {
        console.error(error);
        setToast("批量删除 Case 失败：" + error.message, true);
        renderSmokeLists();
      }
    });

    refs.memoSearchInput.addEventListener("input", () => {
      state.memoSearch = refs.memoSearchInput.value;
      renderMemo();
    });
    refs.memoForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await createMemoFromComposer(true);
    });
    refs.memoInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        refs.memoForm.requestSubmit();
      }
    });
    refs.memoInput.addEventListener("blur", () => createMemoFromComposer(false));
    refs.memoDrawerBackdrop.addEventListener("click", closeMemoDrawer);

    refs.saveVaultPathButton.addEventListener("click", async () => {
      await saveVaultPath(refs.vaultPathInput.value);
    });
    refs.chooseVaultPathButton.addEventListener("click", async () => {
      state.config = await api.config.selectVaultPath();
      await Promise.all([loadSmoke(), loadMemo()]);
      renderAll();
      setToast("Vault 已切换");
    });
    refs.importMemoButton.addEventListener("click", importMemoNotes);
    refs.exportMemoButton.addEventListener("click", exportMemoNotes);
    refs.saveMemoSampleButton.addEventListener("click", saveMemoImportSample);
    refs.saveSmokeSettingsButton.addEventListener("click", async () => {
      try {
        await saveSmokeSettingsFromSettings();
      } catch (error) {
        console.error(error);
        setToast("冒烟记录设置保存失败：" + error.message, true);
      }
    });

    bindShortcutInput(refs.quickMemoShortcutInput);
    bindShortcutInput(refs.openMainShortcutInput);
    refs.saveQuickMemoShortcutButton.addEventListener("click", async () => {
      try {
        await saveShortcuts();
      } catch (error) {
        console.error(error);
        setToast("快捷键保存失败：" + error.message, true);
      }
    });

    if (api.memo.onChanged) {
      api.memo.onChanged(refreshMemoFromExternalChange);
    }
  }

  bindEvents();
  timers.set("dashboard-clock", window.setInterval(renderDashboardTime, 1000));
  reloadAll();
})();
