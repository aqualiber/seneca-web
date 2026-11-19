import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/puro.js";

test("escolherMime: opus primeiro, webm simples depois, null sem suporte", () => {
  assert.equal(P.escolherMime({ isTypeSupported: () => true }), "audio/webm;codecs=opus");
  assert.equal(P.escolherMime({ isTypeSupported: (m) => m === "audio/webm" }), "audio/webm");
  assert.equal(P.escolherMime({ isTypeSupported: () => false }), null);
  assert.equal(P.escolherMime(undefined), null);
  assert.equal(P.escolherMime({ isTypeSupported: () => { throw new Error("x"); } }), null);
});

test("extensaoDoMime ignora codecs", () => {
  assert.equal(P.extensaoDoMime("audio/webm;codecs=opus"), "webm");
  assert.equal(P.extensaoDoMime("audio/mp4"), "m4a");
  assert.equal(P.extensaoDoMime("x/y"), "bin");
});

test("datas em Brasilia (UTC-3): virada de dia", () => {
  const ms = Date.UTC(2026, 10, 19, 2, 30, 5); // 02:30 UTC = 23:30 de 18/11 em Brasilia
  assert.equal(P.dataBrasilia(ms), "2026-11-18");
  assert.equal(P.horaBrasilia(ms), "23:30");
  assert.equal(P.nomeTrecho(ms), "web_20261118_233005.webm");
  assert.equal(P.nomeTrecho(ms, "audio/webm;codecs=opus"), "web_20261118_233005.webm");
});

test("formatarDia e formatarDataHora", () => {
  assert.equal(P.formatarDia("2026-11-19"), "19/11/2026 (qui)");
  assert.equal(P.formatarDia("lixo"), "lixo");
  assert.equal(P.formatarDataHora("2026-11-19T17:05:00Z"), "19/11 14:05");
  assert.equal(P.formatarDataHora("nada"), "");
});

test("formatarTempo e formatarBytes", () => {
  assert.equal(P.formatarTempo(0), "00:00");
  assert.equal(P.formatarTempo(61999), "01:01");
  assert.equal(P.formatarTempo(3600000 + 5000), "1:00:05");
  assert.equal(P.formatarTempo(-5), "00:00");
  assert.equal(P.formatarBytes(512), "512 B");
  assert.equal(P.formatarBytes(2048), "2 KB");
  assert.equal(P.formatarBytes(5 * 1024 * 1024), "5.0 MB");
});

test("backoffMs dobra e tem teto de 60 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 50].map(P.backoffMs), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(P.backoffMs(0), 2000);
});

test("codigo de pareamento", () => {
  assert.equal(P.normalizarCodigo(" ab cd-23.45 "), "ABCD2345");
  assert.ok(P.codigoValido("abcd2345"));
  assert.ok(!P.codigoValido("abc"));
  assert.ok(!P.codigoValido("abcd234$"));
});

test("MedidorNivel: pico e media na escala 0..32767", () => {
  const m = new P.MedidorNivel(2);
  [0.1, 0.5, 0.2, 0.2].forEach((a) => m.empurrar(a)); // janelas: 0.5 e 0.2
  const r = m.resultado();
  assert.equal(r.pico, Math.round(0.5 * 32767));
  assert.equal(r.media, Math.round(0.35 * 32767));
  assert.deepEqual(new P.MedidorNivel().resultado(), { pico: 0, media: 0 });
  const f = new P.MedidorNivel(10);
  f.empurrar(9); // fora da faixa: limitado a 1
  assert.equal(f.resultado().pico, 32767); // janela parcial fecha no resultado
});

test("mensagemDeErro", () => {
  assert.match(P.mensagemDeErro(0), /Sem conexão/);
  assert.match(P.mensagemDeErro(429, "parear"), /10 minutos/);
  assert.match(P.mensagemDeErro(400, "parear"), /inválido ou vencido/);
  assert.match(P.mensagemDeErro(401, "parear"), /inválido ou vencido/);
  assert.match(P.mensagemDeErro(401), /pareado/);
  assert.match(P.mensagemDeErro(503), /servidor/);
});

test("markdown: blocos", () => {
  const b = P.parseMarkdown("# Titulo\n\nlinha 1\nlinha 2\n\n- a\n- b\n\n1. x\n2) y\n\n---\n```\ncodigo <b>\n```");
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "ul", "ol", "hr", "pre"]);
  assert.equal(b[1].v, "linha 1 linha 2");
  assert.deepEqual(b[2].itens, ["a", "b"]);
  assert.deepEqual(b[3].itens, ["x", "y"]);
  assert.equal(b[5].v, "codigo <b>");
});

test("markdown: inline", () => {
  assert.deepEqual(P.parseInline("a **b** `c` *d* e"), [
    { t: "texto", v: "a " }, { t: "b", v: "b" }, { t: "texto", v: " " }, { t: "cod", v: "c" },
    { t: "texto", v: " " }, { t: "i", v: "d" }, { t: "texto", v: " e" },
  ]);
  assert.deepEqual(P.parseInline("2 * 3 * 4"), [{ t: "texto", v: "2 * 3 * 4" }]);
});

test("markdown: HTML do servidor e escapado", () => {
  const html = P.blocosParaHtml(P.parseMarkdown("# <img src=x onerror=alert(1)>\n\n**<script>x</script>** [l](javascript:alert(1))\n\n- <b>\"'&"));
  assert.ok(!/<img|<script|<b>/.test(html));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("<strong>&lt;script&gt;x&lt;/script&gt;</strong>"));
  assert.ok(!html.includes("<a "));
});

test("textoParaFala tira marcas", () => {
  assert.equal(P.textoParaFala("# Oi\n\n- **a** e `b`\n```x```"), "Oi a e b");
});
