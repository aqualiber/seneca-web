import test from "node:test";
import assert from "node:assert/strict";
import { criarApi, criarTokenStore, aguardarResposta } from "../js/api.js";

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m };
}

function resposta(status, json) {
  return { status, json: async () => { if (json === undefined) throw new Error("sem json"); return json; } };
}

function montar(roteiro, tokenInicial = "") {
  const chamadas = [];
  const st = storage();
  const tokens = criarTokenStore(st);
  if (tokenInicial) tokens.set(tokenInicial);
  let naoAut = 0;
  const fetchFn = async (url, init) => {
    chamadas.push({ url, init });
    const r = roteiro.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const api = criarApi({ baseUrl: "https://x.test/functions/v1/api/", fetchFn, tokens, aoNaoAutorizado: () => naoAut++ });
  return { api, chamadas, tokens, st, naoAut: () => naoAut };
}

test("parear: corpo, sem token, guarda o token", async () => {
  const t = montar([resposta(200, { ok: true, token: "tok_abcdefghijklmnopqrstuvwxyz", dispositivo_id: 1 })]);
  const r = await t.api.parear("ABCD2345");
  assert.ok(r.ok);
  assert.equal(t.tokens.get(), "tok_abcdefghijklmnopqrstuvwxyz");
  const c = t.chamadas[0];
  assert.equal(c.url, "https://x.test/functions/v1/api/parear");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.headers["x-device-token"], undefined);
  assert.deepEqual(JSON.parse(c.init.body), {
    codigo: "ABCD2345", nome: "Navegador do Túlio", modelo: "Chrome Android", android: "web", versao_app: "web-1.0.0",
  });
});

test("parear: 400, 429 e rede nao guardam token", async () => {
  for (const [rot, st] of [[resposta(400, { ok: false }), 400], [resposta(429, { ok: false }), 429], [new Error("rede"), 0]]) {
    const t = montar([rot]);
    const r = await t.api.parear("ABCD2345");
    assert.equal(r.ok, false);
    assert.equal(r.status, st);
    assert.equal(t.tokens.get(), "");
  }
});

test("401 em rota com token apaga o token e avisa; sem token nem chama a rede", async () => {
  const t = montar([resposta(401, { ok: false })], "tok_abcdefghijklmnopqrstuvwxyz");
  const r = await t.api.conversa();
  assert.equal(r.status, 401);
  assert.equal(t.tokens.get(), "");
  assert.equal(t.naoAut(), 1);
  const r2 = await t.api.dias();
  assert.equal(r2.status, 401);
  assert.equal(t.chamadas.length, 1);
  assert.equal(t.naoAut(), 2);
});

test("rotas: cabecalho de token, URL e corpo", async () => {
  const t = montar([
    resposta(200, { ok: true, id: "7", status: "pendente" }),
    resposta(200, { status: "pendente" }),
    resposta(200, { ok: true, dias: [] }),
    resposta(200, { ok: true }),
    resposta(200, { ok: true, trechos: [] }),
    resposta(200, { mensagens: [] }),
  ], "TOK");
  await t.api.perguntar("oi?");
  await t.api.resposta("a b");
  await t.api.dias();
  await t.api.dia("2026-11-19");
  await t.api.diaTexto("2026-11-19", 1234.9);
  await t.api.conversa();
  assert.ok(t.chamadas.every((c) => c.init.headers["x-device-token"] === "TOK"));
  assert.deepEqual(JSON.parse(t.chamadas[0].init.body), { pergunta: "oi?", horas: 12 });
  assert.deepEqual(t.chamadas.map((c) => c.url.replace("https://x.test/functions/v1/api", "")), [
    "/perguntar", "/resposta?id=a%20b", "/dias?limite=60", "/dia?data=2026-11-19",
    "/dia/texto?data=2026-11-19&apos_ms=1234", "/conversa?limite=40",
  ]);
});

test("ingest: cabecalhos do contrato e corpo cru", async () => {
  const t = montar([resposta(200, { ok: true, id: 1, repetido: false })], "TOK");
  const blob = { size: 3 };
  await t.api.ingest({ blob, mime: "audio/webm;codecs=opus", inicioMs: 1763600000123.7, duracaoMs: 59990.4, pico: 1200, media: 300, nome: "web_20261119_100000.webm" });
  const { init } = t.chamadas[0];
  assert.equal(init.body, blob);
  assert.equal(init.method, "POST");
  assert.deepEqual(
    Object.fromEntries(Object.entries(init.headers).filter(([k]) => k !== "accept")),
    {
      "x-device-token": "TOK", "content-type": "audio/webm;codecs=opus", "x-inicio-ms": "1763600000123",
      "x-duracao-ms": "59990", "x-pico": "1200", "x-media": "300", "x-origem": "web", "x-nome-arquivo": "web_20261119_100000.webm",
    },
  );
});

test("aguardarResposta: pendente, respondendo, pronto", async () => {
  const seq = [{ status: 200, json: { status: "pendente" } }, { status: 200, json: { status: "respondendo" } }, { status: 200, json: { status: "pronto", resposta: "42" } }];
  const vistos = [];
  const api = { resposta: async () => seq.shift() };
  const r = await aguardarResposta(api, "1", { dormir: async () => {}, aoPassar: (s) => vistos.push(s) });
  assert.deepEqual(r, { status: "pronto", resposta: "42" });
  assert.deepEqual(vistos, ["pendente", "respondendo"]);
});

test("aguardarResposta: erro, rede caindo, 401, tempo e cancelamento", async () => {
  const dormir = async () => {};
  assert.deepEqual(await aguardarResposta({ resposta: async () => ({ status: 200, json: { status: "erro", erro: "x" } }) }, "1", { dormir }), { status: "erro", erro: "x" });
  const seq = [{ status: 0, json: null }, { status: 502, json: null }, { status: 200, json: { status: "pronto", resposta: "ok" } }];
  assert.equal((await aguardarResposta({ resposta: async () => seq.shift() }, "1", { dormir })).status, "pronto");
  assert.equal((await aguardarResposta({ resposta: async () => ({ status: 401, json: null }) }, "1", { dormir })).status, "nao_autorizado");
  let n = 0;
  const r = await aguardarResposta({ resposta: async () => { n++; return { status: 200, json: { status: "pendente" } }; } }, "1", { dormir, max: 5 });
  assert.equal(r.status, "tempo");
  assert.equal(n, 5);
  assert.equal((await aguardarResposta({ resposta: async () => ({ status: 200, json: {} }) }, "1", { dormir, cancelado: () => true })).status, "cancelado");
});

test("tokenStore tolera storage que lanca erro", () => {
  const ruim = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  const t = criarTokenStore(ruim);
  assert.equal(t.get(), "");
  assert.equal(t.set("a"), false);
  t.clear();
});
