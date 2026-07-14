import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_JOIN_FEE_RECEIVER': JSON.stringify(env.VITE_JOIN_FEE_RECEIVER || env.JOIN_FEE_RECEIVER || ''),
    },
  }
})
