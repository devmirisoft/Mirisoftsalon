import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  // In dev the browser talks to Vite (same origin), and Vite proxies /api/*
  // to the backend.  This avoids the WSL localhost-resolution problem where
  // the browser's 'localhost' points at Windows rather than the WSL VM.
  const backendUrl = env.VITE_API_URL || 'http://localhost:5001'

  return {
    plugins: [react()],
    server: {
      host: true, // bind 0.0.0.0 so the Windows browser can reach Vite via the WSL virtual NIC
      port: Number(env.VITE_DEV_PORT || 5173),
      strictPort: false,
      // ponytail: polling watcher; fs events unreliable on this Windows path. Drop to default watch if native events start working.
      watch: { usePolling: true, interval: 300 },
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          // Keep cookies intact so JWT refresh flow still works.
          cookieDomainRewrite: { '*': '' },
        },
      },
    },
    css: {
      devSourcemap: true
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    build: {
      commonjsOptions: {
        transformMixedEsModules: true
      }
    },
  }
})
