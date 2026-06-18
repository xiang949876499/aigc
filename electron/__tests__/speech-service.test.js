import { describe, expect, it, vi } from 'vitest'
import { SpeechService } from '../speech-service.js'

describe('SpeechService', () => {
  it('records microphone samples and transcribes them with the FunASR CLI', async () => {
    const execFile = vi.fn((command, args, _options, callback) => {
      if (command === 'where.exe') {
        callback(null, 'C:\\Python\\Scripts\\funasr.exe\r\n', '')
        return
      }
      callback(null, '{"text":"你好"}', '')
    })
    const writeFile = vi.fn(async () => {})
    const rm = vi.fn(async () => {})
    const service = new SpeechService({
      execFile,
      writeFile,
      rm,
      mkdtemp: vi.fn(async () => 'C:\\Temp\\aigc-funasr-123'),
      tmpdir: () => 'C:\\Temp',
      env: {},
      platform: 'win32',
    })

    await service.initialize()
    service.start()
    service.process(new Float32Array([0, -1, 1]))
    const result = await service.stop()

    expect(execFile).toHaveBeenCalledWith(
      'where.exe',
      ['funasr'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    )
    expect(execFile).toHaveBeenLastCalledWith(
      'funasr',
      [
        'C:\\Temp\\aigc-funasr-123\\speech.wav',
        '--output-format',
        'json',
        '--model',
        'sensevoice',
        '--language',
        'zh',
      ],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    )
    const wav = writeFile.mock.calls[0][1]
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(result).toEqual({ text: '你好' })
    expect(rm).toHaveBeenCalledWith('C:\\Temp\\aigc-funasr-123', { recursive: true, force: true })
  })

  it('reports when the FunASR CLI is not available', async () => {
    const missing = Object.assign(new Error('not found'), { code: 'ENOENT' })
    const service = new SpeechService({
      execFile: vi.fn((_command, _args, _options, callback) => callback(missing, '', '')),
      env: {},
      platform: 'win32',
    })

    await expect(service.initialize()).rejects.toThrow('FunASR CLI')
  })

  it('does not expose the raw where.exe failure text when FunASR is missing', async () => {
    const missing = Object.assign(
      new Error('Command failed: where.exe funasr\nINFO: Could not find files for the given pattern(s).'),
      { code: 1 },
    )
    const service = new SpeechService({
      execFile: vi.fn((_command, _args, _options, callback) => callback(missing, '', '')),
      env: {},
      platform: 'win32',
    })

    await expect(service.initialize()).rejects.toThrow(
      'FunASR CLI 未找到，请先安装 funasr，或设置 FUNASR_CLI 为 funasr.exe 的完整路径。',
    )
    await expect(service.initialize()).rejects.not.toThrow('where.exe')
  })
})
