import { defineConfig } from 'vite';
import preact from '@preactjs/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 3001,
    hmr: { overlay: false }
  }
});