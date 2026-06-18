import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpeechRecognition } from '../useSpeechRecognition.js'

function createAudioContext() {
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  }
  return {
    processor,
    context: {
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
      createScriptProcessor: vi.fn(() => processor),
      destination: {},
      close: vi.fn(async () => {}),
    },
  }
}

describe('useSpeechRecognition Electron bridge', () => {
  beforeEach(() => {
    const { processor, context } = createAudioContext()
    global.AudioContext = class MockAudioContext {
      constructor() {
        return context
      }
    }
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    }
    window.electronAPI = {
      speech: {
        initialize: vi.fn(async () => ({ supported: true })),
        start: vi.fn(async () => undefined),
        process: vi.fn(async () => ({ text: '' })),
        stop: vi.fn(async () => ({ text: '你好' })),
        free: vi.fn(async () => undefined),
      },
    }
    window.__speechProcessor = processor
  })

  it('initializes, records microphone samples, and applies the FunASR transcript after stop', async () => {
    const speech = useSpeechRecognition()

    await speech.initialize()
    await speech.startListening()
    window.__speechProcessor.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array([0.1, 0.2]) },
    })
    await vi.waitFor(() => expect(window.electronAPI.speech.process).toHaveBeenCalled())
    await speech.stopListening()

    expect(speech.isSupported.value).toBe(true)
    expect(window.electronAPI.speech.stop).toHaveBeenCalledWith({ transcribe: true })
    expect(speech.transcript.value).toBe('你好')
  })
})
