import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Redirect React imports to Preact's compatibility layer
      'react': 'preact/compat',
      'react-dom': 'preact/compat'
    }
  },

  server: {
    port: 3001
  }
});
