import React, { useState } from 'react';
import {
  Box,
  Text,
  Static,
  Transform,
  Newline,
  Spacer,
  useInput,
  useApp,
  useStdin,
  useStdout,
  useStderr,
  useFocus,
  useFocusManager,
} from './ink.js';
import {
  Alert,
  Badge,
  ConfirmInput,
  EmailInput,
  MultiSelect,
  OrderedList,
  PasswordInput,
  ProgressBar,
  Select,
  // Spinner, // 已移除，因为它会导致闪屏
  StatusMessage,
  TextInput,
  UnorderedList,
  // useSpinner, // 已移除，因为它会导致闪屏
  ThemeProvider,
  defaultTheme,
  type Option,
} from './inkjs-ui.js';

export function ComponentsShowcase() {
  const [textInputValue, setTextInputValue] = useState('');
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | undefined>();
  const [multiSelectedOptions, setMultiSelectedOptions] = useState<string[]>([]);
  const [confirmChoice, setConfirmChoice] = useState<boolean | null>(null);
  const [progressValue] = useState(50); // 固定值，不再自动更新
  const [staticMessages] = useState<string[]>([
    '静态消息示例 1',
    '静态消息示例 2',
    '静态消息示例 3',
  ]); // 固定值，不再自动更新

  // 使用各种 hooks
  const app = useApp();
  const stdin = useStdin();
  const stdout = useStdout();
  const stderr = useStderr();
  const { isFocused: focusState } = useFocus({ autoFocus: true, id: 'main' });
  const focusManager = useFocusManager();
  // 移除 useSpinner，因为它内部有定时器会导致频繁重新渲染
  // const spinner = useSpinner({ type: 'dots' });

  // 使用 useInput hook
  useInput((input, key) => {
    if (key.escape) {
      app.exit();
    }
    if (key.tab) {
      focusManager.focusNext();
    }
    if (key.shift && key.tab) {
      focusManager.focusPrevious();
    }
  });

  // 准备选项数据
  const selectOptions: Option[] = [
    { label: '选项 1', value: '1' },
    { label: '选项 2', value: '2' },
    { label: '选项 3', value: '3' },
    { label: '选项 4', value: '4' },
  ];

  const multiSelectOptions: Option[] = [
    { label: '多选 1', value: 'm1' },
    { label: '多选 2', value: 'm2' },
    { label: '多选 3', value: 'm3' },
    { label: '多选 4', value: 'm4' },
  ];
  return (
    <ThemeProvider theme={defaultTheme}>
      <Box flexDirection="column" padding={1} gap={1}>
        <Text bold color="cyan" underline>
          Ink & @inkjs/ui 组件展示页面
        </Text>
        <Text dimColor>
          按 ESC 退出 | Tab 切换焦点 | Shift+Tab 返回上一个焦点
        </Text>
        <Newline />

        <Box borderStyle="round" borderColor="blue" padding={1}>
          <Text bold color="blue">
            Ink 基础组件
          </Text>
          <Newline />

          <Box flexDirection="row" gap={1}>
            <Box borderStyle="single" padding={1}>
              <Text>Box 组件 - 单边框</Text>
            </Box>
            <Box borderStyle="double" padding={1}>
              <Text>Box 组件 - 双边框</Text>
            </Box>
            <Box borderStyle="round" padding={1}>
              <Text>Box 组件 - 圆角边框</Text>
            </Box>
          </Box>
          <Newline />

          <Text>Text 组件 - 普通文本</Text>
          <Text bold>Text 组件 - 粗体</Text>
          <Text color="green">Text 组件 - 绿色</Text>
          <Text color="red" backgroundColor="yellow">
            Text 组件 - 红色文字黄色背景
          </Text>
          <Text dimColor>Text 组件 - 暗淡颜色</Text>
          <Text italic>Text 组件 - 斜体</Text>
          <Text underline>Text 组件 - 下划线</Text>
          <Text strikethrough>Text 组件 - 删除线</Text>
          <Newline />

          <Transform transform={(output) => output.toUpperCase()}>
            <Text>Transform 组件 - 转换为大写</Text>
          </Transform>
          <Newline />

          <Text>Spacer 组件上方</Text>
          <Spacer />
          <Text>Spacer 组件下方</Text>
          <Newline />

          <Box borderStyle="single" padding={1}>
            <Text bold>Static 组件 - 静态内容（不滚动）</Text>
            <Static items={staticMessages}>
              {(message) => (
                <Text key={message} color="gray">
                  {message}
                </Text>
              )}
            </Static>
          </Box>
        </Box>
        <Newline />

        <Box borderStyle="round" borderColor="magenta" padding={1}>
          <Text bold color="magenta">
            Hooks 信息
          </Text>
          <Text>useApp: 应用已初始化</Text>
          <Text>useStdin: {stdin.isRawModeSupported ? '支持原始模式' : '不支持原始模式'}</Text>
          <Text>useStdout: 列数 {stdout.stdout?.columns || 'N/A'}, 行数 {stdout.stdout?.rows || 'N/A'}</Text>
          <Text>useStderr: 标准错误流可用</Text>
          <Text>useFocus: 当前焦点状态 - {focusState ? '已聚焦' : '未聚焦'}</Text>
        </Box>
        <Newline />

        <Box borderStyle="round" borderColor="green" padding={1}>
          <Text bold color="green">
            @inkjs/ui 组件
          </Text>
          <Newline />

          

          <Box flexDirection="column" gap={1}>
            <Text bold>Badge 组件:</Text>
            <Box flexDirection="row" gap={1}>
              <Badge color="green">成功</Badge>
              <Badge color="red">错误</Badge>
              <Badge color="yellow">警告</Badge>
              <Badge color="blue">信息</Badge>
            </Box>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>StatusMessage 组件:</Text>
            <StatusMessage variant="info">信息状态消息</StatusMessage>
            <StatusMessage variant="success">成功状态消息</StatusMessage>
            <StatusMessage variant="warning">警告状态消息</StatusMessage>
            <StatusMessage variant="error">错误状态消息</StatusMessage>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>ProgressBar 组件:</Text>
            <ProgressBar value={progressValue} />
            <Text dimColor>进度: {progressValue}% (固定值，不再自动更新)</Text>
            <Newline />
          </Box>

          {/* Spinner 组件已移除，因为它内部使用了定时器会导致频繁重新渲染 */}
          {/* <Box flexDirection="column" gap={1}>
            <Text bold>Spinner 组件 (使用 useSpinner hook):</Text>
            <Box flexDirection="row" gap={1}>
              <Box flexDirection="row" gap={1}>
                <Spinner type="dots" />
                <Text>加载中...</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Spinner type="line" />
                <Text>处理中...</Text>
              </Box>
            </Box>
            <Text dimColor>useSpinner hook 正在运行</Text>
            <Newline />
          </Box> */}

          <Box flexDirection="column" gap={1}>
            <Text bold>TextInput 组件:</Text>
            <TextInput
              placeholder="请输入文本..."
              defaultValue={textInputValue}
              onChange={(value) => setTextInputValue(value)}
              onSubmit={(value) => {
                // 不再更新静态消息，避免闪屏
              }}
            />
            <Text dimColor>当前值: {textInputValue || '(空)'}</Text>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>EmailInput 组件:</Text>
            <EmailInput
              placeholder="请输入邮箱地址..."
              defaultValue={emailValue}
              onChange={(value) => setEmailValue(value)}
              onSubmit={(value) => {
                // 不再更新静态消息，避免闪屏
              }}
            />
            <Text dimColor>当前值: {emailValue || '(空)'}</Text>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>PasswordInput 组件:</Text>
            <PasswordInput
              placeholder="请输入密码..."
              onChange={(value) => setPasswordValue(value)}
              onSubmit={(value) => {
                // 不再更新静态消息，避免闪屏
              }}
            />
            <Text dimColor>密码长度: {passwordValue.length}</Text>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>Select 组件:</Text>
            <Select
              options={selectOptions}
              defaultValue={selectedOption}
              onChange={(value) => setSelectedOption(value)}
            />
            <Text dimColor>
              已选择: {selectedOption ? selectOptions.find((o) => o.value === selectedOption)?.label : '(未选择)'}
            </Text>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>MultiSelect 组件:</Text>
            <MultiSelect
              options={multiSelectOptions}
              defaultValue={multiSelectedOptions}
              onChange={(values) => setMultiSelectedOptions(values)}
              onSubmit={(values) => {
              }}
            />
            <Text dimColor>
              已选择: {multiSelectedOptions.length > 0 ? multiSelectedOptions.join(', ') : '(未选择)'}
            </Text>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>ConfirmInput 组件:</Text>
            <ConfirmInput
              defaultChoice="confirm"
              onConfirm={() => {
                setConfirmChoice(true);
                // 不再更新静态消息，避免闪屏
              }}
              onCancel={() => {
                setConfirmChoice(false);
                // 不再更新静态消息，避免闪屏
              }}
            />
            <Text dimColor>
              选择结果: {confirmChoice === null ? '(未选择)' : confirmChoice ? '是' : '否'}
            </Text>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>OrderedList 组件:</Text>
            <OrderedList>
              <OrderedList.Item>
                <Text>第一项</Text>
              </OrderedList.Item>
              <OrderedList.Item>
                <Text>第二项</Text>
              </OrderedList.Item>
              <OrderedList.Item>
                <Text>第三项</Text>
              </OrderedList.Item>
            </OrderedList>
            <Newline />
          </Box>

          <Box flexDirection="column" gap={1}>
            <Text bold>UnorderedList 组件:</Text>
            <UnorderedList>
              <UnorderedList.Item>
                <Text>无序列表项 1</Text>
              </UnorderedList.Item>
              <UnorderedList.Item>
                <Text>无序列表项 2</Text>
              </UnorderedList.Item>
              <UnorderedList.Item>
                <Text>无序列表项 3</Text>
              </UnorderedList.Item>
            </UnorderedList>
          </Box>
        </Box>
      </Box>
      
    </ThemeProvider>
  );
}

