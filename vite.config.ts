import { defineConfig, loadEnv } from "vite";
import { isFeatureEnabled } from "./shared/feature-flags.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const youtubeEnabled = isFeatureEnabled(env.ENABLE_YOUTUBE);

  return {
    define: {
      __YOUTUBE_ENABLED__: JSON.stringify(youtubeEnabled),
    },
    build: {
      outDir: "dist/client",
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.ts"],
      },
    },
  };
});
