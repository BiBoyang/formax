import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { normalizePathForCompare } from '../../utils/paths.js'
import { getTheme } from '../../utils/theme.js'
import { KeyHintBar } from '../../components/ui/KeyHintBar.js'
import { OverlayFrame } from '../../components/ui/OverlayFrame.js'
import { SelectList } from '../../components/ui/SelectList.js'
import TextInput from '../../components/ui/TextInput.js'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import {
  loadMergedPermissions,
  persistPermissionRule,
  deletePermissionRule,
  persistWorkspaceDirectory,
  deleteWorkspaceDirectory,
  type LoadedPermissions,
  type PermissionScope,
  type PermissionListKind,
  type PermissionRuleEntry,
} from '../../adapters/permissions/permissionsStore.js'

type Tab = 'Allow' | 'Ask' | 'Deny' | 'Workspace'
const TABS: Tab[] = ['Allow', 'Ask', 'Deny', 'Workspace']

const fileStore = createNodeFileStore()

// Components

const Separator = ({ color }: { color: string }) => (
  <Box width="100%">
    <Text color={color}>────────────────────────────────────────────────────────────────────────────────────────────────────────────────</Text>
  </Box>
);

const TabHeader = ({ activeTab, mainColor, mutedColor }: { activeTab: Tab; mainColor: string; mutedColor: string }) => {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Permissions: </Text>
        {TABS.map((tab, index) => (
            <Text key={tab}>
                {activeTab === tab ? <Text backgroundColor={mainColor} color="black"> {tab} </Text> : <Text> {tab} </Text>}
                {index < TABS.length - 1 ? ' ' : ''}
            </Text>
        ))}
        &nbsp;<Text color={mutedColor}>(tab to cycle)</Text>
      </Text>
    </Box>
  );
};

const TabDescription = ({ activeTab }: { activeTab: Tab }) => {
    switch (activeTab) {
        case 'Allow':
            return <Text>Claude Code won't ask before using allowed tools.</Text>;
        case 'Ask':
            return <Text>Claude Code will always ask for confirmation before using these tools.</Text>;
        case 'Deny':
            return <Text>Claude Code will always reject requests to use denied tools.</Text>;
        case 'Workspace':
            return <Text>Claude Code can read files in the workspace, and make edits when auto-accept edits is on.</Text>;
    }
};

const ListItem = ({
  index,
  text,
  isSelected,
  mainColor,
  mutedColor,
  showIndex = true,
  scrollIndicator,
}: {
  index: number
  text: string
  isSelected: boolean
  mainColor: string
  mutedColor: string
  showIndex?: boolean
  scrollIndicator?: 'up' | 'down' | null
}) => {
  return (
    <Box>
      <Box width={3}>
        <Text color={isSelected || scrollIndicator ? mainColor : mutedColor}>
            {isSelected ? '❯ ' : (scrollIndicator === 'down' ? '↓ ' : (scrollIndicator === 'up' ? '↑ ' : '  '))}
        </Text>
      </Box>
      <Box width={4}>
         <Text color={isSelected ? mainColor : mutedColor}>{showIndex ? `${index + 1}.` : ''}</Text>
      </Box>
      <Text>{text}</Text>
    </Box>
  );
};

type ViewState =
  | 'MAIN'
  | 'ADD_RULE'
  | 'ADD_DIRECTORY'
  | 'DELETE_CONFIRM'
  | 'SAVE_RULE_LOCATION'
  | 'DELETE_DIRECTORY_SELECT'
  | 'DELETE_DIRECTORY_CONFIRM';

export const PermissionsDialog = ({ onExit }: { onExit?: () => void }) => {
  useScopeActivation('overlay:permissions')
  const app = useApp()
  const exit = useMemo(() => onExit ?? app.exit, [app.exit, onExit])
  const theme = getTheme()
  const mainColor = theme.permission
  const deleteColor = theme.error
  const grayColor = theme.secondaryText
  const cwd = process.cwd()
  const [permissions, setPermissions] = useState<LoadedPermissions | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('Allow');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const VISIBLE_ROWS = 10;
  const [view, setView] = useState<ViewState>('MAIN');
  const viewRef = useRef<ViewState>('MAIN')
  const [inputText, setInputText] = useState('');
  const [isSearching, setIsSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    viewRef.current = view
  }, [view])

  const setViewSafe = (next: ViewState): void => {
    viewRef.current = next
    setView(next)
  }

	  const [deleteChoice, setDeleteChoice] = useState<0 | 1>(0);
	  const [saveLocationIndex, setSaveLocationIndex] = useState(0);
	  const [directoryError, setDirectoryError] = useState<string | null>(null);
	  const [directorySelectIndex, setDirectorySelectIndex] = useState(0);
	  const [directorySelectScrollTop, setDirectorySelectScrollTop] = useState(0);
	  const [directoryToDelete, setDirectoryToDelete] = useState<string | null>(null);

  // Constants
  const SAVE_OPTIONS = [
    { label: 'Project settings (local)', detail: 'Saved in .formax/settings.local.json' },
    { label: 'Project settings', detail: 'Checked in at .formax/settings.json' },
    { label: 'User settings', detail: 'Saved in at ~/.formax/settings.json' },
  ];

  const refreshPermissions = async (): Promise<void> => {
    const merged = await loadMergedPermissions({ fileStore, cwd, env: process.env })
    setPermissions(merged)
  }

  useEffect(() => {
    void refreshPermissions()
  }, [])

  function getListKindForTab(tab: Tab): PermissionListKind | null {
    if (tab === 'Allow') return 'allow'
    if (tab === 'Ask') return 'ask'
    if (tab === 'Deny') return 'deny'
    return null
  }

  function getScopeLabel(scope: PermissionScope): string {
    if (scope === 'projectLocal') return 'project local settings'
    if (scope === 'project') return 'project settings'
    return 'user settings'
  }

  function parseRule(rule: string): { toolName: string; spec: string } {
    const raw = String(rule || '').trim()
    const m = /^([A-Za-z0-9_:-]+)\((.*)\)$/.exec(raw)
    if (!m) return { toolName: raw, spec: '' }
    return { toolName: String(m[1] || '').trim(), spec: String(m[2] || '').trim() }
  }

  function describeRule(rule: string): string {
    const { toolName, spec } = parseRule(rule)
    if (!toolName) return 'Any tool use'

    if (toolName === 'Bash') {
      const normalized = spec.trim()
      if (!normalized) return 'Any Bash command'
      if (normalized.endsWith(':*')) return `Any Bash command starting with ${normalized.slice(0, -2)}`
      return `Any Bash command matching ${normalized}`
    }

    if (!spec) return `Any use of the ${toolName} tool`
    return `Any use of the ${toolName} tool (${spec})`
  }

  function getRuleListForTab(tab: Tab): PermissionRuleEntry[] {
    if (!permissions) return []
    if (tab === 'Allow') return permissions.allow
    if (tab === 'Ask') return permissions.ask
    if (tab === 'Deny') return permissions.deny
    return []
  }

	  function getSelectedRuleEntry(rule: string): PermissionRuleEntry | null {
	    const list = getRuleListForTab(activeTab)
	    return list.find((e) => e.rule === rule) ?? null
	  }

	  function getSelectedWorkspaceDirEntry(dir: string): { dir: string; scope: PermissionScope } | null {
	    const list = permissions?.workspace?.additionalDirectories ?? []
	    const found = list.find((e) => e.dir === dir)
	    return found ? { dir: found.dir, scope: found.scope } : null
	  }

  
  // Workspace mocks are weird in the screenshot. It shows the path with a dash, then the button.
  // "   -  /Users/david/Documents/github/formax (Original working directory)"
  // " ❯ 1. Add directory…"
  // This implies the directory list is "above" the selectable menu or the selection logic is unique.
  // For simplicity, I'll treat directories as non-selectable display items mostly, or just part of the list.
  // But wait, user expects to be able to remove them probably?
  // Text doesn't show removal UX for workspace explicitly other than maybe selecting it.
  // Let's stick to the list structure: Items then "Add".
  // Actually, screenshot 4 (Workspace) shows:
  //    - /path
  //  ❯ 1. Add directory...
  // This implies the directories are listed, then the action.
  // But standard menu usually has actions first?
  // Let's follow the screenshot exactly.
  // If I select "1. Add directory...", index is 0? Or is the path index 0?
  // The path has a `-`, not a number.
  
  const getDisplayItems = () => {
      const allow = permissions?.allow?.map((e) => e.rule) ?? []
      const ask = permissions?.ask?.map((e) => e.rule) ?? []
      const deny = permissions?.deny?.map((e) => e.rule) ?? []
      const dirs = permissions?.workspace?.additionalDirectories?.map((e) => e.dir) ?? []

	      if (activeTab === 'Workspace') {
	          return {
	              staticItems: [`${cwd} (Original working directory)`, ...dirs],
	              interactiveItems: ['Add directory…', ...(dirs.length ? ['Delete directory…'] : [])]
	          };
	      }
      return {
          staticItems: [],
          interactiveItems: ['Add a new rule…', ...(
              activeTab === 'Allow' ? allow :
              activeTab === 'Ask' ? ask :
              activeTab === 'Deny' ? deny : []
          )]
      };
  };

  const { staticItems, interactiveItems } = getDisplayItems();
  const filteredInteractiveItems = useMemo(() => {
    if (!isSearching) return interactiveItems
    const q = (searchQuery || '').trim().toLowerCase()
    if (!q) return interactiveItems

    const head = interactiveItems[0]
    const tail = interactiveItems.slice(1).filter((item) => item.toLowerCase().includes(q))
    return head ? [head, ...tail] : tail
  }, [interactiveItems, isSearching, searchQuery])

  const interactiveCount = filteredInteractiveItems.length

  useEffect(() => {
    if (interactiveCount <= 0) return
    setSelectedIndex((i) => Math.max(0, Math.min(i, interactiveCount - 1)))
    setScrollTop((t) => Math.max(0, Math.min(t, Math.max(0, interactiveCount - VISIBLE_ROWS))))
  }, [interactiveCount, activeTab, isSearching])

  const submitAddRule = (rawValue: string): void => {
    const cleanInput = rawValue.trim()
    setInputText(cleanInput)

    if (activeTab === 'Allow' || activeTab === 'Ask' || activeTab === 'Deny') {
      setViewSafe('SAVE_RULE_LOCATION')
      setSaveLocationIndex(0)
      return
    }

    const kind = getListKindForTab(activeTab)
    if (kind && cleanInput) {
      void persistPermissionRule({
        fileStore,
        cwd,
        scope: 'projectLocal',
        kind,
        rule: cleanInput,
        env: process.env,
      }).then(refreshPermissions)
    }
    setViewSafe('MAIN')
  }

  const submitAddDirectory = (rawValue: string): void => {
    const cleanInput = rawValue.trim()
    setInputText(cleanInput)
    if (!cleanInput) return

    const absoluteDir = normalizePathForCompare(cleanInput, cwd)
    void fileStore.exists(absoluteDir).then((exists) => {
      if (!exists) {
        setDirectoryError(`Path ${cleanInput} was not found.`)
        return
      }
      return persistWorkspaceDirectory({
        fileStore,
        cwd,
        scope: 'projectLocal',
        dir: absoluteDir,
        env: process.env,
      })
        .then(refreshPermissions)
        .then(() => {
          setDirectoryError(null)
          setViewSafe('MAIN')
        })
    })
  }

  useScopedInput(
	    'overlay:permissions',
	    (input, key) => {
	      const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
	      const isReturn =
	        key.return || (key as any)?.enter || input === '\r' || input === '\n' || seq === '\r' || seq === '\n'
	      const currentView = viewRef.current

	      if (currentView === 'SAVE_RULE_LOCATION') {
	        const isUp = key.upArrow || seq === '\u001B[A' || input === '\u001B[A'
	        const isDown = key.downArrow || seq === '\u001B[B' || input === '\u001B[B'

	        if (key.escape) {
	          setViewSafe('ADD_RULE')
	          return
	        }

        if (isUp) {
          setSaveLocationIndex((prev) => Math.max(0, prev - 1))
          return
        }

        if (isDown) {
          setSaveLocationIndex((prev) => Math.min(SAVE_OPTIONS.length - 1, prev + 1))
          return
        }

        if (!isReturn) return

        const kind = getListKindForTab(activeTab)
        const scope = (saveLocationIndex === 2
          ? 'user'
          : saveLocationIndex === 1
            ? 'project'
            : 'projectLocal') as PermissionScope
        if (kind && inputText.trim()) {
          void persistPermissionRule({
            fileStore,
            cwd,
            scope,
            kind,
            rule: inputText.trim(),
            env: process.env,
	          }).then(refreshPermissions)
	        }
	        setViewSafe('MAIN')
	        return
	      }

	    if (currentView === 'MAIN') {
		        if (key.escape) {
		            // Dismiss
		            // In a real app this would clear screen or exit
	             exit();
	             return;
	        }
	        if ((input === '/' || seq === '/') && !key.ctrl && !key.meta) {
	          if (isSearching) {
	            setIsSearching(false)
	            setSearchQuery('')
	          } else {
	            setIsSearching(true)
	          }
	          setSelectedIndex(0)
	          setScrollTop(0)
	          return
        }
	        if (key.tab) {
            // Cycle tabs
            const currentIndex = TABS.indexOf(activeTab);
            const nextIndex = (currentIndex + 1) % TABS.length;
            setActiveTab(TABS[nextIndex]);
            setSelectedIndex(0);
            setScrollTop(0);
            setIsSearching(false)
            setSearchQuery('')
            return;
        }
        if (key.upArrow) {
            const newIndex = Math.max(0, selectedIndex - 1);
            setSelectedIndex(newIndex);
            if (newIndex < scrollTop) {
                setScrollTop(newIndex);
            }
        }
        if (key.downArrow) {
            const newIndex = Math.min(filteredInteractiveItems.length - 1, selectedIndex + 1);
            setSelectedIndex(newIndex);
            if (newIndex >= scrollTop + VISIBLE_ROWS) {
                 setScrollTop(newIndex - VISIBLE_ROWS + 1);
	            }
	        }
			        if (isReturn) {
			            const selectedItem = filteredInteractiveItems[selectedIndex];
			            if (selectedItem.startsWith('Add ')) {
			                if (activeTab === 'Workspace') {
			                     setViewSafe('ADD_DIRECTORY');
			                     setDirectoryError(null);
		                }
		                else setViewSafe('ADD_RULE');
		                setInputText('');
		            } else if (selectedItem === 'Delete directory…') {
		                 setDirectorySelectIndex(0);
		                 setDirectorySelectScrollTop(0);
		                 setDirectoryToDelete(null);
		                 setViewSafe('DELETE_DIRECTORY_SELECT');
		            } else {
		                // Clicking an existing item -> Delete confirmation?
			                 setViewSafe('DELETE_CONFIRM');
			                 setDeleteChoice(0);
			            }
			        }
		    } else if (currentView === 'ADD_RULE' || currentView === 'ADD_DIRECTORY') {
		        if (key.escape) {
		            setViewSafe('MAIN');
		            return
		        }
		        // `TextInput` handles Enter/Return submission for these views.
			    } else if (currentView === 'DELETE_CONFIRM') {
		         if (key.escape) setViewSafe('MAIN');
		         
			         if (key.upArrow || key.downArrow) {
			             setDeleteChoice(prev => prev === 0 ? 1 : 0);
			         }

		         if (isReturn) {
		             if (deleteChoice === 0) {
		                 const kind = getListKindForTab(activeTab)
		                 const rule = filteredInteractiveItems[selectedIndex]
		                 const entry = kind ? getSelectedRuleEntry(rule) : null
	                 if (kind && entry) {
	                   void deletePermissionRule({
	                     fileStore,
	                     cwd,
	                     scope: entry.scope,
	                     kind,
	                     rule: entry.rule,
	                     env: process.env,
		                   }).then(refreshPermissions)
		                 }
		             }
		             setViewSafe('MAIN');
		         }
		    } else if (currentView === 'DELETE_DIRECTORY_SELECT') {
		        if (key.escape) {
		            setViewSafe('MAIN');
		            return;
		        }

	        const dirs = permissions?.workspace?.additionalDirectories?.map((e) => e.dir) ?? []
	        const visible = 8
		        const count = dirs.length
		        if (count <= 0) {
		            setViewSafe('MAIN');
		            return;
		        }

	        if (key.upArrow) {
	            const next = Math.max(0, directorySelectIndex - 1);
	            setDirectorySelectIndex(next);
	            if (next < directorySelectScrollTop) {
	                setDirectorySelectScrollTop(next);
	            }
	        }
	        if (key.downArrow) {
	            const next = Math.min(count - 1, directorySelectIndex + 1);
	            setDirectorySelectIndex(next);
	            if (next >= directorySelectScrollTop + visible) {
		                setDirectorySelectScrollTop(next - visible + 1);
		            }
		        }
			        if (isReturn) {
			            const dir = dirs[directorySelectIndex]
			            setDirectoryToDelete(dir ?? null)
			            setDeleteChoice(0)
			            setViewSafe('DELETE_DIRECTORY_CONFIRM')
		        }
		    } else if (currentView === 'DELETE_DIRECTORY_CONFIRM') {
		        if (key.escape) {
		            setViewSafe('DELETE_DIRECTORY_SELECT')
		            return
		        }

		        if (key.upArrow || key.downArrow) {
		            setDeleteChoice(prev => prev === 0 ? 1 : 0);
		        }

		        if (isReturn) {
		            if (deleteChoice === 0 && directoryToDelete) {
		                const entry = getSelectedWorkspaceDirEntry(directoryToDelete)
		                if (entry) {
		                    void deleteWorkspaceDirectory({
	                        fileStore,
	                        cwd,
	                        scope: entry.scope,
	                        dir: entry.dir,
	                        env: process.env,
		                    }).then(refreshPermissions)
		                }
		            }
		            setViewSafe('MAIN')
		        }
			    }
			  },
  )

  const renderMain = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>&gt; /permissions</Text>
      </Box>

      <Separator color={grayColor} />
      
      <TabHeader activeTab={activeTab} mainColor={mainColor} mutedColor={grayColor} />
      <Box marginBottom={1}>
        <TabDescription activeTab={activeTab} />
      </Box>

      <Box flexDirection="column">
          {staticItems.map((item, i) => (
               <Box key={`static-${i}`}>
                   <Text>   -  {item}</Text>
               </Box>
          ))}
          {filteredInteractiveItems.slice(scrollTop, scrollTop + VISIBLE_ROWS).map((item, i) => {
             const actualIndex = i + scrollTop;
             // Determine scroll indicator
             let scrollIndicator: 'up' | 'down' | null = null;
             // Show down arrow on the last visible item if there are more items
             if (i === VISIBLE_ROWS - 1 && actualIndex < filteredInteractiveItems.length - 1) {
                 scrollIndicator = 'down';
             }
             if (i === 0 && actualIndex > 0) {
                 scrollIndicator = 'up';
             }
             // Optional: Show up arrow on first item if we are scrolled down? 
             // The user spec specifically asked for ↓ on line 10. 
             // Line 10 in the UI is the last visible line (index 9 in 0-indexed visible slice).
             
             return (
             <ListItem 
                key={actualIndex} 
                index={actualIndex} 
                text={item} 
                isSelected={selectedIndex === actualIndex} 
                mainColor={mainColor}
                mutedColor={grayColor}
                scrollIndicator={scrollIndicator}
             />
             );
          })}
      </Box>

      {isSearching ? (
        <Box marginTop={1}>
          <Text color={grayColor}>Search: </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            cursorStyle="bar"
            cursorChar="▏"
            focus
            scope="overlay:permissions"
          />
        </Box>
      ) : null}

      <KeyHintBar
        text="Press ↑↓ to navigate · Enter to select · / to search · Esc to cancel"
        color={grayColor}
        marginLeft={0}
        marginTop={2}
      />
      

    </Box>
  );

  const renderAddRule = () => (
      <Box flexDirection="column">
        <Box marginBottom={1}>
             <Text dimColor>&gt; /permissions</Text>
        </Box>
        <OverlayFrame borderStyle="single" borderColor={mainColor} flexDirection="column" paddingX={1}>
            <Text bold color={mainColor}>Add {activeTab !== 'Workspace' ? activeTab.toLowerCase() : ''} permission rule</Text>
            <Text> </Text>
            <Text>Permission rules are a tool name, optionally followed by a specifier in parentheses.</Text>
            <Text>e.g., <Text color="white" bold>WebFetch</Text> or <Text color="white" bold>Bash(ls:*)</Text></Text>
            <Text> </Text>
            <Box borderStyle="round" borderColor="gray" paddingX={1}>
                 <TextInput
                   value={inputText}
                   onChange={setInputText}
                   onSubmit={submitAddRule}
                   placeholder="Enter permission rule…"
                   focus
                   scope="overlay:permissions"
                 />
            </Box>
             <Text> </Text>
        </OverlayFrame>
        <KeyHintBar text="   Enter to submit · Esc to cancel" color={grayColor} marginLeft={0} />
      </Box>
  );

  const renderSaveRuleLocation = () => (
      <Box flexDirection="column">
         <Box marginBottom={1}>
             <Text color={grayColor}>&gt; /permissions</Text>
         </Box>

         <Separator color={grayColor} />
         
         <Box flexDirection="column" marginTop={1}>
             <Text bold color={mainColor}>Add {activeTab.toLowerCase()} permission rule</Text> 
             <Text> </Text>
             <Box flexDirection="column" paddingLeft={3}>
                <Text bold color="white">{inputText}</Text>
                <Text color={grayColor}>Any use of the <Text bold color="white">{inputText}</Text> tool</Text>
             </Box>
             <Text> </Text>
             <Text> </Text>
             <Text> Where should this rule be saved?</Text>
             {SAVE_OPTIONS.map((option, i) => (
                 <Box key={i}>
                     <Box width={38}>
                        <Text color={saveLocationIndex === i ? mainColor : grayColor}>
                            {saveLocationIndex === i ? ' ❯ ' : '   '}{i + 1}. {option.label}
                        </Text>
                     </Box>
                     <Text color={grayColor}>{option.detail}</Text>
                 </Box>
             ))}
             <Text> </Text>
             <Text> </Text>
             <Text color={grayColor}>   Enter to confirm · Esc to cancel</Text>
        </Box>
      </Box>
  );

  const renderAddDirectory = () => (
     <Box flexDirection="column">
         <Box marginBottom={1}>
             <Text color={grayColor}>&gt; /permissions</Text>
        </Box>
        <OverlayFrame borderStyle="single" borderColor={mainColor} flexDirection="column" paddingX={1}>
             <Text bold color={mainColor}>Add directory to workspace</Text>
             <Text> </Text>
             <Text>  Claude Code will be able to read files in this directory and make edits when auto-accept edits is on.</Text>
             <Text> </Text>
             <Text>  Enter the path to the directory:</Text>
             <Text> </Text>
            <Box borderStyle="round" borderColor={directoryError ? deleteColor : 'gray'} paddingX={1}>
                 <TextInput
                   value={inputText}
                   onChange={(value) => {
                     setInputText(value)
                     setDirectoryError(null)
                   }}
                   onSubmit={submitAddDirectory}
                   placeholder="Directory path…"
                   focus
                   scope="overlay:permissions"
                 />
            </Box>
             <Text> </Text>
             {directoryError && (
                 <Box marginBottom={1}>
                     <Text color={deleteColor}>{directoryError}</Text>
                 </Box>
             )}
        </OverlayFrame>
        <KeyHintBar text="   Enter to add · Esc to cancel" color={grayColor} marginLeft={0} />

     </Box>
  );

	  const renderDeleteConfirm = () => {
	    // Current selected item details mock
	    const item = interactiveItems[selectedIndex]; 
	    const entry = getSelectedRuleEntry(item)
	    const scopeLabel = entry ? getScopeLabel(entry.scope) : 'project local settings'
    return (
     <Box flexDirection="column">
         <Box marginBottom={1}>
             <Text color={grayColor}>&gt; /permissions</Text>
        </Box>
         <OverlayFrame borderStyle="single" borderColor={deleteColor} flexDirection="column" paddingX={1}>
             <Text bold color={deleteColor}>Delete allowed tool?</Text>
             <Text> </Text>
             <Text bold color="white">  {item}</Text>
             <Text color={grayColor}>  {describeRule(item)}</Text>
             <Text color={grayColor}>  From {scopeLabel}</Text>
             <Text> </Text>
             <Text color={grayColor}> Are you sure you want to delete this permission rule?</Text>
             <Text> </Text>
             <SelectList
               items={[
                 { key: 'yes', label: 'Yes' },
                 { key: 'no', label: 'No' },
               ]}
               cursor={deleteChoice}
               accentColor={mainColor}
               mutedColor={grayColor}
               activePrefix=" ❯ "
               inactivePrefix="   "
               showNumbers
             />
        </OverlayFrame>
        <KeyHintBar text="   Esc to cancel" color={grayColor} marginLeft={0} />

     </Box>
    );
	  };

	  const renderDeleteDirectorySelect = () => {
	    const dirs = permissions?.workspace?.additionalDirectories?.map((e) => e.dir) ?? []
	    const visible = 8
	    const count = dirs.length
	    return (
	      <Box flexDirection="column">
	        <Box marginBottom={1}>
	          <Text color={grayColor}>&gt; /permissions</Text>
	        </Box>
	        <OverlayFrame borderStyle="single" borderColor={deleteColor} flexDirection="column" paddingX={1}>
	          <Text bold color={deleteColor}>Delete workspace directory?</Text>
	          <Text> </Text>
	          {dirs.slice(directorySelectScrollTop, directorySelectScrollTop + visible).map((dir, i) => {
	            const actualIndex = i + directorySelectScrollTop
	            return (
	              <ListItem
	                key={`${dir}-${actualIndex}`}
	                index={actualIndex}
	                text={dir}
	                isSelected={directorySelectIndex === actualIndex}
                  mainColor={mainColor}
                  mutedColor={grayColor}
	                scrollIndicator={null}
	              />
	            )
	          })}
	          {count === 0 ? <Text color={grayColor}>No additional directories.</Text> : null}
	        </OverlayFrame>
	        <KeyHintBar text="   Enter to select · Esc to cancel" color={grayColor} marginLeft={0} />
	      </Box>
	    )
	  }

	  const renderDeleteDirectoryConfirm = () => {
	    const dir = directoryToDelete ?? ''
	    const entry = directoryToDelete ? getSelectedWorkspaceDirEntry(directoryToDelete) : null
	    const scopeLabel = entry ? getScopeLabel(entry.scope) : 'project local settings'
	    return (
	      <Box flexDirection="column">
	        <Box marginBottom={1}>
	          <Text color={grayColor}>&gt; /permissions</Text>
	        </Box>
	        <OverlayFrame borderStyle="single" borderColor={deleteColor} flexDirection="column" paddingX={1}>
	          <Text bold color={deleteColor}>Delete workspace directory?</Text>
	          <Text> </Text>
	          <Text bold color="white">  {dir}</Text>
	          <Text color={grayColor}>  From {scopeLabel}</Text>
	          <Text> </Text>
	          <Text color={grayColor}> Are you sure you want to delete this directory?</Text>
	          <Text> </Text>
	          <SelectList
	            items={[
	              { key: 'yes', label: 'Yes' },
	              { key: 'no', label: 'No' },
	            ]}
	            cursor={deleteChoice}
	            accentColor={mainColor}
	            mutedColor={grayColor}
	            activePrefix=" ❯ "
	            inactivePrefix="   "
	            showNumbers
	          />
	        </OverlayFrame>
	        <KeyHintBar text="   Esc to cancel" color={grayColor} marginLeft={0} />
	      </Box>
	    )
	  }

	  switch (view) {
	      case 'ADD_RULE': return renderAddRule();
	      case 'SAVE_RULE_LOCATION': return renderSaveRuleLocation();
	      case 'ADD_DIRECTORY': return renderAddDirectory();
	      case 'DELETE_CONFIRM': return renderDeleteConfirm();
	      case 'DELETE_DIRECTORY_SELECT': return renderDeleteDirectorySelect();
	      case 'DELETE_DIRECTORY_CONFIRM': return renderDeleteDirectoryConfirm();
	      default: return renderMain();
	  }
};

export default PermissionsDialog
