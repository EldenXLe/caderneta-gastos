// Relógio parado numa quarta-feira: "hoje", os meses e os totais do exemplo não mudam com o dia em que o teste roda.
export const HOJE = new Date("2026-11-25T12:00:00-03:00");

export async function abrir(page) {
  await page.clock.setFixedTime(HOJE);
  await page.goto("/");
}

export async function carregarExemplo(page) {
  await page.getByRole("button", { name: "Ver com dados de exemplo" }).click();
  await page.getByText("Você está vendo dados de exemplo.").waitFor();
}

export async function anotar(page, { valor, categoria, descricao, repetir }) {
  await page.locator(".valor-entrada input").fill(valor);
  if (categoria) await page.locator(".opcao", { hasText: categoria }).click();
  if (repetir) await page.locator(".repetir").click();
  if (descricao) await page.getByPlaceholder("opcional").fill(descricao);
  await page.getByRole("button", { name: "Anotar gasto" }).click();
}

export const lancamento = (page, texto) => page.locator(".lancamento", { hasText: texto });
export const aba = (page, mes) => page.locator(".aba", { hasText: mes });
