import { useEffect, useRef, useState } from "react";
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
  somarMes,
  totaisDoAno,
} from "./gastos";

const CHAVE = "caderneta:gastos";
const CHAVE_RECORRENTES = "caderneta:recorrentes";

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

/** Mesmo ponto de quebra do CSS: abaixo dele o formulário vira painel inferior. */
function useCelular() {
  const consulta = "(max-width: 820px)";
  const [celular, setCelular] = useState(() => matchMedia(consulta).matches);
  useEffect(() => {
    const mq = matchMedia(consulta);
    const mudar = () => setCelular(mq.matches);
    mq.addEventListener("change", mudar);
    return () => mq.removeEventListener("change", mudar);
  }, []);
  return celular;
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
  const celular = useCelular();
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
  const temExemplo = gastos.some((g) => g.exemplo) || recorrentes.some((r) => r.exemplo);

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
    setMes(mesAtual);
    setFiltro(null);
  }

  // Tira só o que veio do exemplo; o que a pessoa anotou por cima fica.
  function apagarExemplo() {
    guardar(gastos.filter((g) => !g.exemplo));
    guardarRecorrentes(recorrentes.filter((r) => !r.exemplo));
  }

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
            {online ? "Online" : "Offline · tudo salvo no aparelho"}
          </span>
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
    </div>
  );
}
