import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveComfyTargets } from './comfy-targets.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function proxyToComfy(req, res, comfyTarget, prefix = '/api/comfyui') {
  const targetOrigin = new URL(comfyTarget).origin
  const pathAndQuery = (req.url || '').replace(new RegExp(`^${prefix}`), '') || '/'
  const targetUrl = new URL(pathAndQuery, comfyTarget)

  const headers = { ...req.headers, host: targetUrl.host }
  headers.origin = targetOrigin
  headers.referer = `${targetOrigin}/`
  delete headers['content-length']

  const proxyReq = http.request(
    targetUrl,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, {
        ...proxyRes.headers,
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': '*',
      })
      proxyRes.pipe(res)
    },
  )

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    }
    res.end('ComfyUI proxy error')
  })

  req.pipe(proxyReq)
}

function serveStatic(req, res, distDir) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath)

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const tryFile = (target) => {
    fs.readFile(target, (err, data) => {
      if (!err) {
        res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' })
        res.end(data)
        return
      }
      if (target !== path.join(distDir, 'index.html')) {
        fs.readFile(path.join(distDir, 'index.html'), (fallbackErr, fallbackData) => {
          if (fallbackErr) {
            res.writeHead(404)
            res.end('Not found')
            return
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(fallbackData)
        })
        return
      }
      res.writeHead(404)
      res.end('Not found')
    })
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      tryFile(filePath)
      return
    }
    tryFile(path.join(distDir, 'index.html'))
  })
}

/**
 * Serves the Vite build and proxies /api/comfyui (same behavior as vite dev proxy).
 * @param {string} distDir
 * @returns {Promise<{ port: number, server: import('node:http').Server }>}
 */
export function startProdServer(distDir) {
  const { comfyTarget, comfyVideoTarget } = resolveComfyTargets()

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (
        req.method === 'OPTIONS'
        && (req.url?.startsWith('/api/comfyui-video') || req.url?.startsWith('/api/comfyui'))
      ) {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': '*',
        })
        res.end()
        return
      }

      if (req.url?.startsWith('/api/comfyui-video')) {
        proxyToComfy(req, res, comfyVideoTarget, '/api/comfyui-video')
        return
      }

      if (req.url?.startsWith('/api/comfyui')) {
        proxyToComfy(req, res, comfyTarget)
        return
      }

      serveStatic(req, res, distDir)
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ port, server })
    })
  })
}

export function resolveDistDir() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, '../dist')
}
