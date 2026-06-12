import { ref, onBeforeUnmount } from 'vue'
import { loadModel } from '../lib/modelManager.js'
import SherpaRecognizer from '../lib/sherpaRecognizer.js'

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096
const CHANNELS = 1

export function useSpeechRecognition() {
  const isListening = ref(false)
  const isSupported = ref(false)
  const isLoading = ref(false)
  const transcript = ref('')
  const error = ref(null)

  let recognizer = null
  let audioContext = null
  let mediaStream = null
  let processor = null
  let isDisposed = false

  // Check if WebAssembly is supported
  function checkSupport() {
    try {
      return typeof WebAssembly === 'object'
    } catch {
      console.debug('WebAssembly support check failed')
      return false
    }
  }

  // Initialize the recognizer
  async function initialize() {
    if (!checkSupport()) {
      error.value = '您的浏览器不支持 WebAssembly，无法使用语音识别'
      return
    }

    isLoading.value = true
    error.value = null

    try {
      // Load model files
      const modelFiles = await loadModel()

      // Initialize Sherpa-ONNX recognizer
      recognizer = new SherpaRecognizer()
      await recognizer.initialize(modelFiles)

      isSupported.value = true
    } catch (e) {
      console.error('Failed to initialize speech recognition:', e)
      error.value = '语音识别初始化失败，请刷新页面重试'
      isSupported.value = false
    } finally {
      isLoading.value = false
    }
  }

  // Start listening to microphone
  async function startListening() {
    if (!isSupported.value) {
      error.value = '语音识别未初始化'
      return
    }

    if (isListening.value) {
      return
    }

    error.value = null

    try {
      // Create recognition stream
      recognizer.createStream()

      // Get microphone access
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: CHANNELS,
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      // Create audio context
      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })

      // Create audio source
      const source = audioContext.createMediaStreamSource(mediaStream)

      // Create script processor
      processor = audioContext.createScriptProcessor(BUFFER_SIZE, CHANNELS, CHANNELS)

      // Process audio data
      processor.onaudioprocess = (e) => {
        if (!isListening.value) return

        try {
          const samples = e.inputBuffer.getChannelData(0)

          // Feed audio to recognizer
          recognizer.acceptWaveform(samples)

          // Check if ready to decode
          if (recognizer.isReady()) {
            recognizer.decode()
          }

          // Get result
          const result = recognizer.getResult()
          if (result && result.text) {
            transcript.value = result.text
          }
        } catch (e) {
          console.error('Audio processing error:', e)
          error.value = '语音处理过程中发生错误'
        }
      }

      // Connect audio nodes
      source.connect(processor)
      processor.connect(audioContext.destination)

      isListening.value = true
    } catch (e) {
      console.error('Failed to start listening:', e)

      if (e.name === 'NotAllowedError' || e.message.includes('Permission denied')) {
        error.value = '请允许麦克风权限以使用语音识别'
      } else if (e.message.includes('Recognizer not initialized') || e.message.includes('Stream not created')) {
        error.value = '语音识别器未就绪，请刷新页面重试'
      } else {
        error.value = '无法访问麦克风，请检查设备设置'
      }

      cleanup()
    }
  }

  // Stop listening
  function stopListening() {
    if (!isListening.value) {
      return
    }

    isListening.value = false
    cleanup()
  }

  // Cleanup resources
  async function cleanup() {
    if (processor) {
      processor.disconnect()
      processor = null
    }

    if (audioContext) {
      try {
        await audioContext.close()
      } catch (e) {
        console.debug('AudioContext close error:', e)
      }
      audioContext = null
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop())
      mediaStream = null
    }

    if (recognizer) {
      recognizer.reset()
    }
  }

  // Cleanup on unmount
  onBeforeUnmount(() => {
    isDisposed = true
    if (isListening.value) {
      isListening.value = false
    }
    if (recognizer) {
      recognizer.free()
      recognizer = null
    }
  })

  return {
    isListening,
    isSupported,
    isLoading,
    transcript,
    error,
    initialize,
    startListening,
    stopListening
  }
}
