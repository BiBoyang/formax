# Thread Title Lifecycle

Date: 2026-05-24

Thread titles need an explicit lifecycle instead of using prompt text as a display fallback. `label` is the formal title, `lastUserPrompt` is preview/snippet data, and generated titles identify their source with `session_rename.source = "auto_title"`.

Manual and legacy labels are protected from automatic overwrite. Auto-title failures are best-effort diagnostics and retry state; they must not fail the main turn or appear as transcript content.
