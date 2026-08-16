# openchamber-pet

An [OpenChamber](https://opencode.ai) / opencode plugin that shows a small, always-on-top pet mascot that reacts to the agent's state. While a session is working the pet animates and shows speech bubbles with the task title and a live status icon.

## Features

- Always-on-top, transparent, frameless pet window that lives in the corner of your screen.
- Reacts to agent activity: working, waiting for a permission/question, failed, and idle.
- Speech bubbles show the currently running sessions, stacked newest-first, each with a status icon:
  - spinner — working
  - `?` — waiting for a permission/question answer
  - `✓` — finished
- Multiple pets: right-click the pet to switch between the pets in `pets/`.
- Hide/show the pet via a `/pet` command or a global shortcut.
- Closes automatically with OpenChamber (no orphaned windows).

## Requirements

- Node.js (for `npm install` of the Electron dev dependency). If Electron isn't found locally, the plugin falls back to `npx electron`.
- OpenChamber/opencode with plugin support.

## Install

1. Clone the repository:

   ```sh
   git clone <repo-url>
   cd openchamber-pet
   ```

2. Install dependencies (provides the Electron binary):

   ```sh
   npm install
   ```

3. Register the plugin in your opencode config (`~/.config/opencode/opencode.json` or `opencode.jsonc`):

   ```jsonc
   {
     "plugin": [
       "file:///absolute/path/to/openchamber-pet/index.js"
     ]
   }
   ```

   If you already have a `plugin` array, append the entry to it.

4. Add at least one pet to the `pets/` folder (see below).

5. Restart OpenChamber. The pet window should appear in the bottom-right corner.

## Adding pets

Pets live in the `pets/` folder, one directory per pet:

```
pets/
  my-pet/
    pet.json
    spritesheet.webp
```

`pet.json`:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "Optional description"
}
```

The spritesheet follows the Codex V2 atlas layout: a 192x208 grid of cells, one row per animation state (9 rows: idle, running-right, running-left, waving, jumping, failed, waiting, working, review). Either `spritesheet.webp` or `spritesheet.png` is accepted.

> The contents of `pets/` are git-ignored (only `.gitkeep` is tracked), so your pet assets stay local.

## Usage

| Action | How |
| --- | --- |
| Switch pet | Right-click the pet → **Pet** → choose one |
| Hide pet | Right-click the pet → **Hide pet** |
| Toggle visibility | Type `/pet` in the chat |
| Toggle visibility | Press `Cmd+Alt+P` (`Ctrl+Alt+P` on Windows/Linux) |

The `/pet` command is registered automatically on first load (it writes `~/.config/opencode/command/pet.md`). The shortcut is defined in `pet-app/main.js` as `TOGGLE_SHORTCUT`.

## Configuration

Environment variables:

| Variable | Description |
| --- | --- |
| `OPENCHAMBER_PET_DIR` | Override the directory that holds pets (default: `<repo>/pets`). |
| `OPENCHAMBER_PET_CONFIG` | Override the pet-selection config file path (default: `~/.config/openchamber/pet.json`). |
| `OPENCHAMBER_PET_PORT` | Fix the local server port (default: a random free port). |
| `OPENCHAMBER_PET_ELECTRON` | Path to an Electron binary to use instead of the local install. |

## How it works

The plugin:

1. Scans `pets/` for valid pets.
2. Starts a small local HTTP server that serves the pet page, sprite atlases, and an SSE stream of state changes.
3. Launches an Electron window (the pet) pointed at that server.
4. Maps opencode events (`session.status`, `tool.execute.before`, `permission.asked`, ...) to pet animation states and to the list of running tasks shown in the bubbles.

The pet window polls the plugin's server and quits itself if the server (and therefore OpenChamber) disappears.

## Project structure

```
index.js            plugin entry point
lib/brain.js        maps events to pet states and tasks
lib/tasks.js        tracks running sessions and their status
lib/pets.js         discovers pets in pets/
lib/server.js       local HTTP + SSE server
lib/launcher.js     spawns the Electron window
pet-app/            the Electron pet app (window, renderer, styles)
pets/               your pets (git-ignored)
```
