import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { saveRemoteAsset } from '../asset-store.js'

function mockResponse(body, headers = {}) {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => headers[name.toLowerCase()] || '',
    },
    arrayBuffer: async () => bytes.buffer,
  }
}

describe('asset store', () => {
  it('saves a remote generated image under a stable local assets directory', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-assets-'))
    const fetchImpl = vi.fn(async () => mockResponse('png-bytes', { 'content-type': 'image/png' }))

    const saved = await saveRemoteAsset({
      url: 'http://127.0.0.1:8188/view?filename=ComfyUI_00001_.png&type=output',
      id: 'assistant-one',
      kind: 'generated',
      mediaType: 'image',
      baseDir,
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8188/view?filename=ComfyUI_00001_.png&type=output')
    expect(saved.relativePath).toMatch(/^generated[\\/]+assistant-one-\d+\.png$/)
    expect(saved.fileURL).toMatch(/^file:\/\/\//)
    await expect(fs.readFile(saved.filePath, 'utf8')).resolves.toBe('png-bytes')
  })
})
