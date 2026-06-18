const runtimeConfig = typeof window !== 'undefined' ? window.electronAPI?.config : undefined
const runtimeBaseURL = runtimeConfig?._proxyBaseURL || import.meta.env.VITE_COMFYUI_BASE_URL?.trim()
const runtimeVideoBaseURL = runtimeConfig?._proxyVideoBaseURL || import.meta.env.VITE_COMFYUI_VIDEO_BASE_URL?.trim()
const settingsBaseURL = runtimeConfig?._comfyBaseURL
  || import.meta.env.VITE_COMFYUI_SERVER?.trim()
  || import.meta.env.VITE_COMFYUI_TARGET?.trim()
  || 'http://127.0.0.1:8188'
const settingsVideoBaseURL = runtimeConfig?._comfyVideoBaseURL
  || import.meta.env.VITE_COMFYUI_VIDEO_SERVER?.trim()
  || import.meta.env.VITE_COMFYUI_VIDEO_TARGET?.trim()
  || settingsBaseURL

export default {
  // Use the Vite proxy in local development so the browser does not hit
  // the ComfyUI server cross-origin and get blocked by missing CORS headers.
  baseURL: (runtimeBaseURL || '/api/comfyui').replace(/\/$/, ''),
  videoBaseURL: (runtimeVideoBaseURL || '/api/comfyui-video').replace(/\/$/, ''),
  settingsBaseURL: settingsBaseURL.replace(/\/$/, ''),
  settingsVideoBaseURL: settingsVideoBaseURL.replace(/\/$/, ''),
  pollInterval: 3000,
  // Default timeout: ~300s (pollInterval * pollMaxTries)
  pollMaxTries: 100,
}
