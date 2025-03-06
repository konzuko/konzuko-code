import { defineConfig } from 'vite';
import preact from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [preact()],

  resolve: {
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat'
    }
  },

  server: {
    port: 3001
  }
});