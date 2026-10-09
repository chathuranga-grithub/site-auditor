// The setup screen's only link to the app: load and save the settings (desktop/main.js).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  load: () => ipcRenderer.invoke("setup:load"),
  save: (values) => ipcRenderer.invoke("setup:save", values),
});
