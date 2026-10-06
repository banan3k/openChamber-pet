import assert from "node:assert/strict"
import { test } from "node:test"
import { once } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin, { removeLegacyPetCommand } from "./index.js"
import { registerPetIntegration } from "./lib/opencode.js"
import { createPetServer } from "./lib/server.js"
import { PetBrain } from "./lib/brain.js"

test("the package exposes an OpenCode V2 plugin entrypoint", () => {
  assert.equal(plugin.id, "openchamber-pet")
  assert.equal(typeof plugin.setup, "function")
})

test("migration removes the generated prompt command that overrides the V2 callback, but preserves custom commands", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-command-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "pet.md")
  fs.writeFileSync(file, "---\ndescription: Toggle the OpenChamber pet visibility\n---\nToggle the pet visibility.\n")
  removeLegacyPetCommand(dir)
  assert.equal(fs.existsSync(file), false)
  removeLegacyPetCommand(dir)
  fs.writeFileSync(file, "My custom pet command")
  removeLegacyPetCommand(dir)
  assert.equal(fs.readFileSync(file, "utf8"), "My custom pet command")
})

test("V2 /pet toggles the live server and subscriptions drive pet state until cleanup", async (t) => {
  const server = createPetServer({ pets: [], defaultPetId: null })
  await server.start(0)
  const brain = new PetBrain({
    onState: server.setState,
    onTasks: server.setTasks,
  })
  t.after(() => { brain.dispose(); server.close() })
  let command
  let subscriptionSignal
  let disposed = false
  const ready = Promise.withResolvers()
  const cleanup = await registerPetIntegration({
    tool: { transform: async (transform) => transform({ add() {} }) },
    command: { transform: async (transform) => transform({ add(value) { command = value } }) },
    session: { active: async () => ({}) },
    event: {
      async *subscribe({ signal }) {
        subscriptionSignal = signal
        yield { type: "session.created", data: { sessionID: "ses_test", title: "Pet test", parentID: "ses_parent" } }
        yield { type: "session.step.started", data: { sessionID: "ses_test", assistantMessageID: "msg_test" } }
        yield { type: "session.renamed", data: { sessionID: "ses_test", title: "Renamed task" } }
        ready.resolve()
        await once(signal, "abort")
      },
    },
  }, {
    toggle: server.requestToggle,
    event: async ({ event }) => brain.handleEvent(event),
    dispose: async () => { disposed = true },
  })
  t.after(cleanup)
  await ready.promise
  assert.equal(command.name, "pet")
  const state = () => fetch(`${server.origin}/state`).then((r) => r.json())
  assert.equal((await state()).toggleSeq, 0)
  await command.execute()
  assert.equal((await state()).toggleSeq, 1)
  await command.execute()
  const current = await state()
  assert.equal(current.toggleSeq, 2)
  assert.equal(current.state, "working")
  assert.equal(current.tasks[0].title, "Renamed task")
  await cleanup()
  assert.equal(subscriptionSignal.aborted, true)
  assert.equal(disposed, true)
})

test("loading during ongoing work creates a titled bubble without waiting for another event", async (t) => {
  const brain = new PetBrain({
    onState() {},
    resolveSession: async () => ({ title: "Already running", parentID: "ses_parent" }),
  })
  t.after(() => brain.dispose())
  const cleanup = await registerPetIntegration({
    tool: { transform: async (transform) => transform({ add() {} }) },
    command: { transform: async (transform) => transform({ add() {} }) },
    session: { active: async () => ({ ses_running: { type: "running" } }) },
    event: { async *subscribe({ signal }) { await once(signal, "abort") } },
  }, {
    toggle() {},
    event: async ({ event }) => brain.handleEvent(event),
  })
  t.after(cleanup)
  assert.equal(brain.state, "working")
  assert.equal(brain.tasks.length, 1)
  assert.equal(brain.tasks[0].id, "ses_running")
  assert.equal(brain.tasks[0].title, "Already running")
  assert.equal(brain.tasks[0].isSubagent, true)
})

test("live execution completion wins over an older active-session snapshot", async (t) => {
  const brain = new PetBrain({ onState() {} })
  t.after(() => brain.dispose())
  const snapshot = Promise.withResolvers()
  const cleanup = await registerPetIntegration({
    tool: { transform: async (transform) => transform({ add() {} }) },
    command: { transform: async (transform) => transform({ add() {} }) },
    session: { active: () => snapshot.promise },
    event: {
      async *subscribe({ signal }) {
        yield { type: "session.execution.started", data: { sessionID: "ses_done" } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_done" } }
        snapshot.resolve({ ses_done: { type: "running" } })
        await once(signal, "abort")
      },
    },
  }, {
    toggle() {},
    event: async ({ event }) => brain.handleEvent(event),
  })
  t.after(cleanup)
  await snapshot.promise
  assert.equal(brain.tasks.length, 1)
  assert.equal(brain.tasks[0].status, "done")
})

test("a V2 question marks its session bubble as waiting", async (t) => {
  const brain = new PetBrain({ onState() {} })
  t.after(() => brain.dispose())
  const ready = Promise.withResolvers()
  const cleanup = await registerPetIntegration({
    tool: { transform: async (transform) => transform({ add() {} }) },
    command: { transform: async (transform) => transform({ add() {} }) },
    session: { active: async () => ({}) },
    event: {
      async *subscribe({ signal }) {
        yield { type: "session.execution.started", data: { sessionID: "ses_question" } }
        yield { type: "form.created", data: { form: {
          id: "frm_question", sessionID: "ses_question", title: "Question",
          fields: [{ key: "answer", type: "string", title: "Which option?" }],
        } } }
        ready.resolve()
        await once(signal, "abort")
      },
    },
  }, {
    toggle() {},
    event: async ({ event }) => brain.handleEvent(event),
  })
  t.after(cleanup)
  await ready.promise
  assert.equal(brain.tasks[0].status, "waiting")
  assert.equal(brain.state, "waiting")
})

for (const resolution of ["form.replied", "form.cancelled"]) {
  test(`${resolution} resumes only the session that was waiting`, async (t) => {
    const brain = new PetBrain({ onState() {} })
    t.after(() => brain.dispose())
    const ready = Promise.withResolvers()
    const observations = []
    const cleanup = await registerPetIntegration({
      tool: { transform: async (transform) => transform({ add() {} }) },
      command: { transform: async (transform) => transform({ add() {} }) },
      session: { active: async () => ({}) },
      event: {
        async *subscribe({ signal }) {
          yield { type: "session.execution.started", data: { sessionID: "ses_other" } }
          // A question can be the first event observed for this session.
          yield { type: "form.created", data: { form: {
            id: "frm_question", sessionID: "ses_question", title: "Question",
            fields: [{ key: "answer", type: "string" }],
          } } }
          observations.push(brain.tasks.find((task) => task.id === "ses_question")?.status)
          yield { type: "form.created", data: { form: {
            id: "frm_global", sessionID: "global", title: "Setup",
            fields: [{ key: "answer", type: "string" }],
          } } }
          yield { type: resolution, data: { id: "frm_global", sessionID: "global", answer: {} } }
          observations.push(brain.tasks.find((task) => task.id === "ses_question")?.status)
          yield { type: resolution, data: { id: "frm_question", sessionID: "ses_question", answer: { answer: "Yes" } } }
          observations.push(brain.tasks.find((task) => task.id === "ses_question")?.status)
          ready.resolve()
          await once(signal, "abort")
        },
      },
    }, {
      toggle() {},
      event: async ({ event }) => brain.handleEvent(event),
    })
    t.after(cleanup)
    await ready.promise
    assert.deepEqual(observations, ["waiting", "waiting", "working"])
    assert.equal(brain.tasks.length, 2)
    assert.equal(brain.tasks.find((task) => task.id === "ses_other").status, "working")
    assert.equal(brain.state, "working")
  })
}

test("a question arriving during startup wins over the active-session snapshot", async (t) => {
  const brain = new PetBrain({ onState() {} })
  t.after(() => brain.dispose())
  const snapshot = Promise.withResolvers()
  const cleanup = await registerPetIntegration({
    tool: { transform: async (transform) => transform({ add() {} }) },
    command: { transform: async (transform) => transform({ add() {} }) },
    session: { active: () => snapshot.promise },
    event: {
      async *subscribe({ signal }) {
        yield { type: "form.created", data: { form: {
          id: "frm_question", sessionID: "ses_question", title: "Question",
          fields: [{ key: "answer", type: "string" }],
        } } }
        snapshot.resolve({ ses_question: { type: "running" } })
        await once(signal, "abort")
      },
    },
  }, {
    toggle() {},
    event: async ({ event }) => brain.handleEvent(event),
  })
  t.after(cleanup)
  assert.equal(brain.tasks.length, 1)
  assert.equal(brain.tasks[0].status, "waiting")
  assert.equal(brain.state, "waiting")
})
