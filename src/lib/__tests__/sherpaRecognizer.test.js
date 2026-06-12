import { describe, it, expect, vi, beforeEach } from 'vitest'
import SherpaRecognizer from '../sherpaRecognizer'

// Mock sherpa-onnx module
vi.mock('sherpa-onnx', () => {
  class MockOnlineRecognizer {
    constructor() {
      this.createStream = vi.fn().mockReturnValue({
        acceptWaveform: vi.fn(),
        free: vi.fn()
      })
      this.isReady = vi.fn().mockReturnValue(true)
      this.decode = vi.fn()
      this.getResult = vi.fn().mockReturnValue({ text: 'test', isFinal: true })
      this.free = vi.fn()
    }
  }

  return {
    default: {
      OnlineRecognizer: vi.fn().mockImplementation(function () {
        return new MockOnlineRecognizer()
      })
    }
  }
})

describe('SherpaRecognizer', () => {
  let recognizer
  const mockModelFiles = {
    encoder: new ArrayBuffer(30),
    decoder: new ArrayBuffer(5),
    joiner: new ArrayBuffer(10),
    tokens: 'token1\ntoken2\n'
  }

  beforeEach(() => {
    recognizer = new SherpaRecognizer()
  })

  it('should initialize with valid config', async () => {
    await recognizer.initialize(mockModelFiles)
    expect(recognizer.recognizer).toBeDefined()
  })

  it('should create audio stream', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()
    expect(recognizer.stream).toBeDefined()
  })

  it('should process audio samples', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()

    const samples = new Float32Array(16000) // 1 second
    recognizer.acceptWaveform(samples)

    const result = recognizer.getResult()
    expect(result).toBeDefined()
    expect(result.text).toBe('test')
  })

  it('should reset stream', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()

    recognizer.reset()
    expect(recognizer.stream).toBeDefined()
  })

  it('should free resources', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()

    recognizer.free()
    expect(recognizer.recognizer).toBeNull()
    expect(recognizer.stream).toBeNull()
  })
})
