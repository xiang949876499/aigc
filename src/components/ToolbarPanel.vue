<script setup>
const props = defineProps({
  panel: Object,
  selected: String,
})
const emit = defineEmits(['select', 'close'])

/** 全角冒号前为展示名，后为写入提示词的内容 */
function parsePromptOption(opt) {
  const sep = '：'
  if (typeof opt !== 'string') return { label: opt, value: opt }
  const idx = opt.indexOf(sep)
  if (idx === -1) return { label: opt, value: opt }
  return { label: opt.slice(0, idx), value: opt.slice(idx + sep.length).trim() }
}

function getOptionLabel(opt) {
  if (typeof props.panel?.display === 'function') {
    return opt
  }
  return parsePromptOption(opt).label
}

function getOptionValue(opt) {
  if (typeof props.panel?.display === 'function') {
    return props.panel.display(opt)
  }
  return parsePromptOption(opt).value
}

function isActive(opt) {
  const value = getOptionValue(opt)
  const { label } = parsePromptOption(opt)
  return props.selected === opt || props.selected === value || props.selected === label
}
</script>

<template>
  <div class="panel-wrap" @click.stop>
    <div class="panel-label">{{ panel.label }}</div>
    <div class="panel-options">
      <button
        v-for="opt in panel.options"
        :key="opt"
        class="option-btn"
        :class="{ active: isActive(opt) }"
        @click="emit('select', getOptionValue(opt))"
      >{{ getOptionLabel(opt) }}</button>
    </div>
  </div>
</template>

<style scoped>
.panel-wrap {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  background: rgba(18, 18, 20, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
  min-width: 180px;
  z-index: 100;
  backdrop-filter: blur(16px);
}
.panel-label {
  font-size: 11px;
  color: #8f8998;
  margin-bottom: 8px;
  font-weight: 500;
  letter-spacing: 0.3px;
}
.panel-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-btn {
  text-align: left;
  padding: 9px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #c8c3ce;
  border-radius: 8px;
  transition: all 0.15s;
  white-space: nowrap;
}
.option-btn:hover {
  background: rgba(155, 108, 255, 0.1);
  color: #eee8ff;
}
.option-btn.active {
  background: rgba(155, 108, 255, 0.22);
  color: #d9c7ff;
  font-weight: 500;
}
</style>
