import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_DEV_PORT || 5173),
      strictPort: false,
      // ponytail: polling watcher; fs events unreliable on this Windows path. Drop to default watch if native events start working.
      watch: { usePolling: true, interval: 300 },
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
