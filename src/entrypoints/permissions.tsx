import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';

// Mock Data
// Mock Data
type Tab = 'Allow' | 'Ask' | 'Deny' | 'Workspace';
const TABS: Tab[] = ['Allow', 'Ask', 'Deny', 'Workspace'];
const MAIN_COLOR = '#b1b9f9';
const DELETE_COLOR = '#ff6b80';
const GRAY_COLOR = '#999999';

const MOCK_ALLOWED_RULES = [
  'Bash(cd:*)',
  'Bash(claude tasks:*)',
  'Bash(curl:*)',
  'Bash(find:*)',
  'Bash(git mv:*)',
  'Bash(ls:*)',
  'Bash(node:*)',
  'Bash(npm run build:*)',
  'Bash(npm run dev:*)',
  'Bash(python:*)',
  'Bash(vim:*)',
  'Bash(cat:*)',
  'Bash(grep:*)',
  'Bash(rm:*)',
  'Bash(mkdir:*)',
];

const MOCK_ASK_RULES: string[] = [];
const MOCK_DENY_RULES: string[] = [];
const MOCK_DIRECTORIES = ['/Users/david/Documents/github/formax (Original working directory)'];

// Components

const Separator = () => (
  <Box width="100%">
    <Text color={GRAY_COLOR}>────────────────────────────────────────────────────────────────────────────────────────────────────────────────</Text>
  </Box>
);

const TabHeader = ({ activeTab }: { activeTab: Tab }) => {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Permissions: </Text>
        {TABS.map((tab, index) => (
            <Text key={tab}>
                {activeTab === tab ? <Text backgroundColor={MAIN_COLOR} color="black"> {tab} </Text> : <Text> {tab} </Text>}
                {index < TABS.length - 1 ? ' ' : ''}
            </Text>
        ))}
        &nbsp;<Text color={GRAY_COLOR}>(tab to cycle)</Text>
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

const ListItem = ({ index, text, isSelected, showIndex = true, scrollIndicator }: { index: number, text: string, isSelected: boolean, showIndex?: boolean, scrollIndicator?: 'up' | 'down' | null }) => {
  return (
    <Box>
      <Box width={3}>
        <Text color={isSelected || scrollIndicator ? MAIN_COLOR : GRAY_COLOR}>
            {isSelected ? '❯ ' : (scrollIndicator === 'down' ? '↓ ' : (scrollIndicator === 'up' ? '↑ ' : '  '))}
        </Text>
      </Box>
      <Box width={4}>
         <Text color={isSelected ? MAIN_COLOR : GRAY_COLOR}>{showIndex ? `${index + 1}.` : ''}</Text>
      </Box>
      <Text>{text}</Text>
    </Box>
  );
};

const TextInput = ({ value, onChange, placeholder = '...' }: { value: string, onChange: (v: string) => void, placeholder?: string }) => {
    // Simple text input capture relying on parent useInput for now, simulating partial focus
    // In a real app we'd use a robust input component or state management
    // For this purely visual mock, we just display the value
    return (
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
             <Text>{value || <Text color={GRAY_COLOR}>{placeholder}</Text>}</Text>
        </Box>
    );
};


type ViewState = 'MAIN' | 'ADD_RULE' | 'ADD_DIRECTORY' | 'DELETE_CONFIRM' | 'SAVE_RULE_LOCATION';

const PermissionsApp = () => {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('Allow');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const VISIBLE_ROWS = 10;
  const [view, setView] = useState<ViewState>('MAIN');
  const [inputText, setInputText] = useState('');

  const [deleteChoice, setDeleteChoice] = useState<0 | 1>(0);
  const [saveLocationIndex, setSaveLocationIndex] = useState(0);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  // Constants
  const SAVE_OPTIONS = [
    { label: 'Project settings (local)', detail: 'Saved in .claude/settings.local.json' },
    { label: 'Project settings', detail: 'Checked in at .claude/settings.json' },
    { label: 'User settings', detail: 'Saved in at ~/.claude/settings.json' },
  ];


  
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
      if (activeTab === 'Workspace') {
          return {
              staticItems: MOCK_DIRECTORIES,
              interactiveItems: ['Add directory…']
          };
      }
      return {
          staticItems: [],
          interactiveItems: ['Add a new rule…', ...(
              activeTab === 'Allow' ? MOCK_ALLOWED_RULES :
              activeTab === 'Ask' ? MOCK_ASK_RULES :
              activeTab === 'Deny' ? MOCK_DENY_RULES : []
          )]
      };
  };

  const { staticItems, interactiveItems } = getDisplayItems();

  useInput((input, key) => {
    if (view === 'MAIN') {
        if (key.escape) {
            // Dismiss
            // In a real app this would clear screen or exit
             exit();
             return;
        }
        if (key.tab) {
            // Cycle tabs
            const currentIndex = TABS.indexOf(activeTab);
            const nextIndex = (currentIndex + 1) % TABS.length;
            setActiveTab(TABS[nextIndex]);
            setSelectedIndex(0);
            setScrollTop(0);
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
            const newIndex = Math.min(interactiveItems.length - 1, selectedIndex + 1);
            setSelectedIndex(newIndex);
            if (newIndex >= scrollTop + VISIBLE_ROWS) {
                 setScrollTop(newIndex - VISIBLE_ROWS + 1);
            }
        }
        if (key.return) {
            const selectedItem = interactiveItems[selectedIndex];
            if (selectedItem.startsWith('Add ')) {
                if (activeTab === 'Workspace') {
                     setView('ADD_DIRECTORY');
                     setDirectoryError(null);
                }
                else setView('ADD_RULE');
                setInputText('');
            } else {
                // Clicking an existing item -> Delete confirmation?
                 setView('DELETE_CONFIRM');
                 setDeleteChoice(0);
            }
        }
    } else if (view === 'ADD_RULE' || view === 'ADD_DIRECTORY') {
        if (key.escape) {
            setView('MAIN');
        }
        if (key.return) {
            const cleanInput = inputText.trim();
            setInputText(prev => prev.trim());

            if (view === 'ADD_RULE') {
                if (activeTab === 'Ask' || activeTab === 'Deny') {
                    setView('SAVE_RULE_LOCATION');
                    setSaveLocationIndex(0);
                } else {
                    // Allow rules might just save to default or have different logic?
                    // Assuming they go straight to submit for now based on current flow,
                    // or if they need the same dialog we can enable it.
                    // The prompt specifically mentioned Ask/Deny for this dialog.
                    // Let's assume 'Allow' works as simple add for now or follows same pattern.
                    // If 'Allow' needs it too, remove the check.
                    // For now, prompt said "Ask and Deny".
                    setView('MAIN');
                }
            } else {
                // ADD_DIRECTORY validation
                 if (cleanInput.includes('123')) {
                     setDirectoryError(`Path ${cleanInput} was not found.`);
                 } else {
                     setView('MAIN');
                 }
            }
            return;
        }
        // Mock typing
        if (key.backspace || key.delete) {
            setInputText(prev => prev.slice(0, -1));
            if (view === 'ADD_DIRECTORY') setDirectoryError(null);
        } else if (!key.ctrl && !key.meta && input) {
             setInputText(prev => prev + input);
             if (view === 'ADD_DIRECTORY') setDirectoryError(null);
        }
    } else if (view === 'SAVE_RULE_LOCATION') {
        if (key.escape) setView('ADD_RULE'); // Go back to editing rule
        
        if (key.upArrow) {
            setSaveLocationIndex(Math.max(0, saveLocationIndex - 1));
        }
        if (key.downArrow) {
            setSaveLocationIndex(Math.min(SAVE_OPTIONS.length - 1, saveLocationIndex + 1));
        }
        if (key.return) {
            // Confirm save
            setView('MAIN');
        }
    } else if (view === 'DELETE_CONFIRM') {
         if (key.escape) setView('MAIN');
         
         if (key.upArrow || key.downArrow) {
             setDeleteChoice(prev => prev === 0 ? 1 : 0);
         }

         if (key.return) {
             if (deleteChoice === 0) {
                 // Yes
                 // Implement delete logic here if needed
             }
             setView('MAIN');
         }
    }
  });

  const renderMain = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>&gt; /permissions</Text>
      </Box>

      <Separator />
      
      <TabHeader activeTab={activeTab} />
      <Box marginBottom={1}>
        <TabDescription activeTab={activeTab} />
      </Box>

      <Box flexDirection="column">
          {staticItems.map((item, i) => (
               <Box key={`static-${i}`}>
                   <Text>   -  {item}</Text>
               </Box>
          ))}
          {interactiveItems.slice(scrollTop, scrollTop + VISIBLE_ROWS).map((item, i) => {
             const actualIndex = i + scrollTop;
             // Determine scroll indicator
             let scrollIndicator: 'up' | 'down' | null = null;
             // Show down arrow on the last visible item if there are more items
             if (i === VISIBLE_ROWS - 1 && actualIndex < interactiveItems.length - 1) {
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
                scrollIndicator={scrollIndicator}
             />
             );
          })}
      </Box>

      <Box marginTop={2}>
        <Text color={GRAY_COLOR}>Press ↑↓ to navigate · Enter to select · / to search · Esc to cancel</Text>
      </Box>
      

    </Box>
  );

  const renderAddRule = () => (
      <Box flexDirection="column">
        <Box marginBottom={1}>
             <Text dimColor>&gt; /permissions</Text>
        </Box>
        <Box borderStyle="single" borderColor={MAIN_COLOR} flexDirection="column" paddingX={1}>
            <Text bold color={MAIN_COLOR}>Add {activeTab !== 'Workspace' ? activeTab.toLowerCase() : ''} permission rule</Text>
            <Text> </Text>
            <Text>Permission rules are a tool name, optionally followed by a specifier in parentheses.</Text>
            <Text>e.g., <Text color="white" bold>WebFetch</Text> or <Text color="white" bold>Bash(ls:*)</Text></Text>
            <Text> </Text>
            <Box borderStyle="round" borderColor="gray" paddingX={1}>
                 <Text>{inputText || <Text color={GRAY_COLOR}>Enter permission rule…</Text>}</Text>
            </Box>
             <Text> </Text>
        </Box>
        <Text color={GRAY_COLOR}>   Enter to submit · Esc to cancel</Text>
      </Box>
  );

  const renderSaveRuleLocation = () => (
      <Box flexDirection="column">
         <Box marginBottom={1}>
             <Text color={GRAY_COLOR}>&gt; /permissions</Text>
         </Box>

         <Separator />
         
         <Box flexDirection="column" marginTop={1}>
             <Text bold color={MAIN_COLOR}>Add {activeTab.toLowerCase()} permission rule</Text> 
             <Text> </Text>
             <Box flexDirection="column" paddingLeft={3}>
                <Text bold color="white">{inputText}</Text>
                <Text color={GRAY_COLOR}>Any use of the <Text bold color="white">{inputText}</Text> tool</Text>
             </Box>
             <Text> </Text>
             <Text> </Text>
             <Text> Where should this rule be saved?</Text>
             {SAVE_OPTIONS.map((option, i) => (
                 <Box key={i}>
                     <Box width={38}>
                        <Text color={saveLocationIndex === i ? MAIN_COLOR : GRAY_COLOR}>
                            {saveLocationIndex === i ? ' ❯ ' : '   '}{i + 1}. {option.label}
                        </Text>
                     </Box>
                     <Text color={GRAY_COLOR}>{option.detail}</Text>
                 </Box>
             ))}
             <Text> </Text>
             <Text> </Text>
             <Text color={GRAY_COLOR}>   Enter to confirm · Esc to cancel</Text>
        </Box>
      </Box>
  );

  const renderAddDirectory = () => (
     <Box flexDirection="column">
         <Box marginBottom={1}>
             <Text color={GRAY_COLOR}>&gt; /permissions</Text>
        </Box>
        <Box borderStyle="single" borderColor={MAIN_COLOR} flexDirection="column" paddingX={1}>
             <Text bold color={MAIN_COLOR}>Add directory to workspace</Text>
             <Text> </Text>
             <Text>  Claude Code will be able to read files in this directory and make edits when auto-accept edits is on.</Text>
             <Text> </Text>
             <Text>  Enter the path to the directory:</Text>
             <Text> </Text>
            <Box borderStyle="round" borderColor={directoryError ? DELETE_COLOR : 'gray'} paddingX={1}>
                 <Text>{inputText || <Text color={GRAY_COLOR}>Directory path…</Text>}</Text>
            </Box>
             <Text> </Text>
             {directoryError && (
                 <Box marginBottom={1}>
                     <Text color={DELETE_COLOR}>{directoryError}</Text>
                 </Box>
             )}
        </Box>
        <Text color={GRAY_COLOR}>   Enter to add · Esc to cancel</Text>

     </Box>
  );

  const renderDeleteConfirm = () => {
    // Current selected item details mock
    const item = interactiveItems[selectedIndex]; 
    return (
     <Box flexDirection="column">
         <Box marginBottom={1}>
             <Text color={GRAY_COLOR}>&gt; /permissions</Text>
        </Box>
         <Box borderStyle="single" borderColor={DELETE_COLOR} flexDirection="column" paddingX={1}>
             <Text bold color={DELETE_COLOR}>Delete allowed tool?</Text>
             <Text> </Text>
             <Text bold color="white">  {item}</Text>
             <Text color={GRAY_COLOR}>  Any Bash command starting with <Text bold color="white">cd</Text></Text>
             <Text color={GRAY_COLOR}>  From project local settings</Text>
             <Text> </Text>
             <Text color={GRAY_COLOR}> Are you sure you want to delete this permission rule?</Text>
             <Text> </Text>
             <Text color={deleteChoice === 0 ? MAIN_COLOR : GRAY_COLOR}>{deleteChoice === 0 ? ' ❯ ' : '   '}1. Yes</Text>
             <Text color={deleteChoice === 1 ? MAIN_COLOR : GRAY_COLOR}>{deleteChoice === 1 ? ' ❯ ' : '   '}2. No</Text>
        </Box>
        <Text color={GRAY_COLOR}>   Esc to cancel</Text>

     </Box>
    );
  };

  switch (view) {
      case 'ADD_RULE': return renderAddRule();
      case 'SAVE_RULE_LOCATION': return renderSaveRuleLocation();
      case 'ADD_DIRECTORY': return renderAddDirectory();
      case 'DELETE_CONFIRM': return renderDeleteConfirm();
      default: return renderMain();
  }
};

render(<PermissionsApp />);
