import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Gera o service worker que guarda o app inteiro no aparelho e o manifest que permite instalar.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "favicon.ico", "apple-touch-icon-180x180.png"],
      // woff2 entra no cache para as fontes aparecerem também offline.
      workbox: { globPatterns: ["**/*.{js,css,html,woff2}"] },
      manifest: {
        name: "Caderneta — controle de gastos",
        short_name: "Caderneta",
        description: "Anote seus gastos do mês. Funciona sem internet.",
        lang: "pt-BR",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f1ea",
        theme_color: "#0f7b5f",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
