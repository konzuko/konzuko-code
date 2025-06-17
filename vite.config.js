// file: vite.config.js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Load variables from .env, .env.local, etc. into process.env
  const env = loadEnv(mode, process.cwd(), '');
  const SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;

  // FIX: Harden the proxy configuration.
  // It now validates that the URL is present and correctly formatted
  // before attempting to create the proxy, preventing server startup errors.
  const proxyConfig =
    SUPABASE_URL && /^https?:\/\//.test(SUPABASE_URL)
      ? {
          '/functions/v1': {
            target: SUPABASE_URL,
            changeOrigin: true,
            secure: true,
          },
        }
      : undefined;

  if (!proxyConfig) {
    console.warn(
      '⚠️ VITE_SUPABASE_URL is missing or invalid in your .env file. ' +
      'Edge function calls will not be proxied in dev and will likely fail due to CORS.'
    );
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        react: 'preact/compat',
        'react-dom': 'preact/compat',
      },
    },
    server: {
      port: 3001,
      proxy: proxyConfig,
    },
  };
});
