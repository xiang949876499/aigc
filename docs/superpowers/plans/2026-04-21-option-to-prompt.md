# 选项自动添加到输入框功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当用户从工具栏的描述性选项中选择内容后，自动将选项值追加到prompt输入框末尾，用逗号分隔。

**Architecture:** 修改ImageGen.vue组件的selectOption函数，添加逻辑判断选项类型，对描述性选项（风格、质感、视角、色调、灯光）自动追加到prompt输入框。

**Tech Stack:** Vue 3 Composition API

---

## 文件结构

**修改的文件：**
- `src/components/ImageGen.vue` - 添加描述性选项识别和prompt追加逻辑

## Task 1: 修改selectOption函数实现自动追加

**Files:**
- Modify: `src/components/ImageGen.vue:96-99`

- [ ] **Step 1: 定义描述性选项字段常量**

在`selectOption`函数之前添加常量定义：

```javascript
// 定义描述性选项字段
const descriptiveFields = ['style', 'quality', 'angle', 'color', 'lighting']
```

- [ ] **Step 2: 修改selectOption函数添加追加逻辑**

修改`selectOption`函数（第96-99行）：

```javascript
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

- [ ] **Step 3: 验证功能 - 测试空输入框场景**

手动测试步骤：
1. 确保输入框为空
2. 点击"风格"按钮，选择"写实摄影"
3. 验证输入框内容为："写实摄影"（无逗号前缀）

- [ ] **Step 4: 验证功能 - 测试已有内容场景**

手动测试步骤：
1. 在输入框中输入"一只猫"
2. 点击"质感"按钮，选择"超高清"
3. 验证输入框内容为："一只猫，超高清"

- [ ] **Step 5: 验证功能 - 测试连续选择多个选项**

手动测试步骤：
1. 清空输入框
2. 依次选择：风格"写实摄影" → 质感"超高清" → 视角"景深/虚化"
3. 验证输入框内容为："写实摄影，超高清，景深/虚化"

- [ ] **Step 6: 验证功能 - 测试非描述性选项不追加**

手动测试步骤：
1. 清空输入框
2. 点击"比例"按钮，选择"1:1 正方形，头像"
3. 验证输入框保持为空（比例选项不应追加）

- [ ] **Step 7: 验证功能 - 测试FLUX选项不追加**

手动测试步骤：
1. 清空输入框
2. 点击"fLUX"按钮启用，选择"2倍"
3. 验证输入框保持为空（FLUX倍数不应追加）

- [ ] **Step 8: 提交代码**

```bash
git add src/components/ImageGen.vue
git commit -m "feat: auto-append descriptive options to prompt input

When user selects descriptive options (style, quality, angle, color,
lighting), automatically append the selected value to the prompt input
field with comma separation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 自查清单

**规范覆盖检查：**
- ✅ 添加位置：追加到末尾
- ✅ 添加格式：用逗号分隔
- ✅ 适用范围：仅描述性选项（style, quality, angle, color, lighting）
- ✅ 边界情况：空输入框、已有内容、重复选择
- ✅ 测试要点：所有7个测试场景都已覆盖

**占位符检查：**
- ✅ 无TBD、TODO或模糊描述
- ✅ 所有代码块完整
- ✅ 所有测试步骤具体明确

**类型一致性检查：**
- ✅ `descriptiveFields` 数组包含的字段名与 `selected` 对象的属性名一致
- ✅ `prompt.value` 的使用与组件中的ref定义一致
- ✅ `activePanel.value` 的使用与现有代码一致
