import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: { watch: { ignored: ['**/.tmp/**', '**/dist/**', '**/test-results/**'] } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
