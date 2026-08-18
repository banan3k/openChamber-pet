import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { discoverPets, resolveDefaultPet, petsDir } from "./lib/pets.js"
import { PetBrain } from "./lib/brain.js"
import { createPetServer } from "./lib/server.js"
import { launchPetWindow } from "./lib/launcher.js"

const petConfigPath = () =>
  process.env.OPENCHAMBER_PET_CONFIG ||
  (process.platform === "win32"
    ? process.env.APPDATA + "\\openchamber\\pet.json"
    : process.env.HOME + "/.config/openchamber/pet.json")

function readPetConfig() {
  try {
    return JSON.parse(fs.readFileSync(petConfigPath(), "utf8"))
  } catch {
    return {}
  }
}

function writePetConfig(config) {
  try {
    fs.mkdirSync(path.dirname(petConfigPath()), { recursive: true })
    fs.writeFileSync(petConfigPath(), JSON.stringify(config, null, 2), "utf8")
  } catch (error) {
    console.error("[openchamber-pet] Failed to persist pet selection:", error)
  }
}

const opencodeCommandDir = () =>
  process.platform === "win32"
    ? path.join(process.env.APPDATA, "opencode", "command")
    : path.join(process.env.HOME, ".config", "opencode", "command")

const PET_COMMAND = `---
description: Toggle the OpenChamber pet visibility
---
Toggle the pet visibility.
`

function ensurePetCommand() {
  try {
    const dir = opencodeCommandDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "pet.md")
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, PET_COMMAND, "utf8")
    }
  } catch {}
}

const gitRevertUnstagedTool = {
  description:
    "Discard all unstaged changes in the current git repository, keeping staged changes intact. Equivalent to `git restore .`. Untracked files are left untouched. Use when the user wants to undo uncommitted working-tree edits without losing staged changes.",
  args: {
    path: {
      type: "string",
      description: "Optional file or directory path to revert; omit to revert the whole repo.",
    },
  },
  async execute(input, context) {
    const cwd = context?.directory || process.cwd()
    const target = input?.path || "."
    try {
      execFileSync("git", ["restore", "--", target], { cwd, encoding: "utf8" })
      const status = execFileSync("git", ["status", "--short"], { cwd, encoding: "utf8" }).trim()
      return {
        title: "Reverted unstaged changes",
        output: status
          ? `Reverted unstaged changes (git restore ${target}).\nRemaining changes:\n${status}`
          : `Reverted unstaged changes (git restore ${target}). Working tree is clean.`,
      }
    } catch (error) {
      const stderr = error?.stderr?.trim()
      return {
        title: "Revert failed",
        output: stderr || (error instanceof Error ? error.message : String(error)),
      }
    }
  },
}

let singleton = null

export async function OpenChamberPet({ client }) {
  if (singleton) {
    singleton.refs += 1
    return singleton.hooks
  }

  const log = (level, message) => {
    try {
      client?.app?.log?.({
        body: { service: "openchamber-pet", level, message },
      })
    } catch {}
    console.log(`[openchamber-pet] [${level}] ${message}`)
  }

  const pets = discoverPets()
  if (pets.length === 0) {
    log("warn", `No pets found in ${petsDir()}. Skipping pet window.`)
    return { tool: { git_revert_unstaged: gitRevertUnstagedTool } }
  }

  ensurePetCommand()

  const existing = readPetConfig()
  const defaultPetId = resolveDefaultPet(existing.petId, pets)

  const server = createPetServer({
    pets,
    defaultPetId,
    onSelect: (petId) => writePetConfig({ petId }),
  })

  const brain = new PetBrain({
    onState: (state) => server.setState(state),
    onTasks: (tasks) => server.setTasks(tasks),
    resolveTitle: async (sessionID) => {
      try {
        const res = await client?.session?.get?.({ path: { id: sessionID } })
        const title = res?.data?.title
        return typeof title === "string" ? title : null
      } catch {
        return null
      }
    },
  })

  ;(async () => {
    try {
      const res = await client?.session?.list?.()
      const sessions = res?.data ?? (Array.isArray(res) ? res : [])
      brain.seedTitles(sessions)
    } catch {}
  })()

  let child = null

  const hooks = {
    tool: {
      git_revert_unstaged: gitRevertUnstagedTool,
    },
    dispose: async () => {
      if (!singleton) return
      singleton.refs -= 1
      if (singleton.refs > 0) return
      singleton = null
      brain.dispose()
      server.close()
      if (child && !child.killed) {
        try {
          if (child.pid && process.platform !== "win32") {
            process.kill(-child.pid, "SIGTERM")
          } else {
            child.kill()
          }
        } catch {
          child.kill()
        }
      }
    },
    event: async ({ event }) => {
      if (event?.type === "command.executed" && event?.properties?.name === "pet") {
        server.requestToggle()
        log("info", "Toggling pet via /pet command")
      }
      brain.handleEvent(event)
    },
  }

  singleton = { hooks, refs: 1 }

  try {
    await server.start()
    child = await launchPetWindow(server.origin, log)
    log("info", `Pet window running (${server.origin}), ${pets.length} pets, default ${defaultPetId}`)
  } catch (error) {
    server.close()
    log("error", `Could not launch pet window: ${error?.message ?? error}`)
    singleton = null
    return {
      tool: { git_revert_unstaged: gitRevertUnstagedTool },
      dispose: async () => {},
      event: async () => {},
    }
  }

  return hooks
}

export default OpenChamberPet
