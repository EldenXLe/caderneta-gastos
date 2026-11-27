import { describe, expect, it } from "vitest";
import { decodificarOFX, lerOFX, sugerirCategoria } from "./ofx";

// OFX 1.x (SGML) como os bancos exportam: cabeçalho em texto, tags de valor sem fechamento.
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261124120000[-3:BRT]
<TRNAMT>-32.90
<FITID>A1
<MEMO>IFOOD *Restaurante São João
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261105
<TRNAMT>3500.00
<FITID>A2
<MEMO>Salário
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261110000000
<TRNAMT>-1.234,56
<FITID>A3
<NAME>Aluguel &amp; condomínio
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("lerOFX", () => {
  const { gastos, entradas } = lerOFX(SGML);

  it("transforma só as saídas em gastos, em centavos positivos", () => {
    expect(gastos).toHaveLength(2);
    expect(entradas).toBe(1);
    expect(gastos[0]).toEqual({ fitid: "A1", data: "2026-11-24", valor: 3290, descricao: "IFOOD *Restaurante São João" });
  });

  it("aceita vírgula decimal, usa NAME quando falta MEMO e desfaz &amp;", () => {
    expect(gastos[1]).toEqual({ fitid: "A3", data: "2026-11-10", valor: 123456, descricao: "Aluguel & condomínio" });
  });

  it("lê o OFX 2.x em XML, com as tags fechadas", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261103</DTPOSTED><TRNAMT>-55.90</TRNAMT><FITID>X9</FITID><MEMO>NETFLIX.COM</MEMO></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    expect(lerOFX(xml).gastos).toEqual([{ fitid: "X9", data: "2026-11-03", valor: 5590, descricao: "NETFLIX.COM" }]);
  });

  it("sem FITID, gera um código estável e diferencia compras iguais no mesmo dia", () => {
    const semId = `<OFX>
<STMTTRN><DTPOSTED>20261101<TRNAMT>-10.00<MEMO>Café</STMTTRN>
<STMTTRN><DTPOSTED>20261101<TRNAMT>-10.00<MEMO>Café</STMTTRN>
</OFX>`;
    const ids = lerOFX(semId).gastos.map((g) => g.fitid);
    expect(ids).toEqual(["2026-11-01|-1000|Café", "2026-11-01|-1000|Café#1"]);
    expect(lerOFX(semId).gastos.map((g) => g.fitid)).toEqual(ids); // mesmo arquivo, mesmos códigos
  });

  it("recusa o que não é extrato e movimentação com dado inválido", () => {
    expect(lerOFX("data;valor\n1;2").erro).toMatch(/não parece um extrato/);
    expect(lerOFX("<OFX></OFX>").erro).toMatch(/nenhuma movimentação/);
    expect(lerOFX("<OFX><STMTTRN><DTPOSTED>20261340<TRNAMT>-5</STMTTRN></OFX>").erro).toMatch(/inválidos/);
    expect(lerOFX("<OFX><STMTTRN><DTPOSTED>20261101<TRNAMT>abc</STMTTRN></OFX>").erro).toMatch(/inválidos/);
  });
});

describe("decodificarOFX", () => {
  it("lê Windows-1252 quando o cabeçalho pede, sem estragar os acentos", () => {
    const bytes = new Uint8Array(Buffer.from("CHARSET:1252\n<OFX><MEMO>São João</OFX>", "latin1"));
    expect(decodificarOFX(bytes)).toContain("São João");
  });
  it("lê UTF-8 normalmente e cai para Windows-1252 se os bytes não forem UTF-8", () => {
    expect(decodificarOFX(new TextEncoder().encode("<OFX><MEMO>Açaí</OFX>"))).toContain("Açaí");
    expect(decodificarOFX(new Uint8Array(Buffer.from("<OFX><MEMO>Pão</OFX>", "latin1")))).toContain("Pão");
  });
});

describe("sugerirCategoria", () => {
  it.each([
    ["IFOOD *Restaurante São João", "restaurante"],
    ["UBER *TRIP", "transporte"],
    ["NETFLIX.COM", "assinaturas"],
    ["DROGASIL 123", "saude"],
    ["SUPERMERCADO DIA", "mercado"],
    ["Aluguel & condomínio", "casa"],
    ["PIX ENVIADO JOSE", "outros"],
  ])("%s → %s", (descricao, categoria) => expect(sugerirCategoria(descricao)).toBe(categoria));
});
