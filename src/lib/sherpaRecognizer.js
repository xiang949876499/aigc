import sherpa_onnx from 'sherpa-onnx'

const SAMPLE_RATE = 16000
const FEATURE_DIM = 80

export default class SherpaRecognizer {
  constructor() {
    this.recognizer = null
    this.stream = null
  }

  async initialize(modelFiles) {
    if (!modelFiles?.encoder || !modelFiles?.decoder || !modelFiles?.joiner || !modelFiles?.tokens) {
      throw new Error('Missing required model files (encoder, decoder, joiner, tokens)')
    }

    const config = {
      featConfig: {
        sampleRate: SAMPLE_RATE,
        featureDim: FEATURE_DIM
      },
      modelConfig: {
        transducer: {
          encoder: modelFiles.encoder,
          decoder: modelFiles.decoder,
          joiner: modelFiles.joiner
        },
        tokens: modelFiles.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: false
      }
    }

    try {
      this.recognizer = new sherpa_onnx.OnlineRecognizer(config)
    } catch (e) {
      this.recognizer = null
      throw new Error(`Failed to create recognizer: ${e.message}`)
    }
  }

  createStream() {
    if (!this.recognizer) {
      throw new Error('Recognizer not initialized')
    }
    this.stream = this.recognizer.createStream()
  }

  acceptWaveform(samples) {
    if (!this.stream) {
      throw new Error('Stream not created')
    }
    this.stream.acceptWaveform(SAMPLE_RATE, samples)
  }

  isReady() {
    if (!this.recognizer || !this.stream) {
      return false
    }
    return this.recognizer.isReady(this.stream)
  }

  decode() {
    if (!this.recognizer || !this.stream) {
      throw new Error('Recognizer or stream not ready')
    }
    this.recognizer.decode(this.stream)
  }

  getResult() {
    if (!this.recognizer || !this.stream) {
      return { text: '', isFinal: false }
    }
    return this.recognizer.getResult(this.stream)
  }

  reset() {
    if (!this.recognizer) {
      throw new Error('Recognizer not initialized')
    }
    if (this.stream) {
      this.stream.free()
    }
    this.createStream()
  }

  free() {
    if (this.stream) {
      this.stream.free()
      this.stream = null
    }
    if (this.recognizer) {
      this.recognizer.free()
      this.recognizer = null
    }
  }
}
