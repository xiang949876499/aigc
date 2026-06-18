import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import ImageGen from '../ImageGen.vue'

const comfyUI = vi.hoisted(() => ({
  isGenerating: null,
  result: null,
  error: null,
  submit: vi.fn(),
  uploadImage: vi.fn(),
  cancel: vi.fn(),
  getPromptResult: vi.fn(),
  findPromptResultByText: vi.fn(),
}))

const speechUI = vi.hoisted(() => ({
  isListening: null,
  isSupported: null,
  isLoading: null,
  transcript: null,
  error: null,
  initialize: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
}))

vi.mock('../../composables/useComfyUI.js', () => ({
  useComfyUI: () => comfyUI,
}))

vi.mock('../../composables/useSpeechRecognition.js', () => ({
  useSpeechRecognition: () => speechUI,
}))

function stubIndexedDB() {
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const getRequest = { result: null }
                setTimeout(() => getRequest.onsuccess?.(), 0)
                return getRequest
              },
              put: vi.fn(),
            }),
          }),
          close: vi.fn(),
        },
      }
      setTimeout(() => request.onsuccess?.(), 0)
      return request
    }),
  })
}

function mountImageGen() {
  return mount(ImageGen, {
    attachTo: document.body,
    global: {
      stubs: {
        ToolbarPanel: true,
      },
    },
  })
}

function stubElectronAssets(saveFromURL = vi.fn()) {
  window.electronAPI = {
    assets: {
      saveFromURL,
    },
  }
  return saveFromURL
}

beforeEach(() => {
  localStorage.clear()
  comfyUI.isGenerating = ref(false)
  comfyUI.result = ref(null)
  comfyUI.error = ref('')
  comfyUI.submit.mockReset()
  comfyUI.uploadImage.mockReset()
  comfyUI.cancel.mockReset()
  comfyUI.getPromptResult.mockReset()
  comfyUI.findPromptResultByText.mockReset()
  speechUI.isListening = ref(false)
  speechUI.isSupported = ref(true)
  speechUI.isLoading = ref(false)
  speechUI.transcript = ref('')
  speechUI.error = ref('')
  speechUI.initialize.mockReset()
  speechUI.startListening.mockReset()
  speechUI.stopListening.mockReset()
  stubIndexedDB()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('ImageGen controls', () => {
  it('renders saved templates in the preset template section instead of the prompt composer', () => {
    localStorage.setItem('aigc_templates', JSON.stringify([
      { id: 'template-one', color: '#5BB8D4' },
      { id: 'template-two', color: '#C9A84C' },
    ]))

    const wrapper = mountImageGen()

    const presetSection = wrapper.get('[data-testid="preset-template-section"]')
    const composer = wrapper.get('[data-testid="prompt-composer"]')

    expect(presetSection.findAll('.template-chip')).toHaveLength(2)
    expect(composer.findAll('.template-chip')).toHaveLength(0)

    wrapper.unmount()
  })

  it('saves custom ComfyUI image and video addresses from settings', async () => {
    const wrapper = mountImageGen()

    await wrapper.get('[data-testid="settings-button"]').trigger('click')
    expect(wrapper.get('[data-testid="settings-popover"]').text()).toContain('ComfyUI 服务 IP/端口')
    const inputs = wrapper.findAll('.settings-field input')
    expect(inputs).toHaveLength(2)
    const labels = wrapper.findAll('.settings-field span').map((label) => label.text())
    expect(labels).toEqual(['生图 IP/端口', '生视频 IP/端口'])
    expect(inputs[0].element.value).toBe('http://127.0.0.1:8188')
    expect(inputs[1].element.value).toBe('http://127.0.0.1:8188')

    await inputs[0].setValue(' http://192.168.0.10:8188/// ')
    await inputs[1].setValue(' http://127.0.0.1:8189/ ')
    await wrapper.get('.settings-primary').trigger('click')

    expect(wrapper.get('.settings-status').text()).toBe('已保存')
    expect(inputs[0].element.value).toBe('http://192.168.0.10:8188')
    expect(inputs[1].element.value).toBe('http://127.0.0.1:8189')
    expect(JSON.parse(localStorage.getItem('aigc_comfyui_settings'))).toEqual({
      imageBaseURL: 'http://192.168.0.10:8188',
      videoBaseURL: 'http://127.0.0.1:8189',
    })

    wrapper.unmount()
  })

  it('opens the template library from the browse button', async () => {
    localStorage.setItem('aigc_templates', JSON.stringify([
      { id: 'template-one', color: '#5BB8D4' },
      { id: 'template-two', color: '#C9A84C' },
      { id: 'template-three', color: '#8B5CF6' },
    ]))

    const wrapper = mountImageGen()

    expect(wrapper.find('[data-testid="template-library-panel"]').exists()).toBe(false)

    await wrapper.get('[data-testid="browse-template-library"]').trigger('click')

    const library = wrapper.get('[data-testid="template-library-panel"]')
    expect(library.findAll('.template-library-item')).toHaveLength(3)

    wrapper.unmount()
  })

  it('initializes speech input without waiting for pending generation recovery', async () => {
    localStorage.setItem('aigc_messages', JSON.stringify([
      {
        id: 'assistant-pending',
        role: 'assistant',
        status: 'generating',
        mediaType: 'image',
        promptId: 'stuck-prompt',
        promptBaseURL: 'http://192.168.0.131:8188',
        createdAt: 1,
      },
    ]))
    comfyUI.getPromptResult.mockReturnValue(new Promise(() => {}))

    const wrapper = mountImageGen()

    await vi.waitFor(() => {
      expect(speechUI.initialize).toHaveBeenCalled()
    }, { timeout: 200 })

    expect(comfyUI.getPromptResult).toHaveBeenCalledWith('stuck-prompt', {
      baseURL: 'http://192.168.0.131:8188',
    })

    wrapper.unmount()
  })

  it('shows speech input errors in the composer', () => {
    speechUI.error = ref('speech failed')

    const wrapper = mountImageGen()

    expect(wrapper.get('[data-testid="speech-error"]').text()).toBe('speech failed')

    wrapper.unmount()
  })

  it('opens generated history in the asset library view', async () => {
    localStorage.setItem('aigc_messages', JSON.stringify([
      { id: 'user-one', role: 'user', text: '一张概念图', createdAt: 1 },
      {
        id: 'assistant-one',
        role: 'assistant',
        status: 'done',
        imageURL: 'https://example.com/result.png',
        mediaType: 'image',
        createdAt: 2,
      },
    ]))

    const wrapper = mountImageGen()

    expect(wrapper.find('[data-testid="asset-library"]').exists()).toBe(false)

    await wrapper.get('[data-testid="asset-library-button"]').trigger('click')

    const assetLibrary = wrapper.get('[data-testid="asset-library"]')
    expect(assetLibrary.findAll('.asset-card')).toHaveLength(1)
    expect(wrapper.find('.app-shell').exists()).toBe(false)
    expect(wrapper.find('.history-area').exists()).toBe(false)

    wrapper.unmount()
  })

  it('persists the ComfyUI prompt id after a successful generation', async () => {
    comfyUI.submit.mockImplementation(async (_workflow, options) => {
      expect(options.fallbackText).toBe('赛博城市')
      options.onPromptId('prompt-123')
      comfyUI.result.value = {
        imageURL: 'https://example.com/result.png',
        mediaType: 'image',
      }
    })

    const wrapper = mountImageGen()

    await wrapper.get('.prompt-input').setValue('赛博城市')
    await wrapper.get('.send-btn').trigger('click')
    await nextTick()

    const savedMessages = JSON.parse(localStorage.getItem('aigc_messages'))
    const assistantMessage = savedMessages.find((msg) => msg.role === 'assistant')

    expect(assistantMessage).toMatchObject({
      status: 'done',
      imageURL: 'https://example.com/result.png',
      promptId: 'prompt-123',
      promptBaseURL: '/api/comfyui',
    })

    wrapper.unmount()
  })

  it('maps generated history items to locally saved asset files', async () => {
    const saveFromURL = stubElectronAssets(vi.fn(async () => ({
      fileURL: 'file:///C:/Users/test/AppData/Roaming/aigc-app/assets/generated/output.png',
      relativePath: 'generated/output.png',
    })))
    comfyUI.submit.mockImplementation(async (_workflow, options) => {
      options.onPromptId('prompt-local')
      comfyUI.result.value = {
        imageURL: 'https://example.com/result.png',
        mediaType: 'image',
      }
    })

    const wrapper = mountImageGen()

    await wrapper.get('.prompt-input').setValue('本地保存测试')
    await wrapper.get('.send-btn').trigger('click')
    await nextTick()

    expect(saveFromURL).toHaveBeenCalledWith('https://example.com/result.png', {
      id: expect.stringMatching(/^output:a-/),
      kind: 'generated',
      mediaType: 'image',
    })

    const savedMessages = JSON.parse(localStorage.getItem('aigc_messages'))
    const assistantMessage = savedMessages.find((msg) => msg.role === 'assistant')
    expect(assistantMessage).toMatchObject({
      status: 'done',
      imageURL: 'https://example.com/result.png',
      localAssetURL: 'file:///C:/Users/test/AppData/Roaming/aigc-app/assets/generated/output.png',
      localAssetPath: 'generated/output.png',
    })

    wrapper.unmount()
  })
})
