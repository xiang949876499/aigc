import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const EXTENSION_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

function sanitizePart(value, fallback) {
  const safe = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || fallback
}

function inferExtension(url, contentType = '', mediaType = '') {
  const fromContentType = EXTENSION_BY_CONTENT_TYPE[String(contentType).split(';')[0].trim().toLowerCase()]
  if (fromContentType) return fromContentType

  try {
    const parsed = new URL(url)
    const ext = path.extname(parsed.pathname).replace(/^\./, '').toLowerCase()
    if (ext) return ext
  } catch {}

  return mediaType === 'video' ? 'mp4' : 'png'
}

export function resolveAssetsDir(userDataDir) {
  return path.join(userDataDir, 'assets')
}

export async function saveRemoteAsset({
  url,
  id,
  kind = 'generated',
  mediaType = 'image',
  baseDir,
  fetchImpl = fetch,
} = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('asset url is required')
  }
  if (!baseDir) {
    throw new Error('asset baseDir is required')
  }

  const bucket = sanitizePart(kind, 'generated')
  const dir = path.join(baseDir, bucket)
  await fs.mkdir(dir, { recursive: true })

  let bytes
  let contentType = ''
  if (url.startsWith('file://')) {
    const sourcePath = fileURLToPath(url)
    bytes = await fs.readFile(sourcePath)
  } else {
    const response = await fetchImpl(url)
    if (!response?.ok) {
      throw new Error(`asset download failed: HTTP ${response?.status || 'unknown'}`)
    }
    contentType = response.headers?.get?.('content-type') || ''
    bytes = Buffer.from(await response.arrayBuffer())
  }

  if (!bytes?.length) {
    throw new Error('asset download failed: empty response')
  }

  const extension = inferExtension(url, contentType, mediaType)
  const filename = `${sanitizePart(id, 'asset')}-${Date.now()}.${extension}`
  const filePath = path.join(dir, filename)
  await fs.writeFile(filePath, bytes)

  return {
    filePath,
    fileURL: pathToFileURL(filePath).href,
    relativePath: path.join(bucket, filename),
  }
}
