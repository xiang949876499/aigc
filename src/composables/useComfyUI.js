import { ref } from 'vue'
import defaultConfig from '../config/comfyui.js'

export function useComfyUI(config = {}) {
  const cfg = { ...defaultConfig, ...config }

  const isGenerating = ref(false)
  const result = ref(null)
  const error = ref(null)

  let timerId = null
  let cancelled = false
  let activeRunId = 0

  function cancel() {
    activeRunId += 1
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
    cancelled = true
    isGenerating.value = false
  }

  function stopWithError(msg, runId = activeRunId) {
    if (runId !== activeRunId) return
    cancel()
    error.value = msg
  }

  function normalizeHeaders(headers = {}) {
    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries())
    }
    if (Array.isArray(headers)) {
      return Object.fromEntries(headers)
    }
    return { ...headers }
  }

  function shouldUseElectronComfyBridge(url) {
    return /^https?:\/\//i.test(String(url || ''))
      && typeof window !== 'undefined'
      && typeof window.electronAPI?.comfy?.request === 'function'
  }

  async function serializeComfyRequest(url, options = {}) {
    const payload = {
      url: String(url),
      method: options.method || 'GET',
      headers: normalizeHeaders(options.headers),
    }

    if (options.body instanceof FormData) {
      payload.formData = []
      for (const [name, value] of options.body.entries()) {
        if (value instanceof Blob) {
          payload.formData.push({
            name,
            filename: value.name || 'blob',
            type: value.type || 'application/octet-stream',
            bytes: await value.arrayBuffer(),
          })
        } else {
          payload.formData.push({ name, value: String(value) })
        }
      }
      return payload
    }

    if (options.body != null) {
      payload.body = String(options.body)
    }

    return payload
  }

  async function comfyFetch(url, options = {}) {
    if (!shouldUseElectronComfyBridge(url)) {
      return Object.keys(options).length ? fetch(url, options) : fetch(url)
    }

    const response = await window.electronAPI.comfy.request(
      await serializeComfyRequest(url, options),
    )
    return new Response(response?.body ?? '', {
      status: response?.status || 502,
      headers: response?.headers || {},
    })
  }

  function getBaseURL(options = {}) {
    return (options.baseURL || cfg.baseURL).replace(/\/$/, '')
  }

  function formatRequestError(err, baseURL = cfg.baseURL) {
    const message = err?.message || 'Request failed'

    if (message === 'Failed to fetch') {
      return `无法连接到 ComfyUI 服务(${baseURL})，请检查服务地址、代理配置或后端是否已启动`
    }

    if (/unexpected end of json input/i.test(message)) {
      return `ComfyUI 返回了空响应(${baseURL})，请确认服务已启动且地址正确`
    }

    if (message.includes('403')) {
      return `ComfyUI 拒绝请求(403)：请通过开发代理 /api/comfyui 访问，不要设置 VITE_COMFYUI_BASE_URL 直连；或在启动 ComfyUI 时加上 --enable-cors-header "*"`
    }

    return message
  }

  function formatHttpStatusError(status, baseURL = cfg.baseURL) {
    if (status === 403) {
      return '提交失败：403（ComfyUI 拒绝了跨域/来源校验，请重启 npm run dev 并确保未直连 8188 端口）'
    }
    if (status === 502 || status === 504) {
      return `无法连接到 ComfyUI 服务(${baseURL})，请检查服务地址、代理配置或后端是否已启动`
    }
    return `提交失败：${status}`
  }

  async function parseJsonResponse(res) {
    const text = await res.text()
    if (!text.trim()) return null
    try {
      return JSON.parse(text)
    } catch {
      const snippet = text.trim().slice(0, 300)
      if (!res.ok) {
        throw new Error(`ComfyUI 返回非 JSON 错误响应(${res.status})${snippet ? `：${snippet}` : ''}`)
      }
      throw new Error(`ComfyUI 返回了无效的 JSON 数据(${res.status})${snippet ? `：${snippet}` : ''}`)
    }
  }

  function buildViewURL(file, baseURL = cfg.baseURL) {
    if (!file?.filename) return null
    return `${baseURL}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || '')}&type=${encodeURIComponent(file.type || 'output')}`
  }

  function isVideoFile(file) {
    return /\.(mp4|webm|mov|mkv|gif)\b/i.test(file?.filename || '')
  }

  function getMediaFromRecord(record, baseURL = cfg.baseURL) {
    if (!record || typeof record !== 'object') return null

    const outputs = record.outputs || {}
    for (const node of Object.values(outputs)) {
      if (!node || typeof node !== 'object') continue

      if (node.videos?.length > 0) {
        const url = buildViewURL(node.videos[0], baseURL)
        if (url) return { imageURL: url, mediaType: 'video' }
      }

      if (node.gifs?.length > 0) {
        const url = buildViewURL(node.gifs[0], baseURL)
        if (url) return { imageURL: url, mediaType: 'video' }
      }

      if (node.images?.length > 0) {
        const url = buildViewURL(node.images[0], baseURL)
        const mediaType = isVideoFile(node.images[0]) || node.animated?.[0] === true
          ? 'video'
          : 'image'
        if (url) return { imageURL: url, mediaType }
      }
    }

    return null
  }

  function getRecordCreateTime(record) {
    const createTime = record?.prompt?.[3]?.create_time
    return Number.isFinite(createTime) ? createTime : 0
  }

  function recordContainsText(value, text) {
    if (!text) return false
    if (typeof value === 'string') return value.includes(text)
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some((item) => recordContainsText(item, text))
    return Object.values(value).some((item) => recordContainsText(item, text))
  }

  async function fetchHistoryRecord(promptId, baseURL = cfg.baseURL) {
    const res = await comfyFetch(`${baseURL}/history/${promptId}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`查询失败：${res.status}`)
    const data = await parseJsonResponse(res)
    if (!data || typeof data !== 'object') return null
    return data[promptId] || null
  }

  async function fetchHistory(baseURL = cfg.baseURL) {
    const res = await comfyFetch(`${baseURL}/history`)
    if (!res.ok) throw new Error(`查询失败：${res.status}`)
    const data = await parseJsonResponse(res)
    return data && typeof data === 'object' ? data : {}
  }

  async function getPromptResult(promptId, options = {}) {
    if (!promptId) return null
    const baseURL = getBaseURL(options)
    const record = await fetchHistoryRecord(promptId, baseURL)
    if (record?.status?.error) {
      throw new Error(record.status.error)
    }
    return getMediaFromRecord(record, baseURL)
  }

  async function findPromptResultByText(text, options = {}) {
    const query = typeof text === 'string' ? text.trim() : ''
    if (!query) return null

    const baseURL = getBaseURL(options)
    const history = await fetchHistory(baseURL)
    const matches = Object.entries(history)
      .filter(([, record]) => record?.status?.completed && recordContainsText(record?.prompt?.[2], query))
      .map(([promptId, record]) => ({
        promptId,
        media: getMediaFromRecord(record, baseURL),
        createTime: getRecordCreateTime(record),
      }))
      .filter((item) => item.media?.imageURL)
      .sort((a, b) => b.createTime - a.createTime)

    if (!matches.length) return null
    const { promptId, media } = matches[0]
    return { promptId, media }
  }

  async function resolveFromHistory(promptId, {
    allowIncomplete = true,
    baseURL = cfg.baseURL,
    runId = activeRunId,
  } = {}) {
    const record = await fetchHistoryRecord(promptId, baseURL)
    if (runId !== activeRunId) return false
    if (!record) return false

    if (record.status?.error) {
      stopWithError(record.status.error, runId)
      return true
    }

    if (!allowIncomplete && !record.status?.completed) {
      return false
    }

    const media = getMediaFromRecord(record, baseURL)
    if (!media?.imageURL) return false

    result.value = media
    cancel()
    return true
  }

  async function resolveFromFullHistory(text, {
    baseURL = cfg.baseURL,
    runId = activeRunId,
    onPromptId,
  } = {}) {
    const recovered = await findPromptResultByText(text, { baseURL })
    if (runId !== activeRunId) return false
    if (!recovered?.media?.imageURL) return false

    if (typeof onPromptId === 'function' && recovered.promptId) {
      onPromptId(recovered.promptId)
    }
    result.value = recovered.media
    cancel()
    return true
  }

  async function uploadImage(file, options = {}) {
    const baseURL = getBaseURL(options)

    if (!file) {
      throw new Error('请先上传一张图片')
    }

    const formData = new FormData()
    formData.append('image', file, file.name || `upload-${Date.now()}.png`)
    formData.append('overwrite', 'true')

    let res
    try {
      res = await comfyFetch(`${baseURL}/upload/image`, {
        method: 'POST',
        body: formData,
      })
    } catch (err) {
      throw new Error(formatRequestError(err, baseURL))
    }

    let data = null
    try {
      data = await parseJsonResponse(res)
    } catch {
      data = null
    }

    if (!res.ok) {
      const detail = data?.error?.message || data?.error || data?.message || `图片上传失败(${res.status})`
      throw new Error(detail)
    }

    if (!data?.name) {
      throw new Error('图片上传失败：服务端未返回文件名')
    }

    return data
  }

  async function submit(workflow, options = {}) {
    cancel()  // stop any prior poll
    cancelled = false
    const runId = activeRunId
    isGenerating.value = true
    result.value = null
    error.value = null

    const baseURL = getBaseURL(options)
    const effectivePollInterval = Number.isFinite(options.pollInterval) ? options.pollInterval : cfg.pollInterval
    const effectivePollMaxTries = Number.isFinite(options.pollMaxTries) ? options.pollMaxTries : cfg.pollMaxTries
    const fallbackText = typeof options.fallbackText === 'string' ? options.fallbackText.trim() : ''

    let promptId
    try {
      const res = await comfyFetch(`${baseURL}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
      })
      const data = await parseJsonResponse(res)
      if (!res.ok) {
        const nodeErrors = data?.node_errors || {}
        const firstNode = Object.entries(nodeErrors)[0]
        const detail = firstNode
          ? `节点 ${firstNode[0]}(${firstNode[1].class_type}): ${firstNode[1].errors?.[0]?.message || ''}`
          : (data?.error?.message || data?.error || formatHttpStatusError(res.status, baseURL))
        throw new Error(detail)
      }
      if (!data?.prompt_id) {
        throw new Error('提交失败：ComfyUI 未返回 prompt_id，请检查服务是否正常')
      }
      promptId = data.prompt_id
      if (typeof options.onPromptId === 'function') {
        options.onPromptId(promptId)
      }
    } catch (err) {
      stopWithError(formatRequestError(err, baseURL), runId)
      return
    }

    if (runId !== activeRunId) return

    let tries = 0
    await new Promise((resolve) => {
      timerId = setInterval(async () => {
        if (cancelled) {
          clearInterval(timerId)
          timerId = null
          resolve()
          return
        }
        tries++
        if (tries >= effectivePollMaxTries) {
          try {
            let resolved = await resolveFromHistory(promptId, { allowIncomplete: false, baseURL, runId })
            if (!resolved && fallbackText) {
              resolved = await resolveFromFullHistory(fallbackText, {
                baseURL,
                runId,
                onPromptId: options.onPromptId,
              })
            }
            if (!resolved && !cancelled && runId === activeRunId) {
              stopWithError('生成超时，请重试', runId)
            }
          } catch {
            if (!cancelled && runId === activeRunId) stopWithError('生成超时，请重试', runId)
          }
          resolve()
          return
        }

        try {
          const resolved = await resolveFromHistory(promptId, { baseURL, runId })
          if (cancelled) { resolve(); return }
          if (resolved) resolve()
        } catch (err) {
          stopWithError(formatRequestError(err, baseURL), runId)
          resolve()
        }
      }, effectivePollInterval)
    })
  }

  return { isGenerating, result, error, submit, cancel, uploadImage, getPromptResult, findPromptResultByText }
}
