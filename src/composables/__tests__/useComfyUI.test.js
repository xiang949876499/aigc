import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useComfyUI } from '../useComfyUI'

function mockJsonResponse(data, { ok = true, status = 200 } = {}) {
  const body = data == null ? '' : JSON.stringify(data)
  return {
    ok,
    status,
    text: async () => body,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useComfyUI', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
    delete window.electronAPI
  })

  it('initial state is idle', () => {
    const { isGenerating, result, error } = useComfyUI()
    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBeNull()
  })

  it('submit resolves with image url when polling returns output', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-123' }))
      .mockResolvedValueOnce(mockJsonResponse({
        'test-id-123': {
          outputs: {
            '9': {
              images: [{ filename: 'output.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '3': {} })
    expect(isGenerating.value).toBe(true)

    await vi.runAllTimersAsync()
    await submitPromise

    expect(isGenerating.value).toBe(false)
    expect(error.value).toBeNull()
    expect(result.value).toEqual({
      imageURL: 'http://127.0.0.1:8188/view?filename=output.png&subfolder=&type=output',
      mediaType: 'image',
    })
  })

  it('routes absolute ComfyUI requests through the Electron bridge when available', async () => {
    const bridgeRequest = vi.fn(async ({ url }) => {
      if (url === 'http://192.168.0.131:8188/prompt') {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt_id: 'bridge-id' }),
        }
      }

      if (url === 'http://192.168.0.131:8188/history/bridge-id') {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            'bridge-id': {
              outputs: {
                '9': {
                  images: [{ filename: 'bridge.png', subfolder: '', type: 'output' }],
                },
              },
              status: { completed: true },
            },
          }),
        }
      }

      throw new Error(`Unexpected bridge URL: ${url}`)
    })
    window.electronAPI = { comfy: { request: bridgeRequest } }

    const { result, error, submit } = useComfyUI({
      baseURL: 'http://192.168.0.131:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '3': {} })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(global.fetch).not.toHaveBeenCalled()
    expect(bridgeRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: 'http://192.168.0.131:8188/prompt',
      method: 'POST',
    }))
    expect(bridgeRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: 'http://192.168.0.131:8188/history/bridge-id',
      method: 'GET',
    }))
    expect(error.value).toBeNull()
    expect(result.value).toEqual({
      imageURL: 'http://192.168.0.131:8188/view?filename=bridge.png&subfolder=&type=output',
      mediaType: 'image',
    })
  })

  it('reports prompt id as soon as ComfyUI accepts a prompt', async () => {
    const onPromptId = vi.fn()
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'accepted-id' }))
      .mockResolvedValueOnce(mockJsonResponse({
        'accepted-id': {
          outputs: {
            '10': {
              images: [{ filename: 'accepted.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { submit } = useComfyUI({
      baseURL: '/api/comfyui',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '3': {} }, { onPromptId })

    await vi.waitFor(() => {
      expect(onPromptId).toHaveBeenCalledWith('accepted-id')
    })

    await vi.runAllTimersAsync()
    await submitPromise
  })

  it('resolves a completed prompt result directly from history', async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse({
      'completed-id': {
        outputs: {
          '10': {
            images: [{ filename: 'completed.png', subfolder: '', type: 'output' }],
          },
        },
        status: { completed: true },
      },
    }))

    const { getPromptResult } = useComfyUI({
      baseURL: '/api/comfyui',
    })

    await expect(getPromptResult('completed-id')).resolves.toEqual({
      imageURL: '/api/comfyui/view?filename=completed.png&subfolder=&type=output',
      mediaType: 'image',
    })
  })

  it('finds the latest completed prompt result by prompt text', async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse({
      old: {
        prompt: [0, 'old', { '17': { inputs: { prompt: '迪丽热巴' } } }, { create_time: 1 }],
        outputs: {
          '10': {
            images: [{ filename: 'old.png', subfolder: '', type: 'output' }],
          },
        },
        status: { completed: true },
      },
      latest: {
        prompt: [1, 'latest', { '17': { inputs: { prompt: '迪丽热巴' } } }, { create_time: 2 }],
        outputs: {
          '10': {
            images: [{ filename: 'latest.png', subfolder: '', type: 'output' }],
          },
        },
        status: { completed: true },
      },
    }))

    const { findPromptResultByText } = useComfyUI({
      baseURL: '/api/comfyui',
    })

    await expect(findPromptResultByText('迪丽热巴')).resolves.toEqual({
      promptId: 'latest',
      media: {
        imageURL: '/api/comfyui/view?filename=latest.png&subfolder=&type=output',
        mediaType: 'image',
      },
    })
  })

  it('supports two consecutive successful submissions on the same instance', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'first-id' }))
      .mockResolvedValueOnce(mockJsonResponse({
        'first-id': {
          outputs: {
            '9': {
              images: [{ filename: 'first.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'second-id' }))
      .mockResolvedValueOnce(mockJsonResponse({
        'second-id': {
          outputs: {
            '9': {
              images: [{ filename: 'second.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const firstSubmit = submit({ '3': {} })
    await vi.runAllTimersAsync()
    await firstSubmit

    expect(isGenerating.value).toBe(false)
    expect(result.value?.imageURL).toContain('first.png')

    const secondSubmit = submit({ '3': {} })
    await vi.runAllTimersAsync()
    await secondSubmit

    expect(isGenerating.value).toBe(false)
    expect(error.value).toBeNull()
    expect(result.value?.imageURL).toContain('second.png')
  })

  it('ignores a stale polling response from the previous submission', async () => {
    vi.useRealTimers()
    const staleFirstHistory = deferred()
    const secondHistory = deferred()

    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'first-id' }))
      .mockImplementationOnce(() => staleFirstHistory.promise)
      .mockResolvedValueOnce(mockJsonResponse({
        'first-id': {
          outputs: {
            '9': {
              images: [{ filename: 'first.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'second-id' }))
      .mockImplementationOnce(() => secondHistory.promise)

    const { isGenerating, result, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 5,
      pollMaxTries: 5,
    })

    const firstSubmit = submit({ '3': {} })
    await firstSubmit

    const secondSubmit = submit({ '3': {} })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(isGenerating.value).toBe(true)

    staleFirstHistory.resolve(mockJsonResponse({
      'first-id': {
        outputs: {
          '9': {
            images: [{ filename: 'first.png', subfolder: '', type: 'output' }],
          },
        },
        status: { completed: true },
      },
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(isGenerating.value).toBe(true)

    secondHistory.resolve(mockJsonResponse({
      'second-id': {
        outputs: {
          '9': {
            images: [{ filename: 'second.png', subfolder: '', type: 'output' }],
          },
        },
        status: { completed: true },
      },
    }))
    await secondSubmit

    expect(isGenerating.value).toBe(false)
    expect(result.value?.imageURL).toContain('second.png')
  })

  it('sets an error when polling exceeds max tries', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-456' }))
      .mockResolvedValue(mockJsonResponse({ 'test-id-456': { outputs: {}, status: { completed: false } } }))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 3,
    })

    const submitPromise = submit({ '3': {} })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBeTruthy()
  })

  it('recovers result from final history check when polling just timed out', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-timeout-recover' }))
      .mockResolvedValueOnce(mockJsonResponse({ 'test-id-timeout-recover': { outputs: {}, status: { completed: false } } }))
      .mockResolvedValueOnce(mockJsonResponse({
        'test-id-timeout-recover': {
          outputs: {
            '9': {
              images: [{ filename: 'late-output.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 2,
    })

    const submitPromise = submit({ '3': {} })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(isGenerating.value).toBe(false)
    expect(error.value).toBeNull()
    expect(result.value).toEqual({
      imageURL: 'http://127.0.0.1:8188/view?filename=late-output.png&subfolder=&type=output',
      mediaType: 'image',
    })
  })

  it('recovers a timed-out submission from full history by prompt text', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'second-id' }))
      .mockResolvedValueOnce(mockJsonResponse({ 'second-id': { outputs: {}, status: { completed: false } } }))
      .mockResolvedValueOnce(mockJsonResponse({}))
      .mockResolvedValueOnce(mockJsonResponse({
        'second-id': {
          prompt: [1, 'second-id', { '17': { inputs: { prompt: 'second prompt' } } }, { create_time: 2 }],
          outputs: {
            '9': {
              images: [{ filename: 'second-output.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 2,
    })

    const submitPromise = submit({ '3': {} }, { fallbackText: 'second prompt' })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(isGenerating.value).toBe(false)
    expect(error.value).toBeNull()
    expect(result.value).toEqual({
      imageURL: 'http://127.0.0.1:8188/view?filename=second-output.png&subfolder=&type=output',
      mediaType: 'image',
    })
  })

  it('handles submit network failures', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network Error'))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    await submit({ '3': {} })

    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBe('Network Error')
  })

  it('formats browser fetch failures with a ComfyUI hint', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Failed to fetch'))

    const { uploadImage } = useComfyUI({
      baseURL: '/api/comfyui',
    })

    const file = new File(['test'], 'example.png', { type: 'image/png' })
    await expect(uploadImage(file)).rejects.toThrow('无法连接到 ComfyUI 服务(/api/comfyui)')
  })

  it('cancel stops polling and keeps result/error empty', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-789' }))
      .mockResolvedValue(mockJsonResponse({ 'test-id-789': { outputs: {}, status: { completed: false } } }))

    const { isGenerating, result, error, cancel, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    submit({ '3': {} })
    await Promise.resolve()

    cancel()
    expect(isGenerating.value).toBe(false)

    await vi.runAllTimersAsync()
    expect(result.value).toBeNull()
    expect(error.value).toBeNull()
  })

  it('sets prompt submit error for non-2xx response', async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse({}, { ok: false, status: 500 }))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    await submit({ '3': {} })

    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toContain('500')
  })

  it('surfaces non-json ComfyUI error responses instead of masking them as parse errors', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request: invalid prompt',
    })

    const { error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
    })

    await submit({ '3': {} })

    expect(error.value).toContain('400')
    expect(error.value).toContain('Bad Request: invalid prompt')
    expect(error.value).not.toContain('无效的 JSON')
  })

  it('includes a response snippet when a successful ComfyUI response is not JSON', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html>ComfyUI frontend</html>',
    })

    const { error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
    })

    await submit({ '3': {} })

    expect(error.value).toContain('无效的 JSON 数据(200)')
    expect(error.value).toContain('<html>ComfyUI frontend</html>')
  })

  it('uploadImage returns payload when API succeeds', async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse({ name: 'example.png', subfolder: '', type: 'input' }))

    const { uploadImage } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
    })

    const file = new File(['test'], 'example.png', { type: 'image/png' })
    const payload = await uploadImage(file)

    expect(payload).toEqual({ name: 'example.png', subfolder: '', type: 'input' })
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8188/upload/image',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('treats empty history response as not ready during polling', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-empty-history' }))
      .mockResolvedValueOnce(mockJsonResponse(null))
      .mockResolvedValueOnce(mockJsonResponse({
        'test-id-empty-history': {
          outputs: {
            '9': {
              images: [{ filename: 'output.png', subfolder: '', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { result, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '3': {} })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(result.value?.imageURL).toContain('output.png')
  })

  it('shows friendly error when prompt submit returns empty body', async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse(null, { ok: false, status: 502 }))

    const { error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
    })

    await submit({ '3': {} })

    expect(error.value).toContain('无法连接到 ComfyUI 服务(http://127.0.0.1:8188)')
  })

  it('submit resolves with video url when history returns videos output', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-video' }))
      .mockResolvedValueOnce(mockJsonResponse({
        'test-id-video': {
          outputs: {
            '75': {
              videos: [{ filename: 'LTX-2_00001_.mp4', subfolder: 'video', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { result, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '75': {} })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(result.value).toEqual({
      imageURL: 'http://127.0.0.1:8188/view?filename=LTX-2_00001_.mp4&subfolder=video&type=output',
      mediaType: 'video',
    })
  })

  it('treats mp4 files returned in the images field as video', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-save-video' }))
      .mockResolvedValueOnce(mockJsonResponse({
        'test-id-save-video': {
          outputs: {
            '75': {
              images: [{ filename: 'LTX-2_00021_.mp4', subfolder: 'video', type: 'output' }],
              animated: [true],
            },
          },
          status: { completed: true },
        },
      }))

    const { result, submit } = useComfyUI({
      baseURL: '/api/comfyui-video',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '75': {} })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(result.value).toEqual({
      imageURL: '/api/comfyui-video/view?filename=LTX-2_00021_.mp4&subfolder=video&type=output',
      mediaType: 'video',
    })
  })

  it('uses per-call baseURL for video submit polling and output URLs', async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ prompt_id: 'test-id-video-server' }))
      .mockResolvedValueOnce(mockJsonResponse({
        'test-id-video-server': {
          outputs: {
            '75': {
              videos: [{ filename: 'video-server.mp4', subfolder: 'video', type: 'output' }],
            },
          },
          status: { completed: true },
        },
      }))

    const { result, submit } = useComfyUI({
      baseURL: '/api/comfyui',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '75': {} }, { baseURL: '/api/comfyui-video' })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/comfyui-video/prompt',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/comfyui-video/history/test-id-video-server')
    expect(result.value).toEqual({
      imageURL: '/api/comfyui-video/view?filename=video-server.mp4&subfolder=video&type=output',
      mediaType: 'video',
    })
  })

  it('uses per-call baseURL when uploading an image', async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse({ name: 'video-input.png', subfolder: '', type: 'input' }))

    const { uploadImage } = useComfyUI({
      baseURL: '/api/comfyui',
    })

    const file = new File(['test'], 'video-input.png', { type: 'image/png' })
    await uploadImage(file, { baseURL: '/api/comfyui-video' })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/comfyui-video/upload/image',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uploadImage throws service error when API fails', async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse({ error: 'bad image' }, { ok: false, status: 400 }))

    const { uploadImage } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
    })

    const file = new File(['test'], 'broken.png', { type: 'image/png' })
    await expect(uploadImage(file)).rejects.toThrow('bad image')
  })
})
