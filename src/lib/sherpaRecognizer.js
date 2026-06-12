import sherpa_onnx from 'sherpa-onnx'

export default class SherpaRecognizer {
  constructor() {
    this.recognizer = null
    this.stream = null
  }

  async initialize(modelFiles) {
    const config = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80
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

    this.recognizer = new sherpa_onnx.OnlineRecognizer(config)
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
    this.stream.acceptWaveform(16000, samples)
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
