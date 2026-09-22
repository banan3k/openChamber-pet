const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("petWindow", {
  resize: (width, height) => ipcRenderer.send("pet:resize", { width, height }),
  onBubbleSide: (callback) => {
    ipcRenderer.on("pet:bubble-side", (_event, side) => callback(side))
    ipcRenderer.send("pet:layout-ready")
  },
})
