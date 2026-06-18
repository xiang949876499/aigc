<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import FigmaIcon from './FigmaIcon.vue'
import ToolbarPanel from './ToolbarPanel.vue'
import figmaResultPreview from '../assets/figma-result-preview.png'
import figmaTemplate1 from '../assets/figma-template-1.png'
import figmaTemplate2 from '../assets/figma-template-2.png'
import { useComfyUI } from '../composables/useComfyUI.js'
import { useSpeechRecognition } from '../composables/useSpeechRecognition.js'
import comfyuiConfig from '../config/comfyui.js'
import {
  createComfyUISettingsDraft,
  loadComfyUISettings,
  resetComfyUISettings,
  saveComfyUISettings,
} from '../config/comfyuiSettings.js'
import { getWorkflowKeyForSubmit, isSourceImageRequiredForSubmit } from '../workflows/imageRequirements.js'
import workflows from '../workflows/index.js'

const {
  isGenerating,
  result,
  error,
  submit,
  uploadImage,
  cancel,
  getPromptResult,
  findPromptResultByText,
} = useComfyUI()

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

// 监听语音识别结果，追加到 prompt（只追加增量）
let lastTranscriptLength = 0
watch(speechTranscript, (newVal) => {
  if (newVal && newVal.length > lastTranscriptLength) {
    const delta = newVal.slice(lastTranscriptLength)
    prompt.value = prompt.value ? prompt.value + delta : newVal
    lastTranscriptLength = newVal.length
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
const speechButtonTitle = computed(() => {
  if (isListening.value) return '停止录音'
  if (isSpeechLoading.value) return '语音处理中...'
  return '语音输入'
})
const activePanel = ref(null)
const activeView = ref('aigc')
const conversationRef = ref(null)
const sourceImageInputRef = ref(null)
const sourceImageFile = ref(null)
const sourceImagePreview = ref('')
const itemImageInputRef = ref(null)
const itemImageFile = ref(null)
const itemImagePreview = ref('')
const comfySettings = reactive(loadComfyUISettings())
const settingsDraft = reactive({ ...comfySettings })
const settingsStatus = ref('')

const activeComfyImageBaseURL = computed(() => comfySettings.imageBaseURL || comfyuiConfig.baseURL)
const activeComfyVideoBaseURL = computed(() => comfySettings.videoBaseURL || comfyuiConfig.videoBaseURL)

const IMAGE_SOURCE_MODES = new Set(['image_to_image', 'image_to_video', 'replace_item'])
const ITEM_SOURCE_MODES = new Set(['replace_item'])
const REPLACE_ITEM_IMAGE_NODE_IDS = ['78', '139']

const TEMPLATES_KEY = 'aigc_templates'
const MESSAGES_KEY = 'aigc_messages'
const IMAGE_DB_NAME = 'aigc_images'
const IMAGE_DB_STORE = 'blobs'
const DEFAULT_TEMPLATES = [
  { id: 'tpl-1', imageURL: figmaTemplate1 },
  { id: 'tpl-2', imageURL: figmaTemplate2 },
  { id: 'tpl-3', color: '#5BB8D4' },
  { id: 'tpl-4', color: '#C9A84C' },
]

let uidCounter = 0

let imageDBPromise = null
const localObjectURLById = new Map()

function openImageDB() {
  if (imageDBPromise) return imageDBPromise
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'))
  }
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
  if (typeof indexedDB === 'undefined') return
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
  if (typeof indexedDB === 'undefined') return null
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
      if (id === 'tpl-1' && !item.imageURL) {
        next.imageURL = figmaTemplate1
      } else if (id === 'tpl-2' && !item.imageURL) {
        next.imageURL = figmaTemplate2
      }
      const imageURL = typeof item.imageURL === 'string' && item.imageURL
        ? item.imageURL
        : (typeof item.localAssetURL === 'string' ? item.localAssetURL : '')
      if (imageURL) {
        next.imageURL = imageURL
        if (typeof item.localAssetURL === 'string' && item.localAssetURL) {
          next.localAssetURL = item.localAssetURL
          next.localImageURL = item.localAssetURL
        }
        if (typeof item.localAssetPath === 'string' && item.localAssetPath) {
          next.localAssetPath = item.localAssetPath
        }
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
      const localAssetURL = typeof item.localAssetURL === 'string' ? item.localAssetURL : ''
      const localAssetPath = typeof item.localAssetPath === 'string' ? item.localAssetPath : ''
      const promptId = typeof item.promptId === 'string' ? item.promptId : ''
      const promptBaseURL = typeof item.promptBaseURL === 'string' ? item.promptBaseURL : ''
      const mediaURL = localAssetURL || imageURL
      const mediaType = item.mediaType === 'video' || isVideoURL(mediaURL) ? 'video' : 'image'
      let status = item.status
      if (status !== 'generating' && status !== 'done' && status !== 'error') {
        status = mediaURL ? 'done' : (errorText ? 'error' : 'done')
      }

      return {
        id,
        role: 'assistant',
        status,
        imageURL,
        imageId,
        localImageURL: localAssetURL,
        localAssetURL,
        localAssetPath,
        promptId,
        promptBaseURL,
        mediaType: mediaURL && mediaType === 'video' ? 'video' : 'image',
        error: errorText,
        createdAt,
      }
    })
    .filter(Boolean)
}

const templates = ref(normalizeTemplates(readStorage(TEMPLATES_KEY, DEFAULT_TEMPLATES)))
const messages = ref(normalizeMessages(readStorage(MESSAGES_KEY, [])))
const history = computed(() => messages.value
  .filter((item) => item.role === 'assistant' && (item.localImageURL || item.localAssetURL || item.imageURL)))

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
  { key: 'text_to_image', label: '文生图' },
  { key: 'image_to_image', label: '图生图' },
  { key: 'text_to_video', label: '文生视频' },
  { key: 'image_to_video', label: '图生视频' },
  { key: 'replace_item', label: '替换物品' },
]

const MODE_UI = {
  text_to_image: { label: '文生图', icon: 'textImage' },
  image_to_image: { label: '图生图', icon: 'imageImage' },
  text_to_video: { label: '文生视频', icon: 'textVideo' },
  image_to_video: { label: '图生视频', icon: 'imageVideo' },
  replace_item: { label: '替换物品', icon: 'more' },
}

const ratioOptions = [
  { key: '1:1', label: '1:1', shape: 'square' },
  { key: '16:9', label: '16:9', shape: 'wide' },
  { key: '9:16', label: '9:16', shape: 'tall' },
  { key: '4:3', label: '4:3', shape: 'classic' },
]

function getModeLabel(key) {
  return MODE_UI[key]?.label || key
}

function getModeIcon(key) {
  return MODE_UI[key]?.icon || 'spark'
}

function selectRatioOption(ratio) {
  const option = panels.ratio.options.find((item) => item.startsWith(ratio)) || ratio
  selectOption('ratio', option)
}

function isRatioSelected(ratio) {
  return typeof selected.ratio === 'string' && selected.ratio.startsWith(ratio)
}

const promptPlaceholder = computed(() => {
  if (isGenerating.value) return '正在生成，请稍候...'
  if (requiresItemImage.value) return '描述您想替换的内容... 尝试输入“一件未来感夹克”'
  if (requiresSourceImage.value) return '描述您想创作的内容... 可粘贴参考图'
  return '描述您想创作的内容... 尝试输入“一座超现实的赛博朋克城市...”'
})

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

function toggleTemplateLibrary() {
  activePanel.value = activePanel.value === 'templates' ? null : 'templates'
}

function selectView(view) {
  activeView.value = view
  activePanel.value = null
}

function openSettingsPanel() {
  const draft = createComfyUISettingsDraft({
    imageBaseURL: activeComfyImageBaseURL.value,
    videoBaseURL: activeComfyVideoBaseURL.value,
  }, {
    imageBaseURL: comfyuiConfig.settingsBaseURL,
    videoBaseURL: comfyuiConfig.settingsVideoBaseURL,
  })
  settingsDraft.imageBaseURL = draft.imageBaseURL
  settingsDraft.videoBaseURL = draft.videoBaseURL
  settingsStatus.value = ''
  activePanel.value = activePanel.value === 'settings' ? null : 'settings'
}

function applyComfySettings(nextSettings) {
  comfySettings.imageBaseURL = nextSettings.imageBaseURL
  comfySettings.videoBaseURL = nextSettings.videoBaseURL
  settingsDraft.imageBaseURL = nextSettings.imageBaseURL
  settingsDraft.videoBaseURL = nextSettings.videoBaseURL
}

function saveSettingsPanel() {
  applyComfySettings(saveComfyUISettings(settingsDraft))
  settingsStatus.value = '已保存'
}

function restoreDefaultSettings() {
  applyComfySettings(resetComfyUISettings())
  settingsStatus.value = '已恢复默认'
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

onMounted(() => {
  hydrateLocalImagesFromMessages()
  hydrateTemplateImages()
  recoverGeneratingMessages()
  initSpeechRecognition()
})

function addToTemplate(imageURL) {
  if (!imageURL) return
  const id = makeUid('tpl')
  templates.value.unshift({ id, imageURL })
  const imageId = `template:${id}`
  saveAssetURLToLocal(imageURL, {
    id: imageId,
    kind: 'templates',
    mediaType: 'image',
  }).then((saved) => {
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx !== -1 && saved?.fileURL) {
      templates.value[idx] = {
        ...templates.value[idx],
        localImageURL: saved.fileURL,
        localAssetURL: saved.fileURL,
        localAssetPath: saved.relativePath || '',
      }
    }
    return saved
  }).then((saved) => {
    if (saved?.fileURL) return
    return cacheImageURLToId(imageURL, imageId).then((cached) => {
      if (!cached) return
      const idx = templates.value.findIndex((t) => t.id === id)
      if (idx !== -1) {
        templates.value[idx] = { ...templates.value[idx], imageId }
      }
    })
  }).catch(() => {
    // Local asset persistence is best-effort; the original URL remains mapped.
  })
}

async function saveAssetURLToLocal(imageURL, options = {}) {
  const saveFromURL = window.electronAPI?.assets?.saveFromURL
  if (!imageURL || typeof saveFromURL !== 'function') return null

  try {
    return await saveFromURL(resolveAssetSourceURL(imageURL), options)
  } catch (e) {
    console.warn('[ImageGen] 本地素材保存失败:', e.message, imageURL)
    return null
  }
}

function resolveAssetSourceURL(imageURL) {
  if (/^(https?:|file:|data:)/i.test(imageURL)) return imageURL
  return new URL(imageURL, window.location.href).href
}

function buildLocalAssetPatch(saved) {
  if (!saved?.fileURL) return {}
  return {
    localImageURL: saved.fileURL,
    localAssetURL: saved.fileURL,
    localAssetPath: saved.relativePath || '',
  }
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
  return msg ? getMessageMediaURL(msg) : ''
})

const previewIsVideo = computed(() => isMessageVideo(previewCurrentMsg.value))

const previewCounterText = computed(() => {
  const n = previewGallery.value.length
  if (n <= 1) return ''
  return `${previewIndex.value + 1} / ${n}`
})

function openPreview(assistantMsg) {
  if (!assistantMsg || assistantMsg.role !== 'assistant') return
  const url = getMessageMediaURL(assistantMsg)
  if (!url) return
  const list = previewGallery.value
  const idx = list.findIndex((m) => m.id === assistantMsg.id)
  previewIndex.value = idx >= 0 ? idx : 0
  previewOpen.value = true
  nextTick(() => previewMaskRef.value?.focus())
}

function getMessageMediaURL(msg) {
  return msg?.localImageURL || msg?.localAssetURL || msg?.imageURL || ''
}

function getTemplateMediaURL(tpl) {
  return tpl?.localImageURL || tpl?.localAssetURL || tpl?.imageURL || ''
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

async function completeAssistantMessage(assistantId, media, {
  isVideoMode = false,
  promptId,
  promptBaseURL,
} = {}) {
  if (!assistantId || !media?.imageURL) return false

  const outputImageId = `output:${assistantId}`
  const mediaType = media.mediaType || (isVideoMode || isVideoURL(media.imageURL) ? 'video' : 'image')
  const currentMessage = messages.value.find((msg) => msg.id === assistantId)
  const nextPromptId = promptId || currentMessage?.promptId || ''
  const nextPromptBaseURL = promptBaseURL || currentMessage?.promptBaseURL || ''
  updateAssistantMessage(assistantId, {
    status: 'done',
    imageURL: media.imageURL,
    imageId: outputImageId,
    localImageURL: '',
    mediaType,
    promptId: nextPromptId,
    promptBaseURL: nextPromptBaseURL,
    error: '',
  })

  const saved = await saveAssetURLToLocal(media.imageURL, {
    id: outputImageId,
    kind: 'generated',
    mediaType,
  })
  const localAssetPatch = buildLocalAssetPatch(saved)
  if (localAssetPatch.localImageURL) {
    updateAssistantMessage(assistantId, localAssetPatch)
    return true
  }

  const cached = await cacheImageURLToId(media.imageURL, outputImageId)
  if (cached) {
    const localURL = await ensureLocalObjectURL(outputImageId)
    if (localURL) updateAssistantMessage(assistantId, { localImageURL: localURL })
  }

  return true
}

async function recoverGeneratingMessages() {
  const pending = messages.value.filter((msg) => msg?.role === 'assistant' && msg.status === 'generating')

  for (const msg of pending) {
    const baseURL = msg.promptBaseURL || (msg.mediaType === 'video' ? activeComfyVideoBaseURL.value : activeComfyImageBaseURL.value)
    let promptId = msg.promptId || ''
    let media = null

    try {
      if (promptId) {
        media = await getPromptResult(promptId, { baseURL })
      } else {
        const idx = messages.value.findIndex((item) => item.id === msg.id)
        const userPrompt = idx > 0 && messages.value[idx - 1]?.role === 'user'
          ? messages.value[idx - 1].text
          : ''
        const recovered = await findPromptResultByText(userPrompt, { baseURL })
        promptId = recovered?.promptId || ''
        media = recovered?.media || null
      }
    } catch (e) {
      console.warn('[ImageGen] 恢复生成结果失败:', e.message)
    }

    if (media?.imageURL) {
      await completeAssistantMessage(msg.id, media, {
        isVideoMode: msg.mediaType === 'video',
        promptId,
        promptBaseURL: baseURL,
      })
    } else if (!msg.promptId) {
      updateAssistantMessage(msg.id, {
        status: 'error',
        error: '生成状态已中断，请重新提交',
      })
    }
  }
}

async function hydrateLocalImagesFromMessages() {
  const list = messages.value || []
  await Promise.all(list.map(async (msg) => {
    if (msg?.role === 'assistant' && msg.imageId) {
      let localURL = msg.localAssetURL || ''
      if (!localURL && msg.imageURL) {
        const mediaType = msg.mediaType || (isVideoURL(msg.imageURL) ? 'video' : 'image')
        const saved = await saveAssetURLToLocal(msg.imageURL, {
          id: msg.imageId,
          kind: 'generated',
          mediaType,
        })
        if (saved?.fileURL) {
          const patch = buildLocalAssetPatch(saved)
          updateAssistantMessage(msg.id, patch)
          localURL = patch.localImageURL
        }
      }
      if (!localURL) localURL = await ensureLocalObjectURL(msg.imageId)
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
    const imageId = tpl.imageId || `template:${tpl.id}`
    let localURL = tpl.localAssetURL || ''
    if (!localURL) {
      const saved = await saveAssetURLToLocal(tpl.imageURL, {
        id: imageId,
        kind: 'templates',
        mediaType: 'image',
      })
      if (saved?.fileURL) {
        localURL = saved.fileURL
        const idx = templates.value.findIndex((t) => t.id === tpl.id)
        if (idx !== -1) {
          templates.value[idx] = {
            ...templates.value[idx],
            ...buildLocalAssetPatch(saved),
          }
        }
      }
    }
    if (!localURL) {
      // 优先用 IndexedDB 缓存
      localURL = await ensureLocalObjectURL(imageId)
    }
    if (!localURL) {
      // IndexedDB 中没有，尝试从 ComfyUI 服务端拉取并缓存
      const cached = await cacheImageURLToId(tpl.imageURL, imageId)
      if (cached) {
        localURL = await ensureLocalObjectURL(imageId)
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
  return isVideoURL(msg.localImageURL) || isVideoURL(msg.localAssetURL) || isVideoURL(msg.imageURL)
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

function getUploadedImageURL(uploadResult, baseURL = activeComfyImageBaseURL.value) {
  return uploadResult?.name
    ? `${baseURL}/view?filename=${encodeURIComponent(uploadResult.name)}&subfolder=${encodeURIComponent(uploadResult.subfolder || '')}&type=${encodeURIComponent(uploadResult.type || 'input')}`
    : ''
}

function getUploadedImageId(uploadResult, prefix = 'input') {
  return uploadResult?.name
    ? `${prefix}:${uploadResult.subfolder || ''}/${uploadResult.name}`
    : makeUid(prefix)
}

async function uploadWorkflowImage(file, cachePrefix = 'input', baseURL = activeComfyImageBaseURL.value) {
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
  const requestBaseURL = isVideoMode ? activeComfyVideoBaseURL.value : activeComfyImageBaseURL.value

  if (isSourceImageRequiredForSubmit(selected.mode) && !sourceImageFile.value) {
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
  const workflowKey = getWorkflowKeyForSubmit(selected.mode, Boolean(sourceImageFile.value))
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

  if (requiresSourceImage.value && sourceImageFile.value) {
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

  const submitOptions = {
    baseURL: requestBaseURL,
    pollMaxTries: isVideoMode ? 600 : 100,
    fallbackText: userPrompt,
    onPromptId: (promptId) => updateAssistantMessage(assistantId, { promptId, promptBaseURL: requestBaseURL }),
  }

  await submit(workflow, submitOptions)

  if (result.value?.imageURL) {
    await completeAssistantMessage(assistantId, result.value, {
      isVideoMode,
      promptBaseURL: requestBaseURL,
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
    <aside class="icon-rail" aria-label="主导航">
      <div class="rail-top">
        <button
          class="rail-btn"
          :class="{ 'rail-btn-active': activeView === 'aigc' && activePanel !== 'settings' }"
          type="button"
          title="AIGC"
          @click.stop="selectView('aigc')"
        >
          <FigmaIcon name="bot" />
        </button>
        <button
          class="rail-btn"
          :class="{ 'rail-btn-active': activeView === 'assets' && activePanel !== 'settings' }"
          type="button"
          title="素材库"
          data-testid="asset-library-button"
          @click.stop="selectView('assets')"
        >
          <FigmaIcon name="library" />
        </button>
      </div>
      <div class="rail-bottom">
        <button
          class="rail-btn"
          :class="{ 'rail-btn-active': activePanel === 'settings' }"
          type="button"
          title="设置"
          data-testid="settings-button"
          @click.stop="openSettingsPanel"
        >
          <FigmaIcon name="settings" />
        </button>
      </div>

      <section
        v-if="activePanel === 'settings'"
        class="settings-popover"
        data-testid="settings-popover"
        aria-label="ComfyUI 设置"
        @click.stop
      >
        <div class="settings-header">
          <div>
            <h2>设置</h2>
            <p>ComfyUI 服务 IP/端口</p>
          </div>
          <button class="settings-close" type="button" title="关闭" @click="activePanel = null">
            <FigmaIcon name="close" />
          </button>
        </div>

        <label class="settings-field">
          <span>生图 IP/端口</span>
          <input
            v-model.trim="settingsDraft.imageBaseURL"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="http://192.168.0.131:8188"
          />
        </label>

        <label class="settings-field">
          <span>生视频 IP/端口</span>
          <input
            v-model.trim="settingsDraft.videoBaseURL"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="http://192.168.0.131:8188"
          />
        </label>

        <div class="settings-actions">
          <button class="settings-secondary" type="button" @click="restoreDefaultSettings">恢复默认</button>
          <button class="settings-primary" type="button" @click="saveSettingsPanel">保存</button>
        </div>
        <p v-if="settingsStatus" class="settings-status">{{ settingsStatus }}</p>
      </section>
    </aside>

    <main v-if="activeView === 'assets'" class="asset-page" aria-label="素材库" data-testid="asset-library">
      <header class="asset-page-header">
        <div>
          <h1>素材库</h1>
          <p>{{ history.length ? `${history.length} 个生成素材` : '生成历史会出现在这里' }}</p>
        </div>
        <button
          v-if="history.length"
          type="button"
          class="asset-clear-btn"
          title="清空历史"
          @click="clearHistory"
        >
          清空
        </button>
      </header>

      <section class="asset-page-section" aria-label="生成历史">
        <div class="asset-section-title">生成历史</div>
        <div v-if="history.length" class="asset-page-grid">
          <div
            v-for="h in history"
            :key="h.id"
            class="asset-card"
            role="button"
            tabindex="0"
            title="预览素材"
            @click="openPreview(h)"
            @keydown.enter.prevent="openPreview(h)"
            @keydown.space.prevent="openPreview(h)"
          >
            <video
              v-if="isMessageVideo(h)"
              :src="getMessageMediaURL(h)"
              class="asset-card-media"
              muted
              playsinline
              loop
            />
            <img v-else :src="getMessageMediaURL(h)" class="asset-card-media" alt="" />
            <span v-if="isMessageVideo(h)" class="asset-type-badge">视频</span>
            <span class="asset-card-shade"></span>
            <button type="button" class="asset-delete-btn" title="删除" @click.stop="removeHistoryItem(h.id)">
              <FigmaIcon name="close" />
            </button>
          </div>
        </div>
        <div v-else class="asset-empty">
          <FigmaIcon name="library" />
          <span>暂无素材</span>
        </div>
      </section>
    </main>

    <main v-else class="app-shell">
      <section class="control-panel" aria-label="创作控制台">
        <div class="controls-scroll">
          <header class="brand-block">
            <img src="../assets/logo.svg" alt="" class="brand-mark" />
            <div>
              <h1>AIGC</h1>
              <p>MDT 创作工作台</p>
            </div>
          </header>

          <div class="panel-section">
            <div class="section-label">创作模式</div>
            <div class="mode-switch figma-mode-switch">
              <button
                v-for="item in modeButtons"
                :key="item.key"
                type="button"
                class="mode-card"
                :class="{ active: selected.mode === item.key }"
                @click.stop="selectMode(item.key)"
              >
                <span class="mode-icon">
                  <FigmaIcon :name="getModeIcon(item.key)" />
                </span>
                <span>{{ getModeLabel(item.key) }}</span>
              </button>
            </div>
          </div>

          <div class="panel-divider"></div>

          <div class="panel-section" data-testid="preset-template-section">
            <div class="section-row">
              <div class="section-label">预设模板</div>
              <button class="small-icon-btn" type="button" title="添加模板"><FigmaIcon name="templatePlus" /></button>
            </div>
            <button
              class="template-browse"
              type="button"
              data-testid="browse-template-library"
              @click.stop="toggleTemplateLibrary"
            >
              <FigmaIcon name="templateBrowse" />
              <span>浏览模板库...</span>
              <FigmaIcon name="chevronRight" />
            </button>
            <div
              v-if="activePanel === 'templates'"
              class="template-library-panel"
              data-testid="template-library-panel"
              @click.stop
            >
              <div class="template-library-header">
                <span>模板库</span>
                <button type="button" title="关闭" @click="activePanel = null">
                  <FigmaIcon name="close" />
                </button>
              </div>
              <div class="template-library-grid">
                <button
                  v-for="t in templates"
                  :key="t.id"
                  type="button"
                  class="template-library-item"
                  title="模板预览"
                >
                  <img v-if="getTemplateMediaURL(t)" :src="getTemplateMediaURL(t)" alt="" />
                  <span v-else :style="{ background: t.color }"></span>
                </button>
              </div>
            </div>
            <div v-if="templates.length" class="template-chip-row">
              <div v-for="t in templates.slice(0, 2)" :key="t.id" class="template-chip">
                <img v-if="getTemplateMediaURL(t)" :src="getTemplateMediaURL(t)" alt="" />
                <span v-else :style="{ background: t.color }"></span>
                <button type="button" title="删除模板" @click.stop="removeTemplate(t.id)"><FigmaIcon name="close" /></button>
              </div>
            </div>
          </div>

          <div class="panel-section">
            <div class="section-label">风格核心</div>
            <div class="toolbar-item-wrap style-select-wrap">
              <button
                class="style-select"
                type="button"
                :class="{ active: activePanel === 'style' }"
                @click.stop="togglePanel('style')"
              >
                <FigmaIcon name="palette" />
                <span>{{ selected.style || '选择风格' }}</span>
                <FigmaIcon name="chevronDown" />
              </button>
              <ToolbarPanel
                v-if="activePanel === 'style'"
                :panel="panels.style"
                :selected="selected.style"
                @select="(v) => selectOption('style', v)"
                @close="activePanel = null"
              />
            </div>
          </div>

          <div class="panel-section">
            <div class="section-label">宽高比</div>
            <div class="ratio-grid">
              <button
                v-for="item in ratioOptions"
                :key="item.key"
                type="button"
                class="ratio-card"
                :class="[{ active: isRatioSelected(item.key) }, 'ratio-' + item.shape]"
                @click="selectRatioOption(item.key)"
              >
                <span class="ratio-shape"></span>
                <span>{{ item.label }}</span>
              </button>
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
          </div>
        </div>

        <div class="composer-wrap input-area" data-testid="prompt-composer">
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
                {{ sourceImageFile ? (requiresItemImage ? '已选原图' : '已选参考图') : (requiresItemImage ? '上传原图' : '上传参考图') }}
              </button>
              <div v-if="sourceImagePreview" class="source-image-preview-wrap">
                <img :src="sourceImagePreview" class="source-image-preview" alt="原图预览" />
                <button type="button" class="source-image-clear" :disabled="isGenerating" @click="clearSourceImage">
                  <FigmaIcon name="close" />
                </button>
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
                {{ itemImageFile ? '已选物品图' : '上传物品图' }}
              </button>
              <div v-if="itemImagePreview" class="source-image-preview-wrap">
                <img :src="itemImagePreview" class="source-image-preview" alt="物品图预览" />
                <button type="button" class="source-image-clear" :disabled="isGenerating" @click="clearItemImage">
                  <FigmaIcon name="close" />
                </button>
              </div>
            </div>
          </div>

          <div class="textarea-wrapper" @paste.capture="handlePasteImageInInputArea">
            <textarea
              v-model="prompt"
              class="prompt-input"
              :placeholder="promptPlaceholder"
              :disabled="isGenerating"
              @keydown.ctrl.enter="generate"
            />
            <div class="composer-actions">
              <button
                v-if="isSpeechSupported"
                type="button"
                class="composer-tool voice-btn"
                :class="{ listening: isListening, loading: isSpeechLoading, disabled: isGenerating || isSpeechLoading }"
                :title="speechButtonTitle"
                :disabled="isGenerating || isSpeechLoading"
                @click="toggleSpeechRecognition"
              >
                <FigmaIcon name="mic" />
              </button>
              <button v-if="isGenerating" type="button" class="send-btn generating" title="取消生成" @click="cancel">
                <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
              </button>
              <button v-else type="button" class="send-btn" title="开始生成" @click="generate">
                <FigmaIcon name="send" />
              </button>
            </div>
            <p v-if="speechError" class="speech-error" data-testid="speech-error">{{ speechError }}</p>
          </div>
        </div>
      </section>

      <section class="workspace" aria-label="创作结果">
        <div ref="conversationRef" class="chat-area">
          <div class="assistant-intro">
            <div class="bot-avatar"><FigmaIcon name="bot" /></div>
            <div class="intro-card">欢迎来到 MDT AIGC！请描述您的想法，让我们共同创造非凡的作品。</div>
          </div>
          <div v-if="!messages.length" class="empty-chat">
            <p>黄昏时分未来赛博朋克大都市的宏大定场镜头。高耸的粗野主义摩天大楼没人发光的霓虹灯雾渊中。</p>
          </div>
          <div v-if="!messages.length" class="chat-row role-assistant">
            <div class="bot-avatar"><FigmaIcon name="bot" /></div>
            <div class="chat-bubble figma-preview-card">
              <div class="result-shell">
                <img :src="figmaResultPreview" class="result-img" alt="Figma 生成结果预览" />
              </div>
              <div class="result-actions">
                <button class="action-btn" type="button">
                  <FigmaIcon name="addTemplate" />
                  加入模板
                </button>
                <button class="action-btn" type="button">
                  <FigmaIcon name="download" />
                  下载
                </button>
              </div>
            </div>
          </div>
          <div v-for="msg in messages" :key="msg.id" class="chat-row" :class="'role-' + msg.role">
            <div v-if="msg.role === 'assistant'" class="bot-avatar"><FigmaIcon name="bot" /></div>
            <div class="chat-bubble">
              <div class="chat-meta">
                <span>{{ msg.role === 'user' ? '你' : 'AI' }}</span>
                <button type="button" class="message-delete-btn" title="删除" @click="removeMessage(msg.id)">删除</button>
              </div>
              <template v-if="msg.role === 'user'">
                <div
                  v-if="msg.localSourceImageURL || msg.sourceImageURL || msg.localSourceImage2URL || msg.sourceImage2URL"
                  class="user-images"
                >
                  <img
                    v-if="msg.localSourceImageURL || msg.sourceImageURL"
                    :src="msg.localSourceImageURL || msg.sourceImageURL"
                    class="user-source-image"
                    alt="原图"
                  />
                  <img
                    v-if="msg.localSourceImage2URL || msg.sourceImage2URL"
                    :src="msg.localSourceImage2URL || msg.sourceImage2URL"
                    class="user-source-image"
                    alt="物品图"
                  />
                </div>
                <div class="chat-text">{{ msg.text }}</div>
              </template>
              <template v-else>
                <div v-if="msg.status === 'generating'" class="generating-tip">正在生成中...</div>
                <div v-else-if="isMessageVideo(msg) && getMessageMediaURL(msg)" class="result-shell">
                  <video
                    :src="getMessageMediaURL(msg)"
                    class="result-video result-img-clickable"
                    controls
                    playsinline
                    loop
                    @click="openPreview(msg)"
                  />
                </div>
                <div v-else-if="getMessageMediaURL(msg)" class="result-shell">
                  <img
                    :src="getMessageMediaURL(msg)"
                    class="result-img result-img-clickable"
                    alt="生成结果"
                    @click="openPreview(msg)"
                  />
                </div>
                <div v-else class="error-tip">{{ msg.error }}</div>
                <div v-if="msg.imageURL" class="result-actions">
                  <button v-if="!isMessageVideo(msg)" class="action-btn" @click="addToTemplate(getMessageMediaURL(msg))">
                    <FigmaIcon name="addTemplate" />
                    加入模板
                  </button>
                  <button class="action-btn" @click="downloadResult(getMessageMediaURL(msg))">
                    <FigmaIcon name="download" />
                    下载
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>
    </main>

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
            aria-label="上一张"
            @click.stop="previewShowPrev"
          >
            ‹
          </button>
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
            <img v-else-if="previewImage" :src="previewImage" class="preview-image" alt="预览结果" />
          </div>
          <button
            v-if="previewGallery.length > 1"
            type="button"
            class="preview-nav preview-nav-next"
            aria-label="下一张"
            @click.stop="previewShowNext"
          >
            ›
          </button>
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
.page{min-height:100vh;display:flex;background:#0a0a0b;color:#d8d2e9;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;overflow:hidden}.icon-rail{width:88px;min-height:100vh;padding:30px 18px;display:flex;flex-direction:column;gap:34px;align-items:center;background:linear-gradient(180deg,#151516 0%,#111112 100%);border-right:1px solid rgba(255,255,255,.08)}.rail-btn{width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:14px;background:transparent;color:#bdb7c9;cursor:pointer}.rail-btn svg,.mode-icon svg,.template-browse svg,.style-select svg,.composer-tool svg,.action-btn svg,.send-btn svg{width:22px;height:22px;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}.rail-btn-active{color:#221338;background:#9b6cff;box-shadow:0 0 24px rgba(155,108,255,.45)}.app-shell{flex:1;min-width:0;display:grid;grid-template-columns:472px minmax(0,1fr)}.control-panel{min-height:100vh;padding:46px 40px 40px;display:flex;flex-direction:column;gap:26px;background:radial-gradient(circle at 22% 10%,rgba(155,108,255,.12),transparent 26%),#141415;border-right:1px solid rgba(255,255,255,.1)}.brand-block{display:flex;align-items:center;gap:18px;margin-bottom:26px}.brand-mark{display:none}.brand-block h1{font-size:30px;line-height:1;color:#cfb7ff;letter-spacing:0}.brand-block p{margin-top:8px;font-size:12px;color:#777180}.panel-section{display:flex;flex-direction:column;gap:12px}.section-row{display:flex;align-items:center;justify-content:space-between}.section-label{color:#8f8998;font-size:14px;font-weight:600}.panel-divider{height:1px;background:rgba(255,255,255,.08)}.figma-mode-switch{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;padding:6px;border:1px solid rgba(255,255,255,.06);border-radius:13px;background:#0b0b0c}.mode-card{min-width:0;height:64px;border:0;border-radius:9px;background:transparent;color:#b9b3c4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:12px;cursor:pointer}.mode-card.active{color:#2a1744;background:#9b6cff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2),0 12px 24px rgba(155,108,255,.25)}.mode-more{font-size:24px}.mode-icon svg{width:18px;height:18px}.template-browse,.style-select{width:100%;height:52px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;color:#bdb7c9;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.02);cursor:pointer;font-size:15px}.style-select.active,.template-browse:hover,.style-select:hover{border-color:rgba(155,108,255,.55);background:rgba(155,108,255,.08)}.small-icon-btn{width:22px;height:22px;border:1px solid rgba(255,255,255,.24);border-radius:5px;background:transparent;color:#c8c0d8}.style-select-wrap{position:relative}.ratio-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.ratio-card{height:78px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border:1px solid rgba(255,255,255,.1);border-radius:9px;background:rgba(255,255,255,.02);color:#bdb7c9;cursor:pointer}.ratio-card.active{border-color:rgba(155,108,255,.8);background:rgba(155,108,255,.14);color:#d6c4ff}.ratio-shape{display:block;border:3px solid currentColor;border-radius:2px}.ratio-square .ratio-shape{width:28px;height:28px}.ratio-wide .ratio-shape{width:36px;height:14px}.ratio-tall .ratio-shape{width:16px;height:34px}.ratio-classic .ratio-shape{width:34px;height:22px}.resolution-inputs{display:flex;align-items:center;width:max-content;gap:8px;padding:8px 12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.03)}.resolution-input{width:62px;border:0;outline:0;background:transparent;color:#d8d2e9;text-align:center}.resolution-sep{color:#706a78}.composer-wrap{margin-top:auto;padding:26px;min-height:276px;display:flex;flex-direction:column;gap:16px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.035));box-shadow:0 28px 80px rgba(0,0,0,.38)}.source-image-uploader{display:flex;flex-wrap:wrap;gap:10px}.source-image-input{display:none}.source-image-group,.source-image-preview-wrap,.template-chip-row{display:flex;align-items:center;gap:10px}.source-image-btn{height:34px;padding:0 12px;border:1px solid rgba(155,108,255,.45);border-radius:9px;background:rgba(155,108,255,.1);color:#d6c4ff;cursor:pointer}.source-image-preview,.template-chip img,.template-chip span{width:56px;height:56px;border-radius:8px;object-fit:cover}.source-image-clear,.template-chip button{width:22px;height:22px;border:0;border-radius:50%;background:rgba(5,8,12,.72);color:#d8d2e9;cursor:pointer}.template-chip{position:relative}.template-chip button{position:absolute;right:-7px;top:-7px}.textarea-wrapper{min-height:150px;display:flex;flex-direction:column;gap:16px}.prompt-input{flex:1;width:100%;min-height:112px;resize:none;border:0;outline:0;background:transparent;color:#d8d2e9;font:inherit;line-height:1.7}.prompt-input::placeholder{color:#716b78}.composer-actions{display:flex;align-items:center;gap:16px}.composer-tool{width:28px;height:28px;display:grid;place-items:center;border:0;background:transparent;color:#898391;cursor:pointer}.voice-btn.listening{color:#9b6cff}.send-btn{margin-left:auto;width:50px;height:50px;border:0;border-radius:50%;display:grid;place-items:center;color:#2a1744;background:#a678ff;box-shadow:0 0 32px rgba(166,120,255,.45);cursor:pointer}.send-btn.generating{background:#5e5870;color:#f4f0ff}.workspace{min-width:0;height:100vh;display:flex;flex-direction:column;background:radial-gradient(circle at 30% 18%,rgba(155,108,255,.08),transparent 32%),#080809}.chat-area{flex:1;min-height:0;overflow-y:auto;padding:40px 42px 24px;display:flex;flex-direction:column;gap:28px}.assistant-intro,.chat-row.role-assistant{display:grid;grid-template-columns:52px minmax(0,1fr);gap:18px;align-items:start;max-width:1000px}.chat-row.role-user{display:flex;justify-content:flex-end}.bot-avatar{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;background:#9b6cff;box-shadow:0 0 28px rgba(155,108,255,.35)}.bot-avatar img{width:30px;height:30px}.intro-card,.chat-bubble{border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.025);color:#c8c3ce}.intro-card{padding:28px;font-size:17px}.empty-chat{max-width:900px;margin-left:70px;padding:26px 30px;border:1px solid rgba(155,108,255,.38);border-radius:16px;background:rgba(72,62,91,.68);color:#d4cedc;line-height:1.8;font-size:16px}.chat-bubble{max-width:min(100%,900px);padding:26px}.chat-row.role-user .chat-bubble{background:rgba(155,108,255,.2);border-color:rgba(155,108,255,.42)}.chat-meta{display:flex;justify-content:space-between;gap:14px;margin-bottom:12px;font-size:12px;color:#8d8794}.message-delete-btn,.history-clear-btn{border:0;background:transparent;color:#8d8794;cursor:pointer}.chat-text{color:#e3ddea;line-height:1.8;white-space:pre-wrap}.user-images{display:flex;gap:10px;margin-bottom:14px}.user-source-image{width:120px;height:120px;border-radius:12px;object-fit:cover;border:1px solid rgba(255,255,255,.12)}.result-shell{padding:24px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.02)}.result-img,.result-video{width:100%;max-height:520px;object-fit:contain;display:block;border-radius:12px;background:#020203}.result-img-clickable{cursor:zoom-in}.generating-tip,.error-tip{color:#d6c4ff}.result-actions,.preview-actions{display:flex;gap:12px;margin-top:16px}.action-btn{min-height:44px;padding:0 18px;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.03);color:#d8d2e9;cursor:pointer}.action-btn svg{width:18px;height:18px}.history-area{border-top:1px solid rgba(255,255,255,.08);padding:14px 42px 20px;background:rgba(255,255,255,.015)}.history-header{display:flex;justify-content:space-between;margin-bottom:12px;color:#8d8794;font-size:13px}.history-list{display:flex;gap:10px;overflow-x:auto}.history-card{position:relative;width:72px;height:72px;flex:0 0 auto;overflow:hidden;border-radius:12px;cursor:pointer;border:1px solid rgba(255,255,255,.1)}.history-card-img{width:100%;height:100%;object-fit:cover}.history-item-delete-btn{position:absolute;right:4px;top:4px;width:20px;height:20px;border:0;border-radius:50%;color:#fff;background:rgba(0,0,0,.65)}.preview-mask{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:28px;background:rgba(0,0,0,.78)}.preview-content{max-width:min(100%,1080px);max-height:100%;display:flex;flex-direction:column;gap:12px}.preview-carousel{position:relative;display:flex;align-items:center;justify-content:center}.preview-media{display:flex;align-items:center;justify-content:center}.preview-image,.preview-video{max-width:100%;max-height:78vh;border-radius:16px;background:#050506}.preview-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:44px;height:44px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;font-size:32px;cursor:pointer}.preview-nav-prev{left:14px}.preview-nav-next{right:14px}.preview-counter{text-align:center;color:rgba(255,255,255,.72)}@media(max-width:1100px){.app-shell{grid-template-columns:1fr}.control-panel{min-height:auto;border-right:0;border-bottom:1px solid rgba(255,255,255,.1)}.workspace{height:auto;min-height:70vh}}@media(max-width:760px){.page{display:block;overflow:auto}.icon-rail{width:100%;min-height:auto;flex-direction:row;justify-content:center;padding:14px}.control-panel{padding:24px 16px}.figma-mode-switch,.ratio-grid{grid-template-columns:repeat(2,1fr)}.chat-area{padding:24px 16px}.assistant-intro,.chat-row.role-assistant{grid-template-columns:42px minmax(0,1fr)}.bot-avatar{width:42px;height:42px}.empty-chat{margin-left:0}}
.bot-avatar{color:#340080}.bot-avatar svg{width:30px;height:30px}
:deep(.figma-icon){stroke:none!important;stroke-width:0!important;stroke-linecap:initial!important;stroke-linejoin:initial!important;fill:none!important}
:deep(.figma-icon path){stroke:none!important;fill:currentColor!important}
.rail-btn{color:#CBC3D7}.rail-btn-active{color:#340080}
.composer-wrap{position:relative;padding:22px 24px 20px;border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035)),#202021;border-color:rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 30px 80px rgba(0,0,0,.42)}
.template-chip-row{align-items:flex-start;gap:12px;min-height:72px}
.template-chip,.source-image-preview-wrap{position:relative;width:72px;height:72px;padding:3px;border-radius:14px;background:linear-gradient(145deg,rgba(255,255,255,.18),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.13);box-shadow:0 12px 28px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.11);overflow:hidden}
.template-chip::after,.source-image-preview-wrap::after{content:"";position:absolute;inset:3px;border-radius:11px;background:linear-gradient(135deg,rgba(255,255,255,.16),transparent 38%,rgba(0,0,0,.16));pointer-events:none}
.template-chip img,.template-chip span,.source-image-preview{width:100%;height:100%;border-radius:11px;object-fit:cover;display:block}
.template-chip span{background:linear-gradient(135deg,#20343b,#758489)!important}
.template-chip button,.source-image-clear{position:absolute;right:5px;top:5px;z-index:2;width:22px;height:22px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(10,10,15,.78);color:#e7e1f2;box-shadow:0 8px 18px rgba(0,0,0,.32);backdrop-filter:blur(10px)}
.template-chip button svg,.source-image-clear svg{width:8px;height:8px}
.template-chip:hover,.source-image-preview-wrap:hover{border-color:rgba(208,188,255,.42);box-shadow:0 16px 34px rgba(0,0,0,.34),0 0 0 1px rgba(155,108,255,.16),inset 0 1px 0 rgba(255,255,255,.12)}
.textarea-wrapper{min-height:132px}.prompt-input{min-height:92px}
.page{position:relative;background:linear-gradient(135deg,#08090a 0%,#101012 42%,#07080a 100%);color:#eee9f7}
.page::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(115deg,rgba(122,220,255,.055),transparent 34%,rgba(208,188,255,.045) 68%,transparent);background-size:56px 56px,56px 56px,100% 100%;mask-image:linear-gradient(90deg,transparent 0%,#000 18%,#000 84%,transparent 100%);opacity:.34}
.icon-rail,.app-shell{position:relative;z-index:1}
.icon-rail{background:linear-gradient(180deg,#171719 0%,#101113 45%,#0b0c0e 100%);border-right:1px solid rgba(255,255,255,.09);box-shadow:inset -1px 0 0 rgba(255,255,255,.035),18px 0 70px rgba(0,0,0,.34)}
.rail-btn{transition:transform .18s ease,background .18s ease,color .18s ease,box-shadow .18s ease}
.rail-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.055);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.rail-btn-active{background:linear-gradient(145deg,#b787ff 0%,#8f63ff 100%);box-shadow:0 16px 34px rgba(122,84,228,.34),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -12px 24px rgba(52,0,128,.13)}
.control-panel{background:linear-gradient(180deg,rgba(24,24,26,.96),rgba(17,18,20,.96)),linear-gradient(130deg,rgba(116,230,255,.05),transparent 38%,rgba(174,131,255,.08));box-shadow:inset -1px 0 0 rgba(255,255,255,.045),24px 0 90px rgba(0,0,0,.35)}
.brand-block{margin-bottom:18px}.brand-block h1{font-weight:800;color:#d8c4ff;text-shadow:0 0 26px rgba(155,108,255,.22)}.brand-block p{color:#8d8795}
.section-label{display:flex;align-items:center;gap:8px;color:#aaa2b3;font-size:13px}
.panel-section{position:relative}
.section-label::before{content:"";width:5px;height:5px;border-radius:50%;background:#75d8ea;box-shadow:0 0 14px rgba(117,216,234,.45)}
.figma-mode-switch{background:linear-gradient(180deg,rgba(0,0,0,.34),rgba(255,255,255,.025));border-color:rgba(255,255,255,.095);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.mode-card{transition:transform .18s ease,background .18s ease,color .18s ease,box-shadow .18s ease}
.mode-card:hover{transform:translateY(-1px);background:rgba(255,255,255,.055);color:#e4ddf1}
.mode-card.active{background:linear-gradient(145deg,#b188ff,#8e63ff);box-shadow:0 14px 30px rgba(141,98,255,.25),inset 0 1px 0 rgba(255,255,255,.34);color:#2c164b}
.template-browse,.style-select,.ratio-card,.resolution-inputs{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));border-color:rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.055)}
.template-browse:hover,.style-select:hover,.style-select.active,.ratio-card:hover{border-color:rgba(117,216,234,.34);background:linear-gradient(180deg,rgba(117,216,234,.07),rgba(155,108,255,.035));box-shadow:0 12px 28px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.07)}
.ratio-card{transition:transform .18s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease}.ratio-card:hover{transform:translateY(-1px)}.ratio-card.active{background:linear-gradient(180deg,rgba(155,108,255,.18),rgba(117,216,234,.055));border-color:rgba(208,188,255,.72);box-shadow:0 12px 28px rgba(96,66,170,.18),inset 0 1px 0 rgba(255,255,255,.09)}
.small-icon-btn,.composer-tool,.message-delete-btn,.history-clear-btn,.history-item-delete-btn{transition:transform .16s ease,background .16s ease,color .16s ease,border-color .16s ease}
.small-icon-btn:hover,.composer-tool:hover,.message-delete-btn:hover,.history-clear-btn:hover,.history-item-delete-btn:hover{transform:translateY(-1px);color:#f0eaff;background:rgba(255,255,255,.07)}
.composer-wrap{background:linear-gradient(180deg,rgba(255,255,255,.095),rgba(255,255,255,.035)),linear-gradient(135deg,rgba(117,216,234,.055),transparent 42%,rgba(166,120,255,.075));border-color:rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 34px 100px rgba(0,0,0,.48)}
.composer-wrap::before{content:"";position:absolute;left:18px;right:18px;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent)}
.prompt-input{color:#f0eaf7;font-size:14px}.prompt-input::placeholder{color:#8f8796}.composer-actions{border-top:1px solid rgba(255,255,255,.06);padding-top:10px}
.source-image-btn{background:linear-gradient(180deg,rgba(155,108,255,.16),rgba(117,216,234,.055));border-color:rgba(208,188,255,.32);box-shadow:inset 0 1px 0 rgba(255,255,255,.08);transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.source-image-btn:hover{transform:translateY(-1px);border-color:rgba(117,216,234,.42);box-shadow:0 12px 24px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.1)}
.send-btn{background:linear-gradient(145deg,#b787ff,#9e6aff 58%,#73d4e8);box-shadow:0 18px 40px rgba(155,108,255,.33),0 0 0 1px rgba(255,255,255,.1),inset 0 1px 0 rgba(255,255,255,.42);transition:transform .18s ease,box-shadow .18s ease}.send-btn:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 22px 46px rgba(155,108,255,.42),0 0 0 1px rgba(255,255,255,.13),inset 0 1px 0 rgba(255,255,255,.46)}
.workspace{background:linear-gradient(180deg,rgba(14,15,17,.98),rgba(6,7,8,.99)),linear-gradient(120deg,rgba(117,216,234,.04),transparent 38%,rgba(155,108,255,.06));box-shadow:inset 1px 0 0 rgba(255,255,255,.035)}
.chat-area{scrollbar-width:thin;scrollbar-color:rgba(208,188,255,.34) transparent}.chat-area::-webkit-scrollbar,.history-list::-webkit-scrollbar{height:8px;width:8px}.chat-area::-webkit-scrollbar-thumb,.history-list::-webkit-scrollbar-thumb{background:rgba(208,188,255,.28);border-radius:99px}.chat-area::-webkit-scrollbar-track,.history-list::-webkit-scrollbar-track{background:transparent}
.bot-avatar{background:linear-gradient(145deg,#b487ff,#8e63ff);box-shadow:0 18px 34px rgba(134,92,255,.28),inset 0 1px 0 rgba(255,255,255,.35)}
.intro-card,.chat-bubble{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.022));border-color:rgba(255,255,255,.13);box-shadow:0 20px 60px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(14px)}
.chat-row.role-user .chat-bubble{background:linear-gradient(180deg,rgba(119,93,166,.38),rgba(69,62,91,.48));border-color:rgba(208,188,255,.4)}
.empty-chat{background:linear-gradient(180deg,rgba(82,73,101,.72),rgba(48,45,58,.7));border-color:rgba(208,188,255,.32);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 20px 54px rgba(0,0,0,.2)}
.result-shell{padding:18px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.2));border-color:rgba(255,255,255,.11);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 18px 48px rgba(0,0,0,.28)}
.result-img,.result-video{border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.42)}
.action-btn{background:linear-gradient(180deg,rgba(255,255,255,.065),rgba(255,255,255,.022));border-color:rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);transition:transform .16s ease,border-color .16s ease,background .16s ease}.action-btn:hover{transform:translateY(-1px);border-color:rgba(117,216,234,.36);background:linear-gradient(180deg,rgba(117,216,234,.08),rgba(255,255,255,.03))}
.history-area{background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(0,0,0,.04));box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}.history-card{border-color:rgba(255,255,255,.13);box-shadow:0 12px 30px rgba(0,0,0,.25);transition:transform .16s ease,border-color .16s ease}.history-card:hover{transform:translateY(-2px);border-color:rgba(117,216,234,.36)}
.history-item-delete-btn{top:6px;right:6px;width:26px;height:26px;display:grid;place-items:center;padding:0;line-height:1;border-radius:50%}
.history-item-delete-btn svg{width:10px!important;height:10px!important}
.preview-mask{background:rgba(0,0,0,.78);backdrop-filter:blur(18px)}.preview-image,.preview-video{box-shadow:0 34px 100px rgba(0,0,0,.58);border:1px solid rgba(255,255,255,.1)}.preview-nav{background:rgba(22,23,27,.72);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px)}
.composer-wrap{margin-bottom:14px}
.composer-actions{min-height:52px;align-items:center}
.composer-tool:first-child{margin-left:0}
.rail-top,.rail-bottom{display:flex;flex-direction:column;align-items:center;gap:34px}
.rail-bottom{margin-top:auto}
.icon-rail{z-index:20}
.settings-popover{position:fixed;left:104px;bottom:28px;z-index:80;width:min(380px,calc(100vw - 132px));padding:22px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:linear-gradient(180deg,rgba(33,34,38,.98),rgba(16,17,20,.98));box-shadow:0 28px 90px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(18px)}
.settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
.settings-header h2{margin:0;color:#f1ebff;font-size:20px;line-height:1.2;letter-spacing:0}
.settings-header p{margin:6px 0 0;color:#91899d;font-size:13px}
.settings-close{width:30px;height:30px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.04);color:#cbc3d7;cursor:pointer}
.settings-close svg{width:10px;height:10px}
.settings-field{display:flex;flex-direction:column;gap:8px;margin-top:14px;color:#b9b2c5;font-size:13px}
.settings-field input{height:42px;width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.13);border-radius:10px;background:rgba(0,0,0,.24);color:#f0eaf7;outline:0;padding:0 12px;font:inherit}
.settings-field input:focus{border-color:rgba(117,216,234,.45);box-shadow:0 0 0 3px rgba(117,216,234,.1)}
.settings-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
.settings-primary,.settings-secondary{min-height:38px;padding:0 14px;border-radius:10px;cursor:pointer;font-weight:700}
.settings-primary{border:0;background:linear-gradient(145deg,#b787ff,#73d4e8);color:#24123e}
.settings-secondary{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#d8d2e9}
.settings-status{margin:12px 2px 0;color:#75d8ea;font-size:12px}
.speech-error{margin:0;color:#ffb4ab;font-size:12px;line-height:1.45}
.template-library-panel{position:absolute;left:0;right:0;top:calc(100% + 10px);z-index:60;padding:14px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:linear-gradient(180deg,rgba(33,34,38,.98),rgba(16,17,20,.98));box-shadow:0 24px 70px rgba(0,0,0,.46),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(18px)}
.template-library-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;color:#f0eaff;font-size:13px;font-weight:700}
.template-library-header button{width:26px;height:26px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.04);color:#cbc3d7;cursor:pointer}
.template-library-header svg{width:9px;height:9px}
.template-library-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;max-height:260px;overflow:auto;padding-right:2px}
.template-library-item{aspect-ratio:1;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:linear-gradient(145deg,rgba(255,255,255,.15),rgba(255,255,255,.035));padding:3px;cursor:pointer;overflow:hidden;box-shadow:0 10px 24px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.08)}
.template-library-item:hover{border-color:rgba(117,216,234,.4);box-shadow:0 14px 30px rgba(0,0,0,.28),0 0 0 1px rgba(155,108,255,.16),inset 0 1px 0 rgba(255,255,255,.1)}
.template-library-item img,.template-library-item span{width:100%;height:100%;border-radius:9px;object-fit:cover;display:block}
.page{--rail-width:88px;--panel-width:clamp(380px,36vw,472px);--panel-pad-x:clamp(22px,3vw,40px);--composer-height:clamp(216px,34vh,276px);height:100dvh;min-height:0}
.icon-rail{flex:0 0 var(--rail-width);min-height:100dvh}
.app-shell{height:100dvh;min-height:0;grid-template-columns:var(--panel-width) minmax(0,1fr)}
.control-panel{height:100dvh;min-height:0;overflow:hidden;padding:clamp(24px,4.2vh,46px) var(--panel-pad-x) 10px;gap:clamp(12px,1.8vh,18px)}
.controls-scroll{min-height:0;overflow:auto;display:flex;flex:1 1 auto;flex-direction:column;gap:clamp(14px,2.2vh,26px);padding-right:4px;scrollbar-width:thin;scrollbar-color:rgba(208,188,255,.34) transparent}
.controls-scroll::-webkit-scrollbar{width:8px}.controls-scroll::-webkit-scrollbar-thumb{background:rgba(208,188,255,.28);border-radius:99px}.controls-scroll::-webkit-scrollbar-track{background:transparent}
.composer-wrap{position:relative;left:auto;right:auto;bottom:auto;z-index:1;width:100%;margin-top:0;margin-bottom:0;flex:0 0 auto;min-height:var(--composer-height);padding:clamp(18px,2.4vh,22px) clamp(18px,2.6vw,24px) clamp(12px,1.8vh,18px)}
.textarea-wrapper{flex:1 1 auto;min-height:clamp(116px,22vh,132px);gap:clamp(10px,1.8vh,16px)}
.prompt-input{min-height:clamp(76px,16vh,92px)}
.composer-actions{margin-top:auto;min-height:clamp(44px,8vh,52px);padding-top:8px}
.asset-library{position:relative;z-index:10;flex:0 0 clamp(220px,18vw,268px);height:100dvh;min-height:0;display:flex;flex-direction:column;gap:16px;padding:28px 18px 22px;background:linear-gradient(180deg,rgba(22,23,26,.98),rgba(12,13,15,.98)),linear-gradient(135deg,rgba(117,216,234,.045),transparent 42%,rgba(166,120,255,.065));border-right:1px solid rgba(255,255,255,.09);box-shadow:inset -1px 0 0 rgba(255,255,255,.035),18px 0 70px rgba(0,0,0,.28)}
.asset-library-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.asset-library-header h2{margin:0;color:#f0eaff;font-size:20px;line-height:1.15;letter-spacing:0}
.asset-library-header p{margin:7px 0 0;color:#8f8798;font-size:12px;line-height:1.4}
.asset-clear-btn{flex:0 0 auto;min-height:30px;padding:0 10px;border:1px solid rgba(255,255,255,.13);border-radius:8px;background:rgba(255,255,255,.04);color:#c9c1d8;font-size:12px;cursor:pointer;transition:transform .16s ease,background .16s ease,color .16s ease,border-color .16s ease}
.asset-clear-btn:hover{transform:translateY(-1px);border-color:rgba(117,216,234,.32);background:rgba(117,216,234,.08);color:#f0eaff}
.asset-section-title{display:flex;align-items:center;gap:8px;color:#aaa2b3;font-size:13px;font-weight:700}
.asset-section-title::before{content:"";width:5px;height:5px;border-radius:50%;background:#75d8ea;box-shadow:0 0 14px rgba(117,216,234,.45)}
.asset-grid{min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:10px;padding-right:3px;scrollbar-width:thin;scrollbar-color:rgba(208,188,255,.34) transparent}
.asset-grid::-webkit-scrollbar{width:8px;height:8px}.asset-grid::-webkit-scrollbar-thumb{background:rgba(208,188,255,.28);border-radius:99px}.asset-grid::-webkit-scrollbar-track{background:transparent}
.asset-card{position:relative;aspect-ratio:1;min-width:0;overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:12px;background:linear-gradient(145deg,rgba(255,255,255,.15),rgba(255,255,255,.035));box-shadow:0 12px 30px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.08);cursor:pointer;outline:0;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
.asset-card:hover,.asset-card:focus-visible{transform:translateY(-2px);border-color:rgba(117,216,234,.4);box-shadow:0 16px 34px rgba(0,0,0,.3),0 0 0 1px rgba(155,108,255,.16),inset 0 1px 0 rgba(255,255,255,.1)}
.asset-card-media{width:100%;height:100%;object-fit:cover;display:block}
.asset-card-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.02),transparent 45%,rgba(0,0,0,.26));pointer-events:none}
.asset-type-badge{position:absolute;left:7px;bottom:7px;z-index:2;min-height:20px;padding:0 7px;display:inline-flex;align-items:center;border-radius:7px;background:rgba(8,9,12,.72);color:#f0eaff;font-size:11px;line-height:1;backdrop-filter:blur(10px)}
.asset-delete-btn{position:absolute;right:6px;top:6px;z-index:3;width:26px;height:26px;display:grid;place-items:center;padding:0;border:1px solid rgba(255,255,255,.12);border-radius:50%;background:rgba(10,10,15,.78);color:#e7e1f2;box-shadow:0 8px 18px rgba(0,0,0,.32);backdrop-filter:blur(10px);cursor:pointer;transition:transform .16s ease,background .16s ease,color .16s ease,border-color .16s ease}
.asset-delete-btn:hover{transform:translateY(-1px);border-color:rgba(117,216,234,.34);background:rgba(255,255,255,.09);color:#fff}
.asset-delete-btn svg{width:10px!important;height:10px!important}
.asset-empty{min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border:1px dashed rgba(255,255,255,.14);border-radius:14px;background:rgba(255,255,255,.025);color:#8f8798;font-size:13px}
.asset-empty svg{width:26px;height:26px}
.asset-page{position:relative;z-index:1;flex:1;min-width:0;height:100dvh;overflow:auto;padding:clamp(28px,4vw,54px);background:linear-gradient(180deg,rgba(14,15,17,.98),rgba(6,7,8,.99)),linear-gradient(120deg,rgba(117,216,234,.04),transparent 38%,rgba(155,108,255,.06));box-shadow:inset 1px 0 0 rgba(255,255,255,.035);scrollbar-width:thin;scrollbar-color:rgba(208,188,255,.34) transparent}
.asset-page::-webkit-scrollbar{width:8px}.asset-page::-webkit-scrollbar-thumb{background:rgba(208,188,255,.28);border-radius:99px}.asset-page::-webkit-scrollbar-track{background:transparent}
.asset-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:30px}
.asset-page-header h1{margin:0;color:#f0eaff;font-size:30px;line-height:1.1;letter-spacing:0}
.asset-page-header p{margin:9px 0 0;color:#91899d;font-size:13px}
.asset-page-section{display:flex;flex-direction:column;gap:16px}
.asset-page-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;align-content:start}
.asset-page .asset-card{min-height:150px}
.asset-page .asset-empty{min-height:320px}
@media(max-width:1180px){.asset-library{flex-basis:210px;padding:24px 14px 18px}.asset-grid{grid-template-columns:1fr}.page{--panel-width:clamp(340px,35vw,400px)}}
@media(max-height:680px){
  .page{--composer-height:198px}
  .control-panel{padding-top:20px;gap:10px}
  .controls-scroll{gap:12px}
  .brand-block{margin-bottom:8px}
  .panel-section{gap:8px}
  .figma-mode-switch{gap:4px;padding:4px}
  .mode-card{height:52px}
  .ratio-card{height:62px}
  .template-browse,.style-select{height:44px}
  .textarea-wrapper{min-height:104px}
  .prompt-input{min-height:68px}
  .composer-actions{min-height:42px}
}
@media(min-width:761px) and (max-width:980px){
  .page{--panel-width:clamp(360px,45vw,410px)}
  .app-shell{grid-template-columns:var(--panel-width) minmax(0,1fr)}
  .control-panel{border-right:1px solid rgba(255,255,255,.1);border-bottom:0}
  .workspace{height:100dvh;min-height:0}
  .chat-area{padding:28px 24px 18px}
  .intro-card,.chat-bubble{padding:20px}
}
@media(max-width:760px){
  .page{--rail-width:0px;--panel-width:100vw;--panel-pad-x:16px;--composer-height:200px;height:auto;min-height:100dvh;overflow:auto}
  .icon-rail{min-height:auto;flex:0 0 auto}
  .asset-library{width:100%;height:auto;min-height:0;padding:12px 16px 14px;border-right:0;border-bottom:1px solid rgba(255,255,255,.09);box-shadow:inset 0 -1px 0 rgba(255,255,255,.035),0 18px 50px rgba(0,0,0,.22)}
  .asset-library-header h2{font-size:18px}.asset-library-header p{margin-top:4px}
  .asset-grid{display:flex;grid-template-columns:none;overflow-x:auto;overflow-y:hidden;padding-bottom:2px;padding-right:0}
  .asset-card{flex:0 0 92px;width:92px}
  .asset-empty{min-height:74px;flex-direction:row}
  .asset-page{height:auto;min-height:calc(100dvh - 72px);padding:22px 16px 28px}
  .asset-page-header{margin-bottom:22px}
  .asset-page-header h1{font-size:24px}
  .asset-page-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .asset-page .asset-card{width:auto;min-height:0;flex:auto}
  .asset-page .asset-empty{min-height:220px;flex-direction:column}
  .app-shell{height:auto;grid-template-columns:1fr}
  .control-panel{height:calc(100dvh - 72px);min-height:0;padding:20px 16px 8px;overflow:hidden}
  .composer-wrap{left:auto;right:auto;width:100%;bottom:auto;min-height:var(--composer-height);border-radius:18px}
  .textarea-wrapper{min-height:108px}
  .prompt-input{min-height:72px}
}
@media(max-width:760px){.rail-top,.rail-bottom{flex-direction:row;gap:18px}.rail-bottom{margin-top:0;margin-left:auto}.settings-popover{left:16px;right:16px;bottom:82px;width:auto}}
</style>
