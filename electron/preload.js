const { contextBridge, ipcRenderer } = require("electron");

const toolboxApi = {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    setVaultPath: (vaultPath) => ipcRenderer.invoke("config:setVaultPath", vaultPath),
    setShortcuts: (shortcuts) => ipcRenderer.invoke("config:setShortcuts", shortcuts),
    selectVaultPath: () => ipcRenderer.invoke("config:selectVaultPath")
  },
  smoke: {
    list: () => ipcRenderer.invoke("smoke:list"),
    importRunPlan: () => ipcRenderer.invoke("smoke:importRunPlan"),
    exportCurrentVersion: () => ipcRenderer.invoke("smoke:exportCurrentVersion"),
    saveSettings: (settings) => ipcRenderer.invoke("smoke:saveSettings", settings),
    createVersion: (payload) => ipcRenderer.invoke("smoke:createVersion", payload),
    updateVersion: (versionId, patch) => ipcRenderer.invoke("smoke:updateVersion", versionId, patch),
    deleteVersion: (versionId) => ipcRenderer.invoke("smoke:deleteVersion", versionId),
    selectVersion: (versionId) => ipcRenderer.invoke("smoke:selectVersion", versionId),
    createScene: (payload) => ipcRenderer.invoke("smoke:createScene", payload),
    updateScene: (sceneId, patch) => ipcRenderer.invoke("smoke:updateScene", sceneId, patch),
    deleteScene: (sceneId) => ipcRenderer.invoke("smoke:deleteScene", sceneId),
    deleteScenes: (sceneIds) => ipcRenderer.invoke("smoke:deleteScenes", sceneIds),
    createCase: (payload) => ipcRenderer.invoke("smoke:createCase", payload),
    updateCase: (caseId, patch) => ipcRenderer.invoke("smoke:updateCase", caseId, patch),
    duplicateCase: (caseId) => ipcRenderer.invoke("smoke:duplicateCase", caseId),
    deleteCase: (caseId) => ipcRenderer.invoke("smoke:deleteCase", caseId),
    deleteCases: (caseIds) => ipcRenderer.invoke("smoke:deleteCases", caseIds),
    selectScene: (sceneId) => ipcRenderer.invoke("smoke:selectScene", sceneId),
    selectCase: (caseId) => ipcRenderer.invoke("smoke:selectCase", caseId)
  },
  memo: {
    listNotes: () => ipcRenderer.invoke("memo:listNotes"),
    createNote: (content) => ipcRenderer.invoke("memo:createNote", content),
    updateNote: (noteId, content) => ipcRenderer.invoke("memo:updateNote", noteId, content),
    toggleNote: (noteId, completed) => ipcRenderer.invoke("memo:toggleNote", noteId, completed),
    deleteNote: (noteId) => ipcRenderer.invoke("memo:deleteNote", noteId),
    importNotes: () => ipcRenderer.invoke("memo:importNotes"),
    exportNotes: () => ipcRenderer.invoke("memo:exportNotes"),
    saveImportSample: () => ipcRenderer.invoke("memo:saveImportSample"),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("memo:changed", listener);
      return () => ipcRenderer.removeListener("memo:changed", listener);
    }
  },
  poem: {
    getDaily: (dateKey) => ipcRenderer.invoke("poem:getDaily", dateKey)
  },
  quickMemo: {
    close: () => ipcRenderer.invoke("quickMemo:close"),
    setSaving: (saving) => ipcRenderer.invoke("quickMemo:setSaving", saving),
    onFocus: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("quickMemo:focus", listener);
      return () => ipcRenderer.removeListener("quickMemo:focus", listener);
    }
  }
};

contextBridge.exposeInMainWorld("toolbox", toolboxApi);
contextBridge.exposeInMainWorld("api", toolboxApi);
