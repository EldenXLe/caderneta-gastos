// Lê extratos OFX (conta e cartão) no próprio navegador: o arquivo não sai do aparelho.
// Cobre o OFX 1.x (SGML, sem fechar as tags de valor) e o 2.x (XML), que os bancos brasileiros exportam.

/** Muitos bancos ainda gravam em Windows-1252 ("CHARSET:1252"); ler como UTF-8 estragaria "São João". */
export function decodificarOFX(bytes) {
  const inicio = new TextDecoder("latin1").decode(bytes.slice(0, 400)).toUpperCase();
  const legado = /CHARSET:\s*(1252|ISO-?8859-?1)/.test(inicio) || /ENCODING="?(WINDOWS-1252|ISO-8859-1)/.test(inicio);
  if (!legado) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // cabeçalho dizia UTF-8 (ou nada), mas os bytes não são: cai para o padrão antigo
    }
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const limpar = (s) =>
  s
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTIDADES[e])
    .replace(/\s+/g, " ")
    .trim();

/** Valor da tag no bloco; no SGML ela não fecha, então o valor vai até o próximo "<" ou fim da linha. */
function campo(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i"));
  return m ? limpar(m[1]) : "";
}

/** "-45.90", "-45,90", "-1.234,56" → centavos (com sinal). null se não for número. */
function centavosOFX(texto) {
  let t = texto.replace(/\s/g, "");
  const ultimaVirgula = t.lastIndexOf(",");
  const ultimoPonto = t.lastIndexOf(".");
  if (ultimaVirgula > ultimoPonto) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** "20261124120000[-3:BRT]" → "2026-11-24". */
function dataOFX(texto) {
  const m = texto.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, a, mes, d] = m.map(Number);
  const data = new Date(a, mes - 1, d);
  if (data.getFullYear() !== a || data.getMonth() !== mes - 1 || data.getDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Devolve { gastos: [{ fitid, data, valor, descricao }], entradas } ou { erro }.
 * Só as saídas viram gasto (valor positivo, em centavos); entradas (salário, Pix recebido, estorno) são contadas e ignoradas.
 */
export function lerOFX(texto) {
  if (!/<OFX>/i.test(texto)) return { erro: "Esse arquivo não parece um extrato OFX." };
  const blocos = [...texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]);
  if (blocos.length === 0) return { erro: "O extrato não tem nenhuma movimentação." };

  const gastos = [];
  const vistos = new Map();
  let entradas = 0;
  for (const bloco of blocos) {
    const valor = centavosOFX(campo(bloco, "TRNAMT"));
    const data = dataOFX(campo(bloco, "DTPOSTED"));
    if (valor === null || !data) return { erro: "O extrato tem uma movimentação com valor ou data inválidos." };
    if (valor >= 0) {
      entradas++;
      continue;
    }
    const descricao = (campo(bloco, "MEMO") || campo(bloco, "NAME") || "Gasto importado").slice(0, 80);
    // Sem FITID (raro), monta um código estável com os dados; repetições iguais no mesmo dia ganham um contador.
    const base = campo(bloco, "FITID") || `${data}|${valor}|${descricao}`;
    const n = vistos.get(base) ?? 0;
    vistos.set(base, n + 1);
    gastos.push({ fitid: n ? `${base}#${n}` : base, data, valor: -valor, descricao });
  }
  return { gastos, entradas };
}

// Palavras sem acento; a primeira que aparecer na descrição decide. Sem palavra conhecida, fica "outros".
const PALAVRAS = [
  ["assinaturas", ["netflix", "spotify", "disney", "prime video", "amazon prime", "hbo", "youtube", "globoplay", "deezer", "icloud", "apple.com", "google one", "chatgpt", "openai"]],
  ["restaurante", ["ifood", "rappi", "restaurante", "lanchonete", "pizzaria", "burger", "mcdonald", "bk ", "starbucks", "cafe", "padoca", "bar "]],
  ["transporte", ["uber", "99app", "99 pop", "cabify", "posto", "combustivel", "shell", "ipiranga", "petrobras", "estacionamento", "sem parar", "conectcar", "metro", "bilhete"]],
  ["mercado", ["mercado", "supermercado", "atacadao", "assai", "carrefour", "pao de acucar", "extra ", "hortifruti", "padaria", "acougue", "sacolao"]],
  ["saude", ["farmacia", "drogaria", "droga raia", "drogasil", "pague menos", "laboratorio", "clinica", "hospital", "odonto", "unimed"]],
  ["casa", ["enel", "sabesp", "copel", "cemig", "light", "comgas", "claro", "vivo", "tim ", "oi ", "net virtua", "aluguel", "condominio", "iptu"]],
  ["lazer", ["cinema", "cinemark", "ingresso", "sympla", "steam", "playstation", "xbox", "livraria", "show"]],
];
const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function sugerirCategoria(descricao) {
  const t = ` ${semAcento(descricao)} `;
  let melhor = { id: "outros", i: Infinity };
  for (const [id, palavras] of PALAVRAS) {
    for (const p of palavras) {
      const i = t.indexOf(p);
      if (i >= 0 && i < melhor.i) melhor = { id, i };
    }
  }
  return melhor.id;
}
