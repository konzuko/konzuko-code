// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // loadEnv adds vars from .env, .env.local, etc. into process.env
  const env = loadEnv(mode, process.cwd(), '')
  const SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL

  if (!/^https?:\/\//.test(SUPABASE_URL ?? '')) {
    // Don’t crash – just warn and skip the proxy
    console.warn(
      '⚠  VITE_SUPABASE_URL is missing or is not a full URL. ' +
      'Edge-function calls will not be proxied.'
    )
  }

  return {
    plugins: [react()],
    server: {
      port: 3001,

      // only create the proxy if we have a valid URL
      proxy: SUPABASE_URL
        ? {
            '/functions': {
              target: SUPABASE_URL,
              changeOrigin: true,
              secure: true,
              rewrite: (p) => p.replace(/^\/functions/, '/functions'),
            },
          }
        : undefined,
    },

    resolve: {
      alias: {
        react:       'preact/compat',
        'react-dom': 'preact/compat',
      },
    },
  }
})
