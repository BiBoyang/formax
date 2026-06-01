# Thread Runtime Preferences Facet

When a value is thread-bound but not transcript content, model it as a sparse facet of shared `ThreadRuntimeState` before adding UI wiring. For v1 thread runtime preferences, `{}` means “inherit config”, while raw patch `null` clears a single override and must reduce back to an omitted field.

Keep the patch lane generic only by name. `thread/runtimeState/patch` is closed to the `preferences` facet until each future facet has contracts, persistence replay, read/resume/replay exposure, and tests.

For Web, route preference writes from an explicit visible-surface owner. A real thread patches thread state; draft/no-thread patches global runtime defaults. Do not use component-local state or `!activeThreadId` as durable semantics.
