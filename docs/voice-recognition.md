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

首次使用时，应用会在初始化时自动加载语音识别模型。模型已被下载到 `public/models/` 目录中，并通过 IndexedDB 缓存，后续使用无需重复加载。

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
    └── ImageGen.vue            # 主组件（集成语音识别按钮）

scripts/
└── download-models.sh          # 模型下载脚本
```

### 核心组件说明

#### ModelManager (`src/lib/modelManager.js`)

管理模型文件的加载和缓存。使用 IndexedDB 缓存模型文件，避免重复加载。

- `loadModel()`: 加载模型文件（优先从缓存读取）
- `isCached()`: 检查模型是否已缓存
- `clearCache()`: 清除缓存的模型

#### SherpaRecognizer (`src/lib/sherpaRecognizer.js`)

封装 Sherpa-ONNX WASM 的初始化和识别逻辑。

- `initialize(modelFiles)`: 初始化识别器
- `createStream()`: 创建音频流
- `acceptWaveform(samples)`: 送入音频数据
- `getResult()`: 获取识别结果
- `reset()`: 重置识别流
- `free()`: 释放资源

#### useSpeechRecognition (`src/composables/useSpeechRecognition.js`)

提供 Vue 3 组合式 API。

- `isListening`: 是否正在录音
- `isSupported`: 是否支持语音识别
- `isLoading`: 是否正在加载模型
- `transcript`: 识别到的文本
- `error`: 错误信息
- `initialize()`: 初始化识别器
- `startListening()`: 开始录音
- `stopListening()`: 停止录音

## 常见问题

### Q: 为什么首次使用需要加载模型？

A: 语音识别需要机器学习模型来进行语音转文字。模型文件约 500MB（压缩后），加载后会缓存在浏览器 IndexedDB 中。

### Q: 语音识别准确率如何？

A: 使用 Sherpa-ONNX 的 Zipformer 流式模型，中英文识别准确率较高。识别效果可能受到口音、语速、环境噪音等因素影响。

### Q: 如何清除缓存的模型？

A: 可以通过浏览器的开发者工具清除 IndexedDB 数据，或者使用代码调用 `clearCache()` 方法。

### Q: 支持哪些语言？

A: 当前支持中文和英文混合识别。使用的模型为 `sherpa-onnx-streaming-zipformer-bilingual-zh-en`。

### Q: 如何下载或更新模型文件？

A: 运行 `bash scripts/download-models.sh` 即可下载模型文件到 `public/models/` 目录。

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

```javascript
const {
  isListening,    // Ref<boolean> - 是否正在录音
  isSupported,    // Ref<boolean> - 是否支持语音识别
  isLoading,      // Ref<boolean> - 是否正在加载模型
  transcript,     // Ref<string>  - 识别到的文本
  error,          // Ref<string>  - 错误信息
  initialize,     // () => Promise<void> - 初始化
  startListening, // () => Promise<void> - 开始录音
  stopListening   // () => void - 停止录音
} = useSpeechRecognition()
```

## 更新日志

### v2.0.0

- 从 Web Speech API 迁移到 Sherpa-ONNX WebAssembly
- 支持完全离线使用
- 提升浏览器兼容性（包括 Firefox）
- 改进识别准确率
- 新增 isLoading 加载状态
- 新增错误提示 Tooltip 组件
