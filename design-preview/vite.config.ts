import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Design preview — deliberately SEPARATE from the production app.
 *
 * `npm run build` uses the repository root `vite.config.ts` and never sees this
 * file, so nothing here can reach `dist/`. There is no Supabase client, no store,
 * no router and no production route: the screens below are fed by static fixtures
 * in `fixtures.ts`, so opening the preview cannot read or write real user data.
 *
 * Run it with:
 *   npm run preview:design     기존 시안 (손으로 그린 목업)
 *   npm run preview:v4         V4 셸 -- 실제 컴포넌트, 실기기 확인용
 *
 * 폰에서 열 때는 Tailscale 로:
 *   http://<머신이름>.<tailnet>.ts.net:5199/v4.html
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  server: {
    port: 5199,
    open: false,
    /*
      0.0.0.0 으로 바인딩한다. Tailscale 로 폰에서 열려면 loopback 만으로는 닿지 않는다.

      `allowedHosts` 는 Vite 가 Host 헤더를 검사하기 때문에 필요하다. 기본값은 알 수 없는
      호스트를 거부하므로 tailnet 이름(`*.ts.net`)으로 열면 화면 대신 차단 메시지가 뜬다.
      `true` 로 전부 여는 대신 tailnet 과 loopback 만 허용한다 -- 이 서버는 프로덕션이
      아니지만 그렇다고 아무 호스트에나 열어 둘 이유도 없다.
    */
    host: true,
    allowedHosts: ['.ts.net', 'localhost', '127.0.0.1'],
  },
});
