---
title: 选项自动添加到输入框功能设计
date: 2026-04-21
status: draft
---

# 选项自动添加到输入框功能设计

## 概述

当用户从工具栏的描述性选项（风格、质感、视角、色调、灯光）中选择内容后，自动将选中的选项值追加到prompt输入框末尾，用逗号分隔。

## 需求背景

用户在使用AI图像生成工具时，需要构建详细的prompt描述。当前实现中，工具栏选项的选择只更新了内部状态（`selected`对象），但没有反映到用户输入的prompt中。用户需要手动输入这些描述词，降低了效率。

## 用户需求

- **添加位置**：追加到输入框末尾
- **添加格式**：用逗号分隔（例如："一只猫，写实摄影"）
- **适用范围**：仅描述性选项（风格、质感、视角、色调、灯光），不包括比例和FLUX倍数

## 设计方案

### 架构

采用方案A：自动追加模式。在用户选择选项时，自动将选项值追加到prompt输入框。

### 核心逻辑

1. **识别描述性选项**：定义哪些选项类型需要添加到prompt
   - 包括：`style`（风格）、`quality`（质感）、`angle`（视角）、`color`（色调）、`lighting`（灯光）
   - 排除：`ratio`（比例）、`fluxScale`（FLUX倍数）

2. **追加逻辑**：
   - 当用户选择选项时，检查该选项类型是否为描述性选项
   - 如果是，将选项值追加到prompt末尾
   - 追加格式：如果prompt非空且不以逗号结尾，先添加"，"（中文逗号），再添加选项值
   - 如果prompt为空，直接添加选项值

3. **实现位置**：
   - 修改`ImageGen.vue`中的`selectOption`函数
   - 添加逻辑判断和字符串拼接

### 数据流

```
用户点击选项 
  → ToolbarPanel触发select事件 
  → ImageGen.vue的selectOption函数接收
  → 更新selected对象
  → 判断是否为描述性选项
  → 如果是，追加到prompt.value
  → 关闭面板
```

### 代码变更

**文件：`src/components/ImageGen.vue`**

修改`selectOption`函数：

```javascript
// 定义描述性选项字段
const descriptiveFields = ['style', 'quality', 'angle', 'color', 'lighting']

function selectOption(field, value) {
  selected[field] = value
  
  // 如果是描述性选项，追加到prompt
  if (descriptiveFields.includes(field)) {
    const currentPrompt = prompt.value.trim()
    if (currentPrompt) {
      // 如果已有内容，添加逗号分隔
      prompt.value = currentPrompt + '，' + value
    } else {
      // 如果为空，直接添加
      prompt.value = value
    }
  }
  
  activePanel.value = null
}
```

### 边界情况处理

1. **空输入框**：直接添加选项值，不添加逗号
2. **已有内容**：在末尾添加"，"（中文逗号）+ 选项值
3. **重复选择**：允许重复添加（用户可以手动删除不需要的部分）
4. **生成中状态**：输入框已禁用，不会触发选项选择

### 用户体验

- 选择选项后，用户可以立即在输入框中看到添加的内容
- 用户可以手动编辑或删除自动添加的内容
- 不影响现有的手动输入功能
- 保持现有的UI和交互流程不变

## 未来优化方向

如果后续发现重复添加是个问题，可以考虑：
- 方案B：智能替换模式（检测并替换同类型的已有选项）
- 添加"清除prompt"按钮
- 添加"撤销"功能

## 测试要点

1. 选择风格选项，验证是否正确追加到输入框
2. 选择质感选项，验证逗号分隔是否正确
3. 选择比例选项，验证不会添加到输入框
4. 在空输入框状态下选择选项，验证不添加逗号
5. 在已有内容的输入框中选择选项，验证逗号分隔
6. 连续选择多个选项，验证格式正确
7. 手动编辑自动添加的内容，验证不影响后续选择
