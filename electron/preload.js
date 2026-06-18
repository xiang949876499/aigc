import { contextBridge, ipcRenderer } from 'electron'

const configArg = process.argv.find((arg) => arg.startsWith('--runtime-config='))
let runtimeConfig = {}
if (configArg) {
  try {
    runtimeConfig = JSON.parse(configArg.slice('--runtime-config='.length))
  } catch {}
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  config: runtimeConfig,
  speech: {
    initialize: () => ipcRenderer.invoke('speech:initialize'),
    start: () => ipcRenderer.invoke('speech:start'),
    process: (samples) => ipcRenderer.invoke('speech:process', samples),
    stop: (options) => ipcRenderer.invoke('speech:stop', options),
    free: () => ipcRenderer.invoke('speech:free'),
  },
  assets: {
    saveFromURL: (url, options) => ipcRenderer.invoke('assets:save-from-url', url, options),
  },
  comfy: {
    request: (payload) => ipcRenderer.invoke('comfy:request', payload),
  },
})
