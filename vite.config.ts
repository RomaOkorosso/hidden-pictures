import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function normalizeBase(input: string | undefined): string {
  if (!input || input === "/") return "/";
  const withLeading = input.startsWith("/") ? input : `/${input}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export default defineConfig({
  base: normalizeBase(process.env.VITE_BASE_PATH),
  plugins: [react()],
});
