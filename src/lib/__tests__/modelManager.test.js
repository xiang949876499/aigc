import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadModel, clearCache, isCached } from '../modelManager'

// Helper to create a mock IDB request that resolves asynchronously
function createMockRequest(result = null) {
  const request = {
    result,
    error: null,
    onsuccess: null,
    onerror: null
  }
  // Use queueMicrotask to simulate async IDB behavior
  queueMicrotask(() => {
    request.onsuccess?.()
  })
  return request
}

// Mock IndexedDB
const mockIDBObjectStore = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}

const mockIDBTransaction = {
  objectStore: vi.fn(() => mockIDBObjectStore),
  oncomplete: null,
  onerror: null
}

const mockIDBDatabase = {
  transaction: vi.fn(() => mockIDBTransaction),
  objectStoreNames: { contains: vi.fn(() => true) }
}

// Mock global indexedDB
global.indexedDB = {
  open: vi.fn(() => createMockRequest(mockIDBDatabase))
}

describe('ModelManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should check if model is cached', async () => {
    mockIDBObjectStore.get.mockImplementation(() => createMockRequest(null))

    const cached = await isCached()
    expect(cached).toBe(false)
  })

  it('should load model from files', async () => {
    // Mock fetch for local files
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(30)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(5)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('tokens') })

    // Mock cache miss
    mockIDBObjectStore.get.mockImplementation(() => createMockRequest(null))
    // Mock cache save
    mockIDBObjectStore.put.mockImplementation(() => createMockRequest(undefined))

    const model = await loadModel()
    expect(model).toBeDefined()
    expect(model.encoder).toBeInstanceOf(ArrayBuffer)
    expect(model.decoder).toBeInstanceOf(ArrayBuffer)
    expect(model.joiner).toBeInstanceOf(ArrayBuffer)
    expect(typeof model.tokens).toBe('string')
  })

  it('should clear cache', async () => {
    mockIDBObjectStore.delete.mockImplementation(() => createMockRequest(undefined))

    await clearCache()
    expect(mockIDBObjectStore.delete).toHaveBeenCalled()
  })
})
