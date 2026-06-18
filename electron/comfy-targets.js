const DEFAULT_COMFY_TARGET = 'http://127.0.0.1:8188'

function normalizeTarget(target) {
  return String(target || '').trim().replace(/\/$/, '')
}

export function resolveComfyTargets(env = process.env) {
  const comfyTarget = normalizeTarget(
    env.VITE_COMFYUI_SERVER
    || env.VITE_COMFYUI_TARGET
    || DEFAULT_COMFY_TARGET,
  )
  const comfyVideoTarget = normalizeTarget(
    env.VITE_COMFYUI_VIDEO_SERVER
    || env.VITE_COMFYUI_VIDEO_TARGET
    || comfyTarget,
  )

  return { comfyTarget, comfyVideoTarget }
}
