import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import { resolveComfyTargets } from './electron/comfy-targets.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const { comfyTarget, comfyVideoTarget } = resolveComfyTargets(env)
  const isElectronBuild =
    process.env.ELECTRON === 'true' || process.env.npm_lifecycle_event?.includes('electron')
  const enableElectron = process.env.VITEST !== 'true' && process.env.VITE_DEV_WEB !== 'true'

  return {
    base: isElectronBuild ? './' : '/',
    plugins: [
      vue(),
      enableElectron &&
        electron({
          main: {
            entry: 'electron/main.js',
            vite: {
              build: {
                rollupOptions: {
                  external: ['electron'],
                },
              },
            },
          },
          preload: {
            input: path.join(__dirname, 'electron/preload.js'),
          },
        }),
    ].filter(Boolean),
    server: {
      host: '127.0.0.1',
      // 放宽开发环境下的跨域，避免浏览器拦截来自其它入口或工具链的请求
      cors: true,
      proxy: Object.fromEntries([
        ['/api/comfyui-video', comfyVideoTarget],
        ['/api/comfyui', comfyTarget],
      ].map(([prefix, target]) => [
        prefix,
        {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(new RegExp(`^${prefix}`), ''),
          configure(proxy) {
            const targetOrigin = new URL(target).origin
            // ComfyUI 会校验 Host 与 Origin 是否一致，不一致时返回 403
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('origin', targetOrigin)
              proxyReq.setHeader('referer', `${targetOrigin}/`)
            })
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.headers['access-control-allow-origin'] = '*'
              proxyRes.headers['access-control-allow-methods'] =
                'GET,HEAD,POST,PUT,DELETE,OPTIONS'
              proxyRes.headers['access-control-allow-headers'] = '*'
            })
          },
        },
      ])),
    },
    test: {
      environment: 'jsdom',
      globals: true,
    },
  }
})
