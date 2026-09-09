import { TaskTracker } from "./tasks.js"

const REVIEW_MS = 2500
const FAILED_MS = 4000
const WAVE_MS = 3000
const DONE_LINGER_MS = 3000

function sessionIdOf(props = {}) {
  return (
    props.sessionID ??
    props.sessionId ??
    props.session?.id ??
    props.info?.id ??
    props.id ??
    null
  )
}

function hasParentMetadata(info) {
  return Boolean(
    info &&
      (Object.hasOwn(info, "parentID") ||
        Object.hasOwn(info, "parentId") ||
        Object.hasOwn(info, "parent")),
  )
}

function parentSessionIdOf(info = {}) {
  return info.parentID ?? info.parentId ?? info.parent?.id ?? null
}

function activeTodos(todos) {
  if (!Array.isArray(todos)) return []
  return todos.filter((todo) => todo?.status === "pending" || todo?.status === "in_progress")
}

export class PetBrain {
  #state = "idle"
  #wasWorking = false
  #timer = null
  #onState
  #titles = new Map()
  #tracker
  #resolveSession
  #lastSessionId = null
  #doneTimers = new Map()
  #subagentSessions = new Set()
  #todos = new Map()
  #onTodos

  constructor({ onState, onTasks, onTodos, resolveSession, resolveTitle }) {
    this.#onState = onState
    this.#onTodos = onTodos || (() => {})
    this.#resolveSession =
      resolveSession ||
      (async (sessionID) => {
        const title = await (resolveTitle || (async () => null))(sessionID)
        return title ? { title } : null
      })
    this.#tracker = new TaskTracker({ onChange: onTasks || (() => {}) })
  }

  get state() {
    return this.#state
  }

  get tasks() {
    return this.#tracker.list
  }

  #set(state, { auto, after } = {}) {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    this.#state = state
    this.#onState(state)
    if (auto && after) {
      this.#timer = setTimeout(() => this.#set(auto), after)
    }
  }

  #finishWork() {
    if (this.#wasWorking) {
      this.#wasWorking = false
      this.#set("review", { auto: "idle", after: REVIEW_MS })
    } else {
      this.#set("idle")
    }
  }

  #rememberSession(sessionID, info) {
    if (!sessionID) return
    const title = info?.title
    if (typeof title === "string" && title) {
      this.#titles.set(sessionID, title)
      this.#tracker.updateTitle(sessionID, title)
    }
    if (hasParentMetadata(info)) {
      const isSubagent = Boolean(parentSessionIdOf(info))
      if (isSubagent) this.#subagentSessions.add(sessionID)
      else this.#subagentSessions.delete(sessionID)
      this.#tracker.updateSubagent(sessionID, isSubagent)
    }
  }

  #startTask(sessionID) {
    if (!sessionID) return
    this.#cancelRemove(sessionID)
    const title = this.#titles.get(sessionID)
    this.#tracker.start(sessionID, title, this.#subagentSessions.has(sessionID))
    if (!title) {
      this.#resolveSession(sessionID).then((info) => {
        if (!info) return
        this.#rememberSession(sessionID, info)
      })
    }
  }

  #waitTask(sessionID) {
    if (!sessionID) return
    this.#cancelRemove(sessionID)
    this.#tracker.setStatus(sessionID, "waiting")
  }

  #doneTask(sessionID) {
    if (!sessionID) return
    this.#tracker.setStatus(sessionID, "done")
    const existing = this.#doneTimers.get(sessionID)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.#doneTimers.delete(sessionID)
      this.#tracker.stop(sessionID)
    }, DONE_LINGER_MS)
    this.#doneTimers.set(sessionID, timer)
  }

  #cancelRemove(sessionID) {
    const existing = this.#doneTimers.get(sessionID)
    if (existing) {
      clearTimeout(existing)
      this.#doneTimers.delete(sessionID)
    }
  }

  #stopTask(sessionID) {
    if (!sessionID) return
    this.#cancelRemove(sessionID)
    this.#tracker.stop(sessionID)
  }

  #setTodos(sessionID, todos) {
    if (!sessionID) return
    const active = activeTodos(todos)
    if (active.length > 0) this.#todos.set(sessionID, active)
    else this.#todos.delete(sessionID)
    this.#onTodos([...this.#todos.values()].flat())
  }

  seedTitles(sessions) {
    if (!Array.isArray(sessions)) return
    for (const session of sessions) {
      if (session?.id) this.#rememberSession(session.id, session)
    }
  }

  handleEvent(event) {
    if (!event || typeof event !== "object") return
    const props = event.properties || {}
    const sessionID = sessionIdOf(props)
    if (sessionID) this.#lastSessionId = sessionID

    switch (event.type) {
      case "session.status": {
        const status = props.status?.type
        if (status === "busy") {
          this.#wasWorking = true
          this.#set("working")
          this.#startTask(sessionID)
        } else if (status === "idle") {
          this.#finishWork()
          this.#doneTask(sessionID)
        }
        break
      }
      case "session.idle":
        this.#finishWork()
        this.#doneTask(sessionID)
        break
      case "session.error":
        this.#wasWorking = false
        this.#set("failed", { auto: "idle", after: FAILED_MS })
        this.#stopTask(sessionID)
        break
      case "session.created":
        this.#rememberSession(sessionID, props.info)
        this.#set("waving", { auto: "idle", after: WAVE_MS })
        break
      case "session.updated":
        this.#rememberSession(sessionID, props.info)
        break
      case "session.deleted":
        this.#titles.delete(sessionID)
        this.#subagentSessions.delete(sessionID)
        this.#setTodos(sessionID, [])
        this.#stopTask(sessionID)
        break
      case "todo.updated":
        this.#setTodos(sessionID, props.todos)
        break
      case "permission.asked":
      case "permission.updated":
      case "question.asked":
      case "question.v2.asked":
        this.#set("waiting")
        this.#waitTask(sessionID || this.#lastSessionId)
        break
      case "permission.replied":
      case "permission.v2.replied":
      case "question.replied":
      case "question.v2.replied":
      case "question.rejected":
      case "question.v2.rejected":
        this.#set("working")
        this.#startTask(sessionID || this.#lastSessionId)
        break
      case "tool.execute.before":
        this.#wasWorking = true
        this.#set("working")
        this.#startTask(sessionID || this.#lastSessionId)
        break
      default:
        break
    }
  }

  dispose() {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    for (const timer of this.#doneTimers.values()) {
      clearTimeout(timer)
    }
    this.#doneTimers.clear()
  }
}
