const { app, BrowserWindow, Menu, screen, ipcMain, globalShortcut } = require("electron")
const path = require("path")

function readServerUrl(argv = process.argv) {
  const flag = argv.find((a) => a.startsWith("--pet-server-url="))
  if (flag) return flag.slice("--pet-server-url=".length)
  const env = process.env.OPENCHAMBER_PET_URL
  if (env) return env
  return null
}

function readParentPid(argv = process.argv) {
  const flag = argv.find((a) => a.startsWith("--pet-parent-pid="))
  if (flag) return Number(flag.slice("--pet-parent-pid=".length))
  const env = process.env.OPENCHAMBER_PET_PARENT_PID
  if (env) return Number(env)
  return null
}

let serverUrl = readServerUrl()
if (!serverUrl) {
  console.error("[openchamber-pet] Missing --pet-server-url")
  process.exit(1)
}

const parentPid = readParentPid()

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

const SCALE = 0.5
const WIDTH = Math.round(192 * SCALE)
const HEIGHT = Math.round(208 * SCALE)
const TOGGLE_SHORTCUT = "CommandOrControl+Alt+P"

let win = null
let currentPetId = null
let pets = []
let serverFailures = 0
let winWidth = WIDTH
let winHeight = HEIGHT
let lastToggleSeq = null

async function pollServer() {
  try {
    const res = await fetch(`${serverUrl}/state`)
    if (res.ok) {
      serverFailures = 0
      const data = await res.json()
      if (typeof data.toggleSeq === "number") {
        if (lastToggleSeq !== null && data.toggleSeq !== lastToggleSeq) {
          toggleWindow()
        }
        lastToggleSeq = data.toggleSeq
      }
    } else {
      serverFailures += 1
    }
  } catch {
    serverFailures += 1
  }
  if (serverFailures >= 4) {
    app.quit()
  }
}

function startServerWatchdog() {
  setInterval(pollServer, 1000)
}

function startParentWatchdog() {
  if (!parentPid) return
  setInterval(() => {
    try {
      process.kill(parentPid, 0)
    } catch (error) {
      if (error?.code === "ESRCH") app.quit()
    }
  }, 2000)
}

async function fetchPets() {
  try {
    const res = await fetch(`${serverUrl}/pets`)
    pets = await res.json()
  } catch {
    pets = []
  }
  try {
    const res = await fetch(`${serverUrl}/state`)
    const state = await res.json()
    currentPetId = state.petId
  } catch {}
}

async function selectPet(id) {
  currentPetId = id
  try {
    await fetch(`${serverUrl}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    })
  } catch {}
}

function buildMenu() {
  const petItems = pets.map((p) => ({
    label: p.displayName || p.id,
    type: "radio",
    checked: p.id === currentPetId,
    click: () => selectPet(p.id),
  }))

  const template = [
    {
      label: "Pet",
      submenu: petItems.length ? petItems : [{ label: "No pets found", enabled: false }],
    },
    { type: "separator" },
    { label: "Hide pet", click: () => hideWindow() },
  ]
  return Menu.buildFromTemplate(template)
}

function showWindow() {
  if (!win) {
    createWindow()
    positionWindow()
    return
  }
  win.show()
}

function hideWindow() {
  if (win) win.hide()
}

function toggleWindow() {
  if (win?.isVisible()) hideWindow()
  else showWindow()
}

function positionWindow() {
  if (!win) return
  const { workArea } = screen.getPrimaryDisplay()
  const margin = 16
  const x = workArea.x + workArea.width - winWidth - margin
  const y = workArea.y + workArea.height - winHeight - margin
  win.setPosition(Math.round(x), Math.round(y))
}

function resizeWindow(width, height) {
  if (!win) return
  winWidth = Math.round(width)
  winHeight = Math.round(height)
  win.setSize(winWidth, winHeight)
  positionWindow()
}

function createWindow() {
  if (win) return
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  })

  win.setAlwaysOnTop(true, "floating")
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadURL(serverUrl)

  win.webContents.on("context-menu", () => {
    buildMenu().popup({ window: win })
  })

  win.on("closed", () => {
    win = null
  })
}

ipcMain.on("pet:resize", (_event, { width, height }) => {
  resizeWindow(width, height)
})

app.on("second-instance", (_event, argv) => {
  const url = readServerUrl(argv)
  if (url) {
    serverUrl = url
    currentPetId = null
    pets = []
    if (win) {
      win.loadURL(url)
      fetchPets()
      showWindow()
    } else if (app.isReady()) {
      createWindow()
      positionWindow()
    }
  }
})

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.dock?.hide()
      Menu.setApplicationMenu(null)
    }

    await fetchPets()
    createWindow()
    positionWindow()
    startServerWatchdog()
    startParentWatchdog()

    globalShortcut.register(TOGGLE_SHORTCUT, () => toggleWindow())

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
        positionWindow()
      }
    })
  })
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll()
})

app.on("window-all-closed", () => {
  app.quit()
})
