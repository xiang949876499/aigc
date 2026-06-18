# Sherpa-ONNX WebAssembly 语音识别集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有的 Web Speech API 语音识别替换为 Sherpa-ONNX WebAssembly 方案，实现离线语音识别和更好的浏览器兼容性。

**Architecture:** 使用 Sherpa-ONNX 的 WebAssembly 模块进行本地语音识别，通过 ModelManager 管理模型加载和缓存，SherpaRecognizer 封装识别逻辑，useSpeechRecognition 提供 Vue 3 组合式 API。

**Tech Stack:** Vue 3, Sherpa-ONNX WebAssembly, Web Audio API, IndexedDB, Vitest

---

## 文件结构

```
src/
├── lib/
│   ├── modelManager.js              # 模型加载和缓存管理
│   └── sherpaRecognizer.js          # Sherpa-ONNX WASM 封装
├── composables/
│   ├── useSpeechRecognition.js      # 主 composable（重写）
│   └── __tests__/
│       ├── modelManager.test.js     # 模型管理器测试
│       ├── sherpaRecognizer.test.js # 识别器测试
│       └── useSpeechRecognition.test.js # composable 测试
└── components/
    └── ImageGen.vue                 # 集成语音识别（修改）

public/
└── models/                          # 模型文件目录（需下载）

scripts/
└── download-models.sh               # 模型下载脚本
```

---

## Task 1: 安装依赖和创建模型下载脚本

**Files:**
- Modify: `package.json`
- Create: `scripts/download-models.sh`

- [ ] **Step 1: 安装 sherpa-onnx 依赖**

```bash
cd D:/code/aigc-app
npm install sherpa-onnx
```

- [ ] **Step 2: 创建模型下载脚本**

```bash
cat > scripts/download-models.sh << 'EOF'
#!/bin/bash
# scripts/download-models.sh
# 下载 Sherpa-ONNX 中英文双语流式识别模型

set -e

MODEL_NAME="sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2"
MODEL_DIR="public/models"

echo "Creating model directory..."
mkdir -p "$MODEL_DIR"

cd "$MODEL_DIR"

if [ -d "$MODEL_NAME" ]; then
  echo "Model already exists, skipping download."
  exit 0
fi

echo "Downloading model from GitHub releases..."
curl -L -O "$MODEL_URL"

echo "Extracting model files..."
tar xvf "${MODEL_NAME}.tar.bz2"

echo "Cleaning up archive..."
rm "${MODEL_NAME}.tar.bz2"

echo "Model downloaded successfully!"
echo "Model location: $(pwd)/$MODEL_NAME"
ls -la "$MODEL_NAME"
EOF

chmod +x scripts/download-models.sh
```

- [ ] **Step 3: 验证脚本创建成功**

```bash
ls -la scripts/download-models.sh
cat scripts/download-models.sh | head -5
```

Expected: 文件存在且内容正确

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/download-models.sh
git commit -m "feat: add sherpa-onnx dependency and model download script"
```

---

## Task 2: 下载模型文件

**Files:**
- Create: `public/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/` (目录)

- [ ] **Step 1: 运行模型下载脚本**

```bash
cd D:/code/aigc-app
bash scripts/download-models.sh
```

Expected: 模型文件下载成功，显示文件列表

- [ ] **Step 2: 验证模型文件存在**

```bash
ls -la public/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
```

Expected: 看到以下文件：
- encoder.onnx (~30MB)
- decoder.onnx (~5MB)
- joiner.onnx (~10MB)
- tokens.txt (~1MB)

- [ ] **Step 3: 更新 .gitignore 忽略模型文件**

```bash
echo "# Model files (too large for git)" >> .gitignore
echo "public/models/" >> .gitignore
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: add model files to gitignore"
```

---

## Task 3: 创建模型管理器 (ModelManager)

**Files:**
- Create: `src/lib/modelManager.js`
- Create: `src/lib/__tests__/modelManager.test.js`

- [ ] **Step 1: 编写模型管理器测试**

```javascript
// src/lib/__tests__/modelManager.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadModel, clearCache, isCached } from '../modelManager'

// Mock IndexedDB
const mockIDBDatabase = {
  transaction: vi.fn(),
  objectStoreNames: { contains: vi.fn() }
}

const mockIDBTransaction = {
  objectStore: vi.fn(),
  oncomplete: null,
  onerror: null
}

const mockIDBObjectStore = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}

const mockIDBRequest = {
  result: null,
  error: null,
  onsuccess: null,
  onerror: null
}

// Mock global indexedDB
global.indexedDB = {
  open: vi.fn(() => {
    const request = { ...mockIDBRequest }
    setTimeout(() => {
      request.result = mockIDBDatabase
      request.onsuccess?.()
    }, 0)
    return request
  })
}

describe('ModelManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIDBDatabase.transaction.mockReturnValue(mockIDBTransaction)
    mockIDBTransaction.objectStore.mockReturnValue(mockIDBObjectStore)
  })

  it('should check if model is cached', async () => {
    mockIDBObjectStore.get.mockReturnValue({
      ...mockIDBRequest,
      result: null
    })

    const cached = await isCached()
    expect(cached).toBe(false)
  })

  it('should load model from files', async () => {
    // Mock fetch for local files
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(30)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(5)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('tokens') })

    const model = await loadModel()
    expect(model).toBeDefined()
    expect(model.encoder).toBeInstanceOf(ArrayBuffer)
    expect(model.decoder).toBeInstanceOf(ArrayBuffer)
    expect(model.joiner).toBeInstanceOf(ArrayBuffer)
    expect(typeof model.tokens).toBe('string')
  })

  it('should clear cache', async () => {
    mockIDBObjectStore.delete.mockReturnValue({
      ...mockIDBRequest,
      result: undefined
    })

    await clearCache()
    expect(mockIDBObjectStore.delete).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd D:/code/aigc-app
npm test -- src/lib/__tests__/modelManager.test.js
```

Expected: FAIL - "Cannot find module '../modelManager'"

- [ ] **Step 3: 编写模型管理器实现**

```javascript
// src/lib/modelManager.js
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
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd D:/code/aigc-app
npm test -- src/lib/__tests__/modelManager.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/modelManager.js src/lib/__tests__/modelManager.test.js
git commit -m "feat: add model manager with IndexedDB caching"
```

---

## Task 4: 创建 Sherpa-ONNX 识别器封装

**Files:**
- Create: `src/lib/sherpaRecognizer.js`
- Create: `src/lib/__tests__/sherpaRecognizer.test.js`

- [ ] **Step 1: 编写识别器测试**

```javascript
// src/lib/__tests__/sherpaRecognizer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SherpaRecognizer from '../sherpaRecognizer'

// Mock sherpa-onnx module
vi.mock('sherpa-onnx', () => ({
  default: {
    OnlineRecognizer: vi.fn().mockImplementation(() => ({
      createStream: vi.fn().mockReturnValue({
        acceptWaveform: vi.fn(),
        free: vi.fn()
      }),
      isReady: vi.fn().mockReturnValue(true),
      decode: vi.fn(),
      getResult: vi.fn().mockReturnValue({ text: 'test', isFinal: true }),
      free: vi.fn()
    }))
  }
}))

describe('SherpaRecognizer', () => {
  let recognizer
  const mockModelFiles = {
    encoder: new ArrayBuffer(30),
    decoder: new ArrayBuffer(5),
    joiner: new ArrayBuffer(10),
    tokens: 'token1\ntoken2\n'
  }

  beforeEach(() => {
    recognizer = new SherpaRecognizer()
  })

  it('should initialize with valid config', async () => {
    await recognizer.initialize(mockModelFiles)
    expect(recognizer.recognizer).toBeDefined()
  })

  it('should create audio stream', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()
    expect(recognizer.stream).toBeDefined()
  })

  it('should process audio samples', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()

    const samples = new Float32Array(16000) // 1 second
    recognizer.acceptWaveform(samples)

    const result = recognizer.getResult()
    expect(result).toBeDefined()
    expect(result.text).toBe('test')
  })

  it('should reset stream', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()

    recognizer.reset()
    expect(recognizer.stream).toBeDefined()
  })

  it('should free resources', async () => {
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()

    recognizer.free()
    expect(recognizer.recognizer).toBeNull()
    expect(recognizer.stream).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd D:/code/aigc-app
npm test -- src/lib/__tests__/sherpaRecognizer.test.js
```

Expected: FAIL - "Cannot find module '../sherpaRecognizer'"

- [ ] **Step 3: 编写识别器实现**

```javascript
// src/lib/sherpaRecognizer.js
import sherpa_onnx from 'sherpa-onnx'

export default class SherpaRecognizer {
  constructor() {
    this.recognizer = null
    this.stream = null
  }

  async initialize(modelFiles) {
    const config = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80
      },
      modelConfig: {
        transducer: {
          encoder: modelFiles.encoder,
          decoder: modelFiles.decoder,
          joiner: modelFiles.joiner
        },
        tokens: modelFiles.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: false
      }
    }

    this.recognizer = new sherpa_onnx.OnlineRecognizer(config)
  }

  createStream() {
    if (!this.recognizer) {
      throw new Error('Recognizer not initialized')
    }
    this.stream = this.recognizer.createStream()
  }

  acceptWaveform(samples) {
    if (!this.stream) {
      throw new Error('Stream not created')
    }
    this.stream.acceptWaveform(16000, samples)
  }

  isReady() {
    if (!this.recognizer || !this.stream) {
      return false
    }
    return this.recognizer.isReady(this.stream)
  }

  decode() {
    if (!this.recognizer || !this.stream) {
      throw new Error('Recognizer or stream not ready')
    }
    this.recognizer.decode(this.stream)
  }

  getResult() {
    if (!this.recognizer || !this.stream) {
      return { text: '', isFinal: false }
    }
    return this.recognizer.getResult(this.stream)
  }

  reset() {
    if (this.stream) {
      this.stream.free()
    }
    this.createStream()
  }

  free() {
    if (this.stream) {
      this.stream.free()
      this.stream = null
    }
    if (this.recognizer) {
      this.recognizer.free()
      this.recognizer = null
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd D:/code/aigc-app
npm test -- src/lib/__tests__/sherpaRecognizer.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sherpaRecognizer.js src/lib/__tests__/sherpaRecognizer.test.js
git commit -m "feat: add Sherpa-ONNX recognizer wrapper"
```

---

## Task 5: 重写 useSpeechRecognition composable

**Files:**
- Modify: `src/composables/useSpeechRecognition.js`
- Modify: `src/composables/__tests__/useSpeechRecognition.test.js`

- [ ] **Step 1: 编写新的测试**

```javascript
// src/composables/__tests__/useSpeechRecognition.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSpeechRecognition } from '../useSpeechRecognition'

// Mock model manager
vi.mock('../../lib/modelManager', () => ({
  loadModel: vi.fn().mockResolvedValue({
    encoder: new ArrayBuffer(30),
    decoder: new ArrayBuffer(5),
    joiner: new ArrayBuffer(10),
    tokens: 'token1\ntoken2\n'
  }),
  isCached: vi.fn().mockResolvedValue(true)
}))

// Mock SherpaRecognizer
vi.mock('../../lib/sherpaRecognizer', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      initialize: vi.fn(),
      createStream: vi.fn(),
      acceptWaveform: vi.fn(),
      getResult: vi.fn().mockReturnValue({ text: 'hello', isFinal: true }),
      reset: vi.fn(),
      free: vi.fn()
    }))
  }
})

// Mock Web Audio API
const mockMediaStream = {
  getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }])
}

const mockAudioContext = {
  createMediaStreamSource: vi.fn().mockReturnValue({
    connect: vi.fn()
  }),
  createScriptProcessor: vi.fn().mockReturnValue({
    connect: vi.fn(),
    onaudioprocess: null
  }),
  destination: {},
  close: vi.fn()
}

global.navigator.mediaDevices = {
  getUserMedia: vi.fn().mockResolvedValue(mockMediaStream)
}

global.AudioContext = vi.fn().mockImplementation(() => mockAudioContext)

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with correct default state', () => {
    const { isListening, isSupported, isLoading, transcript, error } = useSpeechRecognition()

    expect(isListening.value).toBe(false)
    expect(isSupported.value).toBe(false)
    expect(isLoading.value).toBe(false)
    expect(transcript.value).toBe('')
    expect(error.value).toBeNull()
  })

  it('should initialize recognizer', async () => {
    const { initialize, isSupported, isLoading } = useSpeechRecognition()

    await initialize()

    expect(isSupported.value).toBe(true)
    expect(isLoading.value).toBe(false)
  })

  it('should start listening', async () => {
    const { initialize, startListening, isListening } = useSpeechRecognition()

    await initialize()
    await startListening()

    expect(isListening.value).toBe(true)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
  })

  it('should stop listening', async () => {
    const { initialize, startListening, stopListening, isListening } = useSpeechRecognition()

    await initialize()
    await startListening()
    stopListening()

    expect(isListening.value).toBe(false)
  })

  it('should handle microphone permission denied', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
      new Error('Permission denied')
    )

    const { initialize, startListening, error } = useSpeechRecognition()
    await initialize()

    await startListening()

    expect(error.value).toBeTruthy()
    expect(error.value).toContain('麦克风权限')
  })

  it('should update transcript when receiving results', async () => {
    const { initialize, startListening, transcript } = useSpeechRecognition()

    await initialize()
    await startListening()

    // Simulate audio processing
    const processor = mockAudioContext.createScriptProcessor()
    if (processor.onaudioprocess) {
      processor.onaudioprocess({
        inputBuffer: {
          getChannelData: () => new Float32Array(4096)
        }
      })
    }

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(transcript.value).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd D:/code/aigc-app
npm test -- src/composables/__tests__/useSpeechRecognition.test.js
```

Expected: FAIL - 测试应该失败，因为 composable 还未更新

- [ ] **Step 3: 重写 useSpeechRecognition composable**

```javascript
// src/composables/useSpeechRecognition.js
import { ref, onBeforeUnmount } from 'vue'
import { loadModel } from '../lib/modelManager.js'
import SherpaRecognizer from '../lib/sherpaRecognizer.js'

export function useSpeechRecognition() {
  const isListening = ref(false)
  const isSupported = ref(false)
  const isLoading = ref(false)
  const transcript = ref('')
  const error = ref(null)

  let recognizer = null
  let audioContext = null
  let mediaStream = null
  let processor = null

  // Check if WebAssembly is supported
  function checkSupport() {
    try {
      if (typeof WebAssembly === 'object') {
        return true
      }
    } catch (e) {
      // WebAssembly not supported
    }
    return false
  }

  // Initialize the recognizer
  async function initialize() {
    if (!checkSupport()) {
      error.value = '您的浏览器不支持 WebAssembly，无法使用语音识别'
      return
    }

    isLoading.value = true
    error.value = null

    try {
      // Load model files
      const modelFiles = await loadModel()

      // Initialize Sherpa-ONNX recognizer
      recognizer = new SherpaRecognizer()
      await recognizer.initialize(modelFiles)

      isSupported.value = true
    } catch (e) {
      console.error('Failed to initialize speech recognition:', e)
      error.value = '语音识别初始化失败，请刷新页面重试'
      isSupported.value = false
    } finally {
      isLoading.value = false
    }
  }

  // Start listening to microphone
  async function startListening() {
    if (!isSupported.value) {
      error.value = '语音识别未初始化'
      return
    }

    if (isListening.value) {
      return
    }

    error.value = null

    try {
      // Get microphone access
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      // Create audio context
      audioContext = new AudioContext({ sampleRate: 16000 })

      // Create audio source
      const source = audioContext.createMediaStreamSource(mediaStream)

      // Create script processor
      processor = audioContext.createScriptProcessor(4096, 1, 1)

      // Create recognition stream
      recognizer.createStream()

      // Process audio data
      processor.onaudioprocess = (e) => {
        if (!isListening.value) return

        const samples = e.inputBuffer.getChannelData(0)

        // Feed audio to recognizer
        recognizer.acceptWaveform(samples)

        // Check if ready to decode
        if (recognizer.isReady()) {
          recognizer.decode()
        }

        // Get result
        const result = recognizer.getResult()
        if (result && result.text) {
          transcript.value = result.text
        }
      }

      // Connect audio nodes
      source.connect(processor)
      processor.connect(audioContext.destination)

      isListening.value = true
    } catch (e) {
      console.error('Failed to start listening:', e)

      if (e.name === 'NotAllowedError' || e.message.includes('Permission denied')) {
        error.value = '请允许麦克风权限以使用语音识别'
      } else {
        error.value = '无法访问麦克风，请检查设备设置'
      }

      cleanup()
    }
  }

  // Stop listening
  function stopListening() {
    if (!isListening.value) {
      return
    }

    isListening.value = false
    cleanup()
  }

  // Cleanup resources
  function cleanup() {
    if (processor) {
      processor.disconnect()
      processor = null
    }

    if (audioContext) {
      audioContext.close()
      audioContext = null
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop())
      mediaStream = null
    }

    if (recognizer) {
      recognizer.reset()
    }
  }

  // Cleanup on unmount
  onBeforeUnmount(() => {
    stopListening()
    if (recognizer) {
      recognizer.free()
      recognizer = null
    }
  })

  return {
    isListening,
    isSupported,
    isLoading,
    transcript,
    error,
    initialize,
    startListening,
    stopListening
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd D:/code/aigc-app
npm test -- src/composables/__tests__/useSpeechRecognition.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/composables/useSpeechRecognition.js src/composables/__tests__/useSpeechRecognition.test.js
git commit -m "feat: rewrite useSpeechRecognition with Sherpa-ONNX"
```

---

## Task 6: 更新 ImageGen.vue 集成新的语音识别

**Files:**
- Modify: `src/components/ImageGen.vue`

- [ ] **Step 1: 更新 ImageGen.vue 的 script 部分**

找到以下代码（约第 11-27 行）：

```javascript
// 语音识别
const {
  isListening,
  isSupported: isSpeechSupported,
  transcript: speechTranscript,
  error: speechError,
  toggleListening,
  stopListening
} = useSpeechRecognition()

// 监听语音识别结果，追加到 prompt
watch(speechTranscript, (newVal) => {
  if (newVal) {
    // 如果 prompt 为空，直接设置；否则追加
    prompt.value = prompt.value ? prompt.value + ' ' + newVal : newVal
  }
})
```

替换为：

```javascript
// 语音识别
const {
  isListening,
  isSupported: isSpeechSupported,
  isLoading: isSpeechLoading,
  transcript: speechTranscript,
  error: speechError,
  initialize: initSpeechRecognition,
  startListening,
  stopListening: stopSpeechListening
} = useSpeechRecognition()

// 监听语音识别结果，追加到 prompt
watch(speechTranscript, (newVal) => {
  if (newVal) {
    // 如果 prompt 为空，直接设置；否则追加
    prompt.value = prompt.value ? prompt.value + ' ' + newVal : newVal
  }
})

// 切换语音识别状态
function toggleSpeechRecognition() {
  if (isListening.value) {
    stopSpeechListening()
  } else {
    startListening()
  }
}

// 在组件挂载时初始化语音识别
onMounted(async () => {
  await initSpeechRecognition()
})
```

- [ ] **Step 2: 更新麦克风按钮的模板**

找到以下代码（约第 1389-1412 行）：

```vue
<button
  v-if="isSpeechSupported"
  type="button"
  class="voice-btn"
  :class="{ listening: isListening, disabled: isGenerating }"
  :title="isListening ? '点击停止录音' : '点击开始语音输入'"
  :disabled="isGenerating"
  @click="toggleListening"
>
```

替换为：

```vue
<button
  v-if="isSpeechSupported"
  type="button"
  class="voice-btn"
  :class="{
    listening: isListening,
    loading: isSpeechLoading,
    disabled: isGenerating || isSpeechLoading
  }"
  :title="isSpeechLoading ? '正在加载语音识别...' : (isListening ? '点击停止录音' : '点击开始语音输入')"
  :disabled="isGenerating || isSpeechLoading"
  @click="toggleSpeechRecognition"
>
```

- [ ] **Step 3: 更新加载状态的 SVG 图标**

找到以下代码（约第 1398-1405 行）：

```vue
<svg v-if="isListening" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
    <animate attributeName="r" values="8;12;8" dur="1.5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite"/>
  </circle>
</svg>
<svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
  <line x1="12" y1="19" x2="12" y2="23"/>
  <line x1="8" y1="23" x2="16" y2="23"/>
</svg>
```

替换为：

```vue
<svg v-if="isSpeechLoading" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
  <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"/>
</svg>
<svg v-else-if="isListening" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
    <animate attributeName="r" values="8;12;8" dur="1.5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite"/>
  </circle>
</svg>
<svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
  <line x1="12" y1="19" x2="12" y2="23"/>
  <line x1="8" y1="23" x2="16" y2="23"/>
</svg>
```

- [ ] **Step 4: 更新样式部分**

找到以下样式代码（约第 2090-2136 行）：

```css
.voice-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border: none;
  background: #f5f5f5;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  transition: all 0.2s ease;
  padding: 0;
}

.voice-btn:hover:not(.disabled) {
  background: #e8e8e8;
  color: #333;
}

.voice-btn.listening {
  background: #4b9ef8;
  color: white;
  box-shadow: 0 0 0 3px rgba(75, 158, 248, 0.3);
  animation: pulse 1.5s ease-in-out infinite;
}

.voice-btn.listening:hover {
  background: #3a8de6;
}

.voice-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(75, 158, 248, 0.3);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(75, 158, 248, 0.15);
  }
}
```

替换为：

```css
.voice-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border: none;
  background: #f5f5f5;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  transition: all 0.2s ease;
  padding: 0;
}

.voice-btn:hover:not(.disabled) {
  background: #e8e8e8;
  color: #333;
}

.voice-btn.loading {
  background: #e0e0e0;
  color: #999;
}

.voice-btn.listening {
  background: #4b9ef8;
  color: white;
  box-shadow: 0 0 0 3px rgba(75, 158, 248, 0.3);
  animation: pulse 1.5s ease-in-out infinite;
}

.voice-btn.listening:hover {
  background: #3a8de6;
}

.voice-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(75, 158, 248, 0.3);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(75, 158, 248, 0.15);
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
}
```

- [ ] **Step 5: 更新错误提示**

找到以下代码（约第 1413 行之后）：

```vue
</button>
```

在其后添加错误提示：

```vue
</button>
<div v-if="speechError" class="speech-error-tooltip">
  {{ speechError }}
</div>
```

在样式部分添加：

```css
.speech-error-tooltip {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: #ff4444;
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  margin-bottom: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.speech-error-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  right: 12px;
  border: 6px solid transparent;
  border-top-color: #ff4444;
}
```

- [ ] **Step 6: 运行测试验证**

```bash
cd D:/code/aigc-app
npm test
```

Expected: 所有测试通过

- [ ] **Step 7: Commit**

```bash
git add src/components/ImageGen.vue
git commit -m "feat: integrate Sherpa-ONNX speech recognition into ImageGen"
```

---

## Task 7: 运行完整测试并验证功能

**Files:**
- None (手动测试)

- [ ] **Step 1: 运行所有单元测试**

```bash
cd D:/code/aigc-app
npm test
```

Expected: 所有测试通过

- [ ] **Step 2: 启动开发服务器**

```bash
cd D:/code/aigc-app
npm run dev
```

- [ ] **Step 3: 手动测试功能**

1. 打开浏览器访问 http://localhost:5173
2. 检查麦克风按钮是否显示
3. 点击麦克风按钮
4. 允许麦克风权限
5. 说话测试识别功能
6. 再次点击停止录音
7. 检查识别结果是否正确填入输入框

- [ ] **Step 4: 测试错误场景**

1. 拒绝麦克风权限，检查错误提示
2. 在不支持 WebAssembly 的浏览器中测试

- [ ] **Step 5: Commit 最终版本**

```bash
git add -A
git commit -m "feat: complete Sherpa-ONNX speech recognition integration"
```

---

## Task 8: 更新文档

**Files:**
- Modify: `docs/voice-recognition.md`

- [ ] **Step 1: 更新语音识别文档**

```bash
cat > docs/voice-recognition.md << 'EOF'
# 语音识别功能

## 功能简介

在提示词输入框中集成了 Sherpa-ONNX WebAssembly 语音识别功能，支持离线语音输入，无需网络连接。

## 特性

- ✅ **完全离线**: 所有处理在本地完成，无需网络
- ✅ **浏览器兼容**: 支持 Chrome、Firefox、Edge、Safari 等现代浏览器
- ✅ **中英文双语**: 支持中文和英文混合识别
- ✅ **实时识别**: 流式识别，延迟低
- ✅ **隐私保护**: 语音数据不会离开用户设备

## 使用方法

1. **开启语音输入**: 点击输入框右下角的麦克风图标按钮
2. **开始说话**: 按钮变为蓝色并显示脉冲动画，表示正在录音
3. **查看结果**: 识别到的文字会自动填入输入框
4. **停止录音**: 再次点击麦克风按钮停止录音

## 首次使用

首次使用时，应用会自动下载语音识别模型（约 80MB）。下载完成后，模型会被缓存到浏览器中，后续使用无需重复下载。

## 浏览器兼容性

| 浏览器 | 支持情况 |
|--------|----------|
| Chrome 57+ | ✅ 完全支持 |
| Firefox 52+ | ✅ 完全支持 |
| Edge 16+ | ✅ 完全支持 |
| Safari 11+ | ✅ 完全支持 |
| IE | ❌ 不支持 |

## 技术实现

### 使用的技术

- **Sherpa-ONNX**: 开源语音识别工具包
- **WebAssembly**: 在浏览器中运行本地代码
- **Web Audio API**: 获取麦克风音频流
- **IndexedDB**: 缓存模型文件

### 文件结构

```
src/
├── lib/
│   ├── modelManager.js         # 模型加载和缓存管理
│   └── sherpaRecognizer.js     # Sherpa-ONNX 封装
├── composables/
│   └── useSpeechRecognition.js # Vue 3 组合式 API
└── components/
    └── ImageGen.vue            # 主组件
```

## 常见问题

### Q: 为什么首次使用需要下载模型？

A: 语音识别需要机器学习模型来进行语音转文字。模型文件约 80MB，下载后会缓存在浏览器中，后续使用无需重复下载。

### Q: 语音识别准确率如何？

A: 使用 Sherpa-ONNX 的 Zipformer 模型，中英文识别准确率较高。识别效果可能受到口音、语速、环境噪音等因素影响。

### Q: 如何清除缓存的模型？

A: 可以通过浏览器的开发者工具清除 IndexedDB 数据，或者使用代码调用 `clearCache()` 方法。

### Q: 支持哪些语言？

A: 当前支持中文和英文混合识别。未来可以添加更多语言支持。

## 故障排除

### 麦克风无法访问

1. 检查浏览器权限设置
2. 确保使用 HTTPS 或 localhost
3. 检查操作系统麦克风权限

### 识别不准确

1. 确保环境安静
2. 说话清晰，语速适中
3. 靠近麦克风

### 初始化失败

1. 检查浏览器是否支持 WebAssembly
2. 刷新页面重试
3. 清除浏览器缓存后重试

## API 参考

### useSpeechRecognition()

返回以下响应式状态和方法：

| 属性/方法 | 类型 | 说明 |
|-----------|------|------|
| `isListening` | `Ref<boolean>` | 是否正在录音 |
| `isSupported` | `Ref<boolean>` | 是否支持语音识别 |
| `isLoading` | `Ref<boolean>` | 是否正在加载模型 |
| `transcript` | `Ref<string>` | 识别到的文本 |
| `error` | `Ref<string>` | 错误信息 |
| `initialize()` | `Function` | 初始化识别器 |
| `startListening()` | `Function` | 开始录音 |
| `stopListening()` | `Function` | 停止录音 |

## 更新日志

### v2.0.0

- 从 Web Speech API 迁移到 Sherpa-ONNX WebAssembly
- 支持完全离线使用
- 提升浏览器兼容性
- 改进识别准确率
EOF
```

- [ ] **Step 2: Commit**

```bash
git add docs/voice-recognition.md
git commit -m "docs: update voice recognition documentation for Sherpa-ONNX"
```

---

## 自检清单

在完成所有任务后，检查以下内容：

- [ ] 所有单元测试通过
- [ ] 模型下载脚本正常工作
- [ ] 麦克风权限处理正确
- [ ] 错误提示显示正确
- [ ] 加载状态显示正确
- [ ] 识别结果正确填入输入框
- [ ] 浏览器兼容性良好
- [ ] 文档更新完整

---

## 执行选项

**计划完成并保存到 `docs/superpowers/plans/2026-06-12-sherpa-onnx-speech-recognition.md`**

两种执行方式：

**1. Subagent-Driven (推荐)** - 每个任务派发一个新的子代理，任务间进行审查，快速迭代

**2. Inline Execution** - 在当前会话中执行任务，批量执行并设置检查点

你选择哪种方式？
