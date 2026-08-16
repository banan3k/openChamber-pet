import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, "..", "pet-app")
const require = createRequire(import.meta.url)

function resolveElectronBinary() {
  if (process.env.OPENCHAMBER_PET_ELECTRON) {
    return process.env.OPENCHAMBER_PET_ELECTRON
  }
  try {
    const candidate = require("electron")
    if (typeof candidate === "string" && fs.existsSync(candidate)) {
      return candidate
    }
  } catch {}
  return null
}

export async function launchPetWindow(serverOrigin, log = () => {}) {
  const electron = resolveElectronBinary()

  if (!electron) {
    log(
      "info",
      "Electron not found. Falling back to `npx electron` (first run may download it).",
    )
    const args = [
      "--yes",
      "electron",
      APP_DIR,
      `--pet-server-url=${serverOrigin}`,
      `--pet-parent-pid=${process.pid}`,
    ]
    const child = spawn("npx", args, {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    })
    child.unref()
    return child
  }

  const args = [APP_DIR, `--pet-server-url=${serverOrigin}`, `--pet-parent-pid=${process.pid}`]
  const child = spawn(electron, args, {
    stdio: "ignore",
    detached: true,
  })
  child.unref()
  return child
}
