import defaultConfig from './comfyui.js'

export const COMFYUI_SETTINGS_KEY = 'aigc_comfyui_settings'

const KNOWN_PROXY_PATHS = new Set(['/api/comfyui', '/api/comfyui-video'])

function stripExternalProxyPath(baseURL) {
  try {
    const url = new URL(baseURL)
    const pathname = url.pathname.replace(/\/+$/, '')
    if (!KNOWN_PROXY_PATHS.has(pathname)) {
      return baseURL
    }

    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return baseURL
  }
}

function normalizeBaseURL(value, fallback) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const baseURL = raw || fallback
  const normalized = String(baseURL || '').replace(/\/+$/, '')
  if (!raw) return normalized

  return stripExternalProxyPath(normalized)
}

function isKnownProxyBaseURL(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '')
  if (KNOWN_PROXY_PATHS.has(normalized)) return true

  try {
    const url = new URL(normalized)
    const pathname = url.pathname.replace(/\/+$/, '')
    return KNOWN_PROXY_PATHS.has(pathname)
  } catch {
    return false
  }
}

function isAppProxyBaseURL(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '')
  if (KNOWN_PROXY_PATHS.has(normalized)) return true

  try {
    const url = new URL(normalized)
    const pathname = url.pathname.replace(/\/+$/, '')
    return KNOWN_PROXY_PATHS.has(pathname)
      && typeof window !== 'undefined'
      && window.location?.origin
      && url.origin === window.location.origin
  } catch {
    return false
  }
}

function toSettingsDraftBaseURL(value, fallback) {
  if (isAppProxyBaseURL(value)) {
    return normalizeBaseURL(fallback, fallback)
  }

  const normalized = normalizeBaseURL(value, fallback)
  return isKnownProxyBaseURL(normalized)
    ? normalizeBaseURL(fallback, fallback)
    : normalized
}

export function createDefaultComfyUISettings() {
  return {
    imageBaseURL: defaultConfig.baseURL,
    videoBaseURL: defaultConfig.videoBaseURL,
  }
}

export function normalizeComfyUISettings(settings = {}) {
  const defaults = createDefaultComfyUISettings()
  return {
    imageBaseURL: normalizeBaseURL(settings.imageBaseURL, defaults.imageBaseURL),
    videoBaseURL: normalizeBaseURL(settings.videoBaseURL, defaults.videoBaseURL),
  }
}

export function createComfyUISettingsDraft(settings = {}, displayDefaults = {}) {
  const normalized = normalizeComfyUISettings(settings)
  return {
    imageBaseURL: toSettingsDraftBaseURL(
      settings.imageBaseURL ?? normalized.imageBaseURL,
      displayDefaults.imageBaseURL || normalized.imageBaseURL,
    ),
    videoBaseURL: toSettingsDraftBaseURL(
      settings.videoBaseURL ?? normalized.videoBaseURL,
      displayDefaults.videoBaseURL || normalized.videoBaseURL,
    ),
  }
}

export function loadComfyUISettings() {
  if (typeof localStorage === 'undefined') return createDefaultComfyUISettings()

  try {
    const raw = localStorage.getItem(COMFYUI_SETTINGS_KEY)
    return normalizeComfyUISettings(raw ? JSON.parse(raw) : {})
  } catch {
    return createDefaultComfyUISettings()
  }
}

export function saveComfyUISettings(settings) {
  const normalized = normalizeComfyUISettings(settings)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(COMFYUI_SETTINGS_KEY, JSON.stringify(normalized))
  }
  return normalized
}

export function resetComfyUISettings() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(COMFYUI_SETTINGS_KEY)
  }
  return createDefaultComfyUISettings()
}
