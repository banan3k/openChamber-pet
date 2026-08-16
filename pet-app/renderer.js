const CELL_W = 192
const CELL_H = 208
const WIDTH = 96
const HEIGHT = 104

const BUBBLE_W = 220
const BUBBLE_H = 32
const BUBBLE_GAP = 6
const MAX_BUBBLES = 5

const ANIMATIONS = {
  idle: { row: 0, frames: 6, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, frames: 4, durations: [140, 140, 140, 280] },
  jumping: { row: 4, frames: 5, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, frames: 6, durations: [150, 150, 150, 150, 150, 260] },
  working: { row: 7, frames: 6, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, frames: 6, durations: [150, 150, 150, 150, 150, 280] },
}

const canvas = document.getElementById("pet")
const ctx = canvas.getContext("2d")
const bubblesEl = document.getElementById("bubbles")

const dpr = window.devicePixelRatio || 1
canvas.width = WIDTH * dpr
canvas.height = HEIGHT * dpr
ctx.scale(dpr, dpr)

let state = "idle"
let petId = null
let tasks = []
let frameIndex = 0
let frameElapsed = 0
let lastTs = 0

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
const sprites = new Map()

function loadSprite(id) {
  return new Promise((resolve) => {
    const existing = sprites.get(id)
    if (existing && existing.complete && existing.naturalWidth) {
      resolve(existing)
      return
    }
    const img = new Image()
    img.onload = () => {
      sprites.set(id, img)
      resolve(img)
    }
    img.onerror = () => resolve(null)
    img.src = `/pets/${encodeURIComponent(id)}/sprite`
  })
}

function setState(next) {
  if (next === state) return
  state = next
  frameIndex = 0
  frameElapsed = 0
}

async function setPet(next) {
  if (next === petId) return
  petId = next
  frameIndex = 0
  frameElapsed = 0
  await loadSprite(next)
}

function renderBubbles() {
  bubblesEl.innerHTML = ""
  for (const task of tasks.slice(0, MAX_BUBBLES)) {
    const bubble = document.createElement("div")
    bubble.className = "bubble"

    const text = document.createElement("span")
    text.className = "bubble-text"
    text.textContent = task.title || "Working…"

    const icon = document.createElement("span")
    icon.className = `bubble-icon bubble-icon--${task.status || "working"}`

    bubble.append(text, icon)
    bubble.title = task.title || task.id
    bubblesEl.appendChild(bubble)
  }
}

function resizeWindow() {
  const count = Math.min(tasks.length, MAX_BUBBLES)
  const width = count > 0 ? BUBBLE_W + 8 : WIDTH
  const height = HEIGHT + (count > 0 ? count * (BUBBLE_H + BUBBLE_GAP) + BUBBLE_GAP : 0)
  window.petWindow?.resize(width, height)
}

function setTasks(next) {
  tasks = Array.isArray(next) ? next : []
  renderBubbles()
  resizeWindow()
}

function draw() {
  const img = sprites.get(petId)
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  if (!img || !img.complete || !img.naturalWidth) return

  const anim = ANIMATIONS[state] || ANIMATIONS.idle
  const col = frameIndex % anim.frames
  const row = anim.row
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, col * CELL_W, row * CELL_H, CELL_W, CELL_H, 0, 0, WIDTH, HEIGHT)
}

function tick(ts) {
  if (!lastTs) lastTs = ts
  const dt = ts - lastTs
  lastTs = ts

  const anim = ANIMATIONS[state] || ANIMATIONS.idle
  if (!reducedMotion) {
    frameElapsed += dt
    const duration = anim.durations[frameIndex % anim.frames] || 150
    if (frameElapsed >= duration) {
      frameElapsed = 0
      frameIndex = (frameIndex + 1) % anim.frames
    }
  } else {
    frameIndex = 0
  }

  draw()
  requestAnimationFrame(tick)
}

function connectSse() {
  const source = new EventSource("/events")
  source.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.state) setState(msg.state)
      if (msg.petId) setPet(msg.petId)
      if (msg.tasks) setTasks(msg.tasks)
    } catch {}
  }
  source.onerror = () => {}
}

async function init() {
  try {
    const stateRes = await fetch("/state")
    const stateData = await stateRes.json()
    petId = stateData.petId
    state = stateData.state || "idle"
    setTasks(stateData.tasks || [])
    await loadSprite(petId)
  } catch {}
  connectSse()
  requestAnimationFrame(tick)
}

init()
