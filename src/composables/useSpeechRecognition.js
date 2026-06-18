import { onBeforeUnmount, ref } from 'vue'

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096
const CHANNELS = 1

export function useSpeechRecognition() {
  const isListening = ref(false)
  const isSupported = ref(false)
  const isLoading = ref(false)
  const transcript = ref('')
  const error = ref(null)

  let audioContext = null
  let mediaStream = null
  let processor = null
  let processingQueue = Promise.resolve()

  const speechBridge = () => window.electronAPI?.speech

  async function initialize() {
    const bridge = speechBridge()
    if (!bridge) {
      error.value = '当前环境不支持语音输入'
      isSupported.value = false
      return
    }

    isLoading.value = true
    error.value = null
    try {
      const result = await bridge.initialize()
      isSupported.value = result?.supported === true
    } catch (e) {
      console.error('Failed to initialize speech recognition:', e)
      error.value = `语音识别初始化失败：${e.message}`
      isSupported.value = false
    } finally {
      isLoading.value = false
    }
  }

  async function startListening() {
    const bridge = speechBridge()
    if (!isSupported.value || !bridge) {
      error.value = '语音识别未初始化'
      return
    }
    if (isListening.value) return

    error.value = null
    try {
      await bridge.start()
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: CHANNELS,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
      const source = audioContext.createMediaStreamSource(mediaStream)
      processor = audioContext.createScriptProcessor(BUFFER_SIZE, CHANNELS, CHANNELS)
      processor.onaudioprocess = (event) => {
        if (!isListening.value) return
        const samples = new Float32Array(event.inputBuffer.getChannelData(0))
        processingQueue = processingQueue
          .then(() => bridge.process(samples))
          .then((result) => {
            if (isListening.value && result?.text) transcript.value = result.text
          })
          .catch((e) => {
            console.error('Audio processing error:', e)
            error.value = `语音处理失败：${e.message}`
          })
      }
      source.connect(processor)
      processor.connect(audioContext.destination)
      isListening.value = true
    } catch (e) {
      console.error('Failed to start listening:', e)
      error.value = e.name === 'NotAllowedError'
        ? '请允许麦克风权限以使用语音输入'
        : `无法启动语音输入：${e.message}`
      await cleanup({ transcribe: false })
    }
  }

  async function cleanup({ transcribe = false } = {}) {
    processor?.disconnect()
    processor = null
    if (audioContext) {
      await audioContext.close().catch(() => {})
      audioContext = null
    }
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = null
    await processingQueue.catch(() => {})
    return speechBridge()?.stop({ transcribe }).catch((e) => {
      if (transcribe) throw e
      return null
    })
  }

  async function stopListening() {
    if (!isListening.value) return
    isListening.value = false
    isLoading.value = true
    error.value = null
    try {
      const result = await cleanup({ transcribe: true })
      if (result?.text) transcript.value = result.text
    } catch (e) {
      console.error('Failed to transcribe speech:', e)
      error.value = `语音识别失败：${e.message}`
    } finally {
      isLoading.value = false
    }
  }

  onBeforeUnmount(() => {
    isListening.value = false
    cleanup({ transcribe: false }).finally(() => speechBridge()?.free().catch(() => {}))
  })

  return {
    isListening,
    isSupported,
    isLoading,
    transcript,
    error,
    initialize,
    startListening,
    stopListening,
  }
}
