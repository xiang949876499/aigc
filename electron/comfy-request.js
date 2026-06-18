function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)]),
  )
}

function assertAllowedComfyURL(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported ComfyUI URL protocol')
  }
  return parsed
}

function createRequestBody(payload = {}) {
  if (Array.isArray(payload.formData)) {
    const formData = new FormData()
    for (const part of payload.formData) {
      if (!part?.name) continue
      if ('bytes' in part) {
        const blob = new Blob([Buffer.from(part.bytes)], {
          type: part.type || 'application/octet-stream',
        })
        formData.append(part.name, blob, part.filename || 'blob')
      } else {
        formData.append(part.name, String(part.value ?? ''))
      }
    }
    return formData
  }

  return payload.body ?? undefined
}

export async function requestComfy(payload = {}) {
  const url = String(payload.url || '')
  assertAllowedComfyURL(url)

  const headers = normalizeHeaders(payload.headers)
  if (Array.isArray(payload.formData)) {
    delete headers['content-type']
    delete headers['Content-Type']
  }

  const response = await fetch(url, {
    method: payload.method || 'GET',
    headers,
    body: createRequestBody(payload),
  })
  const body = await response.text()

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}
