import { describe, expect, it } from 'vitest'
import { resolveComfyTargets } from '../comfy-targets.js'

describe('ComfyUI target resolution', () => {
  it('uses environment targets instead of legacy config object values', () => {
    const targets = resolveComfyTargets({
      comfyuiServer: 'http://192.168.0.131:8188/',
      comfyuiVideoServer: 'http://192.168.0.132:8188/',
      VITE_COMFYUI_SERVER: 'http://127.0.0.1:8188',
      VITE_COMFYUI_VIDEO_SERVER: 'http://127.0.0.1:8189',
    })

    expect(targets).toEqual({
      comfyTarget: 'http://127.0.0.1:8188',
      comfyVideoTarget: 'http://127.0.0.1:8189',
    })
  })

  it('falls back video requests to the image server when no video target is configured', () => {
    const targets = resolveComfyTargets({
      VITE_COMFYUI_SERVER: 'http://192.168.0.131:8188',
    })

    expect(targets.comfyVideoTarget).toBe('http://192.168.0.131:8188')
  })
})
