import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { aba, abrir, anotar, carregarExemplo, lancamento, conferirRolagemDaRevisao } from "./ajuda";

test.beforeEach(async ({ page }) => abrir(page));

test("caderneta vazia oferece exemplo, e 'Apagar exemplo' mantém o que a pessoa anotou", async ({ page }) => {
  await expect(page.getByText("Nada anotado em novembro ainda.")).toBeVisible();
  await carregarExemplo(page);
  await expect(page.locator(".total")).toHaveText("R$ 1.236,20");

  await anotar(page, { valor: "10", descricao: "Meu gasto" });
  await page.getByRole("button", { name: "Apagar exemplo" }).click();

  await expect(page.locator(".lancamento")).toHaveCount(1);
  await expect(lancamento(page, "Meu gasto")).toBeVisible();
  await expect(page.locator(".total")).toHaveText("R$ 10,00");
});

test("anota um gasto, recusa valor vazio e apaga", async ({ page }) => {
  await page.getByRole("button", { name: "Anotar gasto" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Digite um valor maior que zero/);

  await anotar(page, { valor: "42,90", categoria: "Restaurante", descricao: "Jantar" });
  await expect(lancamento(page, "Jantar")).toContainText("R$ 42,90");
  await expect(page.locator(".dia-numero").first()).toHaveText("25");
  await expect(page.locator(".total")).toHaveText("R$ 42,90");

  await page.getByRole("button", { name: "Apagar Jantar, R$ 42,90" }).click();
  await expect(lancamento(page, "Jantar")).toHaveCount(0);
});

test("filtra pela lista e pela etiqueta do lançamento", async ({ page }) => {
  await carregarExemplo(page);

  await page.locator(".filtro", { hasText: "Mercado" }).click();
  await expect(page.locator(".carimbo")).toContainText("Mercado: R$ 440,10");
  for (const etiqueta of await page.locator(".lancamento .etiqueta").allTextContents()) expect(etiqueta).toBe("Mercado");

  await page.getByRole("button", { name: "Remover filtro" }).click();
  await page.locator(".etiqueta", { hasText: "Transporte" }).first().click();
  await expect(page.locator(".carimbo")).toContainText("Transporte");

  await page.getByRole("button", { name: "Remover filtro" }).click();
  await expect(page.locator(".carimbo")).toHaveCount(0);
});

test("assinatura: preenche os meses seguintes, pula um mês, cancela e desfaz", async ({ page }) => {
  await anotar(page, { valor: "39,90", categoria: "Assinaturas", descricao: "Disney+", repetir: true });
  await expect(lancamento(page, "Disney+").locator(".marca-recorrente")).toBeVisible();

  await aba(page, "dez").click();
  await expect(lancamento(page, "Disney+")).toHaveClass(/previsto/);
  await page.getByRole("button", { name: "Pular Disney+ só em dezembro" }).click();
  await expect(lancamento(page, "Disney+")).toHaveCount(0);
  await expect(page.locator(".pausa")).toHaveText(/dez\/26/);

  await page.getByRole("button", { name: "Próximo ano" }).click();
  await aba(page, "jan").click();
  await expect(lancamento(page, "Disney+")).toBeVisible();

  await page.getByRole("button", { name: "Cancelar assinatura Disney+" }).click();
  await expect(page.locator(".confirmar")).toContainText("Novembro de 2026 fica no histórico");
  await page.getByRole("button", { name: "Sim, cancelar" }).click();
  await expect(lancamento(page, "Disney+")).toHaveCount(0);
  await expect(page.locator(".recorrentes")).toContainText("cancelada");

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(lancamento(page, "Disney+")).toBeVisible();
});

test("orçamento mostra o estado de cada limite e valida a edição", async ({ page }) => {
  await carregarExemplo(page);
  await expect(page.locator(".orcamento.estourou")).toContainText("Lazer");
  await expect(page.locator(".orcamento.estourou")).toContainText("Passou R$ 20,00 do limite");
  await expect(page.locator(".orcamento.atencao")).toContainText("Restaurante");

  await page.getByRole("button", { name: "Editar limites" }).click();
  const transporte = page.locator(".limite", { hasText: "Transporte" }).locator("input");
  await transporte.fill("abc");
  await page.getByRole("button", { name: "Salvar limites" }).click();
  await expect(page.locator(".limites .erro")).toBeVisible();

  await transporte.fill("50");
  await page.getByRole("button", { name: "Salvar limites" }).click();
  await expect(page.locator(".orcamento", { hasText: "Transporte" })).toContainText("Faltam R$ 13,70");
});

test("exporta CSV, baixa backup e restaura (recusando arquivo inválido)", async ({ page }) => {
  await carregarExemplo(page);

  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar novembro (CSV)" }).click()]);
  expect(csv.suggestedFilename()).toBe("caderneta-2026-11.csv");
  const textoCsv = readFileSync(await csv.path(), "utf8");
  expect(textoCsv.startsWith("﻿")).toBe(true);
  expect(textoCsv).toContain("Data;Descrição;Categoria;Valor;Recorrente");

  const [backup] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar backup" }).click()]);
  const conteudo = readFileSync(await backup.path());
  expect(JSON.parse(conteudo.toString()).gastos).toHaveLength(15);

  await page.getByRole("button", { name: "Apagar exemplo" }).click();
  await expect(page.locator(".lancamento")).toHaveCount(0);

  const arquivo = page.locator('input[type="file"][accept*="json"]');
  await arquivo.setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"app":"outro"}') });
  await expect(page.locator(".aviso-dados")).toHaveText("Esse arquivo não é um backup da Caderneta.");

  await arquivo.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: conteudo });
  await expect(page.locator(".bloco-dados .confirmar")).toContainText("15 gastos");
  await page.getByRole("button", { name: "Substituir" }).click();
  await expect(page.locator(".total")).toHaveText("R$ 1.236,20");
});

test("o tema escolhido fica salvo depois de recarregar", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const botao = page.getByRole("button", { name: "Modo escuro" });
  await expect(botao).toHaveAttribute("aria-pressed", "false");

  await botao.click();
  await expect(page.locator("html")).toHaveAttribute("data-tema", "escuro");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-tema", "escuro");
  await expect(botao).toHaveAttribute("aria-pressed", "true");
});

test("sem internet, recarrega e continua tudo lá", async ({ page, context }) => {
  await carregarExemplo(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".total")).toHaveText("R$ 1.236,20");
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
});

test("importa extrato OFX separando gasto, investimento, fatura e transferência, e aprende com as correções", async ({ page }) => {
  const extrato = new URL("./fixtures/extrato-exemplo.ofx", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const arquivo = page.locator('input[type="file"][accept*="ofx"]');
  const revisao = page.getByRole("dialog", { name: "Revisar o extrato" });

  await arquivo.setInputFiles(extrato);
  for (const resumo of ["5 gastos", "1 investimento", "1 resgate", "1 pagamento de fatura", "1 transferência entre contas", "1 entrada ignorada"])
    await expect(revisao).toContainText(resumo);
  await expect(revisao.getByLabel("Categoria de IFOOD *Padaria São João")).toHaveValue("restaurante");
  await expect(revisao.getByLabel("Tipo de APLICACAO CDB")).toHaveValue("investimento");
  await expect(revisao.getByLabel("Tipo de RESGATE CDB")).toHaveValue("resgate");
  await expect(revisao.getByLabel("Tipo de PAGAMENTO DE FATURA")).toHaveValue("fatura");
  await expect(revisao.getByLabel("Importar PAGAMENTO DE FATURA, R$ 1.200,00")).not.toBeChecked();
  await expect(revisao.getByLabel("Importar TED MESMA TITULARIDADE, R$ 300,00")).not.toBeChecked();

  // Correções: o Pix era para a própria conta, e o Uber foi lazer.
  await revisao.getByLabel("Tipo de PIX ENVIADO JOAO").selectOption("transferencia");
  await revisao.getByLabel("Categoria de UBER *TRIP").selectOption("lazer");
  await revisao.getByRole("button", { name: "Importar 4 gastos e 2 movimentações de investimento" }).click();

  await expect(revisao).toBeHidden();
  await expect(page.locator(".aviso-dados")).toContainText("2 regras aprendidas");
  await expect(lancamento(page, "IFOOD *Padaria São João")).toContainText("R$ 32,90");
  await expect(page.locator(".total")).toHaveText("R$ 196,30");
  await expect(page.locator(".guardado-total")).toHaveText("R$ 300,00");

  // Um extrato novo com os mesmos textos já chega com as correções aplicadas.
  const linhas = [
    "<STMTTRN><DTPOSTED>20261125<TRNAMT>-100.00<FITID>N1<MEMO>PIX ENVIADO JOAO</STMTTRN>",
    "<STMTTRN><DTPOSTED>20261125<TRNAMT>-20.00<FITID>N2<MEMO>UBER *TRIP</STMTTRN>",
  ];
  await arquivo.setInputFiles({ name: "novo.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(`<OFX>${linhas.join("")}</OFX>`) });
  await expect(revisao.getByLabel("Tipo de PIX ENVIADO JOAO")).toHaveValue("transferencia");
  await expect(revisao.getByLabel("Categoria de UBER *TRIP")).toHaveValue("lazer");
  await expect(revisao).toContainText("regra sua");
  await revisao.getByRole("button", { name: "Cancelar" }).click();

  // O mesmo extrato de novo não duplica nada.
  await arquivo.setInputFiles(extrato);
  await expect(revisao).toContainText("6 já estavam na caderneta");
  await expect(revisao.getByRole("button", { name: "Nada marcado" })).toBeDisabled();
  await revisao.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.locator(".lancamento")).toHaveCount(4);
});

test("extrato longo: a revisão cabe na tela e a lista rola até o último gasto", async ({ page }) => {
  await conferirRolagemDaRevisao(page, expect);
});

test("descrições longas do banco não fazem a coluna lateral invadir a folha", async ({ page }) => {
  await page.setViewportSize({ width: 1317, height: 900 });
  const memos = [
    'Aplicação no investimento: "Caixinha Reserva de Emergência do Leandro para viagem de fim de ano"',
    'Compra no debito: "No estabelecimento SUPERMERCADO BOM PRECO LTDA FILIAL 12"',
  ];
  const linhas = memos.map((m, i) => `<STMTTRN><DTPOSTED>2026111${i}<TRNAMT>-${50 + i}.00<FITID>W${i}<MEMO>${m}</STMTTRN>`);
  await page.locator('input[type="file"][accept*="ofx"]').setInputFiles({ name: "longo.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(`<OFX>${linhas.join("")}</OFX>`) });
  await page.getByRole("dialog").getByRole("button", { name: /Importar/ }).click();
  await expect(page.locator(".guardado-total")).toHaveText("R$ 50,00");

  const { maisADireita, folha } = await page.evaluate(() => ({
    maisADireita: Math.max(...[...document.querySelectorAll(".resumo *")].map((e) => e.getBoundingClientRect().right)),
    folha: document.querySelector(".folha").getBoundingClientRect().left,
  }));
  expect(maisADireita).toBeLessThan(folha);
});
