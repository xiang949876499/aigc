import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSpeechRecognition } from '../useSpeechRecognition'

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

// Mock SherpaRecognizer
vi.mock('../../lib/sherpaRecognizer', () => {
  return {
    default: class MockSherpaRecognizer {
      constructor() {
        this.initialize = vi.fn()
        this.createStream = vi.fn()
        this.acceptWaveform = vi.fn()
        this.isReady = vi.fn().mockReturnValue(true)
        this.decode = vi.fn()
        this.getResult = vi.fn().mockReturnValue({ text: 'hello', isFinal: true })
        this.reset = vi.fn()
        this.free = vi.fn()
      }
    }
  }
})

// Mock Web Audio API
const mockMediaStream = {
  getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }])
}

const mockAudioContext = {
  createMediaStreamSource: vi.fn().mockReturnValue({
    connect: vi.fn()
  }),
  createScriptProcessor: vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null
  }),
  destination: {},
  close: vi.fn()
}

global.navigator.mediaDevices = {
  getUserMedia: vi.fn().mockResolvedValue(mockMediaStream)
}

global.AudioContext = class MockAudioContext {
  constructor() {
    Object.assign(this, mockAudioContext)
  }
}

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('should start listening', async () => {
    const { initialize, startListening, isListening } = useSpeechRecognition()

    await initialize()
    await startListening()

    expect(isListening.value).toBe(true)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()
  })

  it('should stop listening', async () => {
    const { initialize, startListening, stopListening, isListening } = useSpeechRecognition()

    await initialize()
    await startListening()
    stopListening()

    expect(isListening.value).toBe(false)
  })

  it('should handle microphone permission denied', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
      new Error('Permission denied')
    )

    const { initialize, startListening, error } = useSpeechRecognition()
    await initialize()

    await startListening()

    expect(error.value).toBeTruthy()
    expect(error.value).toContain('麦克风权限')
  })

  it('should update transcript when receiving results', async () => {
    const { initialize, startListening, transcript } = useSpeechRecognition()

    await initialize()
    await startListening()

    // Simulate audio processing
    const processor = mockAudioContext.createScriptProcessor()
    if (processor.onaudioprocess) {
      processor.onaudioprocess({
        inputBuffer: {
          getChannelData: () => new Float32Array(4096)
        }
      })
    }

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(transcript.value).toBeTruthy()
  })
})
