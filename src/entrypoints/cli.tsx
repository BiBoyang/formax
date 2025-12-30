#!/usr/bin/env node

import React from 'react'
import { render, RenderOptions, Text, Box } from 'ink'
import { ReadStream } from 'tty'
import { openSync } from 'fs'
import { Onboarding } from '../components/Onboarding.js'
import { clearTerminal } from '../utils/terminal.js'

// 读取标准输入（stdin）
async function stdin(): Promise<string> {
  // 如果是交互式终端，返回空字符串
  if (process.stdin.isTTY) {
    return ''
  }

  // 从管道或文件重定向读取所有内容
  let data = ''
  for await (const chunk of process.stdin) {
    data += chunk
  }
  return data
}

async function showSetupScreens(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  // Check if onboarding has been completed
  const { getGlobalConfig } = await import('../utils/config.js')
  const config = getGlobalConfig()
  
  if (!config.hasCompletedOnboarding) {
    await clearTerminal()
    await new Promise<void>(resolve => {
      render(
        <Onboarding
          onDone={async () => {
            await clearTerminal()
            resolve()
          }}
        />,
        {
          exitOnCtrlC: true,
        }
      )
    })
  }
}

async function main() {
  let inputPrompt = ''
  let renderContext: RenderOptions | undefined = {
    exitOnCtrlC: false,
  }

  // 显示 Onboarding（如果需要）
  await showSetupScreens()

  // Onboarding 完成后，检查配置并决定下一步
  const { getGlobalConfig } = await import('../utils/config.js')
  const config = getGlobalConfig()
  
  if (config.hasCompletedOnboarding) {
    // 检查是否配置了模型
    if (config.model?.provider && config.model?.apiKey && config.model?.name) {
      // 配置了模型，直接进入聊天界面
      await clearTerminal()
      const { ChatScreen } = await import('../screens/ChatScreen.js')
      
      render(
        <ChatScreen
          onExit={() => {
            process.exit(0)
          }}
        />,
        {
          exitOnCtrlC: false,
        }
      )
    } else {
      // 没有配置模型，显示欢迎消息
      await clearTerminal()
      await new Promise<void>(resolve => {
        render(
          <Box flexDirection="column" gap={1}>
            <Text bold>Welcome to Formax!</Text>
            <Text>Onboarding completed successfully.</Text>
            <Text>Your configuration has been saved.</Text>
            <Text dimColor>Press Ctrl+C to exit</Text>
          </Box>,
          {
            exitOnCtrlC: true,
          }
        )
        // Auto exit after 3 seconds or wait for Ctrl+C
        setTimeout(() => {
          resolve()
        }, 3000)
      })
    }
  }

  // 处理标准输入（stdin）
  // if (!process.stdin.isTTY && !process.env.CI) {
  //   inputPrompt = await stdin()
  //   // 在非 Windows 系统上，打开 /dev/tty 用于后续交互
  //   if (process.platform !== 'win32') {
  //     try {
  //       const ttyFd = openSync('/dev/tty', 'r')
  //       renderContext = { ...renderContext, stdin: new ReadStream(ttyFd) }
  //     } catch (err) {
  //       // 如果无法打开 /dev/tty，继续使用默认的 stdin
  //       console.error(`Could not open /dev/tty: ${err}`)
  //     }
  //   }
  // }

  // render(<Text>123</Text>, renderContext)
}

main()

