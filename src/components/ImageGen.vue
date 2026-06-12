<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ToolbarPanel from './ToolbarPanel.vue'
import { useComfyUI } from '../composables/useComfyUI.js'
import { useSpeechRecognition } from '../composables/useSpeechRecognition.js'
import comfyuiConfig from '../config/comfyui.js'
import workflows from '../workflows/index.js'

const { isGenerating, result, error, submit, uploadImage, cancel } = useComfyUI()

const prompt = ref('')

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
const activePanel = ref(null)
const conversationRef = ref(null)
const sourceImageInputRef = ref(null)
const sourceImageFile = ref(null)
const sourceImagePreview = ref('')
const itemImageInputRef = ref(null)
const itemImageFile = ref(null)
const itemImagePreview = ref('')

const IMAGE_SOURCE_MODES = new Set(['image_to_image', 'image_to_video', 'replace_item'])
const ITEM_SOURCE_MODES = new Set(['replace_item'])
const REPLACE_ITEM_IMAGE_NODE_IDS = ['78', '139']

const TEMPLATES_KEY = 'aigc_templates'
const MESSAGES_KEY = 'aigc_messages'
const IMAGE_DB_NAME = 'aigc_images'
const IMAGE_DB_STORE = 'blobs'
const DEFAULT_TEMPLATES = [
  { id: 'tpl-1', color: '#5B8FD4' },
  { id: 'tpl-2', color: '#8B5CF6' },
  { id: 'tpl-3', color: '#5BB8D4' },
  { id: 'tpl-4', color: '#C9A84C' },
]

let uidCounter = 0

let imageDBPromise = null
const localObjectURLById = new Map()

function openImageDB() {
  if (imageDBPromise) return imageDBPromise
  imageDBPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IMAGE_DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IMAGE_DB_STORE)) {
        db.createObjectStore(IMAGE_DB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('open indexedDB failed'))
  })
  return imageDBPromise
}

async function idbPutBlob(key, blob) {
  if (!key || !blob) return
  const db = await openImageDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('idb put failed'))
    tx.objectStore(IMAGE_DB_STORE).put(blob, key)
  })
}

async function idbGetBlob(key) {
  if (!key) return null
  const db = await openImageDB()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readonly')
    const req = tx.objectStore(IMAGE_DB_STORE).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error || new Error('idb get failed'))
  })
}

async function ensureLocalObjectURL(imageId) {
  if (!imageId) return ''
  const existing = localObjectURLById.get(imageId)
  if (existing) return existing
  const blob = await idbGetBlob(imageId)
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  localObjectURLById.set(imageId, url)
  return url
}

function makeUid(prefix = 'id') {
  uidCounter += 1
  return `${prefix}-${Date.now()}-${uidCounter}-${Math.random().toString(16).slice(2, 8)}`
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function normalizeTemplates(rawTemplates) {
  if (!Array.isArray(rawTemplates)) return [...DEFAULT_TEMPLATES]

  const seen = new Set()
  const normalized = rawTemplates
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const next = {}
      const id = item.id != null ? String(item.id) : makeUid('tpl')
      if (typeof item.imageURL === 'string' && item.imageURL) {
        next.imageURL = item.imageURL
        // 保留 IndexedDB 中的缓存 key
        if (typeof item.imageId === 'string' && item.imageId) {
          next.imageId = item.imageId
        }
      } else {
        next.color = typeof item.color === 'string' ? item.color : '#C9A84C'
      }
      next.id = id
      return next
    })
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })

  return normalized.length ? normalized : [...DEFAULT_TEMPLATES]
}

function normalizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return []

  const seen = new Set()

  return rawMessages
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const role = item.role === 'user' ? 'user' : 'assistant'
      let id = item.id != null ? String(item.id) : makeUid('msg')
      while (seen.has(id)) id = makeUid('msg')
      seen.add(id)

      const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : Date.now() + index

      if (role === 'user') {
        const text = typeof item.text === 'string' ? item.text : ''
        // Avoid persisting huge base64 dataURLs into localStorage (can break refresh/history).
        const sourceImageURLRaw = typeof item.sourceImageURL === 'string' ? item.sourceImageURL : ''
        const sourceImageURL = sourceImageURLRaw.startsWith('data:') ? '' : sourceImageURLRaw
        const sourceImageId = typeof item.sourceImageId === 'string' ? item.sourceImageId : ''
        const sourceImage2URLRaw = typeof item.sourceImage2URL === 'string' ? item.sourceImage2URL : ''
        const sourceImage2URL = sourceImage2URLRaw.startsWith('data:') ? '' : sourceImage2URLRaw
        const sourceImage2Id = typeof item.sourceImage2Id === 'string' ? item.sourceImage2Id : ''
        return text.trim()
          ? { id, role, text, sourceImageURL, sourceImageId, sourceImage2URL, sourceImage2Id, createdAt }
          : null
      }

      const imageURL = typeof item.imageURL === 'string' ? item.imageURL : ''
      const errorText = typeof item.error === 'string' ? item.error : ''
      const imageId = typeof item.imageId === 'string' ? item.imageId : ''
      const mediaType = item.mediaType === 'video' ? 'video' : 'image'
      let status = item.status
      if (status !== 'generating' && status !== 'done' && status !== 'error') {
        status = imageURL ? 'done' : (errorText ? 'error' : 'done')
      }

      return {
        id,
        role: 'assistant',
        status,
        imageURL,
        imageId,
        mediaType: imageURL && mediaType === 'video' ? 'video' : 'image',
        error: errorText,
        createdAt,
      }
    })
    .filter(Boolean)
}

const templates = ref(normalizeTemplates(readStorage(TEMPLATES_KEY, DEFAULT_TEMPLATES)))
const messages = ref(normalizeMessages(readStorage(MESSAGES_KEY, [])))
const history = computed(() => messages.value
  .filter((item) => item.role === 'assistant' && (item.localImageURL || item.imageURL)))

watch(templates, (val) => {
  try {
    // 排除 blob URL（刷新后无效）和缓存 ID（仅运行时使用）
    const slim = val.map((tpl) => {
      const { localImageURL, ...rest } = tpl
      return rest
    })
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(slim))
  } catch (e) {
    console.warn('[ImageGen] 模板 localStorage 写入失败:', e.message)
  }
}, { deep: true })

watch(messages, async (val) => {
  try {
    // 仅存储元数据，不存储刷新后无效的 blob URL
    const slim = val.map((msg) => {
      const { localImageURL, localSourceImageURL, localSourceImage2URL, ...rest } = msg
      return rest
    })
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(slim))
  } catch (e) {
    console.warn('[ImageGen] localStorage 写入失败，部分数据可能未持久化:', e.message)
  }
  await nextTick()
  if (conversationRef.value) {
    conversationRef.value.scrollTop = conversationRef.value.scrollHeight
  }
}, { deep: true, immediate: true })

const selected = reactive({
  ratio: '1:1',
  style: '写实摄影',
  quality: '超高清',
  angle: '景深虚化',
  color: '电影感',
  lighting: '摄影棚光',
  width: 1024,
  height: 1024,
  mode: 'text_to_image',
})

const requiresSourceImage = computed(() => IMAGE_SOURCE_MODES.has(selected.mode))
const requiresItemImage = computed(() => ITEM_SOURCE_MODES.has(selected.mode))

const modeButtons = [
  { key: 'text_to_image', label: '文生图', workflowKey: 'textToImage' },
  { key: 'image_to_image', label: '图生图', workflowKey: 'imageToImage' },
  { key: 'text_to_video', label: '文生视频', workflowKey: 'textToVideo' },
  { key: 'image_to_video', label: '图生视频', workflowKey: 'imageToVideo' },
  { key: 'replace_item', label: '替换物品', workflowKey: 'outfitChange' },
]

const RATIO_DIMENSIONS = {
  '1:1': { width: 1024, height: 1024 },
  '2:3': { width: 832, height: 1216 },
  '3:4': { width: 960, height: 1280 },
  '4:3': { width: 1280, height: 960 },
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1344, height: 768 },
}

/** LTX 文生视频工作流默认画布（EmptyImage 92:89） */
const TEXT_TO_VIDEO_DEFAULT = { ratio: '16:9 宽屏', width: 1280, height: 720 }

const panels = {
  ratio: {
    label: '比例',
    options: ['1:1 正方形', '2:3 竖图', '3:4 经典竖幅', '4:3 经典横幅', '9:16 手机竖屏', '16:9 宽屏'],
    display: (v) => v.split(' ')[0],
  },
  style: {
    label: '风格',
    options: [
      '写实摄影',
      '日系动漫',
      '赛博朋克',
      '水墨国风',
      '3D 渲染',
      '蒸汽朋克',
      '像素风',
      '卡通Q版风格：masterpiece, 最佳质量，8K，超高清，3D渲染，皮克斯卡通风格，Q版',
    ],
  },
  quality: {
    label: '质感',
    options: ['超高清', '皮肤纹理', '金属质感', '水墨晕染', '厚涂油彩', '玻璃材质'],
  },
  angle: {
    label: '视角',
    options: ['景深虚化', '广角全景', '半身像', '全身像', '仰拍', '俯拍', '特写'],
  },
  color: {
    label: '色调',
    options: ['电影感', '莫兰迪', '黑白经典', '复古胶片', '霓虹赛博', '暗黑哥特'],
  },
  lighting: {
    label: '灯光',
    options: ['摄影棚光', '电影布光', '自然光', '逆光'],
  },
}

const descriptiveFields = ['style', 'quality', 'angle', 'color', 'lighting']

function togglePanel(name) {
  activePanel.value = activePanel.value === name ? null : name
}

function selectOption(field, value) {
  selected[field] = value

  if (field === 'ratio') {
    const ratio = typeof value === 'string' ? value.split(' ')[0] : ''
    if (selected.mode === 'text_to_video' && ratio === '16:9') {
      selected.width = TEXT_TO_VIDEO_DEFAULT.width
      selected.height = TEXT_TO_VIDEO_DEFAULT.height
    } else {
      const dims = RATIO_DIMENSIONS[ratio]
      if (dims) {
        selected.width = dims.width
        selected.height = dims.height
      }
    }
  }

  if (descriptiveFields.includes(field)) {
    const current = prompt.value.trim()
    prompt.value = current ? `${current}, ${value}` : value
  }

  activePanel.value = null
}

function clampResolution(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 1024
  return Math.min(4096, Math.max(64, Math.round(num)))
}

function getSelectedRatioPair() {
  const ratio = typeof selected.ratio === 'string' ? selected.ratio.split(' ')[0] : ''
  const [w, h] = ratio.split(':').map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

function syncLinkedResolution(field) {
  const ratioPair = getSelectedRatioPair()
  if (!ratioPair) return

  if (field === 'width') {
    const width = Number(selected.width)
    if (!Number.isFinite(width)) return
    selected.height = clampResolution(width * ratioPair.h / ratioPair.w)
    return
  }

  if (field === 'height') {
    const height = Number(selected.height)
    if (!Number.isFinite(height)) return
    selected.width = clampResolution(height * ratioPair.w / ratioPair.h)
  }
}

function syncResolution(field) {
  selected[field] = clampResolution(selected[field])
  syncLinkedResolution(field)
}

function selectMode(modeKey) {
  selected.mode = modeKey
  if (modeKey === 'text_to_video') {
    selected.ratio = TEXT_TO_VIDEO_DEFAULT.ratio
    selected.width = TEXT_TO_VIDEO_DEFAULT.width
    selected.height = TEXT_TO_VIDEO_DEFAULT.height
  }
  activePanel.value = null
}

function triggerSourceImagePicker() {
  if (isGenerating.value) return
  sourceImageInputRef.value?.click()
}

function triggerItemImagePicker() {
  if (isGenerating.value) return
  itemImageInputRef.value?.click()
}

function clearSourceImage() {
  sourceImageFile.value = null
  if (sourceImagePreview.value) {
    URL.revokeObjectURL(sourceImagePreview.value)
    sourceImagePreview.value = ''
  }
  if (sourceImageInputRef.value) {
    sourceImageInputRef.value.value = ''
  }
}

function clearItemImage() {
  itemImageFile.value = null
  if (itemImagePreview.value) {
    URL.revokeObjectURL(itemImagePreview.value)
    itemImagePreview.value = ''
  }
  if (itemImageInputRef.value) {
    itemImageInputRef.value.value = ''
  }
}

function clearAllSourceImages() {
  clearSourceImage()
  clearItemImage()
}

function getImageFileFromClipboard(data) {
  if (!data) return null
  for (const item of data.items || []) {
    if (item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) return f
    }
  }
  const files = data.files
  if (files?.length) {
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i]
      if (f?.type?.startsWith('image/')) return f
    }
  }
  return null
}

function applyImageFile(file, target) {
  const targetFile = target === 'item' ? itemImageFile : sourceImageFile
  const targetPreview = target === 'item' ? itemImagePreview : sourceImagePreview
  const targetInput = target === 'item' ? itemImageInputRef : sourceImageInputRef
  const clearImage = target === 'item' ? clearItemImage : clearSourceImage

  if (!file) {
    clearImage()
    return
  }

  if (!file.type.startsWith('image/')) {
    alert('请上传图片文件')
    clearImage()
    return
  }

  if (targetPreview.value) {
    URL.revokeObjectURL(targetPreview.value)
  }

  targetFile.value = file
  targetPreview.value = URL.createObjectURL(file)
  if (targetInput.value) {
    targetInput.value.value = ''
  }
}

function applySourceImageFile(file) {
  applyImageFile(file, 'source')
}

function applyItemImageFile(file) {
  applyImageFile(file, 'item')
}

function handleSourceImageChange(event) {
  const [file] = event.target?.files || []
  if (!file) {
    clearSourceImage()
    return
  }
  applySourceImageFile(file)
}

function handleItemImageChange(event) {
  const [file] = event.target?.files || []
  if (!file) {
    clearItemImage()
    return
  }
  applyItemImageFile(file)
}

function handlePasteImageInInputArea(event) {
  if (isGenerating.value) return
  const file = getImageFileFromClipboard(event.clipboardData)
  if (!file) return
  event.preventDefault()
  event.stopPropagation()
  if (!requiresSourceImage.value) {
    selected.mode = selected.mode === 'text_to_video' ? 'image_to_video' : 'image_to_image'
  }
  if (requiresItemImage.value && sourceImageFile.value && !itemImageFile.value) {
    applyItemImageFile(file)
  } else {
    applySourceImageFile(file)
  }
}

function getUploadedImageValue(uploadResult) {
  if (!uploadResult?.name) return ''
  return uploadResult.subfolder ? `${uploadResult.subfolder}/${uploadResult.name}` : uploadResult.name
}

function injectSourceImage(workflow, sourceImageName) {
  if (!sourceImageName) return false

  // 图生视频 LTX 工作流：LoadImage 节点（如 "98"）
  for (const node of Object.values(workflow)) {
    if (node?.class_type === 'LoadImage' && typeof node.inputs?.image === 'string') {
      node.inputs.image = sourceImageName
      return true
    }
  }

  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== 'object') continue
    if (typeof node.inputs?.image === 'string') {
      node.inputs.image = sourceImageName
      return true
    }
  }

  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== 'object') continue
    if (typeof node.inputs?.image_path === 'string') {
      node.inputs.image_path = sourceImageName
      return true
    }
  }

  return false
}

function injectSourceImageByNodeId(workflow, nodeId, sourceImageName) {
  if (!sourceImageName) return false
  const node = workflow?.[nodeId]
  if (!node?.inputs) return false

  if (typeof node.inputs.image === 'string') {
    node.inputs.image = sourceImageName
    return true
  }

  if (typeof node.inputs.image_path === 'string') {
    node.inputs.image_path = sourceImageName
    return true
  }

  return false
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPreviewKeydown, true)
  clearAllSourceImages()
  for (const url of localObjectURLById.values()) {
    URL.revokeObjectURL(url)
  }
  localObjectURLById.clear()
  // 重置 DB promise，避免 HMR 后持有已关闭的数据库连接
  if (imageDBPromise) {
    imageDBPromise.then((db) => db.close()).catch(() => {})
    imageDBPromise = null
  }
})

onMounted(async () => {
  hydrateLocalImagesFromMessages()
  hydrateTemplateImages()
  await initSpeechRecognition()
})

function addToTemplate(imageURL) {
  if (!imageURL) return
  const id = makeUid('tpl')
  templates.value.unshift({ id, imageURL })
  // 异步缓存模板图片到 IndexedDB
  cacheImageURLToId(imageURL, `template:${id}`).then((cached) => {
    if (cached) {
      const idx = templates.value.findIndex((t) => t.id === id)
      if (idx !== -1) {
        templates.value[idx] = { ...templates.value[idx], imageId: `template:${id}` }
      }
    }
  })
}

function removeTemplate(templateId) {
  templates.value = templates.value.filter((item) => item.id !== templateId)
}

const previewOpen = ref(false)
const previewIndex = ref(0)
const previewMaskRef = ref(null)

const previewGallery = computed(() => history.value)

const previewCurrentMsg = computed(() => previewGallery.value[previewIndex.value] || null)

const previewImage = computed(() => {
  const msg = previewCurrentMsg.value
  return msg ? (msg.localImageURL || msg.imageURL) : ''
})

const previewIsVideo = computed(() => isMessageVideo(previewCurrentMsg.value))

const previewCounterText = computed(() => {
  const n = previewGallery.value.length
  if (n <= 1) return ''
  return `${previewIndex.value + 1} / ${n}`
})

function openPreview(assistantMsg) {
  if (!assistantMsg || assistantMsg.role !== 'assistant') return
  const url = assistantMsg.localImageURL || assistantMsg.imageURL
  if (!url) return
  const list = previewGallery.value
  const idx = list.findIndex((m) => m.id === assistantMsg.id)
  previewIndex.value = idx >= 0 ? idx : 0
  previewOpen.value = true
  nextTick(() => previewMaskRef.value?.focus())
}

function closePreview() {
  previewOpen.value = false
}

function previewShowNext() {
  const list = previewGallery.value
  if (previewIndex.value < list.length - 1) previewIndex.value += 1
}

function previewShowPrev() {
  if (previewIndex.value > 0) previewIndex.value -= 1
}

let previewTouchStartX = 0
let previewPointerDown = false

function onPreviewTouchStart(e) {
  if (!isPreviewSwipeTarget(e.target)) return
  previewTouchStartX = e.touches?.[0]?.clientX ?? 0
}

function onPreviewTouchEnd(e) {
  const list = previewGallery.value
  if (list.length <= 1) return
  const x = e.changedTouches?.[0]?.clientX ?? 0
  const dx = x - previewTouchStartX
  const threshold = 48
  if (dx < -threshold) previewShowNext()
  else if (dx > threshold) previewShowPrev()
}

function isPreviewSwipeTarget(target) {
  return target instanceof Element && Boolean(target.closest('.preview-media'))
}

function onPreviewPointerDown(e) {
  if (e.pointerType === 'touch') return
  if (e.button !== 0) return
  if (!isPreviewSwipeTarget(e.target)) return
  previewPointerDown = true
  previewTouchStartX = e.clientX
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // ignore
  }
}

function onPreviewPointerUp(e) {
  if (e.pointerType === 'touch') return
  if (!previewPointerDown) return
  previewPointerDown = false
  try {
    e.currentTarget.releasePointerCapture(e.pointerId)
  } catch {
    // ignore
  }
  const list = previewGallery.value
  if (list.length <= 1) return
  const dx = e.clientX - previewTouchStartX
  const threshold = 48
  if (dx < -threshold) previewShowNext()
  else if (dx > threshold) previewShowPrev()
}

function onPreviewPointerCancel(e) {
  if (e.pointerType === 'touch') return
  previewPointerDown = false
}

function onPreviewKeydown(e) {
  if (!previewOpen.value) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    previewShowPrev()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    previewShowNext()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closePreview()
  }
}

watch(previewOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onPreviewKeydown, true)
  } else {
    window.removeEventListener('keydown', onPreviewKeydown, true)
  }
})

function clearHistory() {
  if (!messages.value.length) return
  const ok = window.confirm('确认清空当前对话与生成历史吗？')
  if (!ok) return
  messages.value = []
  closePreview()
}

function removeMessage(messageId) {
  const idx = messages.value.findIndex((item) => item.id === messageId)
  if (idx === -1) return

  const msg = messages.value[idx]
  // 删除时连带配对消息一起移除
  if (msg.role === 'user' && idx + 1 < messages.value.length && messages.value[idx + 1].role === 'assistant') {
    messages.value.splice(idx, 2)
  } else if (msg.role === 'assistant' && idx > 0 && messages.value[idx - 1].role === 'user') {
    messages.value.splice(idx - 1, 2)
  } else {
    messages.value.splice(idx, 1)
  }
}

function removeHistoryItem(messageId) {
  const currentPreviewId = previewOpen.value
    ? previewGallery.value[previewIndex.value]?.id
    : null
  const target = messages.value.find((item) => item.id === messageId)
  removeMessage(messageId)
  if (!previewOpen.value) return
  if (currentPreviewId === messageId) {
    const list = previewGallery.value
    if (!list.length) closePreview()
    else previewIndex.value = Math.min(previewIndex.value, list.length - 1)
  }
}

async function downloadResult(imageURL) {
  if (!imageURL) return
  try {
    const response = await fetch(imageURL)
    if (!response.ok) throw new Error(`download failed: ${response.status}`)
    const blob = await response.blob()
    const objectURL = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectURL

    // 优先从 Content-Type 判断扩展名，其次从 URL 中推断
    const mimeToExt = (mime) => {
      if (/video\//.test(mime)) return mime.split('/')[1]?.replace(/^x-/, '') || 'mp4'
      if (/image\//.test(mime)) return mime.split('/')[1] || 'png'
      return null
    }
    const ext = mimeToExt(response.headers.get('content-type'))
      || mimeToExt(blob.type)
      || imageURL.match(/\.(\w+)(?:\?|#|$|&)/i)?.[1]
      || (isVideoURL(imageURL) ? 'mp4' : 'png')
    link.download = `aigc-${Date.now()}.${ext}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectURL)
  } catch {
    alert('下载失败，请稍后重试')
  }
}

function appendMessagePair(userPrompt, sourceImageURL = '', sourceImage2URL = '') {
  const ts = Date.now()
  const userId = makeUid('u')
  const assistantId = makeUid('a')

  messages.value.push(
    { id: userId, role: 'user', text: userPrompt, sourceImageURL, sourceImage2URL, createdAt: ts },
    { id: assistantId, role: 'assistant', status: 'generating', imageURL: '', error: '', createdAt: ts + 1 },
  )

  return assistantId
}

function updateAssistantMessage(id, patch) {
  const idx = messages.value.findIndex((msg) => msg.id === id)
  if (idx === -1) return
  messages.value[idx] = { ...messages.value[idx], ...patch }
}

function updateUserMessageByAssistantId(assistantId, patch) {
  const idx = messages.value.findIndex((msg) => msg.id === assistantId)
  if (idx <= 0) return
  const userMsg = messages.value[idx - 1]
  if (!userMsg || userMsg.role !== 'user') return
  messages.value[idx - 1] = { ...userMsg, ...patch }
}

async function cacheImageURLToId(imageURL, imageId) {
  if (!imageURL || !imageId) return false
  try {
    const res = await fetch(imageURL)
    if (!res.ok) {
      console.warn(`[ImageGen] 缓存图片失败: HTTP ${res.status}`, imageURL)
      return false
    }
    const blob = await res.blob()
    if (!blob || blob.size === 0) {
      console.warn('[ImageGen] 缓存图片失败: 空响应', imageURL)
      return false
    }
    await idbPutBlob(imageId, blob)
    return true
  } catch (e) {
    console.warn('[ImageGen] 缓存图片失败:', e.message, imageURL)
    return false
  }
}

async function cacheFileToId(file, imageId) {
  if (!file || !imageId) return
  try {
    await idbPutBlob(imageId, file)
  } catch {
    // ignore caching failures
  }
}

async function hydrateLocalImagesFromMessages() {
  const list = messages.value || []
  await Promise.all(list.map(async (msg) => {
    if (msg?.role === 'assistant' && msg.imageId) {
      let localURL = await ensureLocalObjectURL(msg.imageId)
      // IndexedDB 中没有缓存，尝试从 ComfyUI 服务端重新拉取
      if (!localURL && msg.imageURL) {
        const cached = await cacheImageURLToId(msg.imageURL, msg.imageId)
        if (cached) localURL = await ensureLocalObjectURL(msg.imageId)
      }
      if (localURL) updateAssistantMessage(msg.id, { localImageURL: localURL })
    }
    if (msg?.role === 'user' && msg.sourceImageId) {
      let localURL = await ensureLocalObjectURL(msg.sourceImageId)
      if (!localURL && msg.sourceImageURL) {
        const cached = await cacheImageURLToId(msg.sourceImageURL, msg.sourceImageId)
        if (cached) localURL = await ensureLocalObjectURL(msg.sourceImageId)
      }
      if (!localURL) return
      const idx = messages.value.findIndex((m) => m.id === msg.id)
      if (idx !== -1) {
        messages.value[idx] = { ...messages.value[idx], localSourceImageURL: localURL }
      }
    }
    if (msg?.role === 'user' && msg.sourceImage2Id) {
      let localURL = await ensureLocalObjectURL(msg.sourceImage2Id)
      if (!localURL && msg.sourceImage2URL) {
        const cached = await cacheImageURLToId(msg.sourceImage2URL, msg.sourceImage2Id)
        if (cached) localURL = await ensureLocalObjectURL(msg.sourceImage2Id)
      }
      if (!localURL) return
      const idx = messages.value.findIndex((m) => m.id === msg.id)
      if (idx !== -1) {
        messages.value[idx] = { ...messages.value[idx], localSourceImage2URL: localURL }
      }
    }
  }))
}

async function hydrateTemplateImages() {
  const list = templates.value || []
  await Promise.all(list.map(async (tpl) => {
    if (!tpl.imageURL) return
    // 优先用 IndexedDB 缓存
    const imageId = tpl.imageId || `template:${tpl.id}`
    let localURL = await ensureLocalObjectURL(imageId)
    if (!localURL) {
      // IndexedDB 中没有，尝试从 ComfyUI 服务端拉取并缓存
      const cached = await cacheImageURLToId(tpl.imageURL, imageId)
      if (cached) {
        localURL = await ensureLocalObjectURL(imageId)
        // 回写 imageId 以便下次快速查找
        const idx = templates.value.findIndex((t) => t.id === tpl.id)
        if (idx !== -1 && !templates.value[idx].imageId) {
          templates.value[idx] = { ...templates.value[idx], imageId }
        }
      }
    }
    if (localURL) {
      const idx = templates.value.findIndex((t) => t.id === tpl.id)
      if (idx !== -1) {
        templates.value[idx] = { ...templates.value[idx], localImageURL: localURL }
      }
    }
  }))
}

function isVideoURL(url) {
  return /\.(mp4|webm|mov|mkv|gif)\b/i.test(url || '')
}

function isMessageVideo(msg) {
  if (!msg) return false
  if (msg.mediaType === 'video') return true
  return isVideoURL(msg.localImageURL || msg.imageURL)
}

function randomizeWorkflowSeeds(workflow) {
  for (const node of Object.values(workflow)) {
    if (!node?.inputs) continue
    if (node.class_type === 'KSampler' && 'seed' in node.inputs) {
      node.inputs.seed = Math.floor(Math.random() * 2 ** 32)
    }
    if (node.class_type === 'RandomNoise' && 'noise_seed' in node.inputs) {
      node.inputs.noise_seed = Math.floor(Math.random() * 2 ** 48)
    }
  }
}

function findClipTextEncodeInPositiveBranch(workflow, nodeId, visited = new Set()) {
  if (!nodeId || visited.has(nodeId)) return null
  visited.add(nodeId)

  const node = workflow[nodeId]
  if (!node || typeof node !== 'object') return null

  if (node.class_type === 'CLIPTextEncode' && typeof node.inputs?.text === 'string') {
    return node
  }

  if (!node.inputs) return null

  for (const [key, value] of Object.entries(node.inputs)) {
    if (key === 'negative') continue
    if (!Array.isArray(value) || typeof value[0] !== 'string') continue
    const found = findClipTextEncodeInPositiveBranch(workflow, value[0], visited)
    if (found) return found
  }

  return null
}

function injectLTXPositivePrompt(workflow, userPrompt) {
  for (const node of Object.values(workflow)) {
    if (node.class_type !== 'LTXVConditioning') continue
    const positiveId = node.inputs?.positive?.[0]
    const positiveNode = positiveId
      ? findClipTextEncodeInPositiveBranch(workflow, positiveId)
      : null
    if (positiveNode) {
      positiveNode.inputs.text = userPrompt
      return true
    }
  }
  return false
}

/** 同步 LTX 工作流中的帧率：支持 PrimitiveFloat/PrimitiveInt 引用和字面值 */
function syncLtxFrameRate(workflow, fps = 24) {
  const rate = Number(fps)
  if (!Number.isFinite(rate) || rate <= 0) return

  // 1. 更新被 frame_rate 引用的 PrimitiveFloat / PrimitiveInt 节点
  for (const node of Object.values(workflow)) {
    if (!node?.inputs || !Array.isArray(node.inputs.frame_rate)) continue

    const rateNodeId = node.inputs.frame_rate[0]
    const rateNode = rateNodeId ? workflow[rateNodeId] : null
    if (!rateNode?.inputs || !('value' in rateNode.inputs)) continue

    if (rateNode.class_type === 'PrimitiveFloat') {
      rateNode.inputs.value = rate
    } else if (rateNode.class_type === 'PrimitiveInt') {
      rateNode.inputs.value = Math.round(rate)
    }
  }

  // 2. 更新硬编码的字面值帧率（frame_rate / fps 为数字的节点）
  for (const node of Object.values(workflow)) {
    if (!node?.inputs) continue

    if (
      (node.class_type === 'LTXVConditioning' || node.class_type === 'LTXVEmptyLatentAudio')
      && typeof node.inputs.frame_rate === 'number'
    ) {
      node.inputs.frame_rate = rate
    }

    if (node.class_type === 'CreateVideo' && typeof node.inputs.fps === 'number') {
      node.inputs.fps = rate
    }
  }
}

function injectPrompt(workflow, userPrompt) {
  if (injectLTXPositivePrompt(workflow, userPrompt)) return true

  for (const node of Object.values(workflow)) {
    if (node.class_type === 'PrimitiveStringMultiline' && typeof node.inputs?.value === 'string') {
      node.inputs.value = userPrompt
      return true
    }
  }

  for (const node of Object.values(workflow)) {
    if (node.class_type === 'CR Prompt Text' && typeof node.inputs?.prompt === 'string') {
      node.inputs.prompt = userPrompt
      return true
    }
  }

  const tryInjectFromPositiveBranch = (nodeId, visited = new Set()) => {
    if (!nodeId || visited.has(nodeId)) return false
    visited.add(nodeId)

    const node = workflow[nodeId]
    if (!node || typeof node !== 'object' || !node.inputs) return false

    if (typeof node.inputs.prompt === 'string') {
      node.inputs.prompt = userPrompt
      return true
    }

    if (typeof node.inputs.text === 'string') {
      node.inputs.text = userPrompt
      return true
    }

    for (const [key, value] of Object.entries(node.inputs)) {
      if (key === 'negative') continue
      if (!Array.isArray(value) || typeof value[0] !== 'string') continue
      if (tryInjectFromPositiveBranch(value[0], visited)) return true
    }

    return false
  }

  const positiveEntryNodeIds = Object.values(workflow)
    .map((node) => node.inputs?.positive)
    .filter((input) => Array.isArray(input) && typeof input[0] === 'string')
    .map((input) => input[0])

  for (const nodeId of positiveEntryNodeIds) {
    if (tryInjectFromPositiveBranch(nodeId)) {
      return true
    }
  }

  // 后备注入：跳过属于负向分支的节点，避免将正面提示词写入负向提示词
  for (const node of Object.values(workflow)) {
    if (typeof node.inputs?.prompt === 'string' && !node.inputs.prompt.trim()) {
      if (isNegativeNode(workflow, node)) continue
      node.inputs.prompt = userPrompt
      return true
    }
  }

  for (const node of Object.values(workflow)) {
    if (node.class_type === 'CLIPTextEncode' && typeof node.inputs?.text === 'string' && !node.inputs.text.trim()) {
      if (isNegativeNode(workflow, node)) continue
      node.inputs.text = userPrompt
      return true
    }
  }

  return false
}

/** 检查节点是否被某个采样器的 negative 输入引用 */
function isNegativeNode(workflow, targetNode) {
  for (const node of Object.values(workflow)) {
    if (!node?.inputs) continue
    const neg = node.inputs.negative
    if (Array.isArray(neg) && typeof neg[0] === 'string') {
      if (isNodeInBranch(workflow, neg[0], targetNode, new Set())) return true
    }
  }
  return false
}

function isNodeInBranch(workflow, nodeId, targetNode, visited) {
  if (!nodeId || visited.has(nodeId)) return false
  visited.add(nodeId)
  const node = workflow[nodeId]
  if (node === targetNode) return true
  if (!node?.inputs) return false
  for (const value of Object.values(node.inputs)) {
    if (Array.isArray(value) && typeof value[0] === 'string') {
      if (isNodeInBranch(workflow, value[0], targetNode, visited)) return true
    }
  }
  return false
}

function applyRatioToWorkflow(workflow) {
  const width = clampResolution(selected.width)
  const height = clampResolution(selected.height)
  selected.width = width
  selected.height = height

  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== 'object' || !node.inputs) continue

    // 图生视频：ResizeImageMaskNode 使用扁平字段 resize_type.width / height
    if (node.class_type === 'ResizeImageMaskNode') {
      if ('resize_type.width' in node.inputs) node.inputs['resize_type.width'] = width
      if ('resize_type.height' in node.inputs) node.inputs['resize_type.height'] = height
    }

    if (typeof node.inputs.width !== 'number' || typeof node.inputs.height !== 'number') continue
    if (node.class_type !== 'EmptyLatentImage' && node.class_type !== 'EmptyImage') continue
    node.inputs.width = width
    node.inputs.height = height
  }
}

function getUploadedImageURL(uploadResult, baseURL = comfyuiConfig.baseURL) {
  return uploadResult?.name
    ? `${baseURL}/view?filename=${encodeURIComponent(uploadResult.name)}&subfolder=${encodeURIComponent(uploadResult.subfolder || '')}&type=${encodeURIComponent(uploadResult.type || 'input')}`
    : ''
}

function getUploadedImageId(uploadResult, prefix = 'input') {
  return uploadResult?.name
    ? `${prefix}:${uploadResult.subfolder || ''}/${uploadResult.name}`
    : makeUid(prefix)
}

async function uploadWorkflowImage(file, cachePrefix = 'input', baseURL = comfyuiConfig.baseURL) {
  const uploadResult = await uploadImage(file, { baseURL })
  const imageURL = getUploadedImageURL(uploadResult, baseURL)
  const imageId = getUploadedImageId(uploadResult, cachePrefix)
  await cacheFileToId(file, imageId)
  return {
    imageName: getUploadedImageValue(uploadResult),
    imageURL,
    imageId,
  }
}

async function generate() {
  const userPrompt = prompt.value.trim()
  if (!userPrompt || isGenerating.value) return

  // 立即锁定，防止并发（submit 内部会重新管理 isGenerating）
  isGenerating.value = true

  const isVideoMode = selected.mode === 'text_to_video' || selected.mode === 'image_to_video'
  const requestBaseURL = isVideoMode ? comfyuiConfig.videoBaseURL : comfyuiConfig.baseURL

  if (requiresSourceImage.value && !sourceImageFile.value) {
    isGenerating.value = false
    alert(requiresItemImage.value ? '替换物品需要先上传原图' : '图生图/图生视频需要先上传一张图片')
    return
  }

  if (requiresItemImage.value && !itemImageFile.value) {
    isGenerating.value = false
    alert('替换物品需要上传要替换进去的物品图')
    return
  }

  activePanel.value = null
  const workflowKey = modeButtons.find((item) => item.key === selected.mode)?.workflowKey || 'textToImage'
  const baseWorkflow = workflows[workflowKey] || workflows.default
  const workflow = JSON.parse(JSON.stringify(baseWorkflow))
  let userSourceImageURL = ''
  let userSourceImageId = ''
  let userSourceImage2URL = ''
  let userSourceImage2Id = ''

  injectPrompt(workflow, userPrompt)
  applyRatioToWorkflow(workflow)
  if (selected.mode === 'text_to_video' || selected.mode === 'image_to_video') {
    syncLtxFrameRate(workflow)
  }
  randomizeWorkflowSeeds(workflow)

  if (requiresSourceImage.value) {
    try {
      const sourceUpload = await uploadWorkflowImage(sourceImageFile.value, 'input', requestBaseURL)
      userSourceImageURL = sourceUpload.imageURL
      userSourceImageId = sourceUpload.imageId

      if (requiresItemImage.value) {
        const itemUpload = await uploadWorkflowImage(itemImageFile.value, 'input2', requestBaseURL)
        userSourceImage2URL = itemUpload.imageURL
        userSourceImage2Id = itemUpload.imageId

        const [baseNodeId, itemNodeId] = REPLACE_ITEM_IMAGE_NODE_IDS
        if (
          !injectSourceImageByNodeId(workflow, baseNodeId, sourceUpload.imageName)
          || !injectSourceImageByNodeId(workflow, itemNodeId, itemUpload.imageName)
        ) {
          isGenerating.value = false
          throw new Error('当前工作流未配置替换物品的双图输入节点')
        }
      } else if (!injectSourceImage(workflow, sourceUpload.imageName)) {
        isGenerating.value = false
        throw new Error('当前工作流未配置图片输入节点')
      }
    } catch (err) {
      isGenerating.value = false
      alert(err?.message || '图片上传失败，请重试')
      return
    }
  }

  const assistantId = appendMessagePair(userPrompt, userSourceImageURL, userSourceImage2URL)
  if (userSourceImageId) {
    updateUserMessageByAssistantId(assistantId, { sourceImageId: userSourceImageId })
    const localURL = await ensureLocalObjectURL(userSourceImageId)
    if (localURL) updateUserMessageByAssistantId(assistantId, { localSourceImageURL: localURL })
  }
  if (userSourceImage2Id) {
    updateUserMessageByAssistantId(assistantId, { sourceImage2Id: userSourceImage2Id })
    const localURL = await ensureLocalObjectURL(userSourceImage2Id)
    if (localURL) updateUserMessageByAssistantId(assistantId, { localSourceImage2URL: localURL })
  }
  prompt.value = ''
  if (requiresSourceImage.value) clearAllSourceImages()

  await submit(workflow, isVideoMode
    ? { baseURL: requestBaseURL, pollMaxTries: 600 }
    : { baseURL: requestBaseURL, pollMaxTries: 100 })

  if (result.value?.imageURL) {
    const outputImageId = `output:${assistantId}`
    const cached = await cacheImageURLToId(result.value.imageURL, outputImageId)
    const localURL = cached ? await ensureLocalObjectURL(outputImageId) : ''
    const mediaType = result.value.mediaType
      || (isVideoMode || isVideoURL(result.value.imageURL) ? 'video' : 'image')
    updateAssistantMessage(assistantId, {
      status: 'done',
      imageURL: result.value.imageURL,
      imageId: outputImageId,
      localImageURL: localURL || '',
      mediaType,
      error: '',
    })
    return
  }

  updateAssistantMessage(assistantId, {
    status: 'error',
    error: error.value || '生成失败，请重试',
  })
}
</script>

<template>
  <div class="page" @click.self="activePanel = null">
    <div class="slogan">
      <span>灵感触手可及</span>
      <img src="../assets/logo.svg" alt="" class="slogan-icon" />
      <span>创作不再受限</span>
    </div>

    <div class="main-content">
      <div ref="conversationRef" class="chat-area">
        <div v-if="!messages.length" class="empty-chat">
          输入提示词后，提示词和生成结果会以对话形式永久保存在本地。
        </div>

        <div v-for="msg in messages" :key="msg.id" class="chat-row" :class="`role-${msg.role}`">
          <div class="chat-bubble">
            <div class="chat-meta">
              <div class="chat-role">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
              <button type="button" class="message-delete-btn" title="删除该记录" @click="removeMessage(msg.id)">删除</button>
            </div>

            <template v-if="msg.role === 'user'">
              <img
                v-if="msg.localSourceImageURL || msg.sourceImageURL"
                :src="msg.localSourceImageURL || msg.sourceImageURL"
                class="user-source-image"
                alt="参考图"
              />
              <img
                v-if="msg.localSourceImage2URL || msg.sourceImage2URL"
                :src="msg.localSourceImage2URL || msg.sourceImage2URL"
                class="user-source-image"
                alt="替换物品图"
              />
              <div class="chat-text">{{ msg.text }}</div>
            </template>

            <template v-else>
              <div v-if="msg.status === 'generating'" class="generating-tip">正在生成，请稍候...</div>
              <video
                v-else-if="isMessageVideo(msg) && (msg.localImageURL || msg.imageURL)"
                :src="msg.localImageURL || msg.imageURL"
                class="result-video result-img-clickable"
                controls
                playsinline
                loop
                title="点击查看大图，左右滑动切换"
                @click="openPreview(msg)"
              />
              <img
                v-else-if="msg.localImageURL || msg.imageURL"
                :src="msg.localImageURL || msg.imageURL"
                class="result-img result-img-clickable"
                alt="生成结果"
                title="点击查看大图，左右滑动切换"
                @click="openPreview(msg)"
              />
              <div v-else class="error-tip">{{ msg.error }}</div>

              <div v-if="msg.imageURL" class="result-actions">
                <button
                  v-if="!isMessageVideo(msg)"
                  class="action-btn"
                  @click="addToTemplate(msg.localImageURL || msg.imageURL)"
                >加入模板</button>
                <button class="action-btn" @click="downloadResult(msg.localImageURL || msg.imageURL)">下载</button>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="input-area">
        <div class="template-bar">
          <span class="template-bar-label">模板库</span>
          <button class="template-more">></button>
          <div class="template-list">
            <div
              v-for="t in templates"
              :key="t.id"
              class="template-card"
            >
              <img v-if="t.localImageURL || t.imageURL" :src="t.localImageURL || t.imageURL" class="template-card-img" alt="" />
              <div v-else class="template-card-color" :style="{ background: t.color }"></div>
              <button class="template-delete" title="删除模板" @click.stop="removeTemplate(t.id)">×</button>
            </div>
          </div>
        </div>

        <div class="input-box" :class="{ generating: isGenerating }" @paste.capture="handlePasteImageInInputArea">
          <div v-if="requiresSourceImage" class="source-image-uploader">
            <div class="source-image-group">
              <input
                ref="sourceImageInputRef"
                type="file"
                accept="image/*"
                class="source-image-input"
                :disabled="isGenerating"
                @change="handleSourceImageChange"
              />
              <button type="button" class="source-image-btn" :disabled="isGenerating" @click="triggerSourceImagePicker">
                {{ sourceImageFile ? (requiresItemImage ? '重新上传原图' : '重新上传参考图') : (requiresItemImage ? '上传原图' : '上传参考图') }}
              </button>
              <div v-if="sourceImagePreview" class="source-image-preview-wrap">
                <img :src="sourceImagePreview" class="source-image-preview" alt="source preview" />
                <button type="button" class="source-image-clear" :disabled="isGenerating" @click="clearSourceImage">移除</button>
              </div>
            </div>

            <div v-if="requiresItemImage" class="source-image-group">
              <input
                ref="itemImageInputRef"
                type="file"
                accept="image/*"
                class="source-image-input"
                :disabled="isGenerating"
                @change="handleItemImageChange"
              />
              <button type="button" class="source-image-btn" :disabled="isGenerating" @click="triggerItemImagePicker">
                {{ itemImageFile ? '重新上传物品图' : '上传物品图' }}
              </button>
              <div v-if="itemImagePreview" class="source-image-preview-wrap">
                <img :src="itemImagePreview" class="source-image-preview" alt="item preview" />
                <button type="button" class="source-image-clear" :disabled="isGenerating" @click="clearItemImage">移除</button>
              </div>
            </div>
          </div>

          <div class="textarea-wrapper">
            <textarea
              v-model="prompt"
              class="prompt-input"
              :placeholder="isGenerating ? '正在生成，请稍候...' : (requiresItemImage ? '输入替换要求（可 Ctrl+V 依次粘贴两张图）' : (requiresSourceImage ? '输入提示词（可 Ctrl+V 粘贴参考图）' : '输入提示词'))"
              :disabled="isGenerating"
              @keydown.ctrl.enter="generate"
            />
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
            </button>
          </div>

          <div class="toolbar">
            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'ratio' }"
                title="比例"
                @click.stop="togglePanel('ratio')"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'ratio'"
                :panel="panels.ratio"
                :selected="selected.ratio"
                @select="(v) => selectOption('ratio', v)"
                @close="activePanel = null"
              />
            </div>

            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'style' }"
                title="风格"
                @click.stop="togglePanel('style')"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="3" r="1"/><circle cx="21" cy="12" r="1"/><circle cx="12" cy="21" r="1"/><circle cx="3" cy="12" r="1"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'style'"
                :panel="panels.style"
                :selected="selected.style"
                @select="(v) => selectOption('style', v)"
                @close="activePanel = null"
              />
            </div>

            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'quality' }"
                title="质感"
                @click.stop="togglePanel('quality')"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'quality'"
                :panel="panels.quality"
                :selected="selected.quality"
                @select="(v) => selectOption('quality', v)"
                @close="activePanel = null"
              />
            </div>

            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'angle' }"
                title="视角"
                @click.stop="togglePanel('angle')"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'angle'"
                :panel="panels.angle"
                :selected="selected.angle"
                @select="(v) => selectOption('angle', v)"
                @close="activePanel = null"
              />
            </div>

            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'lighting' }"
                title="灯光"
                @click.stop="togglePanel('lighting')"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'lighting'"
                :panel="panels.lighting"
                :selected="selected.lighting"
                @select="(v) => selectOption('lighting', v)"
                @close="activePanel = null"
              />
            </div>

            <div class="resolution-inputs" @click.stop>
              <input
                v-model.number="selected.width"
                type="number"
                min="64"
                max="4096"
                step="1"
                class="resolution-input"
                title="宽度"
                @input="syncLinkedResolution('width')"
                @blur="syncResolution('width')"
              />
              <span class="resolution-sep">×</span>
              <input
                v-model.number="selected.height"
                type="number"
                min="64"
                max="4096"
                step="1"
                class="resolution-input"
                title="高度"
                @input="syncLinkedResolution('height')"
                @blur="syncResolution('height')"
              />
            </div>

            <div class="mode-switch">
              <button
                v-for="item in modeButtons"
                :key="item.key"
                class="toolbar-text-btn mode-btn"
                :class="{ active: selected.mode === item.key }"
                @click.stop="selectMode(item.key)"
              >{{ item.label }}</button>
            </div>

            <button v-if="isGenerating" class="generate-btn generating" @click="cancel" title="取消生成">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            </button>
            <button v-else class="generate-btn" @click="generate">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
        </div>

        <div v-if="history.length" class="history-area">
          <div class="history-header">
            <div class="history-label">生成历史</div>
            <button type="button" class="history-clear-btn" @click="clearHistory">清空历史</button>
          </div>
          <div class="history-list">
            <div
              v-for="h in history"
              :key="h.id"
              class="history-card"
              @click="openPreview(h)"
            >
              <video
                v-if="isMessageVideo(h)"
                :src="h.localImageURL || h.imageURL"
                class="history-card-img history-card-video"
                muted
                playsinline
                loop
              />
              <img v-else :src="h.localImageURL || h.imageURL" class="history-card-img" alt="" />
              <button
                type="button"
                class="history-item-delete-btn"
                title="删除该历史"
                @click.stop="removeHistoryItem(h.id)"
              >×</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="previewOpen"
      ref="previewMaskRef"
      class="preview-mask"
      tabindex="-1"
      @click="closePreview"
      @keydown="onPreviewKeydown"
    >
      <div class="preview-content" @click.stop>
        <div class="preview-carousel">
          <button
            v-if="previewGallery.length > 1"
            type="button"
            class="preview-nav preview-nav-prev"
            title="上一张（← 或向右滑）"
            aria-label="上一张"
            @click.stop="previewShowPrev"
          >‹</button>
          <div
            class="preview-media"
            @touchstart.passive="onPreviewTouchStart"
            @touchend="onPreviewTouchEnd"
            @pointerdown="onPreviewPointerDown"
            @pointerup="onPreviewPointerUp"
            @pointercancel="onPreviewPointerCancel"
          >
            <video
              v-if="previewImage && previewIsVideo"
              :src="previewImage"
              class="preview-image preview-video"
              controls
              autoplay
              playsinline
              loop
            />
            <img v-else-if="previewImage" :src="previewImage" class="preview-image" alt="大图预览" />
          </div>
          <button
            v-if="previewGallery.length > 1"
            type="button"
            class="preview-nav preview-nav-next"
            title="下一张（→ 或向左滑）"
            aria-label="下一张"
            @click.stop="previewShowNext"
          >›</button>
        </div>
        <div v-if="previewCounterText" class="preview-counter">{{ previewCounterText }}</div>
        <div class="preview-actions">
          <button v-if="!previewIsVideo" class="action-btn" @click="addToTemplate(previewImage)">加入模板</button>
          <button class="action-btn" @click="downloadResult(previewImage)">下载</button>
          <button class="action-btn" @click="closePreview">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 24px 20px;
  background: #fff;
}

.slogan {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 36px;
  font-weight: 500;
  color: #1a1a1a;
  margin-bottom: 24px;
  letter-spacing: -0.5px;
}

.slogan-icon {
  width: 72px;
  height: 72px;
  object-fit: contain;
}

.main-content {
  width: 100%;
  max-width: 1140px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-area {
  width: min(100%, 820px);
  margin: 0 auto;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 6px 18px;
}

.empty-chat {
  color: #9b9b9b;
  font-size: 14px;
  text-align: center;
  padding: 26px 16px;
  border: 1px dashed #d8d8d8;
  border-radius: 14px;
}

.chat-row {
  display: flex;
}

.chat-row.role-user {
  justify-content: flex-end;
}

.chat-row.role-assistant {
  justify-content: flex-start;
}

.chat-bubble {
  max-width: min(100%, 680px);
  border-radius: 16px;
  padding: 12px 14px;
  background: #f5f6f8;
  border: 1px solid #e9e9e9;
}

.chat-row.role-user .chat-bubble {
  background: #ebf4ff;
  border-color: #d8e9ff;
}

.chat-role {
  font-size: 11px;
  color: #7c7c7c;
}

.chat-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
}

.message-delete-btn {
  border: none;
  background: transparent;
  color: #8f8f8f;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
}

.message-delete-btn:hover {
  color: #ff5f6d;
  background: #fff1f3;
}

.chat-text {
  font-size: 14px;
  color: #1a1a1a;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.user-source-image {
  width: 100%;
  max-width: 320px;
  border-radius: 10px;
  border: 1px solid #dcdcdc;
  margin-bottom: 8px;
  display: block;
}

.result-img,
.result-video {
  width: 100%;
  max-width: 620px;
  border-radius: 12px;
  display: block;
}

.result-video {
  background: #000;
}

.generating-tip {
  color: #808080;
  font-size: 14px;
}

.error-tip {
  color: #d94a4a;
  font-size: 14px;
}

.result-actions {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fff;
  padding: 6px 10px;
  font-size: 12px;
  color: #4a4a4a;
  cursor: pointer;
}

.action-btn:hover {
  background: #f6f6f6;
}

.input-area {
  width: min(100%, 820px);
  margin: 0 auto;
  position: sticky;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, #ffffff 28%);
}

.template-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f0f0f0;
  border-radius: 14px;
  padding: 10px 14px;
  align-self: flex-end;
  min-width: 320px;
}

.template-bar-label {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
}

.template-more {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: #888;
  margin-left: auto;
  padding: 2px 4px;
}

.template-list {
  display: flex;
  gap: 8px;
}

.template-card {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 10px;
  flex-shrink: 0;
  overflow: hidden;
}

.template-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.template-card-color {
  width: 100%;
  height: 100%;
}

.template-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  padding: 0;
  cursor: pointer;
}

.template-delete:hover {
  background: rgba(0, 0, 0, 0.85);
}

.input-box {
  width: 100%;
  box-sizing: border-box;
  background: #fff;
  border: 2px solid #4b9ef8;
  border-radius: 20px;
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.2s;
}

.input-box.generating {
  border-color: #bbb;
}

.source-image-uploader {
  border: 1px dashed #d5def0;
  border-radius: 12px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: #f8fbff;
}

.source-image-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.source-image-input {
  display: none;
}

.source-image-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #9cc2ff;
  background: #fff;
  color: #2f6fd6;
  cursor: pointer;
}

.source-image-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.source-image-preview-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-image-preview {
  width: 60px;
  height: 60px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid #dcdcdc;
}

.source-image-clear {
  border: none;
  background: none;
  color: #757575;
  cursor: pointer;
  padding: 0;
  font-size: 13px;
}

.source-image-clear:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.history-area {
  width: 100%;
  border: 1px dashed #ddd;
  border-radius: 14px;
  padding: 10px 12px;
  box-sizing: border-box;
  background: #fff;
}

.history-label {
  font-size: 12px;
  color: #999;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.history-clear-btn {
  border: none;
  background: transparent;
  color: #8f8f8f;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
}

.history-clear-btn:hover {
  color: #4b9ef8;
  background: #edf4ff;
}

.history-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.history-card {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.15s ease;
  overflow: hidden;
}

.history-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.history-card:hover {
  transform: translateY(-1px);
}

.history-item-delete-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-item-delete-btn:hover {
  background: rgba(220, 38, 38, 0.95);
}

.prompt-input {
  width: 100%;
  min-height: 90px;
  border: none;
  outline: none;
  font-size: 15px;
  color: #1a1a1a;
  resize: none;
  background: transparent;
  line-height: 1.6;
  font-family: inherit;
}

.prompt-input::placeholder {
  color: #c4c4c4;
}

.prompt-input:disabled {
  color: #9f9f9f;
}

.textarea-wrapper {
  position: relative;
}

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

.voice-btn.loading {
  background: #e0e0e0;
  color: #999;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(75, 158, 248, 0.3);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(75, 158, 248, 0.15);
  }
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-item-wrap {
  position: relative;
}

.toolbar-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  border-radius: 8px;
  transition: all 0.2s;
}

.toolbar-btn:hover,
.toolbar-btn.active {
  color: #4b9ef8;
  background: #ebf4ff;
}

.toolbar-text-btn {
  height: 34px;
  padding: 0 10px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #666;
  border-radius: 8px;
  white-space: nowrap;
  transition: all 0.2s;
}

.toolbar-text-btn:hover,
.toolbar-text-btn.active {
  color: #4b9ef8;
  background: #ebf4ff;
}

.resolution-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 34px;
  border-radius: 8px;
  background: #f7f9fc;
  border: 1px solid #e3e9f5;
}

.resolution-input {
  width: 64px;
  border: none;
  background: transparent;
  outline: none;
  font-size: 12px;
  color: #333;
  text-align: center;
}

.resolution-input::-webkit-outer-spin-button,
.resolution-input::-webkit-inner-spin-button {
  margin: 0;
}

.resolution-sep {
  font-size: 12px;
  color: #8f8f8f;
}

.mode-switch {
  display: flex;
  gap: 2px;
  margin-left: 4px;
}

.mode-btn.active {
  color: #1a1a1a;
  font-weight: 600;
  background: #e6f0ff;
}

.generate-btn {
  margin-left: auto;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  transition: background 0.2s;
}

.generate-btn:hover {
  background: #333;
}

.generate-btn.generating {
  background: #999;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
  display: block;
}

.preview-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.preview-content {
  max-width: min(100%, 920px);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-mask:focus {
  outline: none;
}

.preview-carousel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.preview-media {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: pan-y;
  user-select: none;
}

.preview-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.preview-nav:hover {
  background: rgba(0, 0, 0, 0.65);
}

.preview-nav-prev {
  left: 10px;
}

.preview-nav-next {
  right: 10px;
}

.preview-counter {
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
}

.preview-image,
.preview-video {
  max-width: 100%;
  max-height: 74vh;
  border-radius: 14px;
  background: #fff;
  display: block;
}

.preview-video {
  background: #000;
}

.history-card-video {
  object-fit: cover;
}

.result-img-clickable {
  cursor: zoom-in;
}

.preview-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .slogan {
    font-size: 28px;
    gap: 12px;
  }

  .slogan-icon {
    width: 58px;
    height: 58px;
  }

  .template-bar {
    width: 100%;
    min-width: 0;
  }

  .template-list {
    margin-left: auto;
  }

  .mode-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }
}
</style>
