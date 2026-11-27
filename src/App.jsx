import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CATEGORIAS,
  agruparPorDia,
  dadosDeExemplo,
  expandirRecorrentes,
  filtrarPorCategoria,
  fimAoCancelar,
  hojeISO,
  lerValor,
  nomeDoMes,
  reais,
  resumoDoMes,
  situacaoOrcamento,
  somarMes,
  totaisDoAno,
} from "./gastos";
import { gerarCSV, lerBackup, montarBackup } from "./backup";
import { chaveDaRegra, classificarTipo, decodificarOFX, lerOFX, sugerirCategoria } from "./ofx";

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CHAVE = "caderneta:gastos";
const CHAVE_RECORRENTES = "caderneta:recorrentes";
const CHAVE_ORCAMENTOS = "caderneta:orcamentos";
const CHAVE_GUARDADO = "caderneta:guardado";
const CHAVE_REGRAS = "caderneta:regras";

// Tipos da revisão do extrato. Só gasto, investimento e resgate entram na caderneta;
// fatura e transferência entre contas próprias ficam fora para o mesmo dinheiro não contar duas vezes.
const TIPOS_SAIDA = [
  ["gasto", "Gasto"],
  ["investimento", "Investimento"],
  ["transferencia", "Transferência entre minhas contas"],
  ["fatura", "Pagamento de fatura"],
];
const TIPOS_ENTRADA = [
  ["resgate", "Resgate de investimento"],
  ["ignorar", "Não importar"],
];
const IMPORTAVEIS = new Set(["gasto", "investimento", "resgate"]);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// shortcut: localStorage (~5 MB, uns 30 mil gastos); trocar por IndexedDB ao sincronizar com servidor.
function carregar(chave) {
  try {
    return JSON.parse(localStorage.getItem(chave)) ?? [];
  } catch {
    return [];
  }
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine);
    addEventListener("online", atualizar);
    addEventListener("offline", atualizar);
    return () => {
      removeEventListener("online", atualizar);
      removeEventListener("offline", atualizar);
    };
  }, []);
  return online;
}

/**
 * Acompanha uma media query do CSS (tamanho de tela, tema do sistema).
 * useSyncExternalStore relê o valor real: uma mudança entre o primeiro desenho e a inscrição não se perde.
 */
function useConsulta(consulta) {
  const inscrever = useCallback(
    (avisar) => {
      const mq = matchMedia(consulta);
      mq.addEventListener("change", avisar);
      return () => mq.removeEventListener("change", avisar);
    },
    [consulta],
  );
  return useSyncExternalStore(inscrever, () => matchMedia(consulta).matches);
}

const CHAVE_TEMA = "caderneta:tema";
const COR_BARRA = { claro: "#f3eee2", escuro: "#14161a" };

/** Tema escolhido no botão; sem escolha, segue o sistema. O index.html aplica a escolha antes de desenhar. */
function useTema() {
  const [escolhido, setEscolhido] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_TEMA);
    } catch {
      return null;
    }
  });
  const sistemaEscuro = useConsulta("(prefers-color-scheme: dark)");
  const tema = escolhido ?? (sistemaEscuro ? "escuro" : "claro");
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COR_BARRA[tema]);
  }, [tema]);
  function alternar() {
    const novo = tema === "escuro" ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    setEscolhido(novo);
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      // sem armazenamento a escolha vale só até fechar a página
    }
  }
  return [tema, alternar];
}

/** Botão "Instalar" quando o navegador oferece (Chrome, Edge, Android). */
function useInstalar() {
  const [evento, setEvento] = useState(null);
  useEffect(() => {
    const guardar = (e) => {
      e.preventDefault();
      setEvento(e);
    };
    addEventListener("beforeinstallprompt", guardar);
    return () => removeEventListener("beforeinstallprompt", guardar);
  }, []);
  if (!evento) return null;
  return () => {
    evento.prompt();
    setEvento(null);
  };
}

const porId = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));
const semPonto = (s) => s.replace(".", "");
const MESES = Array.from({ length: 12 }, (_, i) =>
  semPonto(new Date(2026, i, 1).toLocaleDateString("pt-BR", { month: "short" })),
);
const diaDaSemana = (iso) => semPonto(new Date(`${iso}T12:00`).toLocaleDateString("pt-BR", { weekday: "short" }));
const reaisCurto = (centavos) =>
  centavos >= 100000
    ? `${(centavos / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : (centavos / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export default function App() {
  const [gastos, setGastos] = useState(() => carregar(CHAVE));
  const [recorrentes, setRecorrentes] = useState(() => carregar(CHAVE_RECORRENTES));
  const [orcamentos, setOrcamentos] = useState(() => carregar(CHAVE_ORCAMENTOS));
  const [guardado, setGuardado] = useState(() => carregar(CHAVE_GUARDADO));
  const [regras, setRegras] = useState(() => carregar(CHAVE_REGRAS));
  const [rascunhoLimites, setRascunhoLimites] = useState(null); // null = fora do modo de edição
  const [limitesInvalidos, setLimitesInvalidos] = useState([]);
  const [restauracao, setRestauracao] = useState(null); // backup lido, esperando confirmação
  const [avisoDados, setAvisoDados] = useState(null);
  const arquivoBackup = useRef(null);
  const arquivoOFX = useRef(null);
  const [importacao, setImportacao] = useState(null); // extrato lido, esperando revisão
  const botaoImportar = useRef(null);
  const [repetir, setRepetir] = useState(false);
  const [cancelando, setCancelando] = useState(null);
  const [mes, setMes] = useState(() => hojeISO().slice(0, 7));
  const [filtro, setFiltro] = useState(null);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("mercado");
  const [data, setData] = useState(hojeISO);
  const [erro, setErro] = useState("");
  const [falhaAoSalvar, setFalhaAoSalvar] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const campoValor = useRef(null);
  const online = useOnline();
  const instalar = useInstalar();
  // Mesmo ponto de quebra do CSS: abaixo dele o formulário vira painel inferior.
  const celular = useConsulta("(max-width: 820px)");
  const [tema, alternarTema] = useTema();
  const painelAberto = celular && formAberto;

  // No celular as abas rolam de lado: mantém o mês escolhido à vista.
  useEffect(() => {
    document.querySelector(".aba[aria-current]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [mes]);

  useEffect(() => {
    if (!painelAberto) return;
    campoValor.current?.focus();
    const fecharNoEsc = (e) => e.key === "Escape" && setFormAberto(false);
    addEventListener("keydown", fecharNoEsc);
    return () => removeEventListener("keydown", fecharNoEsc);
  }, [painelAberto]);

  const ano = Number(mes.slice(0, 4));
  const indiceMes = Number(mes.slice(5, 7)) - 1;
  const hoje = hojeISO();
  const mesAtual = hoje.slice(0, 7);
  const todos = [...gastos, ...expandirRecorrentes(recorrentes, ano)];
  const totaisAno = totaisDoAno(todos, ano);
  const { itens, total } = resumoDoMes(todos, mes);
  const recorrentesVisiveis = recorrentes.filter((r) => !r.fim || r.fim >= mesAtual);
  const visiveis = filtrarPorCategoria(itens, filtro);
  const dias = agruparPorDia(visiveis);
  const totalFiltrado = visiveis.reduce((s, g) => s + g.valor, 0);
  const porCategoria = CATEGORIAS.map((c) => ({
    ...c,
    total: itens.filter((g) => g.categoria === c.id).reduce((s, g) => s + g.valor, 0),
  }));
  const nomeMes = nomeDoMes(mes).split(" ")[0].toLowerCase();
  const vazio = gastos.length === 0 && recorrentes.length === 0;
  const temExemplo = [gastos, recorrentes, orcamentos].some((lista) => lista.some((x) => x.exemplo));
  const guardadoMes = guardado.filter((g) => g.data.startsWith(mes)).sort((a, b) => b.data.localeCompare(a.data));
  const somaGuardado = (direcao) => guardadoMes.filter((g) => g.direcao === direcao).reduce((s, g) => s + g.valor, 0);
  const aplicadoMes = somaGuardado("aplicacao");
  const resgatadoMes = somaGuardado("resgate");
  const limitePorCategoria = Object.fromEntries(orcamentos.map((o) => [o.categoria, o.limite]));

  function salvar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      setFalhaAoSalvar(false);
    } catch {
      setFalhaAoSalvar(true);
    }
  }
  function guardar(novos) {
    setGastos(novos);
    salvar(CHAVE, novos);
  }
  function guardarRecorrentes(novas) {
    setRecorrentes(novas);
    salvar(CHAVE_RECORRENTES, novas);
  }
  function guardarOrcamentos(novos) {
    setOrcamentos(novos);
    salvar(CHAVE_ORCAMENTOS, novos);
  }
  function guardarGuardado(novos) {
    setGuardado(novos);
    salvar(CHAVE_GUARDADO, novos);
  }
  function guardarRegras(novas) {
    setRegras(novas);
    salvar(CHAVE_REGRAS, novas);
  }

  const paraCampo = (centavos) => (centavos / 100).toFixed(2).replace(".", ",");
  function editarLimites() {
    setRascunhoLimites(
      Object.fromEntries(CATEGORIAS.map((c) => [c.id, limitePorCategoria[c.id] ? paraCampo(limitePorCategoria[c.id]) : ""])),
    );
    setLimitesInvalidos([]);
  }
  // Campo vazio tira o limite; texto que não é valor bloqueia o salvamento e é apontado na linha.
  function salvarLimites() {
    const invalidos = CATEGORIAS.filter((c) => rascunhoLimites[c.id].trim() && !lerValor(rascunhoLimites[c.id])).map((c) => c.id);
    setLimitesInvalidos(invalidos);
    if (invalidos.length) return;
    guardarOrcamentos(
      CATEGORIAS.filter((c) => rascunhoLimites[c.id].trim()).map((c) => {
        const limite = lerValor(rascunhoLimites[c.id]);
        const antes = orcamentos.find((o) => o.categoria === c.id);
        // Limite do exemplo que não foi mexido continua sendo exemplo (e sai com "Apagar exemplo").
        return antes?.exemplo && antes.limite === limite ? antes : { categoria: c.id, limite };
      }),
    );
    setRascunhoLimites(null);
  }

  function adicionar(e) {
    e.preventDefault();
    const centavos = lerValor(valor);
    if (!centavos) {
      setErro("Digite um valor maior que zero, como 12,50.");
      return;
    }
    const base = {
      id: crypto.randomUUID(),
      valor: centavos,
      descricao: descricao.trim() || porId[categoria].nome,
      categoria,
    };
    if (repetir) {
      guardarRecorrentes([
        ...recorrentes,
        { ...base, dia: Number(data.slice(8)), inicio: data.slice(0, 7), fim: null, pulados: [] },
      ]);
    } else {
      guardar([{ ...base, data, criadoEm: Date.now() }, ...gastos]);
    }
    setMes(data.slice(0, 7));
    setRepetir(false);
    // O gasto novo precisa aparecer: se o filtro ativo o esconderia, o filtro sai.
    if (filtro && filtro !== categoria) setFiltro(null);
    setValor("");
    setDescricao("");
    setErro("");
    setFormAberto(false);
  }

  function carregarExemplo() {
    const exemplo = dadosDeExemplo(hoje);
    guardar(exemplo.gastos);
    guardarRecorrentes(exemplo.recorrentes);
    guardarOrcamentos(exemplo.orcamentos);
    setMes(mesAtual);
    setFiltro(null);
  }

  // Tira só o que veio do exemplo; o que a pessoa anotou por cima fica.
  function apagarExemplo() {
    guardar(gastos.filter((g) => !g.exemplo));
    guardarRecorrentes(recorrentes.filter((r) => !r.exemplo));
    guardarOrcamentos(orcamentos.filter((o) => !o.exemplo));
  }

  function exportarCSV() {
    baixar(`caderneta-${mes}.csv`, gerarCSV(itens), "text/csv;charset=utf-8");
  }

  function baixarBackup() {
    baixar(`caderneta-backup-${hoje}.json`, montarBackup({ gastos, recorrentes, orcamentos, guardado, regras }), "application/json");
    setAvisoDados({ tipo: "ok", texto: "Backup baixado. Guarde o arquivo num lugar seguro." });
  }

  async function lerArquivo(e) {
    const arquivo = e.target.files[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!arquivo) return;
    setAvisoDados(null);
    if (arquivo.size > 5 * 1024 * 1024) return setAvisoDados({ tipo: "erro", texto: "Arquivo grande demais para ser um backup da Caderneta." });
    const lido = lerBackup(await arquivo.text());
    if (lido.erro) return setAvisoDados({ tipo: "erro", texto: lido.erro });
    setRestauracao(lido);
  }

  function confirmarRestauracao() {
    const { gastos: g, recorrentes: r, orcamentos: o, guardado: gu, regras: re } = restauracao.dados;
    guardar(g);
    guardarRecorrentes(r);
    guardarOrcamentos(o);
    guardarGuardado(gu);
    guardarRegras(re);
    setRestauracao(null);
    setFiltro(null);
    setMes(mesAtual);
    setAvisoDados({ tipo: "ok", texto: "Backup restaurado." });
  }

  // O id vem do código único do banco (FITID): importar o mesmo extrato de novo não duplica, nem depois de um backup.
  const idDoOFX = (fitid) => `ofx-${fitid}`.slice(0, 100);

  async function lerExtrato(e) {
    const arquivo = e.target.files[0];
    e.target.value = "";
    if (!arquivo) return;
    setAvisoDados(null);
    if (arquivo.size > 5 * 1024 * 1024) return setAvisoDados({ tipo: "erro", texto: "Arquivo grande demais para um extrato." });
    const lido = lerOFX(decodificarOFX(new Uint8Array(await arquivo.arrayBuffer())));
    if (lido.erro) return setAvisoDados({ tipo: "erro", texto: lido.erro });
    const ids = new Set([...gastos, ...guardado].map((g) => g.id));
    const regraDe = new Map(regras.map((r) => [r.chave, r]));
    let entradasIgnoradas = 0;
    const itens = [];
    for (const [lista, entrada] of [
      [lido.saidas, false],
      [lido.entradas, true],
    ]) {
      for (const m of lista) {
        const chave = chaveDaRegra(m.descricao);
        // Sugestão automática (texto do banco) e, por cima, o que a pessoa já corrigiu antes.
        const auto = { tipo: classificarTipo(m.descricao, entrada) ?? "ignorar", categoria: sugerirCategoria(m.descricao) };
        const regra = regraDe.get(chave);
        const tipo = regra?.tipo ?? auto.tipo;
        if (entrada && tipo === "ignorar" && !regra) {
          entradasIgnoradas++; // salário, Pix recebido: não é gasto nem investimento
          continue;
        }
        const id = idDoOFX(m.fitid);
        const jaExiste = ids.has(id);
        itens.push({
          ...m,
          id,
          entrada,
          chave,
          auto,
          aprendido: Boolean(regra),
          tipo,
          categoria: regra?.categoria ?? auto.categoria,
          jaExiste,
          marcado: !jaExiste && IMPORTAVEIS.has(tipo),
        });
      }
    }
    if (itens.length === 0)
      return setAvisoDados({ tipo: "erro", texto: "O extrato só tem entradas, nenhum gasto ou investimento para importar." });
    setImportacao({ entradasIgnoradas, itens: itens.sort((a, b) => b.data.localeCompare(a.data)) });
  }

  const mudarItem = (id, mudanca) =>
    setImportacao((imp) => ({
      ...imp,
      itens: imp.itens.map((i) => {
        if (i.id !== id) return i;
        const novo = { ...i, ...mudanca };
        // Trocar o tipo já marca ou desmarca: fatura e transferência não entram.
        if ("tipo" in mudanca) novo.marcado = !i.jaExiste && IMPORTAVEIS.has(mudanca.tipo);
        return novo;
      }),
    }));

  function confirmarImportacao() {
    const escolhidos = importacao.itens.filter((i) => i.marcado && !i.jaExiste && IMPORTAVEIS.has(i.tipo));
    const agora = Date.now();
    const novosGastos = escolhidos
      .filter((i) => i.tipo === "gasto")
      .map(({ id, data, valor, descricao, categoria }, n) => ({ id, data, valor, descricao, categoria, criadoEm: agora - n }));
    const novosGuardados = escolhidos
      .filter((i) => i.tipo !== "gasto")
      .map(({ id, data, valor, descricao, tipo }) => ({ id, data, valor, descricao, direcao: tipo === "resgate" ? "resgate" : "aplicacao" }));
    if (novosGastos.length) guardar([...novosGastos, ...gastos]);
    if (novosGuardados.length) guardarGuardado([...novosGuardados, ...guardado]);

    // Aprende com as correções: o que a pessoa mudou vira regra; o que voltou ao automático deixa de ser regra.
    const novasRegras = new Map(regras.map((r) => [r.chave, r]));
    let aprendidas = 0;
    for (const i of importacao.itens) {
      const corrigido = i.tipo !== i.auto.tipo || (i.tipo === "gasto" && i.categoria !== i.auto.categoria);
      if (corrigido) {
        const antes = novasRegras.get(i.chave);
        if (!antes || antes.tipo !== i.tipo || antes.categoria !== i.categoria) aprendidas++;
        novasRegras.set(i.chave, { chave: i.chave, tipo: i.tipo, categoria: i.categoria });
      } else novasRegras.delete(i.chave);
    }
    guardarRegras([...novasRegras.values()]);

    setImportacao(null);
    setFiltro(null);
    if (escolhidos.length) setMes(escolhidos[0].data.slice(0, 7));
    const partes = [];
    if (novosGastos.length) partes.push(plural(novosGastos.length, "gasto importado", "gastos importados"));
    if (novosGuardados.length)
      partes.push(plural(novosGuardados.length, "movimentação de investimento", "movimentações de investimento"));
    if (aprendidas) partes.push(`${plural(aprendidas, "regra aprendida", "regras aprendidas")} para as próximas importações`);
    setAvisoDados({ tipo: "ok", texto: `${partes.join(", ") || "Nada importado"}.` });
  }

  // Só ao abrir e fechar a revisão (não a cada marcação): foco no botão e Esc para fechar.
  const revisando = importacao !== null;
  useEffect(() => {
    if (!revisando) return;
    botaoImportar.current?.focus();
    const fecharNoEsc = (e) => e.key === "Escape" && setImportacao(null);
    addEventListener("keydown", fecharNoEsc);
    return () => removeEventListener("keydown", fecharNoEsc);
  }, [revisando]);

  function remover(g) {
    if (!g.recorrenteId) return guardar(gastos.filter((x) => x.id !== g.id));
    // Numa cobrança recorrente, o × tira só aquele mês; a regra continua.
    const mesDoItem = g.data.slice(0, 7);
    guardarRecorrentes(
      recorrentes.map((r) => (r.id === g.recorrenteId ? { ...r, pulados: [...r.pulados, mesDoItem] } : r)),
    );
  }

  const mesPorExtenso = (m) => nomeDoMes(m).toLowerCase();
  const atualizarRegra = (id, mudanca) =>
    guardarRecorrentes(recorrentes.map((x) => (x.id === id ? { ...x, ...mudanca } : x)));

  // Sem confirm(): navegadores embutidos e PWAs instalados podem bloquear a janela e responder "não" sozinhos.
  function avisoDeCancelamento(r) {
    const fim = fimAoCancelar(r, hoje);
    if (!fim) return `Ainda não houve nenhuma cobrança de ${r.descricao}, então ela será apagada.`;
    return `${nomeDoMes(fim)} fica no histórico. A partir de ${mesPorExtenso(somarMes(fim, 1))}, ${r.descricao} não aparece mais.`;
  }

  function cancelar(r) {
    const fim = fimAoCancelar(r, hoje);
    guardarRecorrentes(fim ? recorrentes.map((x) => (x.id === r.id ? { ...x, fim } : x)) : recorrentes.filter((x) => x.id !== r.id));
    setCancelando(null);
  }
  const irParaMes = (a, i) => setMes(`${a}-${String(i + 1).padStart(2, "0")}`);

  return (
    <div className="pagina">
      <header className="cabecalho">
        <div className="marca">
          <h1>Caderneta</h1>
          <p>controle de gastos · funciona offline</p>
        </div>
        <div className="cabecalho-acoes">
          <span className={`status ${online ? "on" : "off"}`} role="status">
            {online ? (
              "Online"
            ) : (
              <>
                Offline<span className="status-extra"> · tudo salvo no aparelho</span>
              </>
            )}
          </span>
          <button
            type="button"
            className="botao-tema"
            onClick={alternarTema}
            aria-pressed={tema === "escuro"}
            aria-label="Modo escuro"
            title={tema === "escuro" ? "Voltar para o modo claro" : "Mudar para o modo escuro"}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              {tema === "escuro" ? (
                <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4.5" />
                  <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
                </g>
              ) : (
                <path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z" />
              )}
            </svg>
            <span className="botao-tema-texto">{tema === "escuro" ? "Claro" : "Escuro"}</span>
          </button>
          {instalar && (
            <button type="button" className="botao-contorno" onClick={instalar}>
              Instalar app
            </button>
          )}
        </div>
      </header>

      {falhaAoSalvar && (
        <p className="aviso" role="alert">
          Não foi possível salvar no aparelho. O armazenamento pode estar cheio ou bloqueado.
        </p>
      )}

      {temExemplo && (
        <div className="faixa-exemplo" role="status">
          <p>
            <strong>Você está vendo dados de exemplo.</strong> Fique à vontade para filtrar, pular meses e cancelar
            assinaturas.
          </p>
          <button type="button" className="botao-contorno" onClick={apagarExemplo}>
            Apagar exemplo
          </button>
        </div>
      )}

      <nav className="abas" aria-label={`Meses de ${ano}`}>
        <button type="button" className="aba-ano" onClick={() => irParaMes(ano - 1, indiceMes)} aria-label="Ano anterior">
          ‹
        </button>
        <span className="ano">{ano}</span>
        <button type="button" className="aba-ano" onClick={() => irParaMes(ano + 1, indiceMes)} aria-label="Próximo ano">
          ›
        </button>
        <ol>
          {MESES.map((nome, i) => (
            <li key={nome}>
              <button
                type="button"
                className="aba"
                aria-current={i === indiceMes ? "true" : undefined}
                onClick={() => irParaMes(ano, i)}
              >
                <span className="aba-nome">{nome}</span>
                <span className="aba-valor">{totaisAno[i] ? reaisCurto(totaisAno[i]) : "—"}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grade">
        <aside className="resumo" aria-label="Resumo do mês">
          <section className="bloco bloco-total">
            <p className="rotulo">Total de {nomeMes}</p>
            <p className="total">{reais(total)}</p>
            <p className="fraco">
              {itens.length} {itens.length === 1 ? "lançamento" : "lançamentos"}
            </p>
            {total > 0 && (
              <div className="barra-empilhada" aria-hidden="true">
                {porCategoria
                  .filter((c) => c.total > 0)
                  .map((c) => (
                    <span
                      key={c.id}
                      style={{ flexGrow: c.total, background: c.cor, opacity: filtro && filtro !== c.id ? 0.25 : 1 }}
                    />
                  ))}
              </div>
            )}
          </section>

          <section className="bloco bloco-filtros" aria-labelledby="titulo-categorias">
            <h2 id="titulo-categorias" className="rotulo">
              Filtrar por categoria
            </h2>
            <ul className="filtros">
              <li>
                <button type="button" className="filtro" aria-pressed={!filtro} onClick={() => setFiltro(null)}>
                  <span className="filtro-nome">Todas</span>
                  <span className="filtro-valor">{reais(total)}</span>
                </button>
              </li>
              {porCategoria.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`filtro ${c.total ? "" : "vazio"}`}
                    style={{ "--cor": c.cor }}
                    aria-pressed={filtro === c.id}
                    onClick={() => setFiltro(filtro === c.id ? null : c.id)}
                  >
                    <span className="filtro-nome">
                      <span className="ponto" />
                      {c.nome}
                    </span>
                    <span className="filtro-valor">
                      {c.total ? reais(c.total) : "—"}
                      {c.total > 0 && <small>{Math.round((c.total / total) * 100)}%</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="bloco bloco-orcamento" aria-labelledby="titulo-orcamento">
            <div className="bloco-topo">
              <h2 id="titulo-orcamento" className="rotulo">
                Orçamento de {nomeMes}
              </h2>
              {!rascunhoLimites && (
                <button type="button" className="botao-texto neutro" onClick={editarLimites}>
                  {orcamentos.length ? "Editar limites" : "Definir limites"}
                </button>
              )}
            </div>

            {rascunhoLimites ? (
              <div className="limites">
                <p className="fraco">Limite por mês. Deixe em branco para não acompanhar a categoria.</p>
                {CATEGORIAS.map((c) => (
                  <label key={c.id} className="limite" style={{ "--cor": c.cor }}>
                    <span className="filtro-nome">
                      <span className="ponto" />
                      {c.nome}
                    </span>
                    <span className="limite-campo">
                      <span aria-hidden="true">R$</span>
                      <input
                        inputMode="decimal"
                        placeholder="sem limite"
                        value={rascunhoLimites[c.id]}
                        onChange={(e) => setRascunhoLimites({ ...rascunhoLimites, [c.id]: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && salvarLimites()}
                        aria-invalid={limitesInvalidos.includes(c.id)}
                      />
                    </span>
                  </label>
                ))}
                {limitesInvalidos.length > 0 && (
                  <p className="erro" role="alert">
                    Confira os campos em vermelho: use valores como 600 ou 150,50.
                  </p>
                )}
                <div className="confirmar-acoes">
                  <button type="button" className="botao-pequeno" onClick={salvarLimites}>
                    Salvar limites
                  </button>
                  <button type="button" className="botao-contorno" onClick={() => setRascunhoLimites(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : orcamentos.length === 0 ? (
              <p className="fraco recorrentes-vazio">
                Defina quanto quer gastar por categoria, e a barra avisa quando estiver perto do limite.
              </p>
            ) : (
              <ul className="orcamentos">
                {CATEGORIAS.filter((c) => limitePorCategoria[c.id]).map((c) => {
                  const gasto = porCategoria.find((p) => p.id === c.id).total;
                  const limite = limitePorCategoria[c.id];
                  const { pct, restante, nivel } = situacaoOrcamento(gasto, limite);
                  const porcento = Math.round(pct * 100);
                  return (
                    <li key={c.id} className={`orcamento ${nivel}`} style={{ "--cor": c.cor }}>
                      <div className="orcamento-linha">
                        <span className="filtro-nome">
                          <span className="ponto" />
                          {c.nome}
                        </span>
                        <span className="orcamento-valor">
                          {reais(gasto)} <span className="fraco">de {reais(limite)}</span>
                        </span>
                      </div>
                      <div
                        className="orcamento-barra"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(porcento, 100)}
                        aria-label={`${c.nome}: ${porcento}% do limite`}
                      >
                        <span style={{ width: `${Math.min(pct, 1) * 100}%` }} />
                      </div>
                      <p className="orcamento-status">
                        {nivel === "estourou"
                          ? `Passou ${reais(-restante)} do limite`
                          : restante === 0
                            ? "Limite atingido"
                            : `Faltam ${reais(restante)} · ${porcento}%`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {guardado.length > 0 && (
            <section className="bloco bloco-guardado" aria-labelledby="titulo-guardado">
              <h2 id="titulo-guardado" className="rotulo">
                Guardado em {nomeMes}
              </h2>
              <p className="guardado-total">{reais(aplicadoMes - resgatadoMes)}</p>
              <p className="fraco guardado-detalhe">
                {reais(aplicadoMes)} aplicados · {reais(resgatadoMes)} resgatados. Fica fora das despesas.
              </p>
              {guardadoMes.length > 0 && (
                <ul className="guardado-lista">
                  {guardadoMes.map((g) => (
                    <li key={g.id}>
                      <span className="revisao-data">
                        {g.data.slice(8)}/{g.data.slice(5, 7)}
                      </span>
                      <span className="guardado-descricao">{g.descricao}</span>
                      <span className={`valor ${g.direcao}`}>
                        {g.direcao === "resgate" ? "−" : "+"}
                        {reais(g.valor)}
                      </span>
                      <button
                        type="button"
                        className="apagar"
                        onClick={() => guardarGuardado(guardado.filter((x) => x.id !== g.id))}
                        aria-label={`Apagar ${g.descricao}, ${reais(g.valor)}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="bloco bloco-recorrentes" aria-labelledby="titulo-recorrentes">
            <h2 id="titulo-recorrentes" className="rotulo">
              Assinaturas e recorrentes
            </h2>
            {recorrentesVisiveis.length === 0 ? (
              <p className="fraco recorrentes-vazio">
                Marque “Repetir todo mês” ao anotar uma assinatura, e ela aparece aqui.
              </p>
            ) : (
              <ul className="recorrentes">
                {recorrentesVisiveis.map((r) => {
                  const pausas = r.pulados.filter((p) => p >= mesAtual && (!r.fim || p <= r.fim)).sort();
                  return (
                    <li key={r.id} className={r.fim ? "cancelada" : ""} style={{ "--cor": porId[r.categoria].cor }}>
                      <div className="recorrente-linha">
                        <span className="recorrente-info">
                          <span className="recorrente-nome">
                            <span className="ponto" />
                            {r.descricao}
                          </span>
                          <span className="fraco">
                            {reais(r.valor)} ·{" "}
                            {r.fim ? `cancelada · última em ${mesPorExtenso(r.fim)}` : `todo dia ${r.dia}`}
                          </span>
                        </span>
                        {r.fim ? (
                          <button type="button" className="botao-texto neutro" onClick={() => atualizarRegra(r.id, { fim: null })}>
                            Desfazer
                          </button>
                        ) : (
                          cancelando !== r.id && (
                            <button
                              type="button"
                              className="botao-texto"
                              onClick={() => setCancelando(r.id)}
                              aria-label={`Cancelar assinatura ${r.descricao}`}
                            >
                              Cancelar
                            </button>
                          )
                        )}
                      </div>

                      {pausas.length > 0 && (
                        <p className="pausas">
                          Pulada em{" "}
                          {pausas.map((p) => (
                            <button
                              key={p}
                              type="button"
                              className="pausa"
                              onClick={() => atualizarRegra(r.id, { pulados: r.pulados.filter((x) => x !== p) })}
                              title="Voltar a cobrar neste mês"
                              aria-label={`Voltar a cobrar ${r.descricao} em ${mesPorExtenso(p)}`}
                            >
                              {MESES[Number(p.slice(5)) - 1]}/{p.slice(2, 4)} ↺
                            </button>
                          ))}
                        </p>
                      )}

                      {cancelando === r.id && (
                        <div className="confirmar" role="group" aria-label={`Cancelar ${r.descricao}`}>
                          <p>
                            <strong>Cancelar {r.descricao}?</strong> {avisoDeCancelamento(r)}
                          </p>
                          <div className="confirmar-acoes">
                            <button type="button" className="botao-perigo" onClick={() => cancelar(r)}>
                              Sim, cancelar
                            </button>
                            <button type="button" className="botao-contorno" onClick={() => setCancelando(null)}>
                              Manter
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {recorrentesVisiveis.length > 0 && (
              <p className="dica">
                Para pausar um mês só, use <strong>pular mês</strong> no lançamento daquele mês.
              </p>
            )}
          </section>

          <section className="bloco bloco-dados" aria-labelledby="titulo-dados">
            <h2 id="titulo-dados" className="rotulo">
              Seus dados
            </h2>
            <p className="fraco dados-texto">
              Tudo fica só neste aparelho. Baixe um backup de vez em quando, ou leve para outro aparelho.
            </p>
            <div className="dados-acoes">
              <button type="button" className="botao-contorno" onClick={exportarCSV} disabled={itens.length === 0}>
                Exportar {nomeMes} (CSV)
              </button>
              <button type="button" className="botao-contorno" onClick={baixarBackup}>
                Baixar backup
              </button>
              <button type="button" className="botao-contorno" onClick={() => arquivoBackup.current.click()}>
                Restaurar backup
              </button>
              <button type="button" className="botao-contorno" onClick={() => arquivoOFX.current.click()}>
                Importar extrato do banco (OFX)
              </button>
              <input ref={arquivoOFX} type="file" accept=".ofx,application/x-ofx" onChange={lerExtrato} hidden />
              <input
                ref={arquivoBackup}
                type="file"
                accept="application/json,.json"
                onChange={lerArquivo}
                hidden
              />
            </div>

            {restauracao && (
              <div className="confirmar" role="group" aria-label="Confirmar restauração do backup">
                <p>
                  <strong>Restaurar este backup?</strong>{" "}
                  {restauracao.exportadoEm && `Feito em ${new Date(restauracao.exportadoEm).toLocaleDateString("pt-BR")}, com `}
                  {restauracao.dados.gastos.length} gastos, {restauracao.dados.recorrentes.length} assinaturas e{" "}
                  {restauracao.dados.orcamentos.length} limites. Ele <strong>substitui</strong> o que está na caderneta
                  agora ({gastos.length} gastos).
                </p>
                <div className="confirmar-acoes">
                  <button type="button" className="botao-perigo" onClick={confirmarRestauracao}>
                    Substituir
                  </button>
                  <button type="button" className="botao-contorno" onClick={() => setRestauracao(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {avisoDados && (
              <p className={avisoDados.tipo === "erro" ? "erro aviso-dados" : "ok aviso-dados"} role={avisoDados.tipo === "erro" ? "alert" : "status"}>
                {avisoDados.texto}
              </p>
            )}
          </section>
        </aside>

        <main className="folha" aria-labelledby="titulo-folha">
          <header className="folha-topo">
            <h2 id="titulo-folha">
              Lançamentos de {nomeMes}
              <span className="fraco"> de {ano}</span>
            </h2>
            {filtro && (
              <p className="carimbo" style={{ "--cor": porId[filtro].cor }}>
                {porId[filtro].nome}: {reais(totalFiltrado)}
                <button type="button" onClick={() => setFiltro(null)} aria-label="Remover filtro">
                  ×
                </button>
              </p>
            )}
          </header>

          {dias.length === 0 ? (
            <div className="folha-vazia">
              <p>
                {filtro
                  ? `Nenhum gasto de ${porId[filtro].nome.toLowerCase()} em ${nomeMes}.`
                  : `Nada anotado em ${nomeMes} ainda.`}
              </p>
              {filtro && (
                <button type="button" className="botao-contorno" onClick={() => setFiltro(null)}>
                  Ver todas as categorias
                </button>
              )}
              {vazio && (
                <>
                  <button type="button" className="botao" onClick={carregarExemplo}>
                    Ver com dados de exemplo
                  </button>
                  <small>Um mês e meio de gastos e duas assinaturas, que você apaga com um clique.</small>
                </>
              )}
            </div>
          ) : (
            dias.map((dia) => (
              <section key={dia.data} className="dia" aria-label={`Dia ${Number(dia.data.slice(8))}`}>
                <div className="dia-margem" aria-hidden="true">
                  <span className="dia-numero">{dia.data.slice(8)}</span>
                  <span className="dia-semana">{diaDaSemana(dia.data)}</span>
                </div>
                <ul className="dia-itens">
                  {dia.itens.map((g) => (
                    <li
                      key={g.id}
                      className={`lancamento ${g.data > hoje ? "previsto" : ""}`}
                      style={{ "--cor": porId[g.categoria].cor }}
                    >
                      {g.recorrenteId && (
                        <span className="marca-recorrente" role="img" title="Cobrança recorrente" aria-label="Cobrança recorrente">
                          ↻
                        </span>
                      )}
                      <span className="descricao">{g.descricao}</span>
                      <button
                        type="button"
                        className="etiqueta"
                        style={{ "--cor": porId[g.categoria].cor }}
                        onClick={() => setFiltro(g.categoria)}
                        title={`Filtrar por ${porId[g.categoria].nome}`}
                      >
                        {porId[g.categoria].nome}
                      </button>
                      <span className="pontilhado" aria-hidden="true" />
                      <span className="valor">{reais(g.valor)}</span>
                      <button
                        type="button"
                        className={g.recorrenteId ? "apagar pular" : "apagar"}
                        onClick={() => remover(g)}
                        aria-label={
                          g.recorrenteId
                            ? `Pular ${g.descricao} só em ${nomeMes}`
                            : `Apagar ${g.descricao}, ${reais(g.valor)}`
                        }
                      >
                        {g.recorrenteId ? "pular mês" : "×"}
                      </button>
                    </li>
                  ))}
                  {dia.itens.length > 1 && (
                    <li className="subtotal">
                      <span>total do dia</span>
                      <span className="valor">{reais(dia.total)}</span>
                    </li>
                  )}
                </ul>
              </section>
            ))
          )}
        </main>

        {painelAberto && <div className="fundo-escuro" onClick={() => setFormAberto(false)} aria-hidden="true" />}
        <aside
          className={`lateral-form ${formAberto ? "aberto" : ""}`}
          {...(celular && { role: "dialog", "aria-modal": "true", "aria-labelledby": "titulo-form" })}
        >
          <form className="ticket" onSubmit={adicionar} noValidate aria-labelledby="titulo-form">
            <div className="ticket-topo">
              <h2 id="titulo-form">Novo gasto</h2>
              <button type="button" className="fechar-painel" onClick={() => setFormAberto(false)} aria-label="Fechar">
                ×
              </button>
            </div>

            <label className="campo campo-valor">
              <span>Valor</span>
              <span className="valor-entrada">
                <span aria-hidden="true">R$</span>
                <input
                  ref={campoValor}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  aria-invalid={Boolean(erro)}
                  aria-describedby={erro ? "erro-valor" : undefined}
                />
              </span>
            </label>
            {erro && (
              <p id="erro-valor" className="erro" role="alert">
                {erro}
              </p>
            )}

            <fieldset className="escolha">
              <legend>Categoria</legend>
              {CATEGORIAS.map((c) => (
                <label key={c.id} className="opcao" style={{ "--cor": c.cor }}>
                  <input
                    type="radio"
                    name="categoria"
                    value={c.id}
                    checked={categoria === c.id}
                    onChange={() => setCategoria(c.id)}
                  />
                  <span>{c.nome}</span>
                </label>
              ))}
            </fieldset>

            <label className="repetir">
              <input type="checkbox" checked={repetir} onChange={(e) => setRepetir(e.target.checked)} />
              <span>
                <strong>Repetir todo mês</strong>
                <span className="fraco">Preenche os meses seguintes até você encerrar.</span>
              </span>
            </label>

            <div className="duas-colunas">
              <label className="campo">
                <span>Data</span>
                <input type="date" value={data} onChange={(e) => setData(e.target.value || hojeISO())} />
              </label>
              <label className="campo">
                <span>Descrição</span>
                <input
                  placeholder="opcional"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  maxLength={80}
                />
              </label>
            </div>

            <button type="submit" className="botao">
              Anotar gasto
            </button>
          </form>
          <p className="nota">Seus dados ficam só neste aparelho e nada é enviado para a internet.</p>
        </aside>
      </div>

      {celular && !formAberto && (
        <button type="button" className="botao botao-flutuante" onClick={() => setFormAberto(true)}>
          + Anotar gasto
        </button>
      )}

      {importacao && (
        <div className="revisao-fundo" onClick={(e) => e.target === e.currentTarget && setImportacao(null)}>
          <div className="revisao" role="dialog" aria-modal="true" aria-labelledby="titulo-revisao">
            <header className="revisao-topo">
              <h2 id="titulo-revisao">Revisar o extrato</h2>
              <p className="fraco">
                {(() => {
                  const conta = (t) => importacao.itens.filter((i) => i.tipo === t).length;
                  const partes = [
                    conta("gasto") && plural(conta("gasto"), "gasto", "gastos"),
                    conta("investimento") && plural(conta("investimento"), "investimento", "investimentos"),
                    conta("resgate") && plural(conta("resgate"), "resgate", "resgates"),
                    conta("fatura") && plural(conta("fatura"), "pagamento de fatura", "pagamentos de fatura"),
                    conta("transferencia") && plural(conta("transferencia"), "transferência entre contas", "transferências entre contas"),
                    importacao.itens.some((i) => i.jaExiste) &&
                      `${importacao.itens.filter((i) => i.jaExiste).length} já estavam na caderneta`,
                    importacao.entradasIgnoradas > 0 &&
                      plural(importacao.entradasIgnoradas, "entrada ignorada", "entradas ignoradas"),
                  ].filter(Boolean);
                  return `${partes.join(" · ")}.`;
                })()}{" "}
                Investimentos vão para "Guardado", fora das despesas. Fatura e transferências entre suas contas não entram,
                para o mesmo dinheiro não contar duas vezes. Suas correções viram regra para os próximos extratos.
              </p>
            </header>

            <ul className="revisao-lista">
              {importacao.itens.map((i) => (
                <li key={i.id} className={i.jaExiste ? "ja-existe" : IMPORTAVEIS.has(i.tipo) ? "" : "fora"}>
                  <input
                    type="checkbox"
                    checked={i.marcado}
                    disabled={i.jaExiste || !IMPORTAVEIS.has(i.tipo)}
                    onChange={(e) => mudarItem(i.id, { marcado: e.target.checked })}
                    aria-label={`Importar ${i.descricao}, ${reais(i.valor)}`}
                  />
                  <span className="revisao-data">
                    {i.data.slice(8)}/{i.data.slice(5, 7)}
                  </span>
                  <span className="revisao-descricao">
                    {i.descricao}
                    {i.aprendido && <small className="revisao-regra"> · regra sua</small>}
                  </span>
                  {i.jaExiste ? (
                    <span className="fraco revisao-ja">já importado</span>
                  ) : (
                    <>
                      <select
                        className="revisao-tipo"
                        value={i.tipo}
                        onChange={(e) => mudarItem(i.id, { tipo: e.target.value })}
                        aria-label={`Tipo de ${i.descricao}`}
                      >
                        {(i.entrada ? TIPOS_ENTRADA : TIPOS_SAIDA).map(([id, nome]) => (
                          <option key={id} value={id}>
                            {nome}
                          </option>
                        ))}
                      </select>
                      {i.tipo === "gasto" ? (
                        <select
                          className="revisao-categoria"
                          value={i.categoria}
                          onChange={(e) => mudarItem(i.id, { categoria: e.target.value })}
                          aria-label={`Categoria de ${i.descricao}`}
                          style={{ "--cor": porId[i.categoria].cor }}
                        >
                          {CATEGORIAS.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="revisao-categoria fraco">
                          {i.tipo === "investimento" ? "vai para Guardado" : i.tipo === "resgate" ? "sai do Guardado" : "não entra"}
                        </span>
                      )}
                    </>
                  )}
                  <span className="valor">
                    {i.entrada ? "+" : ""}
                    {reais(i.valor)}
                  </span>
                </li>
              ))}
            </ul>

            <footer className="confirmar-acoes revisao-acoes">
              {(() => {
                const escolhidos = importacao.itens.filter((i) => i.marcado && !i.jaExiste && IMPORTAVEIS.has(i.tipo));
                const nGastos = escolhidos.filter((i) => i.tipo === "gasto").length;
                const nInvest = escolhidos.length - nGastos;
                const rotulo = [
                  nGastos && plural(nGastos, "gasto", "gastos"),
                  nInvest && plural(nInvest, "movimentação de investimento", "movimentações de investimento"),
                ]
                  .filter(Boolean)
                  .join(" e ");
                return (
                  <>
                    <button
                      ref={botaoImportar}
                      type="button"
                      className="botao-pequeno"
                      onClick={confirmarImportacao}
                      disabled={escolhidos.length === 0}
                    >
                      {escolhidos.length ? `Importar ${rotulo}` : "Nada marcado"}
                    </button>
                    <button type="button" className="botao-contorno" onClick={() => setImportacao(null)}>
                      Cancelar
                    </button>
                  </>
                );
              })()}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
