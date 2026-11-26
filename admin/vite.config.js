import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Le proxy lit EINK_PORT dans le .env de la racine, comme le serveur.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '..', ''), ...process.env }
  const target = `http://localhost:${env.EINK_PORT || 3000}`
  return {
    plugins: [react()],
    // Le serveur sert déjà /assets/ (images importées) : le bundle va ailleurs pour éviter la collision.
    build: { assetsDir: 'app' },
    server: { port: 5173, proxy: { '/api': target, '/assets': target } },
  }
})
