# Sherpa-ONNX WebAssembly 语音识别集成设计

## 概述

将现有的 Web Speech API 语音识别替换为 Sherpa-ONNX WebAssembly 方案，实现离线语音识别和更好的浏览器兼容性。

## 背景

### 当前实现

当前使用 Web Speech API (`useSpeechRecognition.js`)，存在以下限制：
- **需要网络连接**：语音数据发送到云端处理
- **浏览器兼容性差**：Firefox 不支持
- **隐私问题**：语音数据离开用户设备

### 目标

- ✅ 完全离线支持，无需网络
- ✅ 更好的浏览器兼容性（包括 Firefox）
- ✅ 中英文双语识别
- ✅ 本地处理，保护隐私
- ✅ 保持现有的交互方式（按住说话）

## 技术选型

### Sherpa-ONNX

- **GitHub**: [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- **许可证**: Apache-2.0
- **特点**:
  - 支持 WebAssembly，可在浏览器中运行
  - 使用 SIMD 加速，性能优秀
  - 支持多种模型，包括中英文双语
  - 完全离线，无需网络

### 选择的模型

**sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20**

- **大小**: 约 80MB
- **语言**: 中文 + 英文
- **类型**: 流式识别（Streaming ASR）
- **特点**:
  - 实时识别，延迟低
  - 准确率高
  - 资源占用适中

## 架构设计

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    ImageGen.vue                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              useSpeechRecognition               │   │
│  │  ┌─────────────────────────────────────────┐   │   │
│  │  │         SherpaRecognizer                │   │   │
│  │  │  - 模型加载                               │   │   │
│  │  │  - WASM 初始化                            │   │   │
│  │  │  - 音频流处理                             │   │   │
│  │  │  - 识别结果输出                            │   │   │
│  │  └─────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Sherpa-ONNX WASM                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  - encoder.onnx (编码器模型)                     │   │
│  │  - decoder.onnx (解码器模型)                     │   │
│  │  - joiner.onnx (连接器模型)                      │   │
│  │  - tokens.txt (词表文件)                         │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 组件职责

#### 1. ModelManager (`src/lib/modelManager.js`)

**职责**: 管理模型文件的加载和缓存

**关键功能**:
- 从本地/CDN 加载模型文件
- 使用 IndexedDB 缓存模型
- 提供模型文件的访问接口

**API**:
```javascript
// 加载模型
async function loadModel() → ModelFiles

// 清除缓存
async function clearCache() → void

// 检查缓存状态
async function isCached() → boolean
```

#### 2. SherpaRecognizer (`src/lib/sherpaRecognizer.js`)

**职责**: 封装 Sherpa-ONNX WASM 的初始化和识别逻辑

**关键功能**:
- 初始化 Sherpa-ONNX WASM
- 创建和管理识别流
- 处理音频数据
- 获取识别结果

**API**:
```javascript
class SherpaRecognizer {
  // 初始化识别器
  async initialize(modelFiles) → void

  // 创建音频流
  createStream() → void

  // 送入音频数据
  acceptWaveform(samples) → void

  // 获取识别结果
  getResult() → { text: string, isFinal: boolean }

  // 重置流
  reset() → void

  // 释放资源
  free() → void
}
```

#### 3. useSpeechRecognition (`src/composables/useSpeechRecognition.js`)

**职责**: 提供 Vue 3 组合式 API，协调整个识别过程

**关键功能**:
- 管理麦克风音频流
- 协调模型加载和识别
- 提供响应式状态
- 处理错误和边界情况

**API**:
```javascript
export function useSpeechRecognition() {
  // 响应式状态
  const isListening = ref(false)
  const isSupported = ref(false)
  const isLoading = ref(false)
  const transcript = ref('')
  const error = ref(null)

  // 方法
  async function initialize() → void
  async function startListening() → void
  function stopListening() → void

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

## 模型文件管理

### 文件结构

```
public/
└── models/
    └── sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
        ├── encoder.onnx          # 编码器模型 (~30MB)
        ├── decoder.onnx          # 解码器模型 (~5MB)
        ├── joiner.onnx           # 连接器模型 (~10MB)
        └── tokens.txt            # 词表文件 (~1MB)
```

### 下载脚本

```bash
#!/bin/bash
# scripts/download-models.sh

MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2"
MODEL_DIR="public/models"

mkdir -p $MODEL_DIR
cd $MODEL_DIR

curl -L -O $MODEL_URL
tar xvf sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
rm sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
```

### 缓存策略

使用 IndexedDB 缓存模型文件：

```javascript
// 缓存键
const CACHE_KEY = 'sherpa-onnx-models'

// 缓存结构
{
  timestamp: Date.now(),
  version: '1.0.0',
  files: {
    encoder: ArrayBuffer,
    decoder: ArrayBuffer,
    joiner: ArrayBuffer,
    tokens: string
  }
}
```

## 音频处理

### 音频参数

- **采样率**: 16000 Hz（Sherpa-ONNX 要求）
- **声道数**: 1（单声道）
- **缓冲区大小**: 4096 样本
- **格式**: Float32Array

### 音频流处理流程

```
麦克风 → MediaStream → AudioContext → ScriptProcessorNode → Sherpa-ONNX
```

1. **获取麦克风权限**: `navigator.mediaDevices.getUserMedia({ audio: true })`
2. **创建 AudioContext**: `new AudioContext({ sampleRate: 16000 })`
3. **创建音频源**: `audioContext.createMediaStreamSource(mediaStream)`
4. **创建处理器**: `audioContext.createScriptProcessor(4096, 1, 1)`
5. **处理音频数据**: 在 `onaudioprocess` 回调中获取音频样本
6. **送入识别器**: `recognizer.acceptWaveform(samples)`

## 错误处理

### 错误类型

| 错误类型 | 错误码 | 处理方式 | 用户提示 |
|---------|--------|---------|---------|
| 模型加载失败 | MODEL_LOAD_ERROR | 自动重试 3 次 | "模型加载失败，请检查网络连接" |
| WASM 初始化失败 | WASM_INIT_ERROR | 显示错误信息 | "语音识别初始化失败，请刷新页面重试" |
| 麦克风权限被拒绝 | MIC_PERMISSION_DENIED | 显示权限提示 | "请允许麦克风权限以使用语音识别" |
| 识别过程中断 | RECOGNITION_INTERRUPTED | 自动重置状态 | "识别已中断，请重新开始" |
| 浏览器不支持 | NOT_SUPPORTED | 隐藏功能 | 不显示语音按钮 |

### 错误处理流程

```javascript
try {
  await startListening()
} catch (error) {
  // 1. 记录错误
  console.error('Speech recognition error:', error)

  // 2. 更新状态
  error.value = getErrorMessage(error)

  // 3. 清理资源
  cleanup()

  // 4. 显示提示
  showErrorToast(error.value)
}
```

## UI/UX 设计

### 麦克风按钮状态

```
┌─────────────────────────────────────────────────────────┐
│                    状态流转图                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐    点击    ┌─────────┐    点击    ┌─────────┐ │
│  │  空闲   │ ────────→ │  录音中 │ ────────→ │  空闲   │ │
│  │ (灰色)  │           │ (蓝色)  │           │ (灰色)  │ │
│  └─────────┘           └─────────┘           └─────────┘ │
│       │                     │                     │     │
│       │                     │                     │     │
│       ▼                     ▼                     ▼     │
│  ┌─────────┐           ┌─────────┐           ┌─────────┐ │
│  │  加载中 │           │  识别中 │           │  完成   │ │
│  │ (旋转)  │           │ (脉冲)  │           │ (绿色)  │ │
│  └─────────┘           └─────────┘           └─────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 按钮样式

```css
.voice-btn {
  /* 默认状态 */
  background: #f5f5f5;
  color: #666;

  /* 加载中状态 */
  &.loading {
    background: #e0e0e0;
    animation: spin 1s linear infinite;
  }

  /* 录音中状态 */
  &.listening {
    background: #4b9ef8;
    color: white;
    box-shadow: 0 0 0 3px rgba(75, 158, 248, 0.3);
    animation: pulse 1.5s ease-in-out infinite;
  }

  /* 错误状态 */
  &.error {
    background: #ff4444;
    color: white;
  }
}
```

### 图标设计

- **空闲状态**: 麦克风图标
- **录音中**: 麦克风图标 + 脉冲动画
- **加载中**: 旋转加载图标
- **错误状态**: 警告图标

## 性能优化

### 1. 模型预加载

```javascript
// 在应用启动时预加载模型
onMounted(async () => {
  await initialize()
})
```

### 2. 音频缓冲区优化

```javascript
// 使用合适的缓冲区大小
const BUFFER_SIZE = 4096  // 平衡延迟和性能
const SAMPLE_RATE = 16000 // Sherpa-ONNX 要求的采样率
```

### 3. 内存管理

```javascript
// 及时释放资源
onBeforeUnmount(() => {
  stopListening()
  if (recognizer) {
    recognizer.free()
  }
})
```

### 4. 模型缓存

使用 IndexedDB 缓存模型文件，避免重复加载：

```javascript
// 检查缓存
const cachedModel = await getCachedModel()
if (cachedModel) {
  return cachedModel
}

// 加载并缓存
const model = await loadModelFromDisk()
await cacheModel(model)
return model
```

## 测试策略

### 单元测试

```javascript
// 测试模型加载
describe('Model Manager', () => {
  it('should load model from cache', async () => {
    const modelFiles = await loadModel()
    expect(modelFiles).toBeDefined()
    expect(modelFiles.encoder).toBeInstanceOf(ArrayBuffer)
  })

  it('should clear cache', async () => {
    await clearCache()
    const isCached = await isCached()
    expect(isCached).toBe(false)
  })
})

// 测试识别器
describe('Sherpa Recognizer', () => {
  it('should initialize with valid config', async () => {
    const recognizer = new SherpaRecognizer()
    await recognizer.initialize(mockModelFiles)
    expect(recognizer.recognizer).toBeDefined()
  })

  it('should process audio samples', async () => {
    const recognizer = new SherpaRecognizer()
    await recognizer.initialize(mockModelFiles)
    recognizer.createStream()

    const samples = new Float32Array(16000) // 1秒音频
    recognizer.acceptWaveform(samples)

    const result = recognizer.getResult()
    expect(result).toBeDefined()
  })
})
```

### 集成测试

```javascript
// 测试完整的语音识别流程
describe('Speech Recognition Integration', () => {
  it('should recognize speech from microphone', async () => {
    const { startListening, stopListening, transcript } = useSpeechRecognition()

    await startListening()
    // 模拟说话
    await new Promise(resolve => setTimeout(resolve, 1000))
    await stopListening()

    expect(transcript.value).toBeTruthy()
  })
})
```

## 依赖项

```json
{
  "dependencies": {
    "sherpa-onnx": "^1.0.0"
  },
  "devDependencies": {
    "@types/dom-speech-recognition": "^0.0.1"
  }
}
```

## 文件结构

```
src/
├── composables/
│   ├── useSpeechRecognition.js      # 主 composable
│   └── __tests__/
│       └── useSpeechRecognition.test.js
├── lib/
│   ├── sherpaRecognizer.js          # Sherpa-ONNX 封装
│   └── modelManager.js              # 模型管理
└── components/
    └── ImageGen.vue                 # 集成语音识别

public/
└── models/
    └── sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
        ├── encoder.onnx
        ├── decoder.onnx
        ├── joiner.onnx
        └── tokens.txt

scripts/
└── download-models.sh               # 模型下载脚本
```

## 实施计划

### 阶段 1: 基础设施（1-2 天）

1. 下载模型文件
2. 创建模型管理器
3. 创建 Sherpa-ONNX 封装

### 阶段 2: 核心功能（2-3 天）

1. 实现 useSpeechRecognition composable
2. 集成到 ImageGen.vue
3. 添加错误处理

### 阶段 3: 优化和完善（1-2 天）

1. 性能优化
2. UI/UX 完善
3. 测试覆盖

### 阶段 4: 文档和发布（1 天）

1. 更新文档
2. 编写使用指南
3. 发布新版本

## 风险和缓解措施

### 风险 1: 模型文件过大

**问题**: 模型文件约 80MB，会增加应用体积

**缓解措施**:
- 使用模型压缩技术
- 提供模型下载脚本
- 考虑按需加载模型

### 风险 2: 浏览器兼容性

**问题**: 某些旧浏览器可能不支持 WebAssembly

**缓解措施**:
- 检测 WebAssembly 支持
- 提供降级方案（Web Speech API）
- 显示友好的错误提示

### 风险 3: 性能问题

**问题**: 在低端设备上可能性能不佳

**缓解措施**:
- 优化音频缓冲区大小
- 使用 Web Workers 处理音频
- 提供性能监控和调优选项

## 未来扩展

### 短期扩展

- 支持更多语言
- 添加语音命令功能
- 优化识别准确率

### 长期扩展

- 支持语音合成（TTS）
- 添加语音克隆功能
- 集成更多 AI 语音功能

## 参考资料

- [Sherpa-ONNX GitHub](https://github.com/k2-fsa/sherpa-onnx)
- [Sherpa-ONNX 文档](https://k2-fsa.github.io/sherpa/onnx/index.html)
- [WebAssembly 文档](https://developer.mozilla.org/en-US/docs/WebAssembly)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)