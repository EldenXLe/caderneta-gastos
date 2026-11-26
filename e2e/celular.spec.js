import { expect, test } from "@playwright/test";
import { abrir, carregarExemplo, lancamento } from "./ajuda";

test.beforeEach(async ({ page }) => abrir(page));

test("no celular, o formulário abre num painel e fecha ao salvar", async ({ page }) => {
  await expect(page.locator(".lateral-form")).toBeHidden();

  await page.getByRole("button", { name: "+ Anotar gasto" }).click();
  const painel = page.getByRole("dialog");
  await expect(painel).toBeVisible();
  await expect(painel.locator(".valor-entrada input")).toBeFocused();

  await painel.locator(".valor-entrada input").fill("18,50");
  await painel.locator(".opcao", { hasText: "Transporte" }).click();
  await painel.getByPlaceholder("opcional").fill("Uber");
  await painel.getByRole("button", { name: "Anotar gasto" }).click();

  await expect(painel).toBeHidden();
  await expect(lancamento(page, "Uber")).toContainText("R$ 18,50");
});

test("no celular, o mês atual fica à vista e a página não rola de lado", async ({ page }) => {
  await carregarExemplo(page);
  await expect(page.locator('.aba[aria-current="true"]')).toBeInViewport();
  const { larguraConteudo, larguraTela } = await page.evaluate(() => ({
    larguraConteudo: document.documentElement.scrollWidth,
    larguraTela: document.documentElement.clientWidth,
  }));
  expect(larguraConteudo).toBeLessThanOrEqual(larguraTela);
});
