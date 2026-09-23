import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    host: 'localhost', port: 5173, strictPort: true,
    proxy: { '/api': { target: 'http://localhost:5000' } },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        redirect: resolve(__dirname, "redirect.html"),
      },
    },
  },
});
