import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Pages from "vite-plugin-pages";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    Pages({
      dirs: "src/pages",
      extensions: ["jsx"]
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src")
    }
  },
  server: {
    port: 5173
  }
});
