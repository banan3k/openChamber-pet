const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("petWindow", {
  resize: (width, height) => ipcRenderer.send("pet:resize", { width, height }),
})
