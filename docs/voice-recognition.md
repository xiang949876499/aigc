# 语音输入

应用使用 ModelScope FunASR CLI 在 Electron 主进程里做本地语音转文字。渲染进程只负责采集麦克风音频，停止录音后主进程会把音频写成临时 16 kHz mono WAV 文件，并调用 `funasr` 完成转写。

## 架构

- 渲染进程通过 Web Audio API 采集麦克风音频。
- preload 暴露受限的 `electronAPI.speech` IPC 接口。
- Electron 主进程缓存录音采样，停止录音时写入临时 WAV。
- 主进程调用 FunASR CLI，并解析 JSON 或纯文本输出。
- 转写结束后临时音频目录会被删除。

主进程实现位于 `electron/speech-service.js`，渲染层接入位于 `src/composables/useSpeechRecognition.js`。

## 本机准备

安装 FunASR，并确认 `funasr` 可在系统 PATH 中执行：

```bash
pip install -U funasr
npm run check:speech
```

Windows 上建议使用 Python 3.10 或 3.11。当前在 Python 3.13 环境里安装 FunASR
时，`editdistance` 依赖可能没有可用 wheel，并在本地 C++ 编译阶段失败。可用独立
conda 环境安装：

```powershell
conda create -n funasr python=3.10 -y
conda activate funasr
pip install -U funasr
setx FUNASR_CLI "%USERPROFILE%\anaconda3\envs\funasr\Scripts\funasr.exe"
```

设置 `FUNASR_CLI` 后需要重启 Electron 应用，主进程才能读取新的环境变量。

默认调用形式：

```bash
funasr speech.wav --output-format json --model sensevoice --language zh
```

可用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FUNASR_CLI` | `funasr` | FunASR 可执行文件路径或命令名。 |
| `FUNASR_MODEL` | `sensevoice` | 传给 `--model` 的模型名。 |
| `FUNASR_LANGUAGE` | `zh` | 传给 `--language` 的语言。 |
| `FUNASR_TIMEOUT_MS` | `120000` | 单次 CLI 转写超时时间。 |

## 使用方式

1. 点击输入框右下角的麦克风按钮开始录音。
2. 说完后再次点击麦克风按钮停止录音。
3. 应用调用 FunASR CLI，转写完成后把文本追加到提示词输入框。

FunASR CLI 是文件转写模式，因此文本会在停止录音后出现，而不是边说边实时出现。

## Windows 打包

运行：

```bash
npm run build:win
```

打包产物不再内置 ASR 模型或 Python 依赖。目标机器需要自行安装 FunASR CLI，或通过 `FUNASR_CLI` 指向随机器部署的可执行文件。

## 故障排查

1. 确认 Windows 已允许应用访问麦克风。
2. 运行 `npm run check:speech`，确认当前环境能找到 FunASR CLI。
3. 如果使用自定义 Python 环境，把 `FUNASR_CLI` 设置为 `funasr.exe` 的完整路径。
4. 如果识别太慢或超时，调大 `FUNASR_TIMEOUT_MS`，或换用更快的模型/设备配置。
