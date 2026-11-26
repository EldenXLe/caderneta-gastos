import { CATEGORIAS } from "./gastos";

const VERSAO = 1;
const IDS = new Set(CATEGORIAS.map((c) => c.id));
const nomeCategoria = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c.nome]));

export function montarBackup({ gastos, recorrentes, orcamentos }, agora = new Date()) {
  return JSON.stringify({ app: "caderneta", versao: VERSAO, exportadoEm: agora.toISOString(), gastos, recorrentes, orcamentos }, null, 2);
}

// ---------- validação: o arquivo vem de fora, então cada campo é conferido e só o que conhecemos é copiado ----------
const texto = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const centavos = (v) => Number.isInteger(v) && v > 0 && v < 1e11;
const dataISO = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const mesISO = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

function gastoValido(g) {
  if (!g || !texto(g.id, 100) || !centavos(g.valor) || !IDS.has(g.categoria) || !dataISO(g.data) || !texto(g.descricao, 200)) return null;
  return {
    id: g.id,
    valor: g.valor,
    categoria: g.categoria,
    data: g.data,
    descricao: g.descricao,
    criadoEm: Number.isFinite(g.criadoEm) ? g.criadoEm : 0,
    ...(g.exemplo === true && { exemplo: true }),
  };
}

function recorrenteValida(r) {
  const dia = Number.isInteger(r?.dia) && r.dia >= 1 && r.dia <= 31;
  const pulados = Array.isArray(r?.pulados) && r.pulados.every(mesISO);
  if (!r || !texto(r.id, 100) || !centavos(r.valor) || !IDS.has(r.categoria) || !texto(r.descricao, 200) || !dia) return null;
  if (!mesISO(r.inicio) || !(r.fim === null || mesISO(r.fim)) || !pulados) return null;
  return {
    id: r.id,
    valor: r.valor,
    categoria: r.categoria,
    descricao: r.descricao,
    dia: r.dia,
    inicio: r.inicio,
    fim: r.fim,
    pulados: [...r.pulados],
    ...(r.exemplo === true && { exemplo: true }),
  };
}

function orcamentoValido(o) {
  if (!o || !IDS.has(o.categoria) || !centavos(o.limite)) return null;
  return { categoria: o.categoria, limite: o.limite, ...(o.exemplo === true && { exemplo: true }) };
}

/** Lê o texto de um arquivo de backup. Devolve { dados } ou { erro } com uma frase para a tela. */
export function lerBackup(conteudo) {
  let obj;
  try {
    obj = JSON.parse(conteudo);
  } catch {
    return { erro: "Esse arquivo não é um backup da Caderneta (não é um JSON válido)." };
  }
  if (obj?.app !== "caderneta") return { erro: "Esse arquivo não é um backup da Caderneta." };
  if (obj.versao !== VERSAO) return { erro: "Esse backup é de uma versão da Caderneta que este app não conhece." };
  if (![obj.gastos, obj.recorrentes, obj.orcamentos].every(Array.isArray)) return { erro: "O backup está incompleto." };

  const gastos = obj.gastos.map(gastoValido);
  const recorrentes = obj.recorrentes.map(recorrenteValida);
  const orcamentos = obj.orcamentos.map(orcamentoValido);
  // Um item estragado invalida tudo: restaurar pela metade seria pior do que não restaurar.
  if ([...gastos, ...recorrentes, ...orcamentos].includes(null)) return { erro: "O backup tem dados corrompidos e não foi restaurado." };
  if (new Set(orcamentos.map((o) => o.categoria)).size !== orcamentos.length) return { erro: "O backup tem limites repetidos." };

  return { dados: { gastos, recorrentes, orcamentos }, exportadoEm: typeof obj.exportadoEm === "string" ? obj.exportadoEm : null };
}

// ---------- CSV no padrão do Excel brasileiro: ";" separa colunas, vírgula nos centavos, BOM para os acentos ----------
function celula(valor) {
  let v = String(valor);
  // Texto começando com = + - @ vira fórmula no Excel; o apóstrofo impede (injeção de CSV).
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function gerarCSV(itens) {
  const linhas = [["Data", "Descrição", "Categoria", "Valor", "Recorrente"]];
  for (const g of [...itens].sort((a, b) => a.data.localeCompare(b.data))) {
    const [ano, mes, dia] = g.data.split("-");
    linhas.push([`${dia}/${mes}/${ano}`, g.descricao, nomeCategoria[g.categoria], (g.valor / 100).toFixed(2).replace(".", ","), g.recorrenteId ? "sim" : ""]);
  }
  return "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}
