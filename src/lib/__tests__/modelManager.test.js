import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadModel, clearCache, isCached } from '../modelManager'

// Helper to create mock IDB request
function createMockRequest(result) {
  const request = { result, error: null, onsuccess: null, onerror: null }
  queueMicrotask(() => request.onsuccess?.())
  return request
}

// Mock IndexedDB
const mockIDBObjectStore = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}

const mockIDBTransaction = {
  objectStore: vi.fn().mockReturnValue(mockIDBObjectStore)
}

const mockIDBDatabase = {
  transaction: vi.fn().mockReturnValue(mockIDBTransaction),
  objectStoreNames: { contains: vi.fn().mockReturnValue(true) }
}

global.indexedDB = {
  open: vi.fn(() => createMockRequest(mockIDBDatabase))
}

describe('ModelManager', () => {
  const mockCachedModel = {
    encoder: new ArrayBuffer(30),
    decoder: new ArrayBuffer(5),
    joiner: new ArrayBuffer(10),
    tokens: 'cached-tokens'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should check if model is cached (false)', async () => {
    mockIDBObjectStore.get.mockImplementation(() => createMockRequest(null))

    const cached = await isCached()
    expect(cached).toBe(false)
  })

  it('should check if model is cached (true)', async () => {
    mockIDBObjectStore.get.mockImplementation(() => createMockRequest(mockCachedModel))

    const cached = await isCached()
    expect(cached).toBe(true)
  })

  it('should load model from cache when available', async () => {
    mockIDBObjectStore.get.mockImplementation(() => createMockRequest(mockCachedModel))

    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const model = await loadModel()
    expect(model).toEqual(mockCachedModel)
    expect(fetchSpy).not.toHaveBeenCalled() // fetch should not be called when cache hit
  })

  it('should load model from files when cache is empty', async () => {
    mockIDBObjectStore.get.mockImplementation(() => createMockRequest(null))
    mockIDBObjectStore.put.mockImplementation(() => createMockRequest(undefined))

    // Mock fetch for local files
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(30)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(5)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('tokens') })
    global.fetch = fetchMock

    const model = await loadModel()
    expect(model).toBeDefined()
    expect(model.encoder).toBeInstanceOf(ArrayBuffer)
    expect(model.decoder).toBeInstanceOf(ArrayBuffer)
    expect(model.joiner).toBeInstanceOf(ArrayBuffer)
    expect(typeof model.tokens).toBe('string')
    expect(fetchMock).toHaveBeenCalledTimes(4)

    delete global.fetch
  })

  it('should throw error when fetch fails', async () => {
    mockIDBObjectStore.get.mockImplementation(() => createMockRequest(null))

    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'))
    global.fetch = fetchMock

    await expect(loadModel()).rejects.toThrow('Network error')

    delete global.fetch
  })

  it('should clear cache', async () => {
    mockIDBObjectStore.delete.mockImplementation(() => createMockRequest(undefined))

    await clearCache()
    expect(mockIDBObjectStore.delete).toHaveBeenCalled()
  })

  it('should return false when IndexedDB is unavailable', async () => {
    const originalIndexedDB = global.indexedDB
    global.indexedDB = undefined

    const cached = await isCached()
    expect(cached).toBe(false)

    global.indexedDB = originalIndexedDB
  })
})
