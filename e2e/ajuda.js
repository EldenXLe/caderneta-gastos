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

/** Extrato com muitos gastos, para testar a rolagem da revisão. */
export function extratoLongo(quantidade = 40) {
  const linhas = Array.from(
    { length: quantidade },
    (_, i) =>
      `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>202611${String((i % 25) + 1).padStart(2, "0")}<TRNAMT>-${10 + i}.00<FITID>L${i}<MEMO>Compra ${i + 1}</STMTTRN>`,
  );
  return { name: "longo.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(`<OFX>\n${linhas.join("\n")}\n</OFX>`) };
}

/** A janela de revisão cabe na tela e o último gasto da lista dá para alcançar rolando. */
export async function conferirRolagemDaRevisao(page, expect) {
  await page.locator('input[type="file"][accept*="ofx"]').setInputFiles(extratoLongo());
  const revisao = page.getByRole("dialog", { name: "Revisar o extrato" });
  await expect(revisao).toContainText("40 gastos");
  await expect(revisao.getByRole("button", { name: /Importar 40 gastos/ })).toBeInViewport();

  const ultimo = revisao.locator(".revisao-lista li").last();
  await expect(ultimo).not.toBeInViewport();
  await ultimo.scrollIntoViewIfNeeded();
  await expect(ultimo).toBeInViewport();
  await expect(revisao.getByRole("button", { name: /Importar 40 gastos/ })).toBeInViewport();
}
