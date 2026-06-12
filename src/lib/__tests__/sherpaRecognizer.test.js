import { describe, it, expect, vi, beforeEach } from 'vitest'
import SherpaRecognizer from '../sherpaRecognizer'

// Mock sherpa-onnx module
class MockStream {
  constructor() {
    this.acceptWaveform = vi.fn()
    this.free = vi.fn()
  }
}

class MockOnlineRecognizer {
  constructor() {
    this.createStream = vi.fn().mockImplementation(() => new MockStream())
    this.isReady = vi.fn().mockReturnValue(true)
    this.decode = vi.fn()
    this.getResult = vi.fn().mockReturnValue({ text: 'test', isFinal: true })
    this.free = vi.fn()
  }
}

vi.mock('sherpa-onnx', () => ({
  default: {
    OnlineRecognizer: vi.fn().mockImplementation(function () {
      return new MockOnlineRecognizer()
    })
  }
}))

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

  describe('initialize', () => {
    it('should initialize with valid config', async () => {
      await recognizer.initialize(mockModelFiles)
      expect(recognizer.recognizer).toBeDefined()
    })

    it('should throw error when model files are missing', async () => {
      await expect(recognizer.initialize({})).rejects.toThrow('Missing required model files')
      await expect(recognizer.initialize(null)).rejects.toThrow('Missing required model files')
      await expect(recognizer.initialize(undefined)).rejects.toThrow('Missing required model files')
    })

    it('should throw error when OnlineRecognizer fails', async () => {
      const sherpa_onnx = await import('sherpa-onnx')
      sherpa_onnx.default.OnlineRecognizer.mockImplementationOnce(function () {
        throw new Error('Invalid model')
      })

      await expect(recognizer.initialize(mockModelFiles)).rejects.toThrow('Failed to create recognizer')
      expect(recognizer.recognizer).toBeNull()
    })
  })

  describe('createStream', () => {
    it('should create audio stream after initialization', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()
      expect(recognizer.stream).toBeDefined()
    })

    it('should throw error when not initialized', () => {
      expect(() => recognizer.createStream()).toThrow('Recognizer not initialized')
    })
  })

  describe('acceptWaveform', () => {
    it('should process audio samples', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()

      const samples = new Float32Array(16000)
      recognizer.acceptWaveform(samples)
      expect(recognizer.stream.acceptWaveform).toHaveBeenCalledWith(16000, samples)
    })

    it('should throw error when stream not created', () => {
      const samples = new Float32Array(16000)
      expect(() => recognizer.acceptWaveform(samples)).toThrow('Stream not created')
    })
  })

  describe('isReady', () => {
    it('should return true when ready', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()
      expect(recognizer.isReady()).toBe(true)
    })

    it('should return false when not initialized', () => {
      expect(recognizer.isReady()).toBe(false)
    })

    it('should return false when stream not created', async () => {
      await recognizer.initialize(mockModelFiles)
      expect(recognizer.isReady()).toBe(false)
    })
  })

  describe('decode', () => {
    it('should call recognizer.decode', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()
      recognizer.decode()
      expect(recognizer.recognizer.decode).toHaveBeenCalled()
    })

    it('should throw error when not ready', () => {
      expect(() => recognizer.decode()).toThrow('Recognizer or stream not ready')
    })
  })

  describe('getResult', () => {
    it('should return recognition result', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()

      const result = recognizer.getResult()
      expect(result).toEqual({ text: 'test', isFinal: true })
    })

    it('should return empty result when not initialized', () => {
      const result = recognizer.getResult()
      expect(result).toEqual({ text: '', isFinal: false })
    })
  })

  describe('reset', () => {
    it('should reset stream', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()

      const oldStream = recognizer.stream
      recognizer.reset()

      expect(oldStream.free).toHaveBeenCalled()
      expect(recognizer.stream).toBeDefined()
      expect(recognizer.stream).not.toBe(oldStream)
    })

    it('should throw error when not initialized', () => {
      expect(() => recognizer.reset()).toThrow('Recognizer not initialized')
    })
  })

  describe('free', () => {
    it('should free resources', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()

      recognizer.free()
      expect(recognizer.recognizer).toBeNull()
      expect(recognizer.stream).toBeNull()
    })

    it('should be safe to call twice', async () => {
      await recognizer.initialize(mockModelFiles)
      recognizer.createStream()

      recognizer.free()
      expect(() => recognizer.free()).not.toThrow()
    })
  })
})
