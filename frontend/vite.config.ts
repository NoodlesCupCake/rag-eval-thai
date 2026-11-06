import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api goes to the FastAPI backend (uvicorn on :8000 by default).
const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: backend, changeOrigin: true } },
  },
});
