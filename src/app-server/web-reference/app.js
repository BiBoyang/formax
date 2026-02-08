const bridgeUrl = window.__FORMAX_BRIDGE_URL__ || 'ws://127.0.0.1:3777'

const state = {
  socket: null,
  connected: false,
  requestId: 1,
  pendingRequests: new Map(),
  threads: [],
  activeThreadId: null,
  activeTurnId: null,
  transcript: [],
  pendingInputs: new Map(),
  activeInputId: null,
  connectionLabel: 'Disconnected',
}

const ui = {
  threadList: document.getElementById('threadList'),
  refreshThreadsBtn: document.getElementById('refreshThreadsBtn'),
  newThreadBtn: document.getElementById('newThreadBtn'),
  transcript: document.getElementById('transcript'),
  composerForm: document.getElementById('composerForm'),
  composerInput: document.getElementById('composerInput'),
  sendBtn: document.getElementById('sendBtn'),
  interruptBtn: document.getElementById('interruptBtn'),
  connectionStatus: document.getElementById('connectionStatus'),
  pendingList: document.getElementById('pendingList'),
  pendingEmpty: document.getElementById('pendingEmpty'),
  modalBackdrop: document.getElementById('inputModalBackdrop'),
  modalBody: document.getElementById('modalBody'),
  modalTitle: document.getElementById('modalTitle'),
  submitInputBtn: document.getElementById('submitInputBtn'),
  dismissModalBtn: document.getElementById('dismissModalBtn'),
}

function setConnectionLabel(text) {
  state.connectionLabel = text
  ui.connectionStatus.textContent = text
}

function nextRequestId() {
  const id = state.requestId
  state.requestId += 1
  return id
}

function rpcRequest(method, params) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Bridge socket is not connected'))
  }
  const id = nextRequestId()
  const payload = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
  state.socket.send(JSON.stringify(payload))

  return new Promise((resolve, reject) => {
    state.pendingRequests.set(id, { resolve, reject, method })
  })
}

function rpcNotify(method, params) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return
  const payload = { jsonrpc: '2.0', method, ...(params ? { params } : {}) }
  state.socket.send(JSON.stringify(payload))
}

function appendLog(text, level = 'info') {
  state.transcript.push({ kind: 'log', text, level, ts: new Date().toISOString() })
  renderTranscript()
}

function appendMessage(role, text, turnId) {
  state.transcript.push({ kind: 'message', role, text, turnId, ts: new Date().toISOString() })
  renderTranscript()
}

function appendAssistantDelta(turnId, textDelta) {
  const last = state.transcript[state.transcript.length - 1]
  if (last && last.kind === 'message' && last.role === 'assistant' && last.turnId === turnId) {
    last.text += textDelta
  } else {
    state.transcript.push({
      kind: 'message',
      role: 'assistant',
      text: textDelta,
      turnId,
      ts: new Date().toISOString(),
    })
  }
  renderTranscript()
}

function chooseActiveInput() {
  if (state.activeInputId && state.pendingInputs.has(state.activeInputId)) {
    return
  }
  const next = state.pendingInputs.values().next().value
  state.activeInputId = next ? next.inputId : null
}

function toFieldDomId(key) {
  return `field-${encodeURIComponent(key)}`
}

function toFieldName(key) {
  return `field-name-${encodeURIComponent(key)}`
}

function formatThreadTitle(thread) {
  if (thread.label && thread.label.trim()) return thread.label.trim()
  if (thread.lastUserPrompt && thread.lastUserPrompt.trim()) return thread.lastUserPrompt.trim()
  return `Thread ${thread.id.slice(0, 8)}`
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function clearPendingRequests(err) {
  for (const { reject } of state.pendingRequests.values()) {
    reject(err)
  }
  state.pendingRequests.clear()
}

function setBusy(busy) {
  ui.sendBtn.disabled = busy
  ui.interruptBtn.disabled = !busy
}

function renderThreads() {
  ui.threadList.innerHTML = ''

  if (state.threads.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'No threads yet. Start one from the left rail.'
    ui.threadList.appendChild(empty)
    return
  }

  for (const thread of state.threads) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `thread-item ${thread.id === state.activeThreadId ? 'active' : ''}`
    btn.onclick = () => {
      void activateThread(thread.id)
    }

    const title = document.createElement('div')
    title.className = 'thread-title'
    title.textContent = formatThreadTitle(thread)

    const meta = document.createElement('div')
    meta.className = 'thread-meta'
    meta.textContent = `${thread.id.slice(0, 8)} · ${new Date(thread.updatedAt).toLocaleString()}`

    btn.append(title, meta)
    ui.threadList.appendChild(btn)
  }
}

function renderTranscript() {
  ui.transcript.innerHTML = ''

  if (state.transcript.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'Start a turn to stream transcript events here.'
    ui.transcript.appendChild(empty)
    return
  }

  for (const item of state.transcript) {
    if (item.kind === 'message') {
      const bubble = document.createElement('div')
      bubble.className = `message ${item.role}`
      bubble.textContent = item.text
      ui.transcript.appendChild(bubble)
      continue
    }

    const log = document.createElement('div')
    log.className = `log-line ${item.level || 'info'}`
    log.textContent = item.text
    ui.transcript.appendChild(log)
  }

  ui.transcript.scrollTop = ui.transcript.scrollHeight
}

function renderPendingInputs() {
  ui.pendingList.innerHTML = ''
  const pending = Array.from(state.pendingInputs.values())
  ui.pendingEmpty.style.display = pending.length > 0 ? 'none' : 'block'

  for (const input of pending) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `pending-item ${input.inputId === state.activeInputId ? 'active' : ''}`
    row.onclick = () => {
      state.activeInputId = input.inputId
      renderPendingInputs()
      renderInputModal()
    }

    const title = document.createElement('div')
    title.className = 'pending-title'
    title.textContent = `${input.kind === 'approval' ? 'Approval' : 'Question'} · ${input.toolUseId}`

    const sub = document.createElement('div')
    sub.className = 'pending-sub'
    sub.textContent = `expires ${new Date(input.expiresAt).toLocaleTimeString()}`

    row.append(title, sub)
    ui.pendingList.appendChild(row)
  }
}

function collectApprovalAnswers(input) {
  const decision = document.getElementById('approvalDecision')?.value || 'approve'
  const scope = document.getElementById('approvalScope')?.value || 'session'
  const feedback = document.getElementById('approvalFeedback')?.value || ''

  const answers = { decision }
  if (decision === 'approve_remember') answers.scope = scope
  if (decision === 'feedback') answers.feedback = feedback

  return {
    inputId: input.inputId,
    threadId: input.threadId,
    turnId: input.turnId,
    toolUseId: input.toolUseId,
    answers,
  }
}

function collectQuestionAnswers(input) {
  const answers = {}
  for (const q of input.payload.questions || []) {
    const key = q.fieldId || q.header
    if (!key) continue

    if (q.options && q.options.length > 0 && q.multiSelect) {
      const checked = Array.from(document.querySelectorAll(`input[name="${toFieldName(key)}"]:checked`))
      answers[key] = checked.map((el) => el.value).join(',')
      continue
    }

    if (q.options && q.options.length > 0) {
      const select = document.getElementById(toFieldDomId(key))
      answers[key] = select?.value || ''
      continue
    }

    const field = document.getElementById(toFieldDomId(key))
    answers[key] = field?.value || ''
  }

  return {
    inputId: input.inputId,
    threadId: input.threadId,
    turnId: input.turnId,
    toolUseId: input.toolUseId,
    answers,
  }
}

function renderInputModal() {
  const input = state.activeInputId ? state.pendingInputs.get(state.activeInputId) : null
  if (!input) {
    ui.modalBackdrop.classList.remove('visible')
    ui.modalBody.innerHTML = ''
    return
  }

  ui.modalBackdrop.classList.add('visible')
  ui.modalTitle.textContent = input.kind === 'approval' ? 'Approval Required' : 'Ask User Question'
  ui.modalBody.innerHTML = ''

  const meta = document.createElement('div')
  meta.className = 'log-line'
  meta.textContent = `${input.toolUseId} · expires ${new Date(input.expiresAt).toLocaleTimeString()}`
  ui.modalBody.appendChild(meta)

  if (input.kind === 'approval') {
    const actionBlock = document.createElement('pre')
    actionBlock.className = 'code'
    actionBlock.textContent = safeJson({
      toolName: input.payload.toolName,
      action: input.payload.action,
      effectiveDecision: input.payload.effectiveDecision,
      suggestions: input.payload.suggestions || [],
    })

    const decision = document.createElement('select')
    decision.className = 'select'
    decision.id = 'approvalDecision'
    decision.innerHTML = [
      ['approve', 'approve'],
      ['approve_remember', 'approve_remember'],
      ['cancel', 'cancel'],
      ['feedback', 'feedback'],
    ]
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join('')

    const scope = document.createElement('select')
    scope.className = 'select'
    scope.id = 'approvalScope'
    scope.innerHTML = ['session', 'project'].map((v) => `<option value="${v}">${v}</option>`).join('')

    const feedback = document.createElement('textarea')
    feedback.className = 'input'
    feedback.id = 'approvalFeedback'
    feedback.placeholder = 'Feedback text when decision=feedback'
    feedback.rows = 3

    ui.modalBody.append(actionBlock, decision, scope, feedback)
    return
  }

  for (const q of input.payload.questions || []) {
    const key = q.fieldId || q.header
    const row = document.createElement('div')
    row.className = 'question-row'

    const title = document.createElement('strong')
    title.textContent = q.question || q.header || key || 'Question'

    const hint = document.createElement('div')
    hint.className = 'pending-sub'
    hint.textContent = key || 'field'

    row.append(title, hint)

    if (q.options && q.options.length > 0 && q.multiSelect) {
      const optionList = document.createElement('div')
      optionList.className = 'option-list'
      for (const option of q.options) {
        const label = document.createElement('label')
        label.className = 'option-label'
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.name = toFieldName(key)
        checkbox.value = option.label
        label.append(checkbox, document.createTextNode(option.label))
        optionList.appendChild(label)
      }
      row.appendChild(optionList)
      ui.modalBody.appendChild(row)
      continue
    }

    if (q.options && q.options.length > 0) {
      const select = document.createElement('select')
      select.className = 'select'
      select.id = toFieldDomId(key)
      for (const option of q.options) {
        const optionEl = document.createElement('option')
        optionEl.value = option.label
        optionEl.textContent = option.label
        select.appendChild(optionEl)
      }
      row.appendChild(select)
      ui.modalBody.appendChild(row)
      continue
    }

    const inputEl = document.createElement('input')
    inputEl.className = 'input'
    inputEl.id = toFieldDomId(key)
    inputEl.placeholder = 'Answer'
    row.appendChild(inputEl)
    ui.modalBody.appendChild(row)
  }
}

async function refreshThreads() {
  const out = await rpcRequest('thread/list', { limit: 50 })
  state.threads = out.result.data || []
  renderThreads()
}

async function activateThread(threadId) {
  const resume = await rpcRequest('thread/resume', { threadId })
  state.activeThreadId = threadId
  state.activeTurnId = null
  state.pendingInputs.clear()
  state.activeInputId = null

  state.transcript = []
  const read = await rpcRequest('thread/read', { threadId })
  for (const item of read.result.transcriptPreview || []) {
    appendMessage(item.role, item.text, null)
  }

  for (const stale of resume.result.staleInputs || []) {
    appendLog(`stale input expired: ${stale.inputId} (${stale.reason || 'expired'})`, 'warning')
  }

  renderThreads()
  renderPendingInputs()
  renderInputModal()
}

async function startThreadAndActivate() {
  const out = await rpcRequest('thread/start', {})
  const threadId = out.result.thread.id
  await refreshThreads()
  await activateThread(threadId)
}

async function startTurn(text) {
  if (!state.activeThreadId) {
    await startThreadAndActivate()
  }

  appendMessage('user', text, null)
  setBusy(true)
  const out = await rpcRequest('turn/start', {
    threadId: state.activeThreadId,
    input: { text },
  })
  state.activeTurnId = out.result.turn.id
  appendLog(`turn started: ${state.activeTurnId}`, 'info')
}

async function submitActiveInput() {
  const input = state.activeInputId ? state.pendingInputs.get(state.activeInputId) : null
  if (!input) return

  const payload = input.kind === 'approval' ? collectApprovalAnswers(input) : collectQuestionAnswers(input)
  const submissionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`

  const out = await rpcRequest('turn/input/submit', {
    threadId: payload.threadId,
    turnId: payload.turnId,
    inputId: payload.inputId,
    toolUseId: payload.toolUseId,
    answers: payload.answers,
    submissionId,
  })

  appendLog(`input submit: ${out.result.status}`, out.result.accepted ? 'info' : 'warning')
}

function handleTurnNotification(method, params) {
  if (!params) return

  if (method === 'turn/started') {
    state.activeTurnId = params.turn?.id || state.activeTurnId
    setBusy(true)
    return
  }

  if (method === 'turn/event') {
    const event = params.event || {}
    if (event.type === 'assistant_delta') {
      appendAssistantDelta(params.turnId, event.text || '')
      return
    }

    if (event.type === 'error') {
      appendLog(`stream error: ${event.message || 'unknown'}`, 'error')
      return
    }

    appendLog(`event ${event.type || 'unknown'}`, 'info')
    return
  }

  if (method === 'turn/inputRequested') {
    const input = params.input
    if (!input) return
    state.pendingInputs.set(input.inputId, input)
    chooseActiveInput()
    renderPendingInputs()
    renderInputModal()
    appendLog(`input requested: ${input.kind} (${input.inputId})`, 'warning')
    return
  }

  if (method === 'turn/inputResolved') {
    const input = params.input
    if (!input) return
    state.pendingInputs.delete(input.inputId)
    chooseActiveInput()
    renderPendingInputs()
    renderInputModal()
    appendLog(`input resolved: ${input.status} (${input.inputId})`, 'info')
    return
  }

  if (method === 'turn/completed') {
    setBusy(false)
    state.activeTurnId = null
    appendLog('turn completed', 'info')
    return
  }

  if (method === 'turn/failed') {
    setBusy(false)
    state.activeTurnId = null
    appendLog(`turn failed: ${params.error || 'unknown error'}`, 'error')
  }
}

function handleRpcMessage(raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    appendLog(`invalid JSON from bridge: ${raw}`, 'error')
    return
  }

  if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
    const pending = state.pendingRequests.get(msg.id)
    if (!pending) return
    state.pendingRequests.delete(msg.id)

    if (msg.error) {
      const err = new Error(`${msg.error.message}${msg.error.data ? `: ${safeJson(msg.error.data)}` : ''}`)
      pending.reject(err)
      return
    }

    pending.resolve(msg)
    return
  }

  if (msg.method) {
    handleTurnNotification(msg.method, msg.params)
  }
}

async function initializeProtocol() {
  await rpcRequest('initialize', {
    clientInfo: {
      name: 'formax-web-reference',
      version: '0.1.0',
    },
  })
  rpcNotify('initialized', {})
  await refreshThreads()

  if (state.threads.length > 0) {
    await activateThread(state.threads[0].id)
  }

  appendLog('initialize handshake completed', 'info')
}

function connectBridge() {
  setConnectionLabel(`Connecting ${bridgeUrl}`)

  const socket = new WebSocket(bridgeUrl)
  state.socket = socket

  socket.addEventListener('open', () => {
    state.connected = true
    setConnectionLabel(`Connected ${bridgeUrl}`)
    void initializeProtocol().catch((err) => {
      appendLog(`init failed: ${err.message}`, 'error')
    })
  })

  socket.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : String(event.data)
    handleRpcMessage(text)
  })

  socket.addEventListener('close', () => {
    state.connected = false
    state.activeTurnId = null
    setBusy(false)
    setConnectionLabel('Disconnected')
    clearPendingRequests(new Error('bridge socket closed'))
  })

  socket.addEventListener('error', () => {
    appendLog('bridge socket error', 'error')
  })
}

ui.refreshThreadsBtn.addEventListener('click', () => {
  void refreshThreads().catch((err) => appendLog(`refresh threads failed: ${err.message}`, 'error'))
})

ui.newThreadBtn.addEventListener('click', () => {
  void startThreadAndActivate().catch((err) => appendLog(`new thread failed: ${err.message}`, 'error'))
})

ui.composerForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const text = ui.composerInput.value.trim()
  if (!text) return
  ui.composerInput.value = ''
  void startTurn(text).catch((err) => {
    appendLog(`turn start failed: ${err.message}`, 'error')
    setBusy(false)
  })
})

ui.interruptBtn.addEventListener('click', () => {
  if (!state.activeThreadId || !state.activeTurnId) return
  void rpcRequest('turn/interrupt', {
    threadId: state.activeThreadId,
    turnId: state.activeTurnId,
  })
    .then(() => appendLog('interrupt submitted', 'warning'))
    .catch((err) => appendLog(`interrupt failed: ${err.message}`, 'error'))
})

ui.submitInputBtn.addEventListener('click', () => {
  void submitActiveInput().catch((err) => appendLog(`input submit failed: ${err.message}`, 'error'))
})

ui.dismissModalBtn.addEventListener('click', () => {
  state.activeInputId = null
  renderPendingInputs()
  renderInputModal()
})

setBusy(false)
renderThreads()
renderTranscript()
renderPendingInputs()
renderInputModal()
connectBridge()
