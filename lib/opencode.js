// Keep the pet runtime's event format independent of OpenCode's transport API.
function petEvent(event) {
  const properties = event.data || {}
  switch (event.type) {
    case "session.execution.started":
    case "session.step.started":
      return { type: "session.status", properties: { ...properties, status: { type: "busy" } } }
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return { type: "session.idle", properties }
    case "session.created":
      return { type: event.type, properties: { ...properties, info: { ...properties, id: properties.sessionID } } }
    case "session.renamed":
      return { type: "session.updated", properties: { ...properties, info: { title: properties.title } } }
    case "session.execution.failed":
      return { type: "session.error", properties }
    case "form.created":
      return { type: "question.asked", properties: properties.form || {} }
    case "form.replied":
      return { type: "question.replied", properties }
    case "form.cancelled":
      return { type: "question.rejected", properties }
    default:
      return { type: event.type, properties }
  }
}

export async function registerPetIntegration(ctx, hooks) {
  await ctx.tool.transform((editor) => {
    for (const [name, tool] of Object.entries(hooks.tool || {})) {
      editor.add({
        name,
        description: tool.description,
        input: { type: "object", properties: tool.args, additionalProperties: false },
        async execute(input, context) {
          const session = await ctx.session.get({ sessionID: context.sessionID })
          const result = await tool.execute(input, { directory: session.location.directory })
          return { content: result.output }
        },
      })
    }
  })

  if (!hooks.toggle) throw new Error("Pet window could not start. Check the openchamber-pet startup log and pet assets.")

  await ctx.command.transform((editor) => {
    editor.add({
      name: "pet",
      description: "Toggle the OpenChamber pet visibility",
      async execute() {
        hooks.toggle()
      },
    })
  })

  const controller = new AbortController()
  const changedDuringSnapshot = new Set()
  let seeding = true
  const events = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const mapped = petEvent(event)
        // Global forms (such as MCP setup) do not belong to a session bubble.
        if (event.type.startsWith("form.") && (!mapped.properties.sessionID || mapped.properties.sessionID === "global")) continue
        if (seeding && ["session.status", "session.idle", "session.error", "session.deleted", "permission.asked", "question.asked", "question.replied", "question.rejected"].includes(mapped.type)) {
          changedDuringSnapshot.add(mapped.properties.sessionID)
        }
        await hooks.event({ event: mapped })
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error("[openchamber-pet] Event subscription failed:", error)
    }
  })()

  // The stream is live-only: work that began before setup needs an initial snapshot.
  // Subscribe first, then avoid overwriting newer lifecycle events with that snapshot.
  try {
    const active = await ctx.session.active()
    for (const sessionID of Object.keys(active)) {
      if (changedDuringSnapshot.has(sessionID)) continue
      await hooks.event({ event: { type: "session.status", properties: { sessionID, status: { type: "busy" } } } })
    }
  } catch (error) {
    console.error("[openchamber-pet] Could not load active sessions:", error)
  } finally {
    seeding = false
    changedDuringSnapshot.clear()
  }

  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    controller.abort()
    await events
    await hooks.dispose?.()
  }
}
