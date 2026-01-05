import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'

interface LogMessage {
  type: 'log' | 'info' | 'warn' | 'error' | 'debug'
  timestamp: string
  args: any[]
  formatted: string
}

// 导出一个简单的 wsLog 函数供外部使用
let loggerInstance: ConsoleLoggerServer | null = null

export function wsLog(...args: any[]): void {
  if (!loggerInstance) return
  loggerInstance.logToBrowserOnly('log', ...args)
}

export function wsInfo(...args: any[]): void {
  if (!loggerInstance) return
  loggerInstance.logToBrowserOnly('info', ...args)
}

export function wsWarn(...args: any[]): void {
  if (!loggerInstance) return
  loggerInstance.logToBrowserOnly('warn', ...args)
}

export function wsError(...args: any[]): void {
  if (!loggerInstance) return
  loggerInstance.logToBrowserOnly('error', ...args)
}

export function wsDebug(...args: any[]): void {
  if (!loggerInstance) return
  loggerInstance.logToBrowserOnly('debug', ...args)
}

class ConsoleLoggerServer {
  private wss: WebSocketServer | null = null
  private httpServer: any = null
  private port: number
  private clients: Set<WebSocket> = new Set()
  private originalConsole: {
    log: typeof console.log
    info: typeof console.info
    warn: typeof console.warn
    error: typeof console.error
    debug: typeof console.debug
  }

  constructor(port: number = 3001) {
    this.port = port
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    }
  }

  start(): void {
    // 创建 HTTP 服务器
    this.httpServer = createServer((req, res) => {
      if (req.url === '/') {
        // 返回 HTML 页面
        const html = this.getHTML()
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({ server: this.httpServer })

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws)
      
      // 只发送到浏览器，不输出到终端
      this.logToBrowserOnly('info', `浏览器客户端已连接 (${this.clients.size} 个客户端)`)
      
      // 发送一条测试消息确认连接
      try {
        const testMessage: LogMessage = {
          type: 'info',
          timestamp: new Date().toISOString(),
          args: [],
          formatted: '✅ 已连接到日志服务器，开始接收日志...'
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(testMessage))
        }
      } catch (error) {
        // 只发送到浏览器，不输出到终端
        this.logToBrowserOnly('error', '[Console Logger] 发送测试消息失败:', error)
      }
      
      ws.on('close', () => {
        this.clients.delete(ws)
        // 只发送到浏览器，不输出到终端
        this.logToBrowserOnly('info', `浏览器客户端已断开 (${this.clients.size} 个客户端)`)
      })

      ws.on('error', (error) => {
        // 只发送到浏览器，不输出到终端
        this.logToBrowserOnly('error', '[Console Logger] WebSocket 错误:', error)
      })
    })

    this.httpServer.listen(this.port, () => {
      // 只输出启动地址到终端，其他信息只发送到浏览器
      this.originalConsole.log(`[Console Logger] 浏览器访问: http://localhost:${this.port}`)
      
      // 启动信息和测试日志只发送到浏览器，不输出到终端
      setTimeout(() => {
        this.logToBrowserOnly('info', '[Console Logger] 日志服务器已启动')
        this.logToBrowserOnly('info', '[Console Logger] 测试日志：如果你在浏览器中看到这条消息，说明日志功能正常工作！')
      }, 100)
    })
  }

  logToBrowser(type: LogMessage['type'], ...args: any[]): void {
    // 同时输出到控制台
    this.originalConsole[type](...args)

    // 发送到浏览器
    this.sendToBrowserClients(type, ...args)
  }

  logToBrowserOnly(type: LogMessage['type'], ...args: any[]): void {
    // 只发送到浏览器，不输出到终端
    this.sendToBrowserClients(type, ...args)
  }

  private sendToBrowserClients(type: LogMessage['type'], ...args: any[]): void {
    // 准备消息并发送到浏览器
    const timestamp = new Date().toISOString()
    const formatted = args
      .map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      })
      .join(' ')

    const message: LogMessage = {
      type,
      timestamp,
      args: args.map(arg => {
        // 序列化参数，但限制深度避免循环引用
        try {
          return JSON.parse(JSON.stringify(arg, (key, value) => {
            if (typeof value === 'function') return '[Function]'
            if (value instanceof Error) return { message: value.message, stack: value.stack }
            return value
          }))
        } catch {
          return String(arg)
        }
      }),
      formatted,
    }

    const data = JSON.stringify(message)
    
    // 发送到所有已连接的客户端
    if (this.clients.size > 0) {
      this.clients.forEach(client => {
        try {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data)
          }
        } catch (error) {
          // 发送失败时静默处理，避免影响主程序
          // 不输出到终端，只在开发时可能需要调试
        }
      })
    }
  }

  stop(): void {
    if (this.wss) {
      this.clients.forEach(client => client.close())
      this.clients.clear()
      this.wss.close()
      this.wss = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
  }

  private getHTML(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Console Logger - 实时日志查看器</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 20px;
      overflow-x: hidden;
    }
    
    .header {
      background: #252526;
      padding: 15px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border: 1px solid #3e3e42;
    }
    
    .header h1 {
      font-size: 18px;
      color: #4ec9b0;
    }
    
    .status {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .status-indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #f48771;
      animation: pulse 2s infinite;
    }
    
    .status-indicator.connected {
      background: #4ec9b0;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .controls {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    
    button {
      background: #0e639c;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    }
    
    button:hover {
      background: #1177bb;
    }
    
    button:active {
      background: #0a4d73;
    }
    
    .log-container {
      background: #1e1e1e;
      border: 1px solid #3e3e42;
      border-radius: 8px;
      padding: 15px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.6;
    }
    
    .log-entry {
      padding: 4px 0;
      border-left: 3px solid transparent;
      padding-left: 10px;
      margin-bottom: 2px;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    
    .log-entry.log {
      border-left-color: #4ec9b0;
    }
    
    .log-entry.info {
      border-left-color: #569cd6;
    }
    
    .log-entry.warn {
      border-left-color: #dcdcaa;
      background: rgba(220, 220, 170, 0.1);
    }
    
    .log-entry.error {
      border-left-color: #f48771;
      background: rgba(244, 135, 113, 0.1);
    }
    
    .log-entry.debug {
      border-left-color: #c586c0;
      opacity: 0.8;
    }
    
    .timestamp {
      color: #858585;
      font-size: 11px;
      margin-right: 10px;
    }
    
    .log-type {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      margin-right: 8px;
      text-transform: uppercase;
    }
    
    .log-type.log { background: #4ec9b0; color: #1e1e1e; }
    .log-type.info { background: #569cd6; color: #1e1e1e; }
    .log-type.warn { background: #dcdcaa; color: #1e1e1e; }
    .log-type.error { background: #f48771; color: #1e1e1e; }
    .log-type.debug { background: #c586c0; color: #1e1e1e; }
    
    .empty-state {
      text-align: center;
      color: #858585;
      padding: 40px;
    }
    
    /* 滚动条样式 */
    .log-container::-webkit-scrollbar {
      width: 8px;
    }
    
    .log-container::-webkit-scrollbar-track {
      background: #1e1e1e;
    }
    
    .log-container::-webkit-scrollbar-thumb {
      background: #424242;
      border-radius: 4px;
    }
    
    .log-container::-webkit-scrollbar-thumb:hover {
      background: #4e4e4e;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 Console Logger - 实时日志查看器</h1>
    <div class="status">
      <span class="status-indicator" id="statusIndicator"></span>
      <span id="statusText">连接中...</span>
    </div>
  </div>
  
  <div class="controls">
    <button onclick="clearLogs()">清空日志</button>
    <button onclick="toggleAutoScroll()" id="autoScrollBtn">自动滚动: 开启</button>
  </div>
  
  <div class="log-container" id="logContainer">
    <div class="empty-state">等待日志输出...</div>
  </div>

  <script>
    let ws = null;
    let autoScroll = true;
    let logCount = 0;
    
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const logContainer = document.getElementById('logContainer');
    const autoScrollBtn = document.getElementById('autoScrollBtn');
    
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${protocol}//\${window.location.host}\`;
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        statusIndicator.classList.add('connected');
        statusText.textContent = '已连接';
        logContainer.innerHTML = '';
        logCount = 0;
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          addLogEntry(message);
        } catch (error) {
          console.error('解析消息失败:', error);
        }
      };
      
      ws.onclose = () => {
        statusIndicator.classList.remove('connected');
        statusText.textContent = '已断开 - 正在重连...';
        setTimeout(connect, 2000);
      };
      
      ws.onerror = (error) => {
        statusText.textContent = '连接错误 - 正在重连...';
        console.error('WebSocket 错误:', error);
      };
    }
    
    function addLogEntry(message) {
      // 清除空状态（如果存在）
      const emptyState = logContainer.querySelector('.empty-state');
      if (emptyState) {
        emptyState.remove();
      }
      
      // 同时输出到浏览器控制台
      const consoleMethod = console[message.type] || console.log;
      try {
        // 尝试还原参数对象（如果有）
        if (message.args && message.args.length > 0) {
          consoleMethod(...message.args);
        } else {
          consoleMethod(message.formatted);
        }
      } catch (error) {
        // 如果还原失败，使用格式化字符串
        consoleMethod(message.formatted);
      }
      
      logCount++;
      const entry = document.createElement('div');
      entry.className = \`log-entry \${message.type}\`;
      
      const timestamp = new Date(message.timestamp).toLocaleTimeString('zh-CN');
      
      entry.innerHTML = \`
        <span class="timestamp">\${timestamp}</span>
        <span class="log-type \${message.type}">\${message.type}</span>
        <span class="log-content">\${escapeHtml(message.formatted)}</span>
      \`;
      
      logContainer.appendChild(entry);
      
      if (autoScroll) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function clearLogs() {
      logContainer.innerHTML = '<div class="empty-state">等待日志输出...</div>';
      logCount = 0;
    }
    
    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      autoScrollBtn.textContent = \`自动滚动: \${autoScroll ? '开启' : '关闭'}\`;
    }
    
    // 监听滚动，如果用户手动滚动到底部，自动开启自动滚动
    logContainer.addEventListener('scroll', () => {
      const isAtBottom = logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 10;
      if (isAtBottom && !autoScroll) {
        autoScroll = true;
        autoScrollBtn.textContent = '自动滚动: 开启';
      }
    });
    
    // 启动连接
    connect();
  </script>
</body>
</html>`
  }
}

export function startConsoleLogger(port: number = 3001): void {
  if (loggerInstance) {
    console.log('[Console Logger] 日志服务器已在运行')
    return
  }
  
  loggerInstance = new ConsoleLoggerServer(port)
  loggerInstance.start()
  
  // 优雅关闭
  process.on('SIGINT', () => {
    if (loggerInstance) {
      loggerInstance.stop()
      loggerInstance = null
    }
  })
  
  process.on('SIGTERM', () => {
    if (loggerInstance) {
      loggerInstance.stop()
      loggerInstance = null
    }
  })
}

export function stopConsoleLogger(): void {
  if (loggerInstance) {
    loggerInstance.stop()
    loggerInstance = null
  }
}
