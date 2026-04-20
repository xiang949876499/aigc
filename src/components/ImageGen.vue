<script setup>
import { ref, reactive } from 'vue'
import ToolbarPanel from './ToolbarPanel.vue'
import { useComfyUI } from '../composables/useComfyUI.js'
import workflows from '../workflows/index.js'

const { isGenerating, result, error, submit, cancel } = useComfyUI()

// 输入框内容
const prompt = ref('')

// 当前激活的工具面板
const activePanel = ref(null)

// 模板库
const templates = ref([
  { id: 1, color: '#5B8FD4' },
  { id: 2, color: '#8B5CF6' },
  { id: 3, color: '#5BB8D4' },
  { id: 4, color: '#C9A84C' },
])

// 生成历史
const history = ref([
  { id: 1, color: '#C06060' },
  { id: 2, color: '#C06060' },
  { id: 3, color: '#C06060' },
  { id: 4, color: '#C06060' },
])

// 生成结果
// result 由 useComfyUI composable 管理

// 选中的参数
const selected = reactive({
  ratio: '1:1',
  style: '写实摄影',
  quality: '超高清',
  angle: '景深/虚化',
  color: '电影感',
  lighting: '摄影棚光',
  diffMode: false,
  flux: false,
  fluxScale: '2倍',
})

// 工具面板配置
const panels = {
  ratio: {
    label: '比例',
    options: ['1:1 正方形，头像', '2:3 社交媒体，自拍', '3:4 经典比例，拍照', '4:3 交叠区间，插画', '9:16 手机竖图，人像', '16:9 桌面壁纸，风景'],
    field: 'ratio',
    display: o => o.split(' ')[0],
  },
  style: {
    label: '风格',
    options: ['写实摄影', '日系动漫风', '赛博朋克', '吉卜力风', '水墨国风', '3D渲染', '蒸汽朋克', '像素风'],
    field: 'style',
    display: o => o,
  },
  quality: {
    label: '质感选择',
    options: ['超高清', '皮肤纹理', '金属质感', '水墨渗染', '厚涂油彩', '玻璃材质'],
    field: 'quality',
    display: o => o,
  },
  angle: {
    label: '视角设置',
    options: ['景深/虚化', '广角全景', '半身像', '全身像', '前拍', '仰拍', '特写'],
    field: 'angle',
    display: o => o,
  },
  color: {
    label: '色调设置',
    options: ['电影感', '莫兰迪', '黑白经典', '复古胶片', '赛博霓虹', '暗黑哥特'],
    field: 'color',
    display: o => o,
  },
  lighting: {
    label: '灯光设置',
    options: ['摄影棚光', '电影布光', '自然光', '逆光'],
    field: 'lighting',
    display: o => o,
  },
  flux: {
    label: 'FLUX',
    options: ['2倍', '3倍'],
    field: 'fluxScale',
    display: o => o,
  },
}

function togglePanel(name) {
  activePanel.value = activePanel.value === name ? null : name
}

function selectOption(field, value) {
  selected[field] = value
  activePanel.value = null
}

function toggleDiff() {
  selected.diffMode = !selected.diffMode
}

function toggleFlux() {
  selected.flux = !selected.flux
  if (!selected.flux) activePanel.value = null
}

async function generate() {
  if (!prompt.value.trim() || isGenerating.value) return
  activePanel.value = null

  const baseWorkflow = selected.flux ? workflows.flux : workflows.default
  // 深拷贝 workflow 并注入 prompt 和 seed
  const workflow = JSON.parse(JSON.stringify(baseWorkflow))

  // 找到正面提示词节点（CLIPTextEncode，text 为空字符串的节点）并注入 prompt
  for (const node of Object.values(workflow)) {
    if (node.class_type === 'CLIPTextEncode' && node.inputs?.text === '') {
      node.inputs.text = prompt.value.trim()
      break
    }
  }

  // 注入随机 seed 到 KSampler
  for (const node of Object.values(workflow)) {
    if (node.class_type === 'KSampler' && 'seed' in (node.inputs || {})) {
      node.inputs.seed = Math.floor(Math.random() * 2 ** 32)
      break
    }
  }

  await submit(workflow)

  if (result.value) {
    history.value.unshift({ id: Date.now(), imageURL: result.value.imageURL })
    if (history.value.length > 8) history.value.pop()
  }
}

function downloadResult() {
  alert('下载功能')
}

function addToTemplate() {
  if (result.value) {
    templates.value.unshift({ id: Date.now(), imageURL: result.value.imageURL })
  }
}
</script>

<template>
  <div class="page" @click.self="activePanel = null">
    <!-- Slogan -->
    <div class="slogan">
      <span>灵感触手可及</span>
      <img src="../assets/logo.svg" alt="" class="slogan-icon" />
      <span>创作不再受限</span>
    </div>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧：生成结果 -->
      <div class="result-area" v-if="result || isGenerating || error">
        <div class="result-image">
          <img v-if="result && !isGenerating" :src="result.imageURL" class="result-img" alt="生成结果" />
          <div v-else-if="isGenerating" class="generating-tip">正在生成，请稍后...</div>
          <div v-else-if="error" class="error-tip">{{ error }}</div>
        </div>
        <div class="result-actions" v-if="result && !isGenerating">
          <button class="action-btn" @click="addToTemplate">
            <span class="icon-add">＋</span>
          </button>
          <button class="action-btn" @click="downloadResult">
            <span class="icon-dl">↓</span>
          </button>
          <span class="action-label">添加为模板</span>
        </div>
      </div>

      <!-- 右侧：输入区 -->
      <div class="input-area">
        <!-- 模板库 -->
        <div class="template-bar">
          <span class="template-bar-label">模板库</span>
          <button class="template-more">»</button>
          <div class="template-list">
            <div
              v-for="t in templates"
              :key="t.id"
              class="template-card"
              :style="t.imageURL ? { backgroundImage: `url(${t.imageURL})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: t.color }"
            />
          </div>
        </div>

        <!-- 输入框 -->
        <div class="input-box" :class="{ generating: isGenerating }">
          <textarea
            v-model="prompt"
            class="prompt-input"
            :placeholder="isGenerating ? '正在生成，请稍后...' : '输入词'"
            :disabled="isGenerating"
            @keydown.ctrl.enter="generate"
          />
          <div class="toolbar">
            <!-- 比例 -->
            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'ratio' }"
                @click.stop="togglePanel('ratio')"
                title="比例"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'ratio'"
                :panel="panels.ratio"
                :selected="selected.ratio"
                @select="v => selectOption('ratio', v)"
                @close="activePanel = null"
              />
            </div>

            <!-- 风格 -->
            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'style' }"
                @click.stop="togglePanel('style')"
                title="风格"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="3" r="1"/><circle cx="21" cy="12" r="1"/><circle cx="12" cy="21" r="1"/><circle cx="3" cy="12" r="1"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'style'"
                :panel="panels.style"
                :selected="selected.style"
                @select="v => selectOption('style', v)"
                @close="activePanel = null"
              />
            </div>

            <!-- 质感 -->
            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'quality' }"
                @click.stop="togglePanel('quality')"
                title="质感"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'quality'"
                :panel="panels.quality"
                :selected="selected.quality"
                @select="v => selectOption('quality', v)"
                @close="activePanel = null"
              />
            </div>

            <!-- 相机/视角 -->
            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'angle' }"
                @click.stop="togglePanel('angle')"
                title="视角"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'angle'"
                :panel="panels.angle"
                :selected="selected.angle"
                @select="v => selectOption('angle', v)"
                @close="activePanel = null"
              />
            </div>

            <!-- 灯光 -->
            <div class="toolbar-item-wrap">
              <button
                class="toolbar-btn"
                :class="{ active: activePanel === 'lighting' }"
                @click.stop="togglePanel('lighting')"
                title="灯光"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              </button>
              <ToolbarPanel
                v-if="activePanel === 'lighting'"
                :panel="panels.lighting"
                :selected="selected.lighting"
                @select="v => selectOption('lighting', v)"
                @close="activePanel = null"
              />
            </div>

            <!-- DIFF模式 -->
            <button
              class="toolbar-text-btn"
              :class="{ active: selected.diffMode }"
              @click.stop="toggleDiff"
            >DIFF模式</button>

            <!-- fLUX -->
            <div class="toolbar-item-wrap">
              <button
                class="toolbar-text-btn flux"
                :class="{ active: selected.flux }"
                @click.stop="() => { toggleFlux(); if(selected.flux) togglePanel('flux') }"
              >fLUX</button>
              <ToolbarPanel
                v-if="activePanel === 'flux' && selected.flux"
                :panel="panels.flux"
                :selected="selected.fluxScale"
                @select="v => selectOption('fluxScale', v)"
                @close="activePanel = null"
              />
            </div>

            <!-- 生成按钮 -->
            <button
              class="generate-btn"
              :class="{ generating: isGenerating }"
              @click="generate"
            >
              <svg v-if="!isGenerating" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              <span v-else class="spin">◌</span>
            </button>
          </div>
        </div>

        <!-- 生成历史 -->
        <div class="history-area" v-if="history.length">
          <span class="history-label">生成历史</span>
          <div class="history-list">
            <div
              v-for="h in history"
              :key="h.id"
              class="history-card"
              :style="h.imageURL ? { backgroundImage: `url(${h.imageURL})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: h.color }"
            />
          </div>
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
  padding: 60px 24px 40px;
  background: #fff;
}

/* Slogan */
.slogan {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 36px;
  font-weight: 500;
  color: #1a1a1a;
  margin-bottom: 60px;
  letter-spacing: -0.5px;
}
.slogan-icon {
  width: 80px;
  height: 80px;
  object-fit: contain;
}

/* 主内容 */
.main-content {
  width: 100%;
  max-width: 1140px;
  display: flex;
  gap: 40px;
  align-items: flex-start;
}

/* 左侧结果区 */
.result-area {
  flex: 0 0 400px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.result-image {
  width: 100%;
  aspect-ratio: 4/3;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  background: #e0e0e0;
}
.generating-tip {
  color: #999;
  font-size: 14px;
}
.result-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 16px;
}
.error-tip {
  color: #e05252;
  font-size: 14px;
  padding: 0 16px;
  text-align: center;
}
.result-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #555;
  transition: all 0.2s;
}
.action-btn:hover {
  background: #f5f5f5;
  border-color: #bbb;
}
.action-label {
  font-size: 12px;
  color: #999;
  margin-left: 4px;
}

/* 右侧输入区 */
.input-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* 模板库 */
.template-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f0f0f0;
  border-radius: 14px;
  padding: 10px 14px;
  position: relative;
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
  width: 60px;
  height: 60px;
  border-radius: 10px;
  flex-shrink: 0;
  cursor: pointer;
  transition: opacity 0.2s;
}
.template-card:hover {
  opacity: 0.85;
}

/* 输入框 */
.input-box {
  background: #fff;
  border: 2px solid #4B9EF8;
  border-radius: 20px;
  padding: 16px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.2s;
}
.input-box.generating {
  border-color: #bbb;
}
.prompt-input {
  width: 100%;
  min-height: 80px;
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
  color: #ccc;
}
.prompt-input:disabled {
  color: #aaa;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
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
  color: #4B9EF8;
  background: #EBF4FF;
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
  color: #4B9EF8;
  background: #EBF4FF;
}
.toolbar-text-btn.flux.active {
  color: #1a1a1a;
  font-weight: 600;
}

/* 生成按钮 */
.generate-btn {
  margin-left: auto;
  width: 44px;
  height: 44px;
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
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 生成历史 */
.history-area {
  border: 1.5px dashed #ddd;
  border-radius: 16px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.history-label {
  font-size: 12px;
  color: #999;
}
.history-list {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.history-card {
  width: 70px;
  height: 70px;
  border-radius: 10px;
  cursor: pointer;
  transition: opacity 0.2s;
}
.history-card:hover {
  opacity: 0.8;
}
</style>
