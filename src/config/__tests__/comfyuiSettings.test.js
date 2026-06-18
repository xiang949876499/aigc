import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import defaultConfig from '../comfyui.js'
import {
  COMFYUI_SETTINGS_KEY,
  createDefaultComfyUISettings,
  loadComfyUISettings,
  createComfyUISettingsDraft,
  normalizeComfyUISettings,
  saveComfyUISettings,
} from '../comfyuiSettings.js'

const storage = new Map()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => storage.get(key) ?? null),
    setItem: vi.fn((key, value) => storage.set(key, value)),
    removeItem: vi.fn((key) => storage.delete(key)),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('comfyui settings', () => {
  it('creates defaults from the runtime config', () => {
    expect(createDefaultComfyUISettings()).toEqual({
      imageBaseURL: defaultConfig.baseURL,
      videoBaseURL: defaultConfig.videoBaseURL,
    })
  })

  it('normalizes custom image and video addresses', () => {
    expect(normalizeComfyUISettings({
      imageBaseURL: ' http://192.168.0.10:8188/// ',
      videoBaseURL: ' http://127.0.0.1:8189/ ',
    })).toEqual({
      imageBaseURL: 'http://192.168.0.10:8188',
      videoBaseURL: 'http://127.0.0.1:8189',
    })
  })

  it('strips proxy prefixes from absolute ComfyUI addresses', () => {
    expect(normalizeComfyUISettings({
      imageBaseURL: 'http://192.168.0.131:8188/api/comfyui/',
      videoBaseURL: 'http://192.168.0.131:8188/api/comfyui-video/',
    })).toEqual({
      imageBaseURL: 'http://192.168.0.131:8188',
      videoBaseURL: 'http://192.168.0.131:8188',
    })
  })

  it('strips app-origin proxy addresses for settings input', () => {
    expect(normalizeComfyUISettings({
      imageBaseURL: `${window.location.origin}/api/comfyui/`,
      videoBaseURL: `${window.location.origin}/api/comfyui-video/`,
    })).toEqual({
      imageBaseURL: window.location.origin,
      videoBaseURL: window.location.origin,
    })
  })

  it('keeps explicit ComfyUI server addresses from settings', () => {
    expect(normalizeComfyUISettings({
      imageBaseURL: 'http://192.168.0.131:8188/api/comfyui',
      videoBaseURL: 'http://192.168.0.131:8189',
    })).toEqual({
      imageBaseURL: 'http://192.168.0.131:8188',
      videoBaseURL: 'http://192.168.0.131:8189',
    })
  })

  it('uses server roots for settings drafts when active addresses are app proxy routes', () => {
    expect(createComfyUISettingsDraft({
      imageBaseURL: '/api/comfyui',
      videoBaseURL: `${window.location.origin}/api/comfyui-video`,
    }, {
      imageBaseURL: 'http://192.168.0.131:8188',
      videoBaseURL: 'http://127.0.0.1:8188',
    })).toEqual({
      imageBaseURL: 'http://192.168.0.131:8188',
      videoBaseURL: 'http://127.0.0.1:8188',
    })
  })

  it('falls back to defaults when saved settings are incomplete', () => {
    storage.set(COMFYUI_SETTINGS_KEY, JSON.stringify({ imageBaseURL: '  ' }))

    expect(loadComfyUISettings()).toEqual(createDefaultComfyUISettings())
  })

  it('persists normalized settings', () => {
    const settings = saveComfyUISettings({
      imageBaseURL: '/api/comfyui/',
      videoBaseURL: '/api/comfyui-video/',
    })

    expect(settings).toEqual({
      imageBaseURL: '/api/comfyui',
      videoBaseURL: '/api/comfyui-video',
    })
    expect(JSON.parse(storage.get(COMFYUI_SETTINGS_KEY))).toEqual(settings)
  })
})
