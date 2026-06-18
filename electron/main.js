import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startProdServer, resolveDistDir } from './prod-server.js'
import { resolveComfyTargets } from './comfy-targets.js'
import { requestComfy } from './comfy-request.js'
import { SpeechService } from './speech-service.js'
import { resolveAssetsDir, saveRemoteAsset } from './asset-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const runtimeConfig = {}
const speechService = new SpeechService()

/** @type {import('node:http').Server | null} */
let prodServer = null
/** @type {string | null} */
let prodAppURL = null

function registerSpeechHandlers() {
  ipcMain.handle('speech:initialize', () => speechService.initialize())
  ipcMain.handle('speech:start', () => speechService.start())
  ipcMain.handle('speech:process', (_event, samples) => speechService.process(samples))
  ipcMain.handle('speech:stop', (_event, options = {}) => speechService.stop(options))
  ipcMain.handle('speech:free', () => speechService.free())
}

function registerAssetHandlers() {
  ipcMain.handle('assets:save-from-url', (_event, url, options = {}) => saveRemoteAsset({
    url,
    id: options.id,
    kind: options.kind,
    mediaType: options.mediaType,
    baseDir: resolveAssetsDir(app.getPath('userData')),
  }))
}

function registerComfyHandlers() {
  ipcMain.handle('comfy:request', (_event, payload) => requestComfy(payload))
}

function createWindow(loadURL) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--runtime-config=${JSON.stringify(runtimeConfig)}`,
      ],
    },
  })
  win.setMenu(null)

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.loadURL(loadURL)
  return win
}

async function resolveAppURL() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL
  }

  const distDir = resolveDistDir()
  const { port, server } = await startProdServer(distDir)
  prodServer = server
  prodAppURL = `http://127.0.0.1:${port}`
  const { comfyTarget, comfyVideoTarget } = resolveComfyTargets()
  runtimeConfig._comfyBaseURL = comfyTarget
  runtimeConfig._comfyVideoBaseURL = comfyVideoTarget
  runtimeConfig._proxyBaseURL = `http://127.0.0.1:${port}/api/comfyui`
  runtimeConfig._proxyVideoBaseURL = `http://127.0.0.1:${port}/api/comfyui-video`
  return prodAppURL
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  registerSpeechHandlers()
  registerAssetHandlers()
  registerComfyHandlers()
  const loadURL = await resolveAppURL()
  createWindow(loadURL)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const url = process.env.VITE_DEV_SERVER_URL || prodAppURL || (await resolveAppURL())
      createWindow(url)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  speechService.free()
  prodServer?.close()
})
