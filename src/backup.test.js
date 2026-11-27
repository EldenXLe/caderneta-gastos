import { describe, expect, it } from "vitest";
import { gerarCSV, lerBackup, montarBackup } from "./backup";
import { dadosDeExemplo } from "./gastos";

const exemplo = dadosDeExemplo("2026-11-25");

describe("backup", () => {
  it("o que sai no backup volta igual na restauração", () => {
    const { dados, exportadoEm } = lerBackup(montarBackup(exemplo, new Date("2026-11-25T12:00:00Z")));
    expect(dados).toEqual({ ...exemplo, guardado: [], regras: [] });
    expect(exportadoEm).toBe("2026-11-25T12:00:00.000Z");
  });

  it("recusa arquivos que não são backup da Caderneta", () => {
    expect(lerBackup("não é json").erro).toMatch(/JSON/);
    expect(lerBackup('{"app":"outro"}').erro).toMatch(/não é um backup/);
    expect(lerBackup('{"app":"caderneta","versao":99}').erro).toMatch(/versão/);
    expect(lerBackup('{"app":"caderneta","versao":1,"gastos":[]}').erro).toMatch(/incompleto/);
  });

  it("um item estragado recusa o backup inteiro", () => {
    const estragar = (mudanca) => {
      const b = JSON.parse(montarBackup(exemplo));
      mudanca(b);
      return lerBackup(JSON.stringify(b)).erro;
    };
    expect(estragar((b) => (b.gastos[0].valor = -5))).toMatch(/corrompidos/);
    expect(estragar((b) => (b.gastos[0].valor = 12.5))).toMatch(/corrompidos/);
    expect(estragar((b) => (b.gastos[0].categoria = "inexistente"))).toMatch(/corrompidos/);
    expect(estragar((b) => (b.gastos[0].data = "25/11/2026"))).toMatch(/corrompidos/);
    expect(estragar((b) => (b.recorrentes[0].dia = 32))).toMatch(/corrompidos/);
    expect(estragar((b) => (b.orcamentos[0].limite = "600"))).toMatch(/corrompidos/);
    expect(estragar((b) => b.orcamentos.push({ ...b.orcamentos[0] }))).toMatch(/repetidos/);
  });

  it("campos desconhecidos não entram nos dados", () => {
    const b = JSON.parse(montarBackup(exemplo));
    b.gastos[0].script = "<img onerror=alert(1)>";
    // "__proto__" escrito direto no texto, como viria num arquivo malicioso.
    const texto = JSON.stringify(b).replace('"script":', '"__proto__":{"admin":true},"script":');
    const { dados } = lerBackup(texto);
    expect(Object.keys(dados.gastos[0]).sort()).toEqual(["categoria", "criadoEm", "data", "descricao", "exemplo", "id", "valor"]);
    expect(dados.gastos[0].admin).toBeUndefined();
    expect({}.admin).toBeUndefined();
  });
});

describe("CSV", () => {
  const itens = [
    { data: "2026-11-24", descricao: "Almoço; com o time", categoria: "restaurante", valor: 3290 },
    { data: "2026-11-10", descricao: "Netflix", categoria: "assinaturas", valor: 5590, recorrenteId: "r1" },
    { data: "2026-11-12", descricao: '=HYPERLINK("x")', categoria: "outros", valor: 100000 },
  ];
  const csv = gerarCSV(itens);
  const linhas = csv.replace("﻿", "").trim().split("\r\n");

  it("começa com BOM para o Excel abrir os acentos certo", () => expect(csv.startsWith("﻿")).toBe(true));
  it("ordena por data e usa ; e vírgula decimal", () => {
    expect(linhas[0]).toBe("Data;Descrição;Categoria;Valor;Recorrente");
    expect(linhas[1]).toBe("10/11/2026;Netflix;Assinaturas;55,90;sim");
  });
  it("põe entre aspas o texto que tem ;", () => expect(linhas[3]).toBe('24/11/2026;"Almoço; com o time";Restaurante;32,90;'));
  it("neutraliza fórmulas (injeção de CSV)", () => expect(linhas[2]).toBe(`12/11/2026;"'=HYPERLINK(""x"")";Outros;1000,00;`));
});

describe("backup com guardado e regras", () => {
  const guardado = [{ id: "ofx-G1", data: "2026-11-10", valor: 50000, descricao: "APLICACAO CDB", direcao: "aplicacao" }];
  const regras = [{ chave: "pix enviado maria", tipo: "transferencia", categoria: "outros" }];

  it("vão e voltam iguais", () => {
    const { dados } = lerBackup(montarBackup({ ...exemplo, guardado, regras }));
    expect(dados.guardado).toEqual(guardado);
    expect(dados.regras).toEqual(regras);
  });
  it("backup antigo, sem esses campos, continua restaurando", () => {
    const antigo = JSON.parse(montarBackup(exemplo));
    delete antigo.guardado;
    delete antigo.regras;
    expect(lerBackup(JSON.stringify(antigo)).dados.guardado).toEqual([]);
  });
  it("recusa guardado ou regra inválidos", () => {
    const comErro = (mudanca) => {
      const b = JSON.parse(montarBackup({ ...exemplo, guardado, regras }));
      mudanca(b);
      return lerBackup(JSON.stringify(b)).erro;
    };
    expect(comErro((b) => (b.guardado[0].direcao = "saque"))).toMatch(/corrompidos/);
    expect(comErro((b) => (b.regras[0].tipo = "qualquer"))).toMatch(/corrompidos/);
    expect(comErro((b) => (b.regras[0].chave = "__proto__"))).toMatch(/corrompidos/);
    expect(comErro((b) => (b.regras = {}))).toMatch(/corrompidos/);
  });
});
