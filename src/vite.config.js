// vite.config.js
import { defineConfig } from 'vite'
import preact from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [
    preact(),
    wasm(),                // handle .wasm imports
    topLevelAwait()        // allow top-level await in ESM
  ],
  resolve: {
    alias: {
      react:      'preact/compat',
      'react-dom':'preact/compat'
    }
  },
  server: {
    port: 3001,
    hmr: { overlay: false }
  }
})