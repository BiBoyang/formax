export function buildCompactRequest(instructions: string): string {
  const extra = instructions.trim()
  return (
    'Summarize the conversation so far for future context.\n\n' +
    'Requirements:\n' +
    '- Preserve user goals, constraints, and preferences.\n' +
    '- Preserve key technical decisions and trade-offs.\n' +
    '- Preserve important file paths, commands, and APIs discussed.\n' +
    '- Preserve open questions and next steps.\n' +
    '- Keep it concise and structured (bullets or short sections).\n' +
    '- Do NOT call tools.\n\n' +
    (extra ? `Additional user instructions:\n${extra}\n\n` : '') +
    'Output only the summary.'
  )
}
