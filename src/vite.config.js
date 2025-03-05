import { defineConfig } from 'vite';
import preact from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 3000
  }
});