export class TaskTracker {
  #tasks = new Map()
  #onChange

  constructor({ onChange }) {
    this.#onChange = onChange
  }

  get list() {
    return [...this.#tasks.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  #emit() {
    this.#onChange(this.list)
  }

  start(id, title) {
    if (!id) return
    const existing = this.#tasks.get(id)
    if (existing) {
      let changed = false
      if (title && title !== existing.title) {
        existing.title = title
        changed = true
      }
      if (existing.status !== "working") {
        existing.status = "working"
        changed = true
      }
      if (changed) this.#emit()
      return
    }
    this.#tasks.set(id, {
      id,
      title: title || null,
      status: "working",
      startedAt: Date.now(),
    })
    this.#emit()
  }

  setStatus(id, status) {
    if (!id || !status) return
    const existing = this.#tasks.get(id)
    if (!existing || existing.status === status) return
    existing.status = status
    this.#emit()
  }

  updateTitle(id, title) {
    if (!id || !title) return
    const existing = this.#tasks.get(id)
    if (!existing || existing.title === title) return
    existing.title = title
    this.#emit()
  }

  stop(id) {
    if (!id) return
    if (this.#tasks.delete(id)) this.#emit()
  }
}
