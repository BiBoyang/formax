import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { createTarGz } from './nodeArchive'

type FakeChild = EventEmitter & { once: EventEmitter['once'] }

describe('createTarGz', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('throws when required args are missing', async () => {
    await expect(createTarGz({ sourceDir: '', outPath: '/tmp/x.tgz' })).rejects.toThrow('Missing sourceDir')
    await expect(createTarGz({ sourceDir: '/tmp/x', outPath: '' })).rejects.toThrow('Missing outPath')
  })

  it('rejects on spawn error', async () => {
    const child = new EventEmitter() as FakeChild
    spawnMock.mockReturnValueOnce(child)

    const p = createTarGz({ sourceDir: '/tmp/src', outPath: '/tmp/out.tgz' })
    child.emit('error', new Error('boom'))
    await expect(p).rejects.toThrow('boom')
  })

  it('rejects when tar exits with non-zero code', async () => {
    const child = new EventEmitter() as FakeChild
    spawnMock.mockReturnValueOnce(child)

    const p = createTarGz({ sourceDir: '/tmp/src', outPath: '/tmp/out.tgz' })
    child.emit('exit', 2, null)
    await expect(p).rejects.toThrow('tar exited with code 2')
  })

  it('rejects when tar exits with signal', async () => {
    const child = new EventEmitter() as FakeChild
    spawnMock.mockReturnValueOnce(child)

    const p = createTarGz({ sourceDir: '/tmp/src', outPath: '/tmp/out.tgz' })
    child.emit('exit', 0, 'SIGTERM')
    await expect(p).rejects.toThrow('tar exited with signal SIGTERM')
  })

  it('resolves when tar exits with code 0', async () => {
    const child = new EventEmitter() as FakeChild
    spawnMock.mockReturnValueOnce(child)

    const p = createTarGz({ sourceDir: '/tmp/src', outPath: '/tmp/out.tgz' })
    child.emit('exit', 0, null)
    await expect(p).resolves.toBeUndefined()
  })
})
