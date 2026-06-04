import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    assetsDir: '_builder',  // unique prefix — avoids conflicts with dashboard's /assets/
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/img-proxy': {
        target: 'https://goodpix-co.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/img-proxy/, ''),
      },
    },
  },
})
