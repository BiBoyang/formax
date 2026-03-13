import { afterEach, describe, expect, it } from 'vitest'
import {
  addWorkspaceSessionDirectory,
  deleteWorkspaceSessionDirectory,
  listWorkspaceSessionDirectories,
  resetWorkspaceSessionForTests,
} from './workspaceSession.js'

describe('workspaceSession', () => {
  afterEach(() => {
    resetWorkspaceSessionForTests()
  })

  it('adds and lists workspace session directories per project root', () => {
    addWorkspaceSessionDirectory('/repo', '/repo/a')
    addWorkspaceSessionDirectory('/repo', '/repo/b')
    expect(listWorkspaceSessionDirectories('/repo')).toEqual([{ dir: '/repo/a' }, { dir: '/repo/b' }])
  })

  it('ignores empty project root or directory and deduplicates entries', () => {
    addWorkspaceSessionDirectory('', '/repo/a')
    addWorkspaceSessionDirectory('/repo', '')
    addWorkspaceSessionDirectory('/repo', '   ')
    addWorkspaceSessionDirectory('/repo', '/repo/a')
    addWorkspaceSessionDirectory('/repo', '/repo/a')
    expect(listWorkspaceSessionDirectories('/repo')).toEqual([{ dir: '/repo/a' }])
  })

  it('deletes one directory and removes key when the last entry is deleted', () => {
    addWorkspaceSessionDirectory('/repo', '/repo/a')
    addWorkspaceSessionDirectory('/repo', '/repo/b')
    deleteWorkspaceSessionDirectory('/repo', '/repo/a')
    expect(listWorkspaceSessionDirectories('/repo')).toEqual([{ dir: '/repo/b' }])
    deleteWorkspaceSessionDirectory('/repo', '/repo/b')
    expect(listWorkspaceSessionDirectories('/repo')).toEqual([])
  })

  it('is resilient to invalid delete/list inputs', () => {
    addWorkspaceSessionDirectory('/repo', '/repo/a')
    deleteWorkspaceSessionDirectory('', '/repo/a')
    deleteWorkspaceSessionDirectory('/repo', '')
    deleteWorkspaceSessionDirectory('/repo', '   ')
    expect(listWorkspaceSessionDirectories('')).toEqual([])
    expect(listWorkspaceSessionDirectories('/repo')).toEqual([{ dir: '/repo/a' }])
  })

  it('handles deleting from a project root that has no session entries', () => {
    deleteWorkspaceSessionDirectory('/missing', '/missing/a')
    expect(listWorkspaceSessionDirectories('/missing')).toEqual([])
  })
})
