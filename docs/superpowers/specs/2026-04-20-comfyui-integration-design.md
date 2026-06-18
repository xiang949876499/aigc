# ComfyUI 接入设计文档

**日期：** 2026-04-20  
**状态：** 已审批

---

## 目标

将 aigc-app 的图片生成功能从模拟延迟替换为真实的 ComfyUI API 调用，采用定时轮询方式查询生图结果，支持多个固定 workflow，所有连接参数可配置。

---

## 目录结构

```
src/
├── config/
│   └── comfyui.js          # 服务地址、轮询间隔、超时次数配置
├── workflows/
│   ├── index.js            # workflow 注册表（名称 → JSON 映射）
│   ├── default.json        # 默认 workflow
│   └── flux.json           # FLUX workflow
├── composables/
│   └── useComfyUI.js       # 提交任务 + 定时轮询逻辑
└── components/
    └── ImageGen.vue        # 调用 composable，替换模拟逻辑
```

---

## 配置

`src/config/comfyui.js`：

```js
export default {
  baseURL: 'http://127.0.0.1:8188',
  pollInterval: 3000,   // 轮询间隔（ms）
  pollMaxTries: 60,     // 最大轮询次数，超出视为超时
}
```

所有字段均为运行时可覆盖值，不硬编码在业务代码中。

---

## ComfyUI API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/prompt` | POST | 提交 workflow，返回 `{ prompt_id }` |
| `/history/{prompt_id}` | GET | 查询执行结果 |
| `/view?filename=xxx` | GET | 获取图片文件 |

---

## 数据流

```
用户点击生成
    ↓
ImageGen.vue 根据 selected.flux 等参数选择 workflow
    ↓
useComfyUI.submit(workflow)
    ↓
POST /prompt → 获取 prompt_id
    ↓
setInterval 每 pollInterval ms 执行一次
    ↓
GET /history/{prompt_id}
    ├── 有输出 → 提取图片文件名 → 构造 /view URL → result.imageURL
    ├── 无输出 → 继续等待
    └── 超过 pollMaxTries → 超时错误
```

---

## composable 接口

`useComfyUI()` 返回：

```js
{
  isGenerating: Ref<boolean>,
  result: Ref<{ imageURL: string } | null>,
  error: Ref<string | null>,
  submit(workflow: object): Promise<void>,
  cancel(): void,
}
```

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| 网络请求失败 | `error` 设为错误信息，停止轮询，`isGenerating = false` |
| 超过最大轮询次数 | 视为超时，同上 |
| ComfyUI 执行错误 | 读取 history 中的 error 字段，同上 |

---

## ImageGen.vue 改动范围

- 删除 `await new Promise(r => setTimeout(r, 2000))` 模拟逻辑
- 引入 `useComfyUI()`，绑定 `isGenerating`、`result`、`error`
- `result-image` 区域显示真实图片（`<img :src="result.imageURL">`）替换颜色占位块
- 错误状态在生成区域展示提示文字

---

## workflow 选择逻辑

`ImageGen.vue` 中根据用户参数选择 workflow：

```js
import workflows from '../workflows/index.js'

const workflow = selected.flux ? workflows.flux : workflows.default
```

新增 workflow 只需在 `src/workflows/` 添加 JSON 文件并在 `index.js` 注册，无需修改其他代码。
