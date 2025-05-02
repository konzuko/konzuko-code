// vite.config.js
import { defineConfig } from 'vite';
import preact from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [preact()],
  // The react→preact alias block has been removed: we never import "react".
  server: {
    port: 3001,
    hmr: { overlay: false }
  }
});