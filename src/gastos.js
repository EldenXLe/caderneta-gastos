// Cores de tinta de caneta: legíveis no papel claro e no escuro.
export const CATEGORIAS = [
  { id: "mercado", nome: "Mercado", cor: "#2f7d55" },
  { id: "restaurante", nome: "Restaurante", cor: "#c4661d" },
  { id: "transporte", nome: "Transporte", cor: "#2a5fa8" },
  { id: "casa", nome: "Casa e contas", cor: "#9a7426" },
  { id: "saude", nome: "Saúde", cor: "#c0392b" },
  { id: "lazer", nome: "Lazer", cor: "#b0417f" },
  { id: "assinaturas", nome: "Assinaturas", cor: "#0e7c86" },
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

/**
 * Cobranças recorrentes são guardadas como regra — { id, valor, descricao, categoria, dia,
 * inicio: "AAAA-MM", fim: "AAAA-MM" | null, pulados: ["AAAA-MM"] } — e viram lançamentos
 * só na hora de mostrar. Assim os meses seguintes se preenchem sozinhos, sem data final.
 */
export function expandirRecorrentes(recorrentes, ano) {
  const lancamentos = [];
  for (const r of recorrentes) {
    for (let m = 1; m <= 12; m++) {
      const mes = `${ano}-${String(m).padStart(2, "0")}`;
      if (mes < r.inicio || (r.fim && mes > r.fim) || r.pulados.includes(mes)) continue;
      // Dia 31 vira o último dia em meses mais curtos (30, 29 ou 28).
      const dia = Math.min(r.dia, new Date(ano, m, 0).getDate());
      lancamentos.push({
        id: `${r.id}@${mes}`,
        recorrenteId: r.id,
        valor: r.valor,
        descricao: r.descricao,
        categoria: r.categoria,
        data: `${mes}-${String(dia).padStart(2, "0")}`,
        criadoEm: 0,
      });
    }
  }
  return lancamentos;
}

export function somarMes(mes, n) {
  const [ano, m] = mes.split("-").map(Number);
  return hojeISO(new Date(ano, m - 1 + n, 1)).slice(0, 7);
}

/**
 * Último mês cobrado ao cancelar hoje. Se a cobrança deste mês já passou, ela fica;
 * se ainda vai cair, o mês atual também sai. null = nunca houve cobrança (apagar a regra).
 */
export function fimAoCancelar(regra, hoje) {
  const mesAtual = hoje.slice(0, 7);
  const [ano, m] = mesAtual.split("-").map(Number);
  const diaDaCobranca = Math.min(regra.dia, new Date(ano, m, 0).getDate());
  const fim = diaDaCobranca <= Number(hoje.slice(8)) ? mesAtual : somarMes(mesAtual, -1);
  return fim < regra.inicio ? null : fim;
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

/** Um mês e meio de gastos realistas para quem abre o app pela primeira vez (nada no futuro). */
export function dadosDeExemplo(hoje) {
  const base = new Date(`${hoje}T12:00`);
  const diasAtras = (n) => hojeISO(new Date(base.getFullYear(), base.getMonth(), base.getDate() - n));
  const lista = [
    [0, 3290, "restaurante", "Almoço perto do trabalho"],
    [1, 1180, "transporte", "Ônibus da semana"],
    [2, 18740, "mercado", "Compra do mês"],
    [4, 6490, "restaurante", "Pizza de sexta"],
    [5, 2450, "transporte", "Uber"],
    [7, 5630, "saude", "Farmácia"],
    [9, 14990, "casa", "Internet"],
    [11, 9870, "mercado", "Hortifrúti e padaria"],
    [13, 12000, "lazer", "Show no sábado"],
    [16, 4500, "outros", "Presente de aniversário"],
    [20, 21300, "casa", "Conta de luz"],
    [24, 15400, "mercado", "Mercado"],
    [29, 3800, "restaurante", "Café com amigos"],
    [33, 8900, "saude", "Consulta"],
    [38, 26700, "mercado", "Compra do mês"],
  ];
  const gastos = lista.map(([n, valor, categoria, descricao], i) => ({
    id: `exemplo-${i}`,
    valor,
    categoria,
    descricao,
    data: diasAtras(n),
    criadoEm: i,
    exemplo: true,
  }));
  const inicio = somarMes(hoje.slice(0, 7), -2);
  const recorrentes = [
    ["Netflix", 5590, 10],
    ["Spotify", 2190, 5],
  ].map(([descricao, valor, dia], i) => ({
    id: `exemplo-r${i}`,
    valor,
    descricao,
    categoria: "assinaturas",
    dia,
    inicio,
    fim: null,
    pulados: [],
    exemplo: true,
  }));
  // Limites escolhidos para mostrar os três estados: folgado, perto do limite e estourado.
  const orcamentos = [
    ["mercado", 60000],
    ["restaurante", 12000],
    ["lazer", 10000],
  ].map(([categoria, limite]) => ({ categoria, limite, exemplo: true }));
  return { gastos, recorrentes, orcamentos };
}

/** Quanto do limite já foi: abaixo de 80% "ok", a partir de 80% "atencao", acima de 100% "estourou". */
export function situacaoOrcamento(gasto, limite) {
  const pct = gasto / limite;
  return { pct, restante: limite - gasto, nivel: pct > 1 ? "estourou" : pct >= 0.8 ? "atencao" : "ok" };
}
