const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")

function launchPet(workArea = { x: 0, y: 0, width: 1440, height: 900 }) {
  const ipcMain = new EventEmitter()
  const app = new EventEmitter()
  app.requestSingleInstanceLock = () => true
  app.whenReady = () => ({ then() {} })
  let window
  class BrowserWindow extends EventEmitter {
    constructor({ width, height }) {
      super()
      this.bounds = { x: 0, y: 0, width, height }
      this.webContents = new EventEmitter()
      this.messages = []
      this.webContents.send = (channel, value) => this.messages.push({ channel, value })
      window = this
    }
    setAlwaysOnTop() {}
    loadURL() {}
    getBounds() { return { ...this.bounds } }
    setBounds(bounds) { Object.assign(this.bounds, bounds) }
    setSize(width, height) { this.setBounds({ width, height }) }
    setPosition(x, y) { this.setBounds({ x, y }) }
  }
  const context = vm.createContext({
    require: (id) => id === "electron" ? {
      app, BrowserWindow, ipcMain, Menu: {}, globalShortcut: {},
      screen: {
        getPrimaryDisplay: () => ({ workArea }),
        getDisplayNearestPoint: () => ({ workArea }),
      },
    } : require(id),
    process: { argv: ["--pet-server-url=http://localhost:1234"], env: {}, platform: "darwin" },
    __dirname,
    console,
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, "main.js"), "utf8"), context)
  vm.runInContext("createWindow(); positionWindow()", context)
  return {
    window,
    resize: (width, height) => ipcMain.emit("pet:resize", {}, { width, height }),
    drag: (x, y) => {
      window.setPosition(x, y)
      window.emit("move")
      window.emit("moved")
    },
  }
}

test("task bubbles grow and shrink around the dragged pet's position", () => {
  const pet = launchPet()
  pet.drag(1000, 400)
  pet.resize(228, 148)
  assert.deepEqual(pet.window.getBounds(), { x: 868, y: 356, width: 228, height: 148 })
  pet.resize(228, 300)
  assert.deepEqual(pet.window.getBounds(), { x: 868, y: 204, width: 228, height: 300 })
  pet.resize(96, 104)
  assert.deepEqual(pet.window.getBounds(), { x: 1000, y: 400, width: 96, height: 104 })
})

test("repeated task updates do not reset a dragged pet", () => {
  const pet = launchPet()
  pet.drag(1000, 400)
  pet.resize(96, 104)
  assert.deepEqual(pet.window.getBounds(), { x: 1000, y: 400, width: 96, height: 104 })
})

test("left-side pets expand toward the right", () => {
  const pet = launchPet()
  pet.drag(100, 400)
  pet.resize(228, 148)
  assert.deepEqual(pet.window.getBounds(), { x: 100, y: 356, width: 228, height: 148 })
  assert.equal(pet.window.messages.at(-1)?.value, "right")
  pet.resize(96, 104)
  assert.deepEqual(pet.window.getBounds(), { x: 100, y: 400, width: 96, height: 104 })
})

test("crossing the screen with visible bubbles keeps the pet anchored while flipping sides", () => {
  const pet = launchPet()
  pet.resize(228, 148)
  pet.drag(100, 356)
  // Before flipping, the pet is 132px from the window's left edge.
  assert.deepEqual(pet.window.getBounds(), { x: 232, y: 356, width: 228, height: 148 })
  assert.equal(pet.window.messages.at(-1)?.value, "right")
  pet.drag(1000, 356)
  assert.deepEqual(pet.window.getBounds(), { x: 868, y: 356, width: 228, height: 148 })
  assert.equal(pet.window.messages.at(-1)?.value, "left")
})

test("side selection uses the pet's monitor, including negative coordinates", () => {
  const pet = launchPet({ x: -1440, y: 0, width: 1440, height: 900 })
  pet.drag(-1300, 400)
  pet.resize(228, 148)
  assert.deepEqual(pet.window.getBounds(), { x: -1300, y: 356, width: 228, height: 148 })
  assert.equal(pet.window.messages.at(-1)?.value, "right")
})
