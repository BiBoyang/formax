export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  await navigator.clipboard.writeText(text)
}
