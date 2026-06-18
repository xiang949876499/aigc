import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestComfy } from '../comfy-request.js'

describe('ComfyUI Electron request bridge', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('requests an absolute ComfyUI URL from the main process', async () => {
    const response = await requestComfy({
      url: 'http://192.168.0.131:8188/prompt',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"prompt":{}}',
    })

    expect(global.fetch).toHaveBeenCalledWith('http://192.168.0.131:8188/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"prompt":{}}',
    })
    expect(response.status).toBe(200)
    expect(response.body).toBe('{"ok":true}')
  })

  it('rejects non-http protocols', async () => {
    await expect(requestComfy({ url: 'file:///C:/secret.txt' })).rejects.toThrow(
      'Unsupported ComfyUI URL protocol',
    )
  })
})
