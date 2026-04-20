import { ref } from 'vue'
import defaultConfig from '../config/comfyui.js'

export function useComfyUI(config = {}) {
  const cfg = { ...defaultConfig, ...config }

  const isGenerating = ref(false)
  const result = ref(null)
  const error = ref(null)

  let timerId = null
  let cancelled = false

  function cancel() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
    cancelled = true
    isGenerating.value = false
  }

  function stopWithError(msg) {
    cancel()
    error.value = msg
  }

  async function submit(workflow) {
    cancel()  // stop any prior poll
    cancelled = false
    isGenerating.value = true
    result.value = null
    error.value = null

    let promptId
    try {
      const res = await fetch(`${cfg.baseURL}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
      })
      if (!res.ok) throw new Error(`提交失败：${res.status}`)
      const data = await res.json()
      promptId = data.prompt_id
    } catch (err) {
      stopWithError(err.message)
      return
    }

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
        if (tries >= cfg.pollMaxTries) {
          stopWithError('生成超时，请重试')
          resolve()
          return
        }

        try {
          const res = await fetch(`${cfg.baseURL}/history/${promptId}`)
          if (cancelled) { resolve(); return }
          if (!res.ok) throw new Error(`查询失败：${res.status}`)
          const data = await res.json()
          const record = data[promptId]
          if (!record) return

          if (record.status?.error) {
            stopWithError(record.status.error)
            resolve()
            return
          }

          const outputs = record.outputs || {}
          const nodeWithImages = Object.values(outputs).find(
            (node) => node.images?.length > 0
          )
          if (nodeWithImages) {
            const img = nodeWithImages.images[0]
            result.value = {
              imageURL: `${cfg.baseURL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`,
            }
            cancel()
            resolve()
          }
        } catch (err) {
          stopWithError(err.message)
          resolve()
        }
      }, cfg.pollInterval)
    })
  }

  return { isGenerating, result, error, submit, cancel }
}
