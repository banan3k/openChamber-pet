import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, "..", "pet-app")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(body)
}

export function createPetServer({ pets, defaultPetId, onSelect }) {
  let currentState = "idle"
  let currentPetId = defaultPetId
  let currentTasks = []
  let toggleSeq = 0
  const clients = new Set()
  let server = null

  const petById = (id) => pets.find((p) => p.id === id)

  function broadcast(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) {
      try {
        res.write(data)
      } catch {
        clients.delete(res)
      }
    }
  }

  function setState(state) {
    if (state !== currentState) {
      currentState = state
      broadcast({ state })
    }
  }

  function setTasks(tasks) {
    currentTasks = Array.isArray(tasks) ? tasks : []
    broadcast({ tasks: currentTasks })
  }

  function requestToggle() {
    toggleSeq += 1
    broadcast({ toggleSeq })
  }

  function setPet(petId) {
    const pet = petById(petId)
    if (!pet) return false
    currentPetId = pet.id
    broadcast({ petId: pet.id, animations: pet.animations || {} })
    onSelect?.(pet.id)
    return true
  }

  function handler(req, res) {
    const url = new URL(req.url, "http://localhost")

    if (url.pathname === "/") {
      return serveFile(res, path.join(APP_DIR, "index.html"))
    }
    if (url.pathname === "/renderer.js") {
      return serveFile(res, path.join(APP_DIR, "renderer.js"))
    }
    if (url.pathname === "/styles.css") {
      return serveFile(res, path.join(APP_DIR, "styles.css"))
    }

    if (url.pathname === "/pets" && req.method === "GET") {
      return json(res, 200, pets.map(({ spritePath: _s, ...rest }) => rest))
    }

    if (url.pathname === "/state" && req.method === "GET") {
      return json(res, 200, {
        state: currentState,
        petId: currentPetId,
        tasks: currentTasks,
        toggleSeq,
        animations: petById(currentPetId)?.animations || {},
      })
    }

    if (url.pathname === "/select" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => {
        body += chunk
      })
      req.on("end", () => {
        let petId = null
        try {
          petId = JSON.parse(body)?.id
        } catch {}
        if (petId && setPet(String(petId))) {
          return json(res, 200, { ok: true, petId })
        }
        return json(res, 400, { ok: false, error: "Unknown pet" })
      })
      return
    }

    const spriteMatch = url.pathname.match(/^\/pets\/([^/]+)\/sprite$/)
    if (spriteMatch && req.method === "GET") {
      const pet = petById(decodeURIComponent(spriteMatch[1]))
      if (!pet) return json(res, 404, { error: "Unknown pet" })
      return streamFile(res, pet.spritePath)
    }

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      res.write(`data: ${JSON.stringify({ state: currentState, petId: currentPetId, tasks: currentTasks, animations: petById(currentPetId)?.animations || {} })}\n\n`)
      clients.add(res)
      const heartbeat = setInterval(() => {
        try {
          res.write(": ping\n\n")
        } catch {
          clearInterval(heartbeat)
          clients.delete(res)
        }
      }, 20000)
      req.on("close", () => {
        clearInterval(heartbeat)
        clients.delete(res)
      })
      return
    }

    json(res, 404, { error: "Not found" })
  }

  function serveFile(res, filePath) {
    try {
      const data = fs.readFileSync(filePath)
      const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream"
      res.writeHead(200, { "content-type": type, "cache-control": "no-cache" })
      res.end(data)
    } catch {
      json(res, 404, { error: "Not found" })
    }
  }

  function streamFile(res, filePath) {
    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        return json(res, 404, { error: "Sprite not found" })
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream"
      res.writeHead(200, {
        "content-type": type,
        "content-length": stat.size,
        "cache-control": "no-cache",
      })
      const stream = fs.createReadStream(filePath)
      stream.on("error", () => res.end())
      stream.pipe(res)
    })
  }

  function start(port = Number(process.env.OPENCHAMBER_PET_PORT) || 0) {
    return new Promise((resolve, reject) => {
      server = http.createServer(handler)
      server.once("error", reject)
      server.listen(port, "127.0.0.1", () => {
        const address = server.address()
        const actualPort = typeof address === "object" ? address.port : port
        resolve(actualPort)
      })
    })
  }

  function close() {
    for (const res of clients) {
      try {
        res.end()
      } catch {}
    }
    clients.clear()
    if (server) {
      server.close()
      server = null
    }
  }

  return {
    get origin() {
      const address = server?.address()
      const port = typeof address === "object" && address ? address.port : 0
      return `http://127.0.0.1:${port}`
    },
    start,
    close,
    setState,
    setTasks,
    setPet,
    requestToggle,
  }
}
