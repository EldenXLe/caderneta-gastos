import { describe, expect, it } from "vitest";
import {
  agruparPorDia,
  filtrarPorCategoria,
  hojeISO,
  lerValor,
  resumoDoMes,
  totaisDoAno,
} from "./gastos";

describe("lerValor", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12,50", 1250],
    ["1.234,56", 123456],
    ["1.234", 123400],
    ["9.90", 990],
    ["R$ 30", 3000],
  ])("%s → %i centavos", (texto, centavos) => expect(lerValor(texto)).toBe(centavos));

  it.each(["", "0", "-5", "abc", "1,2,3"])("recusa %j", (texto) => expect(lerValor(texto)).toBeNull());
});

describe("datas", () => {
  it("hoje usa o fuso local, não UTC", () => {
    expect(hojeISO(new Date(2026, 10, 25, 23, 30))).toBe("2026-11-25");
  });
});

describe("resumoDoMes", () => {
  const gastos = [
    { id: "1", valor: 1990, categoria: "mercado", data: "2026-11-02", criadoEm: 1 },
    { id: "2", valor: 4500, categoria: "lazer", data: "2026-11-20", criadoEm: 2 },
    { id: "3", valor: 1010, categoria: "mercado", data: "2026-11-20", criadoEm: 3 },
    { id: "4", valor: 9999, categoria: "mercado", data: "2026-10-31", criadoEm: 4 },
  ];
  const r = resumoDoMes(gastos, "2026-11");

  it("soma só o mês pedido, em centavos exatos", () => expect(r.total).toBe(7500));
  it("lista do mais recente para o mais antigo", () => expect(r.itens.map((g) => g.id)).toEqual(["3", "2", "1"]));
  it("agrupa por categoria, maior primeiro", () => {
    expect(r.porCategoria.map((c) => [c.id, c.total])).toEqual([
      ["lazer", 4500],
      ["mercado", 3000],
    ]);
  });
});

describe("filtro, dias e ano", () => {
  const gastos = [
    { id: "a", valor: 1000, categoria: "mercado", data: "2026-11-20", criadoEm: 3 },
    { id: "b", valor: 250, categoria: "lazer", data: "2026-11-20", criadoEm: 2 },
    { id: "c", valor: 700, categoria: "mercado", data: "2026-11-02", criadoEm: 1 },
    { id: "d", valor: 999, categoria: "mercado", data: "2025-11-02", criadoEm: 0 },
  ];
  const { itens } = resumoDoMes(gastos, "2026-11");

  it("filtra por categoria, e null mostra todas", () => {
    expect(filtrarPorCategoria(itens, "mercado").map((g) => g.id)).toEqual(["a", "c"]);
    expect(filtrarPorCategoria(itens, null)).toHaveLength(3);
  });
  it("agrupa por dia com subtotal", () => {
    expect(agruparPorDia(itens).map((d) => [d.data, d.itens.length, d.total])).toEqual([
      ["2026-11-20", 2, 1250],
      ["2026-11-02", 1, 700],
    ]);
  });
  it("soma cada mês do ano pedido", () => {
    const anos = totaisDoAno(gastos, 2026);
    expect(anos[10]).toBe(1950);
    expect(anos.reduce((s, v) => s + v, 0)).toBe(1950);
  });
});
