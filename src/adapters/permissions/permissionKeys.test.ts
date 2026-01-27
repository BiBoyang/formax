import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFsWritePermissionKey, buildToolPermissionKey, isFsWriteToolName } from './permissionKeys.js'

describe('permissionKeys', () => {
  describe('isFsWriteToolName', () => {
    it('accepts known fs-write tool names', () => {
      expect(isFsWriteToolName('Write')).toBe(true)
      expect(isFsWriteToolName('Edit')).toBe(true)
      expect(isFsWriteToolName('NotebookEdit')).toBe(true)
    })

    it('rejects other values', () => {
      expect(isFsWriteToolName('')).toBe(false)
      expect(isFsWriteToolName('Bash')).toBe(false)
      expect(isFsWriteToolName('write')).toBe(false)
    })
  })

  describe('buildToolPermissionKey', () => {
    it('trims tool name and inner value', () => {
      expect(buildToolPermissionKey('  Bash ', ' ls:*  ')).toBe('Bash(ls:*)')
    })

    it('stringifies falsy values', () => {
      expect(buildToolPermissionKey(' ', '')).toBe('()')
      expect(buildToolPermissionKey('', '  ')).toBe('()')
    })
  })

  describe('buildFsWritePermissionKey', () => {
    it('uses an absolute normalized path (cwd-relative)', () => {
      const cwd = path.join(path.sep, 'tmp', 'formax-permissionKeys')
      expect(buildFsWritePermissionKey({ toolName: 'Write', filePath: './a.txt', cwd })).toBe(
        `Write(${path.join(cwd, 'a.txt')})`,
      )
    })

    it('expands ~ paths', () => {
      const home = os.homedir()
      expect(buildFsWritePermissionKey({ toolName: 'Edit', filePath: '~/x.txt', cwd: '/tmp' })).toBe(
        `Edit(${path.join(home, 'x.txt')})`,
      )
    })
  })
})

