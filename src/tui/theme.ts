
export interface Theme {
  bashBorder: string
  primary: string
  permission: string
  secondaryBorder: string
  text: string
  secondaryText: string
  replUserPromptFg: string
  replUserPromptBg: string
  suggestion: string
  claude: string  // AI assistant color
  // Semantic colors
  success: string
  error: string
  warning: string
  diff: {
    added: string
    removed: string
    addedDimmed: string
    removedDimmed: string
  }
  markdown: {
    heading: string
    listMarker: string
    quoteBar: string
    rule: string
    inlineCode: string
    link: string
    codeKeyword: string
    codeString: string
    codeComment: string
    codeDiffAdd: string
    codeDiffDel: string
  }
}


const darkTheme: Theme = {
  bashBorder: '#fd5db1',
  primary: '#5f97cd',
  permission: '#b1b9f9',
  secondaryBorder: '#888',
  text: '#fff',
  secondaryText: '#999',
  replUserPromptFg: '#fff',
  replUserPromptBg: '#373737',
  suggestion: '#b1b9f9',
  claude: '#a78bfa',
  success: '#4eba65',
  error: '#ff6b80',
  warning: '#ffc107',
  diff: {
    added: '#225c2b',
    removed: '#7a2936',
    addedDimmed: '#47584a',
    removedDimmed: '#69484d',
  },
  markdown: {
    heading: '#ffffff',
    listMarker: '#999',
    quoteBar: '#999',
    rule: '#999',
    inlineCode: '#b1b9f9',
    link: '#5f97cd',
    codeKeyword: '#5f97cd',
    codeString: '#ff6b80',
    codeComment: '#999',
    codeDiffAdd: '#4eba65',
    codeDiffDel: '#ff6b80',
  },
}



export function getTheme(): Theme {
  return darkTheme
}
