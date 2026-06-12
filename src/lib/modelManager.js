const DB_NAME = 'sherpa-onnx-cache'
const DB_VERSION = 1
const STORE_NAME = 'models'
const MODEL_DIR = '/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'

const MODEL_FILES = {
  encoder: `${MODEL_DIR}/encoder-epoch-99-avg-1.onnx`,
  decoder: `${MODEL_DIR}/decoder-epoch-99-avg-1.onnx`,
  joiner: `${MODEL_DIR}/joiner-epoch-99-avg-1.onnx`,
  tokens: `${MODEL_DIR}/tokens.txt`
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

export async function isCached() {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.get('model-data')
      request.onsuccess = () => resolve(!!request.result)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return false
  }
}

export async function loadModel() {
  // Check cache first
  const cached = await loadFromCache()
  if (cached) {
    console.log('Model loaded from cache')
    return cached
  }

  // Load from files
  console.log('Loading model from files...')
  const model = await loadFromFiles()

  // Save to cache
  await saveToCache(model)
  console.log('Model cached for future use')

  return model
}

async function loadFromFiles() {
  const [encoder, decoder, joiner, tokens] = await Promise.all([
    fetchFile(MODEL_FILES.encoder),
    fetchFile(MODEL_FILES.decoder),
    fetchFile(MODEL_FILES.joiner),
    fetchText(MODEL_FILES.tokens)
  ])

  return { encoder, decoder, joiner, tokens }
}

async function fetchFile(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  return response.arrayBuffer()
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  return response.text()
}

async function loadFromCache() {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.get('model-data')
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  }
}

async function saveToCache(model) {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.put(model, 'model-data')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('Failed to cache model:', error)
  }
}

export async function clearCache() {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.delete('model-data')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('Failed to clear cache:', error)
  }
}
