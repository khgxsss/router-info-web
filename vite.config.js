import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,    // 외부에서도 접속 가능 (0.0.0.0)
    port: 35442,    // 고정 포트
    strictPort: true // 35442 이미 사용 중이면 에러를 내고 종료 (자동 포트 변경 방지)
  }
})
