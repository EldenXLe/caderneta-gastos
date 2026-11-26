import { defineConfig, devices } from "@playwright/test";

// Os testes rodam contra o build de produção (com service worker), não contra o servidor de desenvolvimento.
// Localmente dá para usar um navegador já instalado: PW_CHANNEL=msedge (ou chrome) npm run test:e2e
const canal = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "computador", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...canal }, testIgnore: /celular/ },
    { name: "celular", use: { ...devices["Pixel 7"], ...canal }, testMatch: /celular/ },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
