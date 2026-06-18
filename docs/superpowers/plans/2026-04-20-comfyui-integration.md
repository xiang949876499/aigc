# ComfyUI 接入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 aigc-app 的图片生成功能对接真实 ComfyUI API，通过定时轮询查询生图结果，替换现有的模拟延迟逻辑。

**Architecture:** 采用 Vue 3 composable 模式，`useComfyUI` 封装提交和轮询逻辑，配置集中在 `src/config/comfyui.js`，多个固定 workflow JSON 文件通过 `src/workflows/index.js` 注册表统一管理，`ImageGen.vue` 调用 composable 替换原有模拟逻辑。

**Tech Stack:** Vue 3 (Composition API), Vite, Vitest, native fetch API

---

## 文件清单

| 操作 | 路径 | 职责 |
|------|------|------|
| 创建 | `src/config/comfyui.js` | ComfyUI 服务地址、轮询间隔、超时次数配置 |
| 创建 | `src/workflows/default.json` | 默认生图 workflow |
| 创建 | `src/workflows/flux.json` | FLUX 模式 workflow |
| 创建 | `src/workflows/index.js` | workflow 注册表 |
| 创建 | `src/composables/useComfyUI.js` | 提交任务 + 定时轮询逻辑 |
| 修改 | `src/components/ImageGen.vue` | 调用 composable，替换模拟逻辑，显示真实图片 |
| 创建 | `src/composables/__tests__/useComfyUI.test.js` | composable 单元测试 |
| 修改 | `package.json` | 添加 vitest 依赖和 test 脚本 |
| 修改 | `vite.config.js` | 添加 vitest 配置 |

---

## Task 1: 安装 Vitest 并配置测试环境

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`

- [ ] **Step 1: 安装 vitest**

```bash
cd D:/code/aigc-app
npm install -D vitest @vitest/ui
```

- [ ] **Step 2: 更新 vite.config.js 添加 test 配置**

当前 `vite.config.js` 内容读取后，替换为：

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 3: 在 package.json 的 scripts 中添加 test 命令**

在 `"scripts"` 对象中添加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: 验证 vitest 可运行**

```bash
npx vitest run --reporter=verbose
```

预期输出：`No test files found` 或正常退出（无报错）

- [ ] **Step 5: Commit**

```bash
git init
git add package.json vite.config.js
git commit -m "chore: add vitest for unit testing"
```

---

## Task 2: 创建 ComfyUI 配置文件

**Files:**
- Create: `src/config/comfyui.js`

- [ ] **Step 1: 创建配置文件**

```js
// src/config/comfyui.js
export default {
  baseURL: 'http://127.0.0.1:8188',
  pollInterval: 3000,
  pollMaxTries: 60,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/comfyui.js
git commit -m "feat: add ComfyUI config"
```

---

## Task 3: 创建 workflow 文件

**Files:**
- Create: `src/workflows/default.json`
- Create: `src/workflows/flux.json`
- Create: `src/workflows/index.js`

- [ ] **Step 1: 创建 default.json**

将你的默认 workflow JSON 内容写入此文件。以下为占位结构（替换为真实内容）：

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "cfg": 7,
      "denoise": 1,
      "latent_image": ["5", 0],
      "model": ["4", 0],
      "negative": ["7", 0],
      "positive": ["6", 0],
      "sampler_name": "euler",
      "scheduler": "normal",
      "seed": 42,
      "steps": 20
    }
  }
}
```

> **注意：** 将上方内容替换为你实际的 ComfyUI default workflow JSON。

- [ ] **Step 2: 创建 flux.json**

将你的 FLUX workflow JSON 内容写入此文件，结构同上，替换为真实 FLUX workflow 内容。

- [ ] **Step 3: 创建 workflow 注册表 index.js**

```js
// src/workflows/index.js
import defaultWorkflow from './default.json'
import fluxWorkflow from './flux.json'

export default {
  default: defaultWorkflow,
  flux: fluxWorkflow,
}
```

- [ ] **Step 4: Commit**

```bash
git add src/workflows/
git commit -m "feat: add ComfyUI workflow files"
```

---

## Task 4: 实现 useComfyUI composable

**Files:**
- Create: `src/composables/__tests__/useComfyUI.test.js`
- Create: `src/composables/useComfyUI.js`

- [ ] **Step 1: 创建测试目录并写失败测试**

```bash
mkdir -p src/composables/__tests__
```

创建 `src/composables/__tests__/useComfyUI.test.js`：

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useComfyUI } from '../useComfyUI'

describe('useComfyUI', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('初始状态：isGenerating 为 false，result 和 error 为 null', () => {
    const { isGenerating, result, error } = useComfyUI()
    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBeNull()
  })

  it('submit 成功时：提交 workflow 并在轮询到结果后设置 result', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: 'test-id-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'test-id-123': {
            outputs: {
              '9': {
                images: [{ filename: 'output.png', subfolder: '', type: 'output' }],
              },
            },
            status: { completed: true },
          },
        }),
      })

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    const submitPromise = submit({ '3': {} })
    expect(isGenerating.value).toBe(true)

    await vi.runAllTimersAsync()
    await submitPromise

    expect(isGenerating.value).toBe(false)
    expect(error.value).toBeNull()
    expect(result.value).toEqual({
      imageURL: 'http://127.0.0.1:8188/view?filename=output.png&subfolder=&type=output',
    })
  })

  it('超过最大轮询次数时：设置超时错误', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: 'test-id-456' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ 'test-id-456': { outputs: {}, status: { completed: false } } }),
      })

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 3,
    })

    const submitPromise = submit({ '3': {} })
    await vi.runAllTimersAsync()
    await submitPromise

    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBe('生成超时，请重试')
  })

  it('网络错误时：设置错误信息并停止生成状态', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network Error'))

    const { isGenerating, result, error, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    await submit({ '3': {} })

    expect(isGenerating.value).toBe(false)
    expect(result.value).toBeNull()
    expect(error.value).toBe('Network Error')
  })

  it('cancel 调用后：isGenerating 变为 false', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ prompt_id: 'test-id-789' }),
    })

    const { isGenerating, cancel, submit } = useComfyUI({
      baseURL: 'http://127.0.0.1:8188',
      pollInterval: 1000,
      pollMaxTries: 5,
    })

    submit({ '3': {} })
    await Promise.resolve()

    cancel()
    expect(isGenerating.value).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试，确认全部失败**

```bash
npx vitest run src/composables/__tests__/useComfyUI.test.js --reporter=verbose
```

预期：所有测试 FAIL（`useComfyUI` 未定义）

- [ ] **Step 3: 实现 useComfyUI.js**

创建 `src/composables/useComfyUI.js`：

```js
import { ref } from 'vue'
import defaultConfig from '../config/comfyui.js'

export function useComfyUI(config = {}) {
  const cfg = { ...defaultConfig, ...config }

  const isGenerating = ref(false)
  const result = ref(null)
  const error = ref(null)

  let timerId = null

  function cancel() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
    isGenerating.value = false
  }

  function stopWithError(msg) {
    cancel()
    error.value = msg
  }

  async function submit(workflow) {
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
        tries++
        if (tries > cfg.pollMaxTries) {
          stopWithError('生成超时，请重试')
          resolve()
          return
        }

        try {
          const res = await fetch(`${cfg.baseURL}/history/${promptId}`)
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
              imageURL: `${cfg.baseURL}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`,
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
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npx vitest run src/composables/__tests__/useComfyUI.test.js --reporter=verbose
```

预期：所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/composables/
git commit -m "feat: implement useComfyUI composable with polling"
```

---

## Task 5: 更新 ImageGen.vue 接入真实 API

**Files:**
- Modify: `src/components/ImageGen.vue`

- [ ] **Step 1: 在 `<script setup>` 顶���引入 composable 和 workflows**

在现有 `import { ref, reactive } from 'vue'` 行之后添加：

```js
import { useComfyUI } from '../composables/useComfyUI.js'
import workflows from '../workflows/index.js'

const { isGenerating, result, error, submit, cancel } = useComfyUI()
```

同时删除原有的 `const isGenerating = ref(false)` 和 `const result = ref(null)` 两行（这两个状态现在由 composable 管理）。

- [ ] **Step 2: 替换 generate 函数**

删除原有 `generate` 函数：

```js
async function generate() {
  if (!prompt.value.trim() || isGenerating.value) return
  isGenerating.value = true
  activePanel.value = null
  // 模拟生成
  await new Promise(r => setTimeout(r, 2000))
  result.value = { color: '#a0a0a0' }
  history.value.unshift({ id: Date.now(), color: '#C06060' })
  if (history.value.length > 8) history.value.pop()
  isGenerating.value = false
}
```

替换为：

```js
async function generate() {
  if (!prompt.value.trim() || isGenerating.value) return
  activePanel.value = null

  const workflow = selected.flux ? workflows.flux : workflows.default
  await submit(workflow)

  if (result.value) {
    history.value.unshift({ id: Date.now(), imageURL: result.value.imageURL })
    if (history.value.length > 8) history.value.pop()
  }
}
```

- [ ] **Step 3: 更新 result-image 区域显示真实图片**

找到 template 中的 `result-image` div：

```html
<div class="result-image" :style="{ background: result ? '#ddd' : '#eee' }">
  <div v-if="isGenerating" class="generating-tip">正在生成，请稍后...</div>
</div>
```

替换为：

```html
<div class="result-image">
  <img v-if="result && !isGenerating" :src="result.imageURL" class="result-img" alt="生成结果" />
  <div v-else-if="isGenerating" class="generating-tip">正在生成，请稍后...</div>
  <div v-else-if="error" class="error-tip">{{ error }}</div>
</div>
```

- [ ] **Step 4: 在 `<style scoped>` 中添加图片和错误样式**

在 `.generating-tip` 规则后添加：

```css
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
```

- [ ] **Step 5: 在 template 的 `result-area` 的显示条件中加入 error**

找到：

```html
<div class="result-area" v-if="result || isGenerating">
```

替换为：

```html
<div class="result-area" v-if="result || isGenerating || error">
```

- [ ] **Step 6: 启动开发服务器，手动验证**

```bash
npm run dev
```

打开浏览器，验证：
1. 输入 prompt 点击生成按钮 → 按钮变为加载状态
2. 生成中期间 result-area 显示"正在生成，请稍后..."
3. ComfyUI 返回结果后显示真实图片
4. 若 ComfyUI 未启动，result-area 显示网络错误提示

- [ ] **Step 7: Commit**

```bash
git add src/components/ImageGen.vue
git commit -m "feat: connect ImageGen to ComfyUI API via useComfyUI"
```

---

## 自检结果

**规格覆盖：**
- ✅ 配置文件（baseURL、pollInterval、pollMaxTries）→ Task 2
- ✅ 多个固定 workflow JSON → Task 3
- ✅ workflow 注册表 → Task 3
- ✅ 提交任务 POST /prompt → Task 4
- ✅ 定时轮询 GET /history → Task 4
- ✅ 图片 URL 构造 /view → Task 4
- ✅ 错误处理（网络失败、超时、ComfyUI 执行错误）→ Task 4
- ✅ ImageGen.vue 替换模拟逻辑 → Task 5
- ✅ 显示真实图片 → Task 5
- ✅ 错误状态展示 → Task 5

**类型一致性：** `result.value.imageURL` 在 Task 4（composable）和 Task 5（模板）中命名一致。`submit(workflow)` 签名在测试和实现中一致。
