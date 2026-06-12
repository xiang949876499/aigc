import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSpeechRecognition } from '../useSpeechRecognition'
import SherpaRecognizer from '../../lib/sherpaRecognizer'

// Mock model manager
vi.mock('../../lib/modelManager', () => ({
  loadModel: vi.fn().mockResolvedValue({
    encoder: new ArrayBuffer(30),
    decoder: new ArrayBuffer(5),
    joiner: new ArrayBuffer(10),
    tokens: 'token1\ntoken2\n'
  }),
  isCached: vi.fn().mockResolvedValue(true)
}))

// Mock SherpaRecognizer with a proper constructor
vi.mock('../../lib/sherpaRecognizer', () => ({
  default: vi.fn().mockImplementation(function () {
    this.initialize = vi.fn()
    this.createStream = vi.fn()
    this.acceptWaveform = vi.fn()
    this.isReady = vi.fn().mockReturnValue(true)
    this.decode = vi.fn()
    this.getResult = vi.fn().mockReturnValue({ text: 'hello', isFinal: true })
    this.reset = vi.fn()
    this.free = vi.fn()
  })
}))

// Mock Web Audio API
const createMockMediaStream = () => ({
  getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }])
})

const createMockAudioContext = () => {
  let onaudioprocess = null
  const processor = {
    get onaudioprocess() { return onaudioprocess },
    set onaudioprocess(fn) { onaudioprocess = fn },
    connect: vi.fn(),
    disconnect: vi.fn()
  }

  return {
    mockProcessor: processor,
    instance: {
      createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
      createScriptProcessor: vi.fn().mockReturnValue(processor),
      destination: {},
      close: vi.fn().mockResolvedValue()
    }
  }
}

describe('useSpeechRecognition', () => {
  let mockAudioCtx

  beforeEach(() => {
    vi.clearAllMocks()
    mockAudioCtx = createMockAudioContext()

    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(createMockMediaStream())
    }

    global.AudioContext = class MockAudioContext {
      constructor() {
        Object.assign(this, mockAudioCtx.instance)
      }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with correct default state', () => {
    const { isListening, isSupported, isLoading, transcript, error } = useSpeechRecognition()

    expect(isListening.value).toBe(false)
    expect(isSupported.value).toBe(false)
    expect(isLoading.value).toBe(false)
    expect(transcript.value).toBe('')
    expect(error.value).toBeNull()
  })

  it('should initialize recognizer', async () => {
    const { initialize, isSupported, isLoading } = useSpeechRecognition()

    await initialize()

    expect(isSupported.value).toBe(true)
    expect(isLoading.value).toBe(false)
  })

  it('should handle initialization failure', async () => {
    const { loadModel } = await import('../../lib/modelManager')
    loadModel.mockRejectedValueOnce(new Error('Network error'))

    const { initialize, isSupported, error, isLoading } = useSpeechRecognition()
    await initialize()

    expect(isSupported.value).toBe(false)
    expect(error.value).toBe('语音识别初始化失败，请刷新页面重试')
    expect(isLoading.value).toBe(false)
  })

  it('should set error when WebAssembly is unavailable', async () => {
    // Temporarily disable WebAssembly
    const originalWebAssembly = global.WebAssembly
    global.WebAssembly = undefined

    const { initialize, error, isSupported } = useSpeechRecognition()
    await initialize()

    expect(error.value).toBe('您的浏览器不支持 WebAssembly，无法使用语音识别')
    expect(isSupported.value).toBe(false)

    global.WebAssembly = originalWebAssembly
  })

  it('should start listening', async () => {
    const { initialize, startListening, isListening } = useSpeechRecognition()

    await initialize()
    await startListening()

    expect(isListening.value).toBe(true)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()
  })

  it('should not start listening when not initialized', async () => {
    const { startListening, isListening, error } = useSpeechRecognition()

    await startListening()

    expect(isListening.value).toBe(false)
    expect(error.value).toBe('语音识别未初始化')
  })

  it('should not start listening again while already listening', async () => {
    const { initialize, startListening, isListening } = useSpeechRecognition()

    await initialize()
    await startListening()

    const streamCallCount = mockAudioCtx.instance.createMediaStreamSource.mock.calls.length

    // Try starting again
    await startListening()

    // Should not create a second audio source
    expect(mockAudioCtx.instance.createMediaStreamSource.mock.calls.length).toBe(streamCallCount)
    expect(isListening.value).toBe(true)
  })

  it('should stop listening', async () => {
    const { initialize, startListening, stopListening, isListening } = useSpeechRecognition()

    await initialize()
    await startListening()
    stopListening()

    expect(isListening.value).toBe(false)
  })

  it('should not stop when not listening', () => {
    const { stopListening, isListening } = useSpeechRecognition()

    // Should not throw
    expect(() => stopListening()).not.toThrow()
    expect(isListening.value).toBe(false)
  })

  it('should handle microphone permission denied', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce({
      name: 'NotAllowedError',
      message: 'Permission denied'
    })

    const { initialize, startListening, error } = useSpeechRecognition()
    await initialize()
    await startListening()

    expect(error.value).toBe('请允许麦克风权限以使用语音识别')
  })

  it('should update transcript when receiving results', async () => {
    const { initialize, startListening, transcript } = useSpeechRecognition()

    await initialize()
    await startListening()

    // Simulate audio processing
    const processor = mockAudioCtx.mockProcessor
    if (processor.onaudioprocess) {
      processor.onaudioprocess({
        inputBuffer: {
          getChannelData: () => new Float32Array(4096)
        }
      })
    }

    expect(transcript.value).toBe('hello')
  })

  it('should handle errors in audio processing', async () => {
    const { initialize, startListening, error } = useSpeechRecognition()
    await initialize()

    // Customize the recognizer instance to throw on getResult
    const mockInstance = SherpaRecognizer.mock.instances[0]
    mockInstance.getResult.mockImplementation(() => {
      throw new Error('Processing failed')
    })

    await startListening()

    // Simulate audio processing that throws
    const processor = mockAudioCtx.mockProcessor
    if (processor.onaudioprocess) {
      processor.onaudioprocess({
        inputBuffer: {
          getChannelData: () => new Float32Array(4096)
        }
      })
    }

    expect(error.value).toBe('语音处理过程中发生错误')
  })

  it('should cleanup resources on stop', async () => {
    const { initialize, startListening, stopListening } = useSpeechRecognition()

    await initialize()
    await startListening()
    stopListening()

    expect(mockAudioCtx.instance.close).toHaveBeenCalled()
  })

  it('should not update transcript when isListening is false', async () => {
    const { initialize, startListening, stopListening, transcript } = useSpeechRecognition()

    await initialize()
    await startListening()
    stopListening()

    // Simulate audio processing after stop
    const processor = mockAudioCtx.mockProcessor
    if (processor.onaudioprocess) {
      processor.onaudioprocess({
        inputBuffer: {
          getChannelData: () => new Float32Array(4096)
        }
      })
    }

    expect(transcript.value).toBe('')
  })
})
