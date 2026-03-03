import { describe, expect, it } from 'vitest'
import {
  getSessionMessages as apiGetSessionMessages,
  listSessions as apiListSessions,
  query as apiQuery,
  unstable_v2_createSession as apiCreateSession,
  unstable_v2_prompt as apiPrompt,
  unstable_v2_resumeSession as apiResumeSession,
} from './api.js'
import { query } from './query.js'
import {
  getSessionMessages,
  listSessions,
} from './sessions.js'
import {
  unstable_v2_createSession,
  unstable_v2_prompt,
  unstable_v2_resumeSession,
} from './v2.js'

describe('sdk api entrypoint', () => {
  it('re-exports query, session-query, and v2 session functions from one place', () => {
    expect(apiQuery).toBe(query)
    expect(apiListSessions).toBe(listSessions)
    expect(apiGetSessionMessages).toBe(getSessionMessages)
    expect(apiCreateSession).toBe(unstable_v2_createSession)
    expect(apiResumeSession).toBe(unstable_v2_resumeSession)
    expect(apiPrompt).toBe(unstable_v2_prompt)
  })
})
