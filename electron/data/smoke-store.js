const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 2;
const DEFAULT_FOLDER = "Smoke Tests";
const DEFAULT_SCENE_NAME = "默认场景";
const DEFAULT_VERSION_NAME = "双边履约";
const FALLBACK_VERSION_NAME = "默认版本";
const DEFAULT_SETTINGS = {
  folder: DEFAULT_FOLDER,
  autoWriteNotes: true,
  openLocation: "main-new-tab"
};

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeStatus(value) {
  return value === "passed" || value === "failed" ? value : "pending";
}

function normalizeStepSort(value) {
  return value === "asc" || value === "custom" ? value : "desc";
}

function timestampFromId(id) {
  const match = String(id || "").match(/(?:^|\/|-)(\d{13})(?:-|$)/);
  if (!match) {
    return "";
  }
  const date = new Date(Number(match[1]));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeStep(step) {
  const status = normalizeStatus(step && step.status);
  const timestamp = nowIso();
  const id = step && step.id ? String(step.id) : createId("step");
  const createdAt = step && step.createdAt
    ? String(step.createdAt)
    : timestampFromId(id) || (step && step.updatedAt ? String(step.updatedAt) : timestamp);
  return {
    id,
    action: String((step && step.action) || ""),
    expected: String((step && step.expected) || ""),
    status,
    failureReason: status === "failed" ? String((step && step.failureReason) || "") : "",
    createdAt,
    updatedAt: step && step.updatedAt ? String(step.updatedAt) : createdAt
  };
}

function createBlankStep() {
  return normalizeStep({
    action: "",
    expected: "",
    status: "pending",
    failureReason: ""
  });
}

function normalizeScene(scene) {
  const timestamp = nowIso();
  return {
    id: scene && scene.id ? String(scene.id) : createId("scene"),
    name: cleanText(scene && scene.name) || DEFAULT_SCENE_NAME,
    description: String((scene && scene.description) || ""),
    createdAt: scene && scene.createdAt ? String(scene.createdAt) : timestamp,
    updatedAt: scene && scene.updatedAt ? String(scene.updatedAt) : timestamp
  };
}

function normalizeVersion(version) {
  const timestamp = nowIso();
  const normalized = {
    id: version && version.id ? String(version.id) : createId("version"),
    name: cleanText(version && version.name) || FALLBACK_VERSION_NAME,
    description: String((version && version.description) || ""),
    scenes: Array.isArray(version && version.scenes) ? version.scenes.map(normalizeScene) : [],
    cases: Array.isArray(version && version.cases) ? version.cases.map(normalizeCase) : [],
    selectedSceneId: version && version.selectedSceneId ? String(version.selectedSceneId) : "",
    selectedCaseId: version && version.selectedCaseId ? String(version.selectedCaseId) : "",
    createdAt: version && version.createdAt ? String(version.createdAt) : timestamp,
    updatedAt: version && version.updatedAt ? String(version.updatedAt) : timestamp
  };
  reconcileVersionSelection(normalized);
  return normalized;
}

function normalizeCase(caseItem) {
  const timestamp = nowIso();
  return {
    id: caseItem && caseItem.id ? String(caseItem.id) : createId("case"),
    sceneId: String((caseItem && caseItem.sceneId) || ""),
    title: cleanText(caseItem && caseItem.title) || "未命名 Case",
    description: String((caseItem && caseItem.description) || ""),
    steps: Array.isArray(caseItem && caseItem.steps) ? caseItem.steps.map(normalizeStep) : [],
    stepSort: normalizeStepSort(caseItem && caseItem.stepSort),
    notePath: caseItem && caseItem.notePath ? String(caseItem.notePath) : "",
    sourceType: caseItem && caseItem.sourceType ? String(caseItem.sourceType) : "",
    sourcePath: caseItem && caseItem.sourcePath ? String(caseItem.sourcePath) : "",
    sourceRunId: caseItem && caseItem.sourceRunId ? String(caseItem.sourceRunId) : "",
    sourceCaseId: caseItem && caseItem.sourceCaseId ? String(caseItem.sourceCaseId) : "",
    createdAt: caseItem && caseItem.createdAt ? String(caseItem.createdAt) : timestamp,
    updatedAt: caseItem && caseItem.updatedAt ? String(caseItem.updatedAt) : timestamp,
    lastRunAt: caseItem && caseItem.lastRunAt ? String(caseItem.lastRunAt) : ""
  };
}

function normalizeOpenLocation(value) {
  return ["main-new-tab", "main-current-tab", "left-sidebar", "right-sidebar"].includes(value) ? value : "main-new-tab";
}

function createEmptyVersion(name) {
  return normalizeVersion({
    name: cleanText(name) || FALLBACK_VERSION_NAME,
    description: "",
    scenes: [],
    cases: [],
    selectedSceneId: "",
    selectedCaseId: ""
  });
}

function isV2Store(raw) {
  return raw && (raw.schemaVersion === SCHEMA_VERSION || Array.isArray(raw.versions));
}

function normalizeStore(raw) {
  const store = raw || {};
  const settings = Object.assign({}, DEFAULT_SETTINGS, store.settings || {});
  settings.folder = cleanText(settings.folder) || DEFAULT_FOLDER;
  settings.autoWriteNotes = settings.autoWriteNotes !== false;
  settings.openLocation = normalizeOpenLocation(settings.openLocation);

  let versions;
  let selectedVersionId = store.selectedVersionId ? String(store.selectedVersionId) : "";
  if (isV2Store(store)) {
    versions = Array.isArray(store.versions) ? store.versions.map(normalizeVersion) : [];
  } else {
    versions = [normalizeVersion({
      name: DEFAULT_VERSION_NAME,
      description: "",
      scenes: Array.isArray(store.scenes) ? store.scenes : [],
      cases: Array.isArray(store.cases) ? store.cases : [],
      selectedSceneId: store.selectedSceneId,
      selectedCaseId: store.selectedCaseId
    })];
    selectedVersionId = versions[0].id;
  }

  if (versions.length === 0) {
    versions.push(createEmptyVersion(FALLBACK_VERSION_NAME));
    selectedVersionId = versions[0].id;
  }

  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    settings,
    versions,
    selectedVersionId
  };
  reconcileStoreSelection(normalized);
  return normalized;
}

function reconcileVersionSelection(version) {
  if (!version.scenes.some((scene) => scene.id === version.selectedSceneId)) {
    version.selectedSceneId = version.scenes.length ? version.scenes[0].id : "";
  }
  const sceneCases = getCasesForScene(version, version.selectedSceneId);
  if (!sceneCases.some((caseItem) => caseItem.id === version.selectedCaseId)) {
    version.selectedCaseId = sceneCases.length ? sceneCases[0].id : "";
  }
}

function reconcileStoreSelection(store) {
  if (!store.versions.some((version) => version.id === store.selectedVersionId)) {
    store.selectedVersionId = store.versions.length ? store.versions[0].id : "";
  }
  store.versions.forEach(reconcileVersionSelection);
}

function getActiveVersion(store) {
  let version = store.versions.find((item) => item.id === store.selectedVersionId);
  if (!version) {
    if (!store.versions.length) {
      store.versions.push(createEmptyVersion(FALLBACK_VERSION_NAME));
    }
    version = store.versions[0];
    store.selectedVersionId = version.id;
  }
  reconcileVersionSelection(version);
  return version;
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
  if (sort === "custom") {
    return steps.slice();
  }
  return sortStepsByCreatedAt(steps, sort);
}

function getStepDisplayNumber(caseItem, index, count) {
  if (normalizeStepSort(caseItem && caseItem.stepSort) !== "desc") {
    return index + 1;
  }
  return count - index;
}

function getCasesForScene(version, sceneId) {
  return version.cases
    .filter((caseItem) => caseItem.sceneId === sceneId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function buildDuplicateCaseTitle(version, sourceCase) {
  const baseTitle = cleanText(sourceCase && sourceCase.title) || "未命名 Case";
  const sceneCases = (version.cases || []).filter((caseItem) => caseItem.sceneId === sourceCase.sceneId);
  const usedTitles = new Set(sceneCases.map((caseItem) => cleanText(caseItem.title)));
  const firstTitle = baseTitle + " 副本";
  if (!usedTitles.has(firstTitle)) {
    return firstTitle;
  }
  let index = 2;
  while (usedTitles.has(baseTitle + " 副本 " + index)) {
    index += 1;
  }
  return baseTitle + " 副本 " + index;
}

function duplicateStepsForTemplate(caseItem, timestamp) {
  const orderedSteps = getOrderedSteps(caseItem);
  if (!orderedSteps.length) {
    return [createBlankStep()];
  }
  return orderedSteps.map((step) => normalizeStep({
    id: createId("step"),
    action: step.action,
    expected: step.expected,
    status: "pending",
    failureReason: "",
    createdAt: step.createdAt || timestamp,
    updatedAt: timestamp
  }));
}

function sanitizePathSegment(value) {
  const normalized = cleanText(value) || "未命名";
  return normalized
    .replace(/[\\/:*?"<>|#[\]^]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function normalizeFolder(value) {
  return cleanText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join("/") || DEFAULT_FOLDER;
}

function shortId(id) {
  return String(id || "").split("-").slice(-2).join("-") || "case";
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
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

function getCaseNotePath(store, version, caseItem) {
  const scene = version.scenes.find((item) => item.id === caseItem.sceneId);
  const baseFolder = normalizeFolder(store.settings.folder);
  const versionFolder = sanitizePathSegment(version ? version.name : FALLBACK_VERSION_NAME);
  const sceneFolder = sanitizePathSegment(scene ? scene.name : DEFAULT_SCENE_NAME);
  const title = sanitizePathSegment(caseItem.title || "未命名 Case");
  return baseFolder + "/" + versionFolder + "/" + sceneFolder + "/" + title + "__" + shortId(caseItem.id) + ".md";
}

function buildCaseMarkdown(store, version, caseItem) {
  const scene = version.scenes.find((item) => item.id === caseItem.sceneId);
  const status = deriveCaseStatus(caseItem);
  const sceneName = scene ? scene.name : DEFAULT_SCENE_NAME;
  const versionName = version ? version.name : FALLBACK_VERSION_NAME;
  const lines = [
    "---",
    "type: smoke-case",
    "smoke_case_id: " + yamlString(caseItem.id),
    "version: " + yamlString(versionName),
    "scene: " + yamlString(sceneName),
    "status: " + yamlString(status),
    "status_label: " + yamlString(statusLabel(status)),
    "updated: " + yamlString(caseItem.updatedAt),
    "---",
    "",
    "# " + caseItem.title,
    "",
    caseItem.description ? caseItem.description : "> 暂无 Case 说明。",
    "",
    "## 执行状态",
    "",
    "- 版本：" + versionName,
    "- 场景：" + sceneName,
    "- 状态：" + statusLabel(status),
    "- 最近执行：" + (caseItem.lastRunAt ? formatTime(caseItem.lastRunAt) : "未执行"),
    "",
    "## 步骤",
    ""
  ];

  const steps = getOrderedSteps(caseItem);
  if (steps.length === 0) {
    lines.push("> 还没有步骤。");
    return lines.join("\n");
  }

  steps.forEach((step, index) => {
    lines.push("### " + getStepDisplayNumber(caseItem, index, steps.length) + ". " + (step.action ? step.action.split("\n")[0] : "未填写操作"));
    lines.push("");
    lines.push("- 操作流程：" + (step.action || "未填写"));
    lines.push("- 期望结果：" + (step.expected || "未填写"));
    lines.push("- 结果：" + statusLabel(step.status));
    if (step.status === "failed") {
      lines.push("- 失败原因：" + (step.failureReason || "未填写"));
    }
    lines.push("");
  });

  return lines.join("\n");
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function markdownTableCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim() || "-";
}

function markdownQuoteBlock(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "> 暂无";
  }
  return text.split(/\r?\n/).map((line) => "> " + line).join("\n");
}

function countVersionStats(version) {
  const stats = {
    scenes: Array.isArray(version && version.scenes) ? version.scenes.length : 0,
    cases: Array.isArray(version && version.cases) ? version.cases.length : 0,
    passed: 0,
    failed: 0,
    incomplete: 0,
    pending: 0
  };
  (version.cases || []).forEach((caseItem) => {
    stats[deriveCaseStatus(caseItem)] += 1;
  });
  return stats;
}

function buildVersionExportMarkdown(version) {
  const stats = countVersionStats(version);
  const lines = [
    "# " + version.name + " 冒烟记录导出",
    "",
    "- 导出时间：" + formatDateTime(nowIso()),
    "- 版本：" + version.name,
    "- 场景数：" + stats.scenes,
    "- Case 数：" + stats.cases,
    "- 成功：" + stats.passed,
    "- 失败：" + stats.failed,
    "- 未完成：" + stats.incomplete,
    "- 未执行：" + stats.pending,
    "",
    "## 目录",
    ""
  ];

  version.scenes.forEach((scene, index) => {
    const sceneCases = getCasesForScene(version, scene.id);
    lines.push((index + 1) + ". " + scene.name + "（Case " + sceneCases.length + "）");
  });

  if (!version.scenes.length) {
    lines.push("> 当前版本还没有场景。");
  }

  version.scenes.forEach((scene, sceneIndex) => {
    const sceneCases = getCasesForScene(version, scene.id);
    lines.push("", "## " + (sceneIndex + 1) + ". " + scene.name, "");
    lines.push("- 场景说明：" + (scene.description || "暂无"));
    lines.push("- Case 数：" + sceneCases.length);

    if (!sceneCases.length) {
      lines.push("", "> 这个场景还没有 Case。");
      return;
    }

    sceneCases.forEach((caseItem, caseIndex) => {
      const steps = getOrderedSteps(caseItem);
      const status = deriveCaseStatus(caseItem);
      lines.push(
        "",
        "### " + (sceneIndex + 1) + "." + (caseIndex + 1) + " " + caseItem.title,
        "",
        "- Case ID：" + caseItem.id,
        "- 状态：" + statusLabel(status),
        "- 步骤数：" + steps.length,
        "- 最近执行：" + (caseItem.lastRunAt ? formatDateTime(caseItem.lastRunAt) : "未执行"),
        "- 更新时间：" + formatDateTime(caseItem.updatedAt),
        "- Markdown：" + (caseItem.notePath || "未同步")
      );
      if (caseItem.sourcePath || caseItem.sourceRunId || caseItem.sourceCaseId) {
        lines.push(
          "- 来源：" + (caseItem.sourcePath || "未记录"),
          "- Run ID：" + (caseItem.sourceRunId || "未记录"),
          "- Source Case：" + (caseItem.sourceCaseId || "未记录")
        );
      }

      lines.push("", "#### Case 说明", "", markdownQuoteBlock(caseItem.description), "");

      if (!steps.length) {
        lines.push("#### 步骤", "", "> 还没有步骤。");
        return;
      }

      lines.push(
        "#### 步骤",
        "",
        "| 序号 | 操作流程 | 期望结果 | 执行结果 | 失败原因 |",
        "| --- | --- | --- | --- | --- |"
      );
      steps.forEach((step, stepIndex) => {
        const displayNumber = getStepDisplayNumber(caseItem, stepIndex, steps.length);
        lines.push(
          "| " +
            [
              displayNumber,
              markdownTableCell(step.action),
              markdownTableCell(step.expected),
              statusLabel(step.status),
              step.status === "failed" ? markdownTableCell(step.failureReason || "未填写") : "-"
            ].join(" | ") +
            " |"
        );
      });
    });
  });

  lines.push("");
  return lines.join("\n");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveVaultRelativePath(vaultPath, relativePath) {
  if (!relativePath) {
    return "";
  }
  const vaultAbs = path.resolve(vaultPath);
  const targetAbs = path.resolve(vaultAbs, String(relativePath));
  const relative = path.relative(vaultAbs, targetAbs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  return targetAbs;
}

function splitMarkdownTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function extractSection(text, heading) {
  const pattern = new RegExp("^####\\s+" + heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\n([\\s\\S]*?)(?=^####\\s+|^###(?!#)\\s+|(?![\\s\\S]))", "m");
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : "";
}

function extractBullets(text) {
  const bullets = [];
  let current = null;
  String(text || "").split(/\r?\n/).forEach((line) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (current) {
        bullets.push(current.trim());
      }
      current = bullet[1].trim();
      return;
    }
    if (current && line.trim()) {
      current += "\n" + line.trim();
    }
  });
  if (current) {
    bullets.push(current.trim());
  }
  return bullets;
}

function extractRunMeta(block, label) {
  const pattern = new RegExp("^\\s*-\\s*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[：:]\\s*(.+)$", "m");
  const match = String(block || "").match(pattern);
  return match ? match[1].trim() : "";
}

function extractNaturalCases(markdown) {
  const headings = [];
  const pattern = /^###\s+(RUN-SMOKE-\d+)\s+(TC\d+)\s+(.+)$/gm;
  let match = pattern.exec(markdown);
  while (match) {
    headings.push({
      runId: match[1],
      caseId: match[2],
      title: match[3].trim(),
      index: match.index
    });
    match = pattern.exec(markdown);
  }

  const cases = new Map();
  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const block = markdown.slice(heading.index, next ? next.index : markdown.length);
    cases.set(heading.runId, {
      runId: heading.runId,
      caseId: heading.caseId,
      title: heading.title,
      requirement: extractRunMeta(block, "覆盖需求"),
      executionMethod: extractRunMeta(block, "执行方式"),
      surface: extractRunMeta(block, "适用端"),
      entry: extractRunMeta(block, "页面入口"),
      priority: extractRunMeta(block, "优先级"),
      dataProfile: extractRunMeta(block, "data_profile"),
      automationSuggestion: extractRunMeta(block, "自动化建议"),
      dataSetup: extractBullets(extractSection(block, "数据准备")),
      preconditions: extractBullets(extractSection(block, "前提条件")),
      actions: extractBullets(extractSection(block, "操作步骤")),
      expected: extractBullets(extractSection(block, "预期结果")),
      checkpoints: extractBullets(extractSection(block, "关键验证点"))
    });
  });
  return cases;
}

function parseRunPlanTable(markdown) {
  const section = String(markdown || "").match(/^##\s+工具读取结构\s*\n([\s\S]*?)(?=^##\s+)/m);
  const source = section ? section[1] : markdown;
  const lines = source.split(/\r?\n/).filter((line) => /^\|\s*(run_id|RUN-SMOKE-)/.test(line));
  if (!lines.length) {
    return [];
  }
  const headers = splitMarkdownTableRow(lines[0]);
  return lines.slice(1)
    .filter((line) => /^\|\s*RUN-SMOKE-/.test(line))
    .map((line) => {
      const cells = splitMarkdownTableRow(line);
      return headers.reduce((row, header, index) => {
        row[header] = cells[index] || "";
        return row;
      }, {});
    });
}

function buildImportKey(sourcePath, runId) {
  return String(sourcePath || "") + "#" + String(runId || "");
}

function extractImportKey(description) {
  const match = String(description || "").match(/smoke_run_plan_import_key=([^\n]+)/);
  return match ? match[1].trim() : "";
}

function formatBulletList(items) {
  if (!items || !items.length) {
    return "- 未提供";
  }
  return items.map((item) => "- " + item).join("\n");
}

function buildImportedCaseDescription(record, sourcePath) {
  const lines = [
    "来源：" + sourcePath,
    "",
    "## 导入信息",
    "",
    "- run_id：" + record.runId,
    "- case_id：" + record.caseId,
    "- target_surface：" + (record.targetSurface || "未提供"),
    "- execution_layer：" + (record.executionLayer || "未提供"),
    "- run_adapter：" + (record.runAdapter || "未提供"),
    "- entry_ref：" + (record.entryRef || "未提供"),
    "- auth_profile：" + (record.authProfile || "未提供"),
    "- data_profile：" + (record.dataProfile || "未提供"),
    "- 优先级：" + (record.priority || "未提供"),
    "- 页面入口：" + (record.entry || "未提供"),
    "- 自动化建议：" + (record.automationSuggestion || "未提供"),
    "",
    "## 数据准备",
    "",
    formatBulletList(record.dataSetup),
    "",
    "## 前提条件",
    "",
    formatBulletList(record.preconditions),
    "",
    "## 关键验证点",
    "",
    formatBulletList(record.checkpoints),
    "",
    "## 导入标记",
    "",
    "smoke_run_plan_import_key=" + buildImportKey(sourcePath, record.runId)
  ];
  return lines.join("\n");
}

function buildImportedCaseTitle(record) {
  return cleanText(record && record.title) || cleanText(record && record.caseId) || cleanText(record && record.runId) || "未命名 Case";
}

function createImportedSteps(record, timestamp) {
  const actions = record.actions && record.actions.length ? record.actions : [record.title];
  const expected = record.expected && record.expected.length ? record.expected : ["见 Case 说明。"];
  const mergedExpected = expected.join("\n");
  const baseTime = Date.parse(timestamp);
  const startTime = Number.isNaN(baseTime) ? Date.now() : baseTime;
  return actions.map((action, index) => normalizeStep({
    id: createId("step"),
    action,
    expected: expected.length === actions.length ? expected[index] : mergedExpected,
    status: "pending",
    failureReason: "",
    createdAt: new Date(startTime + index).toISOString(),
    updatedAt: new Date(startTime + index).toISOString()
  }));
}

function mergeImportedStepsPreservingExecution(existingSteps, importedSteps) {
  const existing = Array.isArray(existingSteps) ? existingSteps.map(normalizeStep) : [];
  const imported = Array.isArray(importedSteps) ? importedSteps.map(normalizeStep) : [];
  return imported.map((step, index) => {
    const oldStep = existing.find((item) => item.action === step.action && item.expected === step.expected) || existing[index];
    if (!oldStep) {
      return step;
    }
    return normalizeStep(Object.assign({}, step, {
      id: oldStep.id || step.id,
      status: normalizeStatus(oldStep.status),
      failureReason: oldStep.failureReason || "",
      createdAt: oldStep.createdAt || step.createdAt,
      updatedAt: oldStep.updatedAt || step.updatedAt
    }));
  });
}

function isSameImportedStepOrder(existingSteps, importedSteps) {
  const existing = Array.isArray(existingSteps) ? existingSteps.map(normalizeStep) : [];
  const imported = Array.isArray(importedSteps) ? importedSteps.map(normalizeStep) : [];
  if (existing.length !== imported.length) {
    return false;
  }
  return imported.every((step, index) => {
    const oldStep = existing[index];
    return oldStep && oldStep.action === step.action && oldStep.expected === step.expected;
  });
}

function parseSmokeRunPlan(markdown, sourcePath) {
  const tableRows = parseRunPlanTable(markdown);
  const naturalCases = extractNaturalCases(markdown);
  const records = tableRows.map((row) => {
    const natural = naturalCases.get(row.run_id) || {};
    return {
      runId: row.run_id || natural.runId || "",
      caseId: row.case_id || natural.caseId || "",
      title: row.title || natural.title || "未命名 Case",
      targetSurface: row.target_surface || "",
      executionLayer: row.execution_layer || "",
      runAdapter: row.run_adapter || "",
      entryType: row.entry_type || "",
      entryRef: row.entry_ref || "",
      authProfile: row.auth_profile || "",
      dataProfile: row.data_profile || natural.dataProfile || "UNKNOWN",
      incrementalRun: row.incremental_run || "",
      artifactsPath: row.artifacts_path || "",
      owner: row.owner || "",
      gateStatus: row.gate_status || "",
      runLane: row.run_lane || "",
      selectionReason: row.selection_reason || "",
      requirement: natural.requirement || "",
      priority: natural.priority || "",
      surface: natural.surface || "",
      entry: natural.entry || "",
      automationSuggestion: natural.automationSuggestion || "",
      dataSetup: natural.dataSetup || [],
      preconditions: natural.preconditions || [],
      actions: natural.actions || [],
      expected: natural.expected || [],
      checkpoints: natural.checkpoints || []
    };
  }).filter((record) => record.runId);

  if (!records.length) {
    throw new Error("未识别到 smoke-run-plan 的 RUN-SMOKE 表格记录");
  }

  return {
    sourcePath,
    tableCount: tableRows.length,
    naturalCaseCount: naturalCases.size,
    records
  };
}

function isCaseImportUpdatable(caseItem) {
  const steps = Array.isArray(caseItem && caseItem.steps) ? caseItem.steps : [];
  if (!steps.length) {
    return true;
  }
  return steps.every((step) => normalizeStatus(step.status) === "pending" && !cleanText(step.failureReason));
}

function toVaultRelativePath(vaultPath, filePath) {
  const relative = path.relative(vaultPath, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return filePath;
  }
  return relative.split(path.sep).join("/");
}

function findImportedCase(version, sourcePath, runId) {
  const importKey = buildImportKey(sourcePath, runId);
  return version.cases.find((caseItem) =>
    caseItem.sourceType === "smoke-run-plan" &&
    caseItem.sourcePath === sourcePath &&
    caseItem.sourceRunId === runId
  ) || version.cases.find((caseItem) => extractImportKey(caseItem.description) === importKey);
}

function versionNameExists(store, name, exceptVersionId) {
  const normalizedName = cleanText(name);
  return store.versions.some((version) => version.id !== exceptVersionId && cleanText(version.name) === normalizedName);
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 10);
}

function safeIso(value, fallback) {
  const time = Date.parse(value || "");
  if (Number.isNaN(time)) {
    return fallback || nowIso();
  }
  return new Date(time).toISOString();
}

function parseSmokeCaseFrontmatter(markdown) {
  const match = String(markdown || "").match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = {};
  if (!match) {
    return frontmatter;
  }
  match[1].split(/\r?\n/).forEach((line) => {
    const item = line.match(/^([^:]+):\s*(.*)$/);
    if (!item) {
      return;
    }
    let value = item[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[item[1].trim()] = value;
  });
  return frontmatter;
}

function parseSmokeCaseDescription(markdown) {
  const body = String(markdown || "").replace(/^---\n[\s\S]*?\n---\n?/, "");
  const title = body.match(/^#\s+.+$/m);
  if (!title) {
    return "";
  }
  const afterTitle = body.slice(title.index + title[0].length);
  const statusIndex = afterTitle.search(/^##\s+执行状态\s*$/m);
  const description = (statusIndex >= 0 ? afterTitle.slice(0, statusIndex) : afterTitle).trim();
  return description === "> 暂无 Case 说明。" ? "" : description;
}

function parseSmokeCaseStepFields(markdown) {
  const fields = {};
  let current = "";
  String(markdown || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^-\s*(操作流程|期望结果|结果|失败原因)：(.*)$/);
    if (match) {
      current = match[1];
      fields[current] = match[2].trim();
      return;
    }
    if (current && line.trim() && !line.trim().startsWith("- ")) {
      fields[current] += "\n" + line.trim();
    }
  });
  return fields;
}

function statusFromMarkdownLabel(value) {
  const label = String(value || "");
  if (label.includes("成功")) {
    return "passed";
  }
  if (label.includes("失败")) {
    return "failed";
  }
  return "pending";
}

function parseSmokeCaseSteps(markdown) {
  const section = String(markdown || "").match(/^##\s+步骤\s*\n([\s\S]*)$/m);
  if (!section) {
    return [];
  }
  const source = section[1];
  const headings = [];
  const pattern = /^###\s+(\d+)\.\s*(.*)$/gm;
  let match = pattern.exec(source);
  while (match) {
    headings.push({
      number: Number(match[1]),
      text: match[2].trim(),
      start: match.index,
      end: pattern.lastIndex
    });
    match = pattern.exec(source);
  }
  return headings.map((heading, index) => {
    const next = headings[index + 1];
    const body = source.slice(heading.end, next ? next.start : source.length).trim();
    const fields = parseSmokeCaseStepFields(body);
    const status = statusFromMarkdownLabel(fields["结果"]);
    return {
      number: heading.number,
      action: fields["操作流程"] || heading.text || "未填写",
      expected: fields["期望结果"] || "",
      status,
      failureReason: status === "failed" ? String(fields["失败原因"] || "") : ""
    };
  });
}

function extractSmokeCaseImportInfo(description) {
  const marker = String(description || "").match(/smoke_run_plan_import_key=([^\n]+)/);
  const sourceCase = String(description || "").match(/^-\s*case_id：([^\n]+)/m);
  if (!marker) {
    return {
      sourceType: "",
      sourcePath: "",
      sourceRunId: "",
      sourceCaseId: sourceCase ? sourceCase[1].trim() : ""
    };
  }
  const importKey = marker[1].trim();
  const splitIndex = importKey.lastIndexOf("#");
  return {
    sourceType: "smoke-run-plan",
    sourcePath: splitIndex >= 0 ? importKey.slice(0, splitIndex) : importKey,
    sourceRunId: splitIndex >= 0 ? importKey.slice(splitIndex + 1) : "",
    sourceCaseId: sourceCase ? sourceCase[1].trim() : ""
  };
}

function relativeVaultPath(vaultPath, filePath) {
  return path.relative(vaultPath, filePath).split(path.sep).join("/");
}

function minIso(values, fallback) {
  return values.filter(Boolean).sort()[0] || fallback || nowIso();
}

function maxIso(values, fallback) {
  return values.filter(Boolean).sort().slice(-1)[0] || fallback || nowIso();
}

async function listMarkdownFiles(folderPath) {
  let entries;
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      return listMarkdownFiles(fullPath);
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      return [fullPath];
    }
    return [];
  }));
  return nested.flat();
}

class SmokeStore {
  constructor(configStore) {
    this.configStore = configStore;
  }

  async getDataPath() {
    const vaultPath = await this.configStore.getVaultPath();
    return path.join(vaultPath, ".personal-toolbox", "smoke.json");
  }

  async getLegacyDataPath() {
    const vaultPath = await this.configStore.getVaultPath();
    return path.join(vaultPath, ".obsidian", "plugins", "smoke-test-recorder", "data.json");
  }

  async backupLegacyDataFile(dataPath) {
    if (!await pathExists(dataPath)) {
      return "";
    }
    const timestamp = nowIso().replace(/[:.]/g, "-");
    const backupPath = dataPath + ".bak-before-versions-" + timestamp;
    await fs.copyFile(dataPath, backupPath);
    return backupPath;
  }

  async backupBeforeVersionDelete(dataPath, version) {
    if (!await pathExists(dataPath)) {
      return "";
    }
    const timestamp = nowIso().replace(/[:.]/g, "-");
    const versionName = sanitizePathSegment(version && version.name ? version.name : "version");
    const backupPath = dataPath + ".bak-before-delete-version-" + versionName + "-" + timestamp;
    await fs.copyFile(dataPath, backupPath);
    return backupPath;
  }

  async restoreStoreFromMarkdownNotes(legacyStore) {
    const vaultPath = await this.configStore.getVaultPath();
    const folder = normalizeFolder(legacyStore && legacyStore.settings && legacyStore.settings.folder);
    const notesRoot = path.join(vaultPath, folder);
    const files = (await listMarkdownFiles(notesRoot)).sort();
    if (!files.length) {
      return null;
    }

    const versionsByName = new Map();
    for (const filePath of files) {
      const markdown = await fs.readFile(filePath, "utf8");
      const frontmatter = parseSmokeCaseFrontmatter(markdown);
      if (frontmatter.type !== "smoke-case" && !frontmatter.smoke_case_id) {
        continue;
      }

      const relativeParts = path.relative(notesRoot, filePath).split(path.sep);
      const versionFolder = relativeParts.length >= 3 ? relativeParts[0] : DEFAULT_VERSION_NAME;
      const sceneFolder = relativeParts.length >= 3 ? relativeParts[1] : (relativeParts[0] || DEFAULT_SCENE_NAME);
      const versionName = cleanText(frontmatter.version) || cleanText(versionFolder) || DEFAULT_VERSION_NAME;
      const sceneName = cleanText(frontmatter.scene) || cleanText(sceneFolder) || DEFAULT_SCENE_NAME;
      const title = cleanText((markdown.match(/^#\s+(.+)$/m) || [])[1]) || "未命名 Case";
      const stats = await fs.stat(filePath);
      const updatedAt = safeIso(frontmatter.updated, stats.mtime.toISOString());
      const caseId = cleanText(frontmatter.smoke_case_id) || "case-md-" + stableHash(relativeVaultPath(vaultPath, filePath));
      const createdAt = timestampFromId(caseId) || updatedAt;
      const parsedSteps = parseSmokeCaseSteps(markdown);
      const descendingSteps = parsedSteps.length > 1 && parsedSteps.every((step, index) =>
        index === 0 || step.number < parsedSteps[index - 1].number
      );
      const storedSteps = descendingSteps
        ? parsedSteps.slice().sort((a, b) => a.number - b.number)
        : parsedSteps;
      const baseTime = Date.parse(createdAt);
      const startTime = Number.isNaN(baseTime) ? Date.now() : baseTime;
      const steps = storedSteps.map((step) => {
        const stepTimestamp = new Date(startTime + step.number).toISOString();
        return normalizeStep({
          id: "step-" + shortId(caseId) + "-" + step.number,
          action: step.action,
          expected: step.expected,
          status: step.status,
          failureReason: step.failureReason,
          createdAt: stepTimestamp,
          updatedAt: step.status === "pending" ? stepTimestamp : updatedAt
        });
      });
      const description = parseSmokeCaseDescription(markdown);
      const importInfo = extractSmokeCaseImportInfo(description);

      if (!versionsByName.has(versionName)) {
        versionsByName.set(versionName, {
          id: "version-md-" + stableHash(versionName),
          name: versionName,
          description: "从 " + folder + "/" + versionName + " Markdown 恢复",
          scenes: [],
          cases: [],
          selectedSceneId: "",
          selectedCaseId: "",
          createdAt: createdAt,
          updatedAt: updatedAt,
          sceneByName: new Map()
        });
      }
      const version = versionsByName.get(versionName);
      if (!version.sceneByName.has(sceneName)) {
        const scene = normalizeScene({
          id: "scene-md-" + stableHash(versionName + "/" + sceneName),
          name: sceneName,
          description: "从 " + folder + "/" + versionName + "/" + sceneName + " Markdown 恢复",
          createdAt,
          updatedAt
        });
        version.sceneByName.set(sceneName, scene);
        version.scenes.push(scene);
      }

      const scene = version.sceneByName.get(sceneName);
      scene.createdAt = minIso([scene.createdAt, createdAt]);
      scene.updatedAt = maxIso([scene.updatedAt, updatedAt]);
      version.createdAt = minIso([version.createdAt, createdAt]);
      version.updatedAt = maxIso([version.updatedAt, updatedAt]);
      version.cases.push(normalizeCase({
        id: caseId,
        sceneId: scene.id,
        title,
        description,
        steps,
        stepSort: descendingSteps ? "desc" : "custom",
        notePath: relativeVaultPath(vaultPath, filePath),
        sourceType: importInfo.sourceType,
        sourcePath: importInfo.sourcePath,
        sourceRunId: importInfo.sourceRunId,
        sourceCaseId: importInfo.sourceCaseId,
        createdAt,
        updatedAt,
        lastRunAt: steps.some((step) => step.status !== "pending") ? updatedAt : ""
      }));
    }

    const versions = Array.from(versionsByName.values())
      .filter((version) => version.cases.length)
      .map((version) => {
        delete version.sceneByName;
        version.scenes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
        const firstScene = version.scenes[0];
        version.selectedSceneId = firstScene ? firstScene.id : "";
        const firstCase = getCasesForScene(version, version.selectedSceneId)[0];
        version.selectedCaseId = firstCase ? firstCase.id : "";
        return normalizeVersion(version);
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    if (!versions.length) {
      return null;
    }

    const restoredNames = new Set(versions.map((version) => cleanText(version.name)));
    const legacyVersions = (legacyStore.versions || [])
      .filter((version) => version.cases.length && !restoredNames.has(cleanText(version.name)));

    return normalizeStore({
      schemaVersion: SCHEMA_VERSION,
      settings: legacyStore.settings,
      versions: versions.concat(legacyVersions),
      selectedVersionId: versions[0].id
    });
  }

  async syncAllCaseNotes(store) {
    for (const version of store.versions) {
      for (const caseItem of version.cases) {
        await this.writeCaseNote(store, version, caseItem);
      }
    }
  }

  async readStore() {
    const dataPath = await this.getDataPath();
    const legacyDataPath = await this.getLegacyDataPath();
    let raw = {};
    let missing = false;
    let readPath = dataPath;
    let migratedFromLegacy = false;
    try {
      raw = JSON.parse(await fs.readFile(dataPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      try {
        raw = JSON.parse(await fs.readFile(legacyDataPath, "utf8"));
        readPath = legacyDataPath;
        migratedFromLegacy = true;
      } catch (legacyError) {
        if (legacyError.code !== "ENOENT") {
          throw legacyError;
        }
        missing = true;
      }
    }
    const shouldMigrate = !missing && !isV2Store(raw);
    const store = normalizeStore(raw);
    if (shouldMigrate) {
      await this.backupLegacyDataFile(readPath);
      const restoredStore = await this.restoreStoreFromMarkdownNotes(store);
      if (restoredStore) {
        return this.saveStore(restoredStore);
      }
      await this.syncAllCaseNotes(store);
      return this.saveStore(store);
    }
    if (missing) {
      const restoredStore = await this.restoreStoreFromMarkdownNotes(store);
      if (restoredStore) {
        return this.saveStore(restoredStore);
      }
    }
    if (missing || migratedFromLegacy || JSON.stringify(raw) !== JSON.stringify(store)) {
      await this.saveStore(store);
    }
    return store;
  }

  async saveStore(store) {
    const dataPath = await this.getDataPath();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(normalizeStore(store), null, 2) + "\n", "utf8");
    return normalizeStore(store);
  }

  async list() {
    return this.readStore();
  }

  async createVersion(payload) {
    const store = await this.readStore();
    const name = cleanText(payload && payload.name) || "新版本";
    if (versionNameExists(store, name)) {
      throw new Error("版本名已存在");
    }
    const version = createEmptyVersion(name);
    version.description = String((payload && payload.description) || "");
    store.versions.unshift(version);
    store.selectedVersionId = version.id;
    return this.saveStore(store);
  }

  async updateVersion(versionId, patch) {
    const store = await this.readStore();
    const version = store.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new Error("Version not found");
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "name")) {
      const name = cleanText(patch.name) || FALLBACK_VERSION_NAME;
      if (versionNameExists(store, name, version.id)) {
        throw new Error("版本名已存在");
      }
      version.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "description")) {
      version.description = String(patch.description || "");
    }
    version.updatedAt = nowIso();
    for (const caseItem of version.cases) {
      await this.writeCaseNote(store, version, caseItem);
    }
    return this.saveStore(store);
  }

  async deleteVersion(versionId) {
    const store = await this.readStore();
    const version = store.versions.find((item) => item.id === versionId);
    if (!version) {
      return store;
    }
    await this.backupBeforeVersionDelete(await this.getDataPath(), version);
    for (const caseItem of version.cases) {
      await this.deleteCaseNote(caseItem);
    }
    store.versions = store.versions.filter((item) => item.id !== versionId);
    if (!store.versions.length) {
      store.versions.push(createEmptyVersion(FALLBACK_VERSION_NAME));
    }
    if (store.selectedVersionId === versionId) {
      store.selectedVersionId = store.versions[0].id;
    }
    reconcileStoreSelection(store);
    return this.saveStore(store);
  }

  async backupBeforeBulkDelete(dataPath, scope) {
    if (!await pathExists(dataPath)) {
      return "";
    }
    const timestamp = nowIso().replace(/[:.]/g, "-");
    const label = sanitizePathSegment(scope || "items");
    const backupPath = dataPath + ".bak-before-bulk-delete-" + label + "-" + timestamp;
    await fs.copyFile(dataPath, backupPath);
    return backupPath;
  }

  async selectVersion(versionId) {
    const store = await this.readStore();
    if (!store.versions.some((version) => version.id === versionId)) {
      return store;
    }
    store.selectedVersionId = versionId;
    reconcileStoreSelection(store);
    return this.saveStore(store);
  }

  async createScene(payload) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const scene = normalizeScene({
      name: cleanText(payload && payload.name) || "新场景",
      description: String((payload && payload.description) || "")
    });
    version.scenes.unshift(scene);
    version.selectedSceneId = scene.id;
    version.selectedCaseId = "";
    version.updatedAt = nowIso();
    return this.saveStore(store);
  }

  async updateScene(sceneId, patch) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const scene = version.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      throw new Error("Scene not found");
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "name")) {
      scene.name = cleanText(patch.name) || DEFAULT_SCENE_NAME;
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "description")) {
      scene.description = String(patch.description || "");
    }
    scene.updatedAt = nowIso();
    version.updatedAt = scene.updatedAt;
    for (const caseItem of version.cases.filter((item) => item.sceneId === scene.id)) {
      await this.writeCaseNote(store, version, caseItem);
    }
    return this.saveStore(store);
  }

  async deleteScene(sceneId) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const deletedCases = version.cases.filter((caseItem) => caseItem.sceneId === sceneId);
    version.scenes = version.scenes.filter((scene) => scene.id !== sceneId);
    version.cases = version.cases.filter((caseItem) => caseItem.sceneId !== sceneId);
    for (const caseItem of deletedCases) {
      await this.deleteCaseNote(caseItem);
    }
    version.updatedAt = nowIso();
    reconcileVersionSelection(version);
    return this.saveStore(store);
  }

  async deleteScenes(sceneIds) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const targets = new Set((Array.isArray(sceneIds) ? sceneIds : []).map(String).filter(Boolean));
    if (!targets.size) {
      return store;
    }
    const existing = new Set(version.scenes.map((scene) => scene.id));
    const targetIds = new Set(Array.from(targets).filter((sceneId) => existing.has(sceneId)));
    if (!targetIds.size) {
      return store;
    }

    await this.backupBeforeBulkDelete(await this.getDataPath(), "scenes");
    const deletedCases = version.cases.filter((caseItem) => targetIds.has(caseItem.sceneId));
    version.scenes = version.scenes.filter((scene) => !targetIds.has(scene.id));
    version.cases = version.cases.filter((caseItem) => !targetIds.has(caseItem.sceneId));
    for (const caseItem of deletedCases) {
      await this.deleteCaseNote(caseItem);
    }
    version.updatedAt = nowIso();
    reconcileVersionSelection(version);
    return this.saveStore(store);
  }

  async createCase(payload) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    let sceneId = String((payload && payload.sceneId) || version.selectedSceneId || "");
    if (!version.scenes.some((scene) => scene.id === sceneId)) {
      sceneId = version.scenes.length ? version.scenes[0].id : "";
    }
    if (!sceneId) {
      const scene = normalizeScene({ name: DEFAULT_SCENE_NAME });
      version.scenes.unshift(scene);
      sceneId = scene.id;
    }
    const caseItem = normalizeCase({
      sceneId,
      title: cleanText(payload && payload.title) || "未命名 Case",
      description: String((payload && payload.description) || ""),
      steps: Array.isArray(payload && payload.steps) ? payload.steps : [createBlankStep()],
      stepSort: "desc"
    });
    version.cases.unshift(caseItem);
    version.selectedSceneId = sceneId;
    version.selectedCaseId = caseItem.id;
    version.updatedAt = nowIso();
    await this.writeCaseNote(store, version, caseItem);
    return this.saveStore(store);
  }

  async updateCase(caseId, patch) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const caseItem = version.cases.find((item) => item.id === caseId);
    if (!caseItem) {
      throw new Error("Case not found");
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "title")) {
      caseItem.title = cleanText(patch.title) || "未命名 Case";
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "description")) {
      caseItem.description = String(patch.description || "");
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "steps")) {
      caseItem.steps = Array.isArray(patch.steps) ? patch.steps.map(normalizeStep) : [];
      caseItem.lastRunAt = nowIso();
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "stepSort")) {
      caseItem.stepSort = normalizeStepSort(patch.stepSort);
    }
    caseItem.updatedAt = nowIso();
    version.selectedSceneId = caseItem.sceneId;
    version.selectedCaseId = caseItem.id;
    version.updatedAt = caseItem.updatedAt;
    await this.writeCaseNote(store, version, caseItem);
    return this.saveStore(store);
  }

  async duplicateCase(caseId) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const sourceCase = version.cases.find((item) => item.id === caseId);
    if (!sourceCase) {
      throw new Error("Case not found");
    }

    const timestamp = nowIso();
    const caseItem = normalizeCase({
      sceneId: sourceCase.sceneId,
      title: buildDuplicateCaseTitle(version, sourceCase),
      description: sourceCase.description,
      steps: duplicateStepsForTemplate(sourceCase, timestamp),
      stepSort: normalizeStepSort(sourceCase.stepSort),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRunAt: ""
    });
    version.cases.unshift(caseItem);
    version.selectedSceneId = caseItem.sceneId;
    version.selectedCaseId = caseItem.id;
    version.updatedAt = timestamp;
    await this.writeCaseNote(store, version, caseItem);
    return this.saveStore(store);
  }

  async deleteCase(caseId) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const caseItem = version.cases.find((item) => item.id === caseId);
    if (!caseItem) {
      return store;
    }
    version.cases = version.cases.filter((item) => item.id !== caseId);
    await this.deleteCaseNote(caseItem);
    version.updatedAt = nowIso();
    reconcileVersionSelection(version);
    return this.saveStore(store);
  }

  async deleteCases(caseIds) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const targets = new Set((Array.isArray(caseIds) ? caseIds : []).map(String).filter(Boolean));
    if (!targets.size) {
      return store;
    }
    const deletedCases = version.cases.filter((caseItem) => targets.has(caseItem.id));
    if (!deletedCases.length) {
      return store;
    }

    await this.backupBeforeBulkDelete(await this.getDataPath(), "cases");
    version.cases = version.cases.filter((caseItem) => !targets.has(caseItem.id));
    for (const caseItem of deletedCases) {
      await this.deleteCaseNote(caseItem);
    }
    version.updatedAt = nowIso();
    reconcileVersionSelection(version);
    return this.saveStore(store);
  }

  async selectScene(sceneId) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    version.selectedSceneId = sceneId;
    const sceneCases = getCasesForScene(version, sceneId);
    version.selectedCaseId = sceneCases.length ? sceneCases[0].id : "";
    return this.saveStore(store);
  }

  async selectCase(caseId) {
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const caseItem = version.cases.find((item) => item.id === caseId);
    if (!caseItem) {
      return store;
    }
    version.selectedSceneId = caseItem.sceneId;
    version.selectedCaseId = caseItem.id;
    return this.saveStore(store);
  }

  async importRunPlan(filePath) {
    const vaultPath = await this.configStore.getVaultPath();
    const sourcePath = toVaultRelativePath(vaultPath, filePath);
    const markdown = await fs.readFile(filePath, "utf8");
    const parsed = parseSmokeRunPlan(markdown, sourcePath);
    const store = await this.readStore();
    const version = getActiveVersion(store);
    const summary = {
      sourcePath,
      parsedCaseCount: parsed.records.length,
      naturalCaseCount: parsed.naturalCaseCount,
      createdSceneCount: 0,
      createdCaseCount: 0,
      updatedCaseCount: 0,
      skippedCaseCount: 0
    };
    const timestampBase = Date.now();
    let firstTouchedCase = null;
    const sceneByName = new Map(version.scenes.map((scene) => [scene.name, scene]));

    for (const [index, record] of parsed.records.entries()) {
      const sceneName = cleanText(record.dataProfile) || "UNKNOWN";
      let scene = sceneByName.get(sceneName);
      if (!scene) {
        scene = normalizeScene({
          name: sceneName,
          description: "从 smoke-run-plan.md 按 data_profile 导入的冒烟分组。"
        });
        version.scenes.push(scene);
        sceneByName.set(scene.name, scene);
        summary.createdSceneCount += 1;
      }

      const timestamp = new Date(timestampBase + (parsed.records.length - index)).toISOString();
      const nextCase = normalizeCase({
        sceneId: scene.id,
        title: buildImportedCaseTitle(record),
        description: buildImportedCaseDescription(record, sourcePath),
        steps: createImportedSteps(record, timestamp),
        stepSort: "custom",
        sourceType: "smoke-run-plan",
        sourcePath,
        sourceRunId: record.runId,
        sourceCaseId: record.caseId,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastRunAt: ""
      });

      const existing = findImportedCase(version, sourcePath, record.runId);
      if (existing) {
        if (!isCaseImportUpdatable(existing)) {
          existing.sceneId = scene.id;
          existing.title = nextCase.title;
          existing.description = nextCase.description;
          if (existing.stepSort !== "custom" || !isSameImportedStepOrder(existing.steps, nextCase.steps)) {
            existing.steps = mergeImportedStepsPreservingExecution(existing.steps, nextCase.steps);
            existing.stepSort = "custom";
          }
          existing.sourceType = "smoke-run-plan";
          existing.sourcePath = sourcePath;
          existing.sourceRunId = record.runId;
          existing.sourceCaseId = record.caseId;
          existing.updatedAt = timestamp;
          await this.writeCaseNote(store, version, existing);
          summary.skippedCaseCount += 1;
          if (!firstTouchedCase) {
            firstTouchedCase = existing;
          }
          continue;
        }
        existing.sceneId = scene.id;
        existing.title = nextCase.title;
        existing.description = nextCase.description;
        existing.steps = nextCase.steps;
        existing.stepSort = "custom";
        existing.sourceType = "smoke-run-plan";
        existing.sourcePath = sourcePath;
        existing.sourceRunId = record.runId;
        existing.sourceCaseId = record.caseId;
        existing.updatedAt = timestamp;
        await this.writeCaseNote(store, version, existing);
        summary.updatedCaseCount += 1;
        firstTouchedCase = firstTouchedCase || existing;
        continue;
      }

      version.cases.push(nextCase);
      await this.writeCaseNote(store, version, nextCase);
      summary.createdCaseCount += 1;
      firstTouchedCase = firstTouchedCase || nextCase;
    }

    if (firstTouchedCase) {
      version.selectedSceneId = firstTouchedCase.sceneId;
      version.selectedCaseId = firstTouchedCase.id;
    }
    version.updatedAt = nowIso();
    reconcileVersionSelection(version);
    const saved = await this.saveStore(store);
    return {
      summary,
      store: saved
    };
  }

  async exportCurrentVersion(filePath) {
    const targetPath = String(filePath || "").trim();
    if (!targetPath) {
      throw new Error("导出路径不能为空");
    }
    const store = await this.readStore();
    const version = getActiveVersion(store);
    if (!version) {
      throw new Error("当前没有可导出的版本");
    }
    const markdown = buildVersionExportMarkdown(version);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, markdown, "utf8");
    const stats = countVersionStats(version);
    return {
      filePath: targetPath,
      versionName: version.name,
      sceneCount: stats.scenes,
      caseCount: stats.cases,
      passedCount: stats.passed,
      failedCount: stats.failed,
      incompleteCount: stats.incomplete,
      pendingCount: stats.pending
    };
  }

  async writeCaseNote(store, version, caseItem) {
    if (!store.settings.autoWriteNotes) {
      return;
    }
    const vaultPath = await this.configStore.getVaultPath();
    const targetPath = getCaseNotePath(store, version, caseItem);
    const targetAbs = resolveVaultRelativePath(vaultPath, targetPath);
    const oldAbs = resolveVaultRelativePath(vaultPath, caseItem.notePath);
    const content = buildCaseMarkdown(store, version, caseItem);

    await fs.mkdir(path.dirname(targetAbs), { recursive: true });

    if (oldAbs && oldAbs !== targetAbs && await pathExists(oldAbs) && !await pathExists(targetAbs)) {
      await fs.rename(oldAbs, targetAbs);
    }

    await fs.writeFile(targetAbs, content, "utf8");

    if (oldAbs && oldAbs !== targetAbs && await pathExists(oldAbs)) {
      await fs.unlink(oldAbs).catch(() => {});
    }

    caseItem.notePath = targetPath;
  }

  async deleteCaseNote(caseItem) {
    if (!caseItem || !caseItem.notePath) {
      return;
    }
    const vaultPath = await this.configStore.getVaultPath();
    const noteAbs = resolveVaultRelativePath(vaultPath, caseItem.notePath);
    if (!noteAbs) {
      return;
    }
    await fs.unlink(noteAbs).catch(() => {});
  }
}

module.exports = {
  SmokeStore,
  createBlankStep,
  deriveCaseStatus,
  getOrderedSteps,
  normalizeStep,
  normalizeStepSort,
  parseSmokeRunPlan
};
