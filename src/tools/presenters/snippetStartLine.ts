export function findSnippetStartLineNumber(args: { fileText: string; snippet: string }): number | null {
  const fileLines = args.fileText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const snippetLines = args.snippet.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  while (snippetLines.length > 0 && snippetLines[snippetLines.length - 1] === '') snippetLines.pop()
  if (snippetLines.length === 0) return null

  const rstrip = (s: string) => s.replace(/\s+$/g, '')

  outer: for (let i = 0; i + snippetLines.length <= fileLines.length; i++) {
    for (let j = 0; j < snippetLines.length; j++) {
      if (rstrip(fileLines[i + j]) !== rstrip(snippetLines[j])) continue outer
    }
    return i + 1
  }

  return null
}
