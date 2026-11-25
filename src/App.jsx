import { useEffect, useState } from "react";
import {
  CATEGORIAS,
  agruparPorDia,
  filtrarPorCategoria,
  hojeISO,
  lerValor,
  nomeDoMes,
  reais,
  resumoDoMes,
  totaisDoAno,
} from "./gastos";

const CHAVE = "caderneta:gastos";

// shortcut: localStorage (~5 MB, uns 30 mil gastos); trocar por IndexedDB ao sincronizar com servidor.
function carregar() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE)) ?? [];
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
  const [gastos, setGastos] = useState(carregar);
  const [mes, setMes] = useState(() => hojeISO().slice(0, 7));
  const [filtro, setFiltro] = useState(null);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("mercado");
  const [data, setData] = useState(hojeISO);
  const [erro, setErro] = useState("");
  const [falhaAoSalvar, setFalhaAoSalvar] = useState(false);
  const online = useOnline();
  const instalar = useInstalar();

  const ano = Number(mes.slice(0, 4));
  const indiceMes = Number(mes.slice(5, 7)) - 1;
  const totaisAno = totaisDoAno(gastos, ano);
  const { itens, total } = resumoDoMes(gastos, mes);
  const visiveis = filtrarPorCategoria(itens, filtro);
  const dias = agruparPorDia(visiveis);
  const totalFiltrado = visiveis.reduce((s, g) => s + g.valor, 0);
  const porCategoria = CATEGORIAS.map((c) => ({
    ...c,
    total: itens.filter((g) => g.categoria === c.id).reduce((s, g) => s + g.valor, 0),
  }));
  const nomeMes = nomeDoMes(mes).split(" ")[0].toLowerCase();

  function guardar(novos) {
    setGastos(novos);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(novos));
      setFalhaAoSalvar(false);
    } catch {
      setFalhaAoSalvar(true);
    }
  }

  function adicionar(e) {
    e.preventDefault();
    const centavos = lerValor(valor);
    if (!centavos) {
      setErro("Digite um valor maior que zero, como 12,50.");
      return;
    }
    const novo = {
      id: crypto.randomUUID(),
      valor: centavos,
      descricao: descricao.trim() || porId[categoria].nome,
      categoria,
      data,
      criadoEm: Date.now(),
    };
    guardar([novo, ...gastos]);
    setMes(data.slice(0, 7));
    // O gasto novo precisa aparecer: se o filtro ativo o esconderia, o filtro sai.
    if (filtro && filtro !== categoria) setFiltro(null);
    setValor("");
    setDescricao("");
    setErro("");
  }

  const remover = (id) => guardar(gastos.filter((x) => x.id !== id));
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
          <section className="bloco">
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

          <section className="bloco" aria-labelledby="titulo-categorias">
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
                    <li key={g.id} className="lancamento">
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
                        className="apagar"
                        onClick={() => remover(g.id)}
                        aria-label={`Apagar ${g.descricao}, ${reais(g.valor)}`}
                      >
                        ×
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

        <aside className="lateral-form">
          <form className="ticket" onSubmit={adicionar} noValidate aria-labelledby="titulo-form">
            <h2 id="titulo-form" className="ticket-topo">
              Novo gasto
            </h2>

            <label className="campo campo-valor">
              <span>Valor</span>
              <span className="valor-entrada">
                <span aria-hidden="true">R$</span>
                <input
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
    </div>
  );
}
