/*
  1. Make sure you have "preact" installed (npm install preact).
  2. Add the resolve.alias section to map "react" and "react-dom" to "preact/compat".
*/

import { defineConfig } from 'vite';
import preact from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [preact()],

  resolve: {
    alias: {
      // Redirect any "react" or "react-dom" import to Preact.
      'react': 'preact/compat',
      'react-dom': 'preact/compat'
    }
  },

  server: {
    port: 3000
  }
});
