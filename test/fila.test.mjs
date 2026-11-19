import test from "node:test";
import assert from "node:assert/strict";
import { criarFila, criarArmazemMemoria } from "../js/fila.js";

const trecho = (inicioMs, tam = 10) => ({ blob: { size: tam }, mime: "audio/webm", inicioMs, duracaoMs: 60000, pico: 1, media: 1, nome: `t${inicioMs}.webm` });

function montar(respostas, opcoes = {}) {
  const armazem = opcoes.armazem || criarArmazemMemoria();
  const enviadosOrdem = [];
  const esperas = [];
  const api = {
    async ingest(it) {
      enviadosOrdem.push(it.inicioMs);
      const r = respostas.shift();
      if (!r) return { status: 200, json: { ok: true } };
      if (r === "rede") return { status: 0, json: null };
      return r;
    },
  };
  const fila = criarFila({ armazem, api, dormir: async (ms) => { esperas.push(ms); }, teto: opcoes.teto, aoMudar: opcoes.aoMudar });
  return { fila, armazem, enviadosOrdem, esperas };
}

test("envia em ordem cronologica e esvazia so depois do 200", async () => {
  const t = montar([]);
  await t.fila.adicionar(trecho(300));
  await t.fila.adicionar(trecho(100));
  await t.fila.adicionar(trecho(200));
  await t.fila.ocioso();
  assert.deepEqual([...t.enviadosOrdem].sort(), [100, 200, 300]);
  assert.equal((await t.armazem.todos()).length, 0);
  assert.equal((await t.fila.estado()).enviados, 3);
});

test("repetido:true tambem apaga", async () => {
  const t = montar([{ status: 200, json: { ok: true, repetido: true } }]);
  await t.fila.adicionar(trecho(1));
  await t.fila.ocioso();
  assert.equal((await t.armazem.todos()).length, 0);
});

test("falha de rede e 5xx: mantem, espera com backoff crescente e tenta de novo", async () => {
  const t = montar(["rede", { status: 503, json: null }, { status: 429, json: null }]);
  await t.fila.adicionar(trecho(1));
  await t.fila.ocioso();
  assert.deepEqual(t.esperas, [2000, 4000, 8000]);
  assert.equal(t.enviadosOrdem.length, 4);
  assert.equal((await t.armazem.todos()).length, 0);
});

test("erro definitivo 3x bloqueia o trecho sem travar os outros", async () => {
  const t = montar([{ status: 415, json: null }, { status: 415, json: null }, { status: 415, json: null }]);
  await t.fila.adicionar(trecho(1));
  await t.fila.ocioso();
  await t.fila.adicionar(trecho(2));
  await t.fila.ocioso();
  const itens = await t.armazem.todos();
  assert.equal(itens.length, 1);
  assert.equal(itens[0].inicioMs, 1);
  assert.equal(itens[0].bloqueado, true);
  const e = await t.fila.estado();
  assert.equal(e.bloqueados, 1);
  assert.equal(e.enviados, 1);
});

test("401 para o envio e mantem tudo guardado; kick() retoma", async () => {
  const t = montar([{ status: 401, json: null }]);
  await t.fila.adicionar(trecho(1));
  await t.fila.ocioso();
  assert.equal((await t.armazem.todos()).length, 1);
  assert.equal((await t.fila.estado()).ultimoErro, "nao_pareado");
  await t.fila.kick();
  assert.equal((await t.armazem.todos()).length, 0);
});

test("sobrevive a recarregar a pagina: nova fila sobre o mesmo armazem envia o que ficou", async () => {
  const armazem = criarArmazemMemoria();
  const a = montar([{ status: 401, json: null }], { armazem });
  await a.fila.adicionar(trecho(5));
  await a.fila.ocioso();
  const b = montar([], { armazem });
  await b.fila.kick();
  assert.deepEqual(b.enviadosOrdem, [5]);
  assert.equal((await armazem.todos()).length, 0);
});

test("teto: nao guarda alem do limite e avisa", async () => {
  const t = montar([{ status: 401, json: null }], { teto: 100 });
  assert.deepEqual(await t.fila.adicionar(trecho(1, 60)), { ok: true });
  await t.fila.ocioso();
  assert.deepEqual(await t.fila.adicionar(trecho(2, 60)), { ok: false, motivo: "cheia" });
  await t.fila.ocioso();
  const e = await t.fila.estado();
  assert.equal(e.naFila, 1);
  assert.equal(e.bytes, 60);
});

test("aoMudar recebe contadores", async () => {
  const vistos = [];
  const t = montar([], { aoMudar: (e) => vistos.push(e) });
  await t.fila.adicionar(trecho(1));
  await t.fila.ocioso();
  const ult = vistos[vistos.length - 1];
  assert.equal(ult.enviados, 1);
  assert.equal(ult.naFila, 0);
  assert.ok(vistos.some((e) => e.naFila === 1));
});
