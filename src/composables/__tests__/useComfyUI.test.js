import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useComfyUI } from '../useComfyUI'

describe('useComfyUI', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('初始状态：isGenerating 为 false，result 和 error 为 null', () => {
    const { isGenerating, result, error } = useComfyUI()
    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBeNull()
  })

  it('submit 成功时：提交 workflow 并在轮询到结果后设置 result', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: 'test-id-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'test-id-123': {
            outputs: {
              '9': {
                images: [{ filename: 'output.png', subfolder: '', type: 'output' }],
              },
            },
            status: { completed: true },
          },
        }),
      })

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
    })
  })

  it('超过最大轮询次数时：设置超时错误', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: 'test-id-456' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ 'test-id-456': { outputs: {}, status: { completed: false } } }),
      })

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
    expect(error.value).toBe('生成超时，请重试')
  })

  it('网络错误时：设置错误信息并停止生成状态', async () => {
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

  it('cancel 调用后：isGenerating 变为 false 且轮询停止', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: 'test-id-789' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ 'test-id-789': { outputs: {}, status: { completed: false } } }),
      })

    const { isGenerating, result, error, cancel, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    submit({ '3': {} })
    await Promise.resolve()

    cancel()
    expect(isGenerating.value).toBe(false)

    // 确认取消后定时器不再触发状态变更
    await vi.runAllTimersAsync()
    expect(result.value).toBeNull()
    expect(error.value).toBeNull()
  })

  it('POST /prompt 返回非 2xx 时：设置错误信息', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    await submit({ '3': {} })

    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBe('提交失败：500')
  })
})
