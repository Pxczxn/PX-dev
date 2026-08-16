import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),

  plugins: [vue()],

  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },

  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@renderer/styles/variables.scss" as *;`
      }
    }
  },

  server: {
    port: 5173,
    strictPort: true
  },

  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true
  }
})
