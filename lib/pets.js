import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCAL_DIR = path.resolve(__dirname, "..", "pets")

export function petsDir() {
  const override = process.env.OPENCHAMBER_PET_DIR
  if (override) return path.resolve(override)
  return LOCAL_DIR
}

const SPRITE_CANDIDATES = ["spritesheet.webp", "spritesheet.png"]

function findSprite(dir) {
  for (const name of SPRITE_CANDIDATES) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function scanPetsDir(root) {
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const pets = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const manifestPath = path.join(dir, "pet.json")
    if (!fs.existsSync(manifestPath)) continue

    let manifest = {}
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    } catch {
      continue
    }

    const spritePath = findSprite(dir)
    if (!spritePath) continue

    const id = String(manifest.id || entry.name)
    pets.push({
      id,
      displayName: String(manifest.displayName || id),
      description: String(manifest.description || ""),
      spritePath,
      animations: manifest.animations && typeof manifest.animations === "object" ? manifest.animations : {},
    })
  }

  pets.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return pets
}

export function discoverPets() {
  return scanPetsDir(petsDir())
}

export function resolveDefaultPet(explicitId, pets) {
  if (explicitId) {
    const match = pets.find((p) => p.id === explicitId)
    if (match) return match.id
  }
  return pets[0]?.id ?? null
}
