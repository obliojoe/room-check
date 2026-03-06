import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: '0.0.0.0',
    https: true,
    port: 5173
  }
});
