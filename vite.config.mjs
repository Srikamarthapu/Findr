import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { findrAccountPlugin } from "./server/vite-account-plugin.mjs";
import { findrGuidePlugin } from "./server/vite-guide-plugin.mjs";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    build: {
      outDir: "dist/client",
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [
      react(),
      ...(command === "serve"
        ? [findrAccountPlugin({ env }), findrGuidePlugin({ env })]
        : []),
    ],
  };
});
