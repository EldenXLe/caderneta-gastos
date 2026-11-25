// Cores de tinta de caneta: legíveis no papel claro e no escuro.
export const CATEGORIAS = [
  { id: "mercado", nome: "Mercado", cor: "#2f7d55" },
  { id: "restaurante", nome: "Restaurante", cor: "#c4661d" },
  { id: "transporte", nome: "Transporte", cor: "#2a5fa8" },
  { id: "casa", nome: "Casa e contas", cor: "#9a7426" },
  { id: "saude", nome: "Saúde", cor: "#c0392b" },
  { id: "lazer", nome: "Lazer", cor: "#b0417f" },
  { id: "outros", nome: "Outros", cor: "#6b7280" },
];

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valores são guardados em centavos (inteiros) para a soma nunca errar por arredondamento. */
export const reais = (centavos) => brl.format(centavos / 100);

/** "12", "12,5", "1.234,56", "R$ 30" → centavos. Devolve null se não for um valor positivo. */
export function lerValor(texto) {
  let t = String(texto).replace(/R\$|\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const centavos = Math.round(Number(t) * 100);
  return centavos > 0 ? centavos : null;
}

/** Data de hoje no fuso do aparelho (toISOString usaria UTC e viraria o dia às 21h no Brasil). */
export function hojeISO(agora = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

export function nomeDoMes(mes) {
  const [ano, m] = mes.split("-").map(Number);
  const nome = new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/** null = todas as categorias. */
export const filtrarPorCategoria = (itens, categoria) =>
  categoria ? itens.filter((g) => g.categoria === categoria) : itens;

/** Itens já ordenados → [{ data, itens, total }], um grupo por dia, na mesma ordem. */
export function agruparPorDia(itens) {
  const grupos = [];
  for (const g of itens) {
    const ultimo = grupos.at(-1);
    if (ultimo?.data === g.data) {
      ultimo.itens.push(g);
      ultimo.total += g.valor;
    } else {
      grupos.push({ data: g.data, itens: [g], total: g.valor });
    }
  }
  return grupos;
}

/** Total de cada mês do ano, de janeiro (índice 0) a dezembro. */
export function totaisDoAno(gastos, ano) {
  const totais = Array(12).fill(0);
  for (const g of gastos) {
    if (g.data.startsWith(`${ano}-`)) totais[Number(g.data.slice(5, 7)) - 1] += g.valor;
  }
  return totais;
}

export function resumoDoMes(gastos, mes) {
  const doMes = gastos
    .filter((g) => g.data.startsWith(mes))
    .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm - a.criadoEm);
  const total = doMes.reduce((s, g) => s + g.valor, 0);
  const porCategoria = CATEGORIAS.map((c) => ({
    ...c,
    total: doMes.filter((g) => g.categoria === c.id).reduce((s, g) => s + g.valor, 0),
  }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  return { itens: doMes, total, porCategoria };
}
