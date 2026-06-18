import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SAMPLE_RATE = 16000
const CHANNELS = 1
const BYTES_PER_SAMPLE = 2
const DEFAULT_MODEL = 'sensevoice'
const DEFAULT_LANGUAGE = 'zh'
const DEFAULT_TIMEOUT_MS = 120000
const MAX_BUFFER = 10 * 1024 * 1024
const FUNASR_NOT_FOUND_MESSAGE = 'FunASR CLI 未找到，请先安装 funasr，或设置 FUNASR_CLI 为 funasr.exe 的完整路径。'

function splitCommandLine(commandLine) {
  const parts = []
  const pattern = /"([^"]+)"|'([^']+)'|(\S+)/g
  let match
  while ((match = pattern.exec(commandLine))) {
    parts.push(match[1] || match[2] || match[3])
  }
  return parts.length ? parts : ['funasr']
}

function clampSample(sample) {
  if (!Number.isFinite(sample)) return 0
  return Math.max(-1, Math.min(1, sample))
}

function createWavBuffer(samples) {
  const dataSize = samples.length * BYTES_PER_SAMPLE
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(CHANNELS, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, 28)
  buffer.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < samples.length; i += 1) {
    const sample = clampSample(samples[i])
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    buffer.writeInt16LE(Math.round(pcm), 44 + i * BYTES_PER_SAMPLE)
  }

  return buffer
}

function extractText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('')
  if (typeof value !== 'object') return ''

  if (typeof value.text === 'string') return value.text.trim()
  if (typeof value.sentence === 'string') return value.sentence.trim()
  if (Array.isArray(value.sentence_info)) return extractText(value.sentence_info)
  if (Array.isArray(value.result)) return extractText(value.result)
  if (value.result && typeof value.result === 'object') return extractText(value.result)
  if (Array.isArray(value.segments)) return extractText(value.segments)
  return ''
}

function parseFunASROutput(stdout) {
  const output = String(stdout || '').trim()
  if (!output) return ''

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line.startsWith('{') && !line.startsWith('[')) continue
    try {
      const text = extractText(JSON.parse(line))
      if (text) return text
    } catch {}
  }

  for (const start of [output.lastIndexOf('{'), output.lastIndexOf('[')].filter((index) => index >= 0).sort((a, b) => b - a)) {
    try {
      const text = extractText(JSON.parse(output.slice(start)))
      if (text) return text
    } catch {}
  }

  return output
}

export class SpeechService {
  constructor({
    execFile = execFileCallback,
    writeFile = fs.promises.writeFile,
    rm = fs.promises.rm,
    mkdtemp = fs.promises.mkdtemp,
    tmpdir = os.tmpdir,
    fileExists = fs.existsSync,
    env = process.env,
    platform = process.platform,
  } = {}) {
    this.execFile = execFile
    this.writeFile = writeFile
    this.rm = rm
    this.mkdtemp = mkdtemp
    this.tmpdir = tmpdir
    this.fileExists = fileExists
    this.env = env
    this.platform = platform
    this.samples = []
    this.isStarted = false
    this.commandLine = env.FUNASR_CLI || 'funasr'
    this.model = env.FUNASR_MODEL || DEFAULT_MODEL
    this.language = env.FUNASR_LANGUAGE || DEFAULT_LANGUAGE
    this.timeoutMs = Number.parseInt(env.FUNASR_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS
  }

  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      this.execFile(command, args, {
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        ...options,
      }, (error, stdout = '', stderr = '') => {
        if (error) {
          error.stderr = stderr
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      })
    })
  }

  getCommandParts() {
    return splitCommandLine(this.commandLine)
  }

  async initialize() {
    const [command] = this.getCommandParts()

    try {
      if (/[\\/]/.test(command)) {
        if (!this.fileExists(command)) throw new Error(`Command not found: ${command}`)
      } else {
        const locator = this.platform === 'win32' ? 'where.exe' : 'which'
        await this.run(locator, [command], { timeout: 10000 })
      }
    } catch (error) {
      throw new Error(FUNASR_NOT_FOUND_MESSAGE)
    }

    return { supported: true }
  }

  start() {
    this.samples = []
    this.isStarted = true
    return { started: true }
  }

  process(samples) {
    if (!this.isStarted) {
      throw new Error('Speech recorder is not started')
    }

    const waveform = samples instanceof Float32Array ? samples : new Float32Array(samples)
    this.samples.push(new Float32Array(waveform))
    return { text: '' }
  }

  buildFunASRArgs(audioPath) {
    const args = [audioPath, '--output-format', 'json']
    if (this.model) args.push('--model', this.model)
    if (this.language) args.push('--language', this.language)
    return args
  }

  takeSamples() {
    const chunks = this.samples
    this.samples = []
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return merged
  }

  async stop({ transcribe = true } = {}) {
    if (!this.isStarted) return { text: '' }
    this.isStarted = false
    const samples = this.takeSamples()

    if (!transcribe || samples.length === 0) {
      return { text: '' }
    }

    const tempDir = await this.mkdtemp(path.join(this.tmpdir(), 'aigc-funasr-'))
    const audioPath = path.join(tempDir, 'speech.wav')

    try {
      await this.writeFile(audioPath, createWavBuffer(samples))
      const [command, ...baseArgs] = this.getCommandParts()
      const { stdout } = await this.run(command, [
        ...baseArgs,
        ...this.buildFunASRArgs(audioPath),
      ], { timeout: this.timeoutMs })
      return { text: parseFunASROutput(stdout) }
    } finally {
      await this.rm(tempDir, { recursive: true, force: true })
    }
  }

  async free() {
    await this.stop({ transcribe: false })
  }
}
