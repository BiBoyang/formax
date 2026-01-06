
export interface Theme {
  bashBorder: string
  primary: string
  permission: string
  secondaryBorder: string
  text: string
  secondaryText: string
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
}


const darkTheme: Theme = {
  bashBorder: '#fd5db1',
  primary: '#5f97cd',
  permission: '#b1b9f9',
  secondaryBorder: '#888',
  text: '#fff',
  secondaryText: '#999',
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
}



export function getTheme(): Theme {
  return darkTheme
}

