import { defineConfig } from 'vite';
import preact from '@vitejs/plugin-react';

export default defineConfig({
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
      'react/jsx-runtime': 'preact/jsx-runtime'
    }
  },
  plugins: [preact()],
  server: {
    port: 3000,
    open: false
  }
});
