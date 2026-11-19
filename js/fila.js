// Fila de envio de trechos. Armazenamento trocavel: IndexedDB no navegador, memoria nos testes.
import { backoffMs, TETO_FILA_BYTES } from "./puro.js";

/** Armazem em memoria (testes). */
export function criarArmazemMemoria() {
  const m = new Map();
  let seq = 0;
  return {
    async adicionar(item) { const id = ++seq; m.set(id, { ...item, id }); return id; },
    async todos() { return [...m.values()].map((x) => ({ ...x })); },
    async atualizar(id, parte) { if (m.has(id)) m.set(id, { ...m.get(id), ...parte }); },
    async apagar(id) { m.delete(id); },
  };
}

/** Armazem em IndexedDB: um objeto por trecho, com o Blob dentro. */
export function criarArmazemIDB(idb = globalThis.indexedDB, nome = "seneca-web", loja = "fila") {
  let dbp = null;
  const abrir = () => {
    if (!dbp) {
      dbp = new Promise((ok, falha) => {
        const rq = idb.open(nome, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(loja, { keyPath: "id", autoIncrement: true });
        rq.onsuccess = () => ok(rq.result);
        rq.onerror = () => { dbp = null; falha(rq.error); };
      });
    }
    return dbp;
  };
  const tx = async (modo, fn) => {
    const db = await abrir();
    return new Promise((ok, falha) => {
      const t = db.transaction(loja, modo);
      const s = t.objectStore(loja);
      let res;
      const rq = fn(s);
      if (rq) rq.onsuccess = () => { res = rq.result; };
      t.oncomplete = () => ok(res);
      t.onerror = () => falha(t.error);
      t.onabort = () => falha(t.error);
    });
  };
  return {
    adicionar: (item) => tx("readwrite", (s) => s.add(item)),
    todos: () => tx("readonly", (s) => s.getAll()),
    async atualizar(id, parte) {
      const db = await abrir();
      return new Promise((ok, falha) => {
        const t = db.transaction(loja, "readwrite");
        const s = t.objectStore(loja);
        const g = s.get(id);
        g.onsuccess = () => { if (g.result) s.put({ ...g.result, ...parte }); };
        t.oncomplete = () => ok();
        t.onerror = () => falha(t.error);
      });
    },
    apagar: (id) => tx("readwrite", (s) => s.delete(id)),
  };
}

const ERROS_DEFINITIVOS = new Set([400, 413, 415]);

/**
 * Fila: adicionar() guarda e dispara o envio sequencial (mais antigo primeiro). So apaga depois de 200.
 * Falha de rede / 5xx / 429: backoff e tenta de novo. 400/413/415 repetidos 3x: o trecho fica guardado como
 * "bloqueado" (nao trava os demais). 401: para (a pagina volta ao pareamento; o envio recomeca com kick()).
 */
export function criarFila({ armazem, api, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), teto = TETO_FILA_BYTES, aoMudar = () => {} }) {
  let rodando = false;
  let parado = false;
  let falhas = 0;
  let enviados = 0;
  let ultimoErro = "";
  let enviando = false;

  async function estado() {
    const itens = await armazem.todos();
    const bytes = itens.reduce((a, i) => a + (i.tamanho || 0), 0);
    return {
      naFila: itens.filter((i) => !i.bloqueado).length,
      bloqueados: itens.filter((i) => i.bloqueado).length,
      bytes, enviados, enviando, falhas, ultimoErro,
      cheia: bytes >= teto,
    };
  }
  const avisar = async () => { try { aoMudar(await estado()); } catch { /* nada */ } };

  async function drenar() {
    if (rodando) return;
    rodando = true;
    parado = false;
    try {
      while (!parado) {
        const itens = (await armazem.todos()).filter((i) => !i.bloqueado).sort((a, b) => a.inicioMs - b.inicioMs);
        if (!itens.length) break;
        const it = itens[0];
        enviando = true;
        await avisar();
        const r = await api.ingest(it);
        enviando = false;
        if (r.status === 200 && r.json && r.json.ok !== false) {
          await armazem.apagar(it.id); // inclui repetido:true (o servidor ja tem)
          enviados++; falhas = 0; ultimoErro = "";
        } else if (r.status === 401) {
          ultimoErro = "nao_pareado";
          await avisar();
          break;
        } else if (ERROS_DEFINITIVOS.has(r.status)) {
          const t = (it.tentativas || 0) + 1;
          await armazem.atualizar(it.id, { tentativas: t, bloqueado: t >= 3 });
          ultimoErro = `http_${r.status}`;
        } else {
          falhas++;
          ultimoErro = r.status === 0 ? "sem_rede" : `http_${r.status}`;
          await avisar();
          await dormir(backoffMs(falhas));
        }
        await avisar();
      }
    } finally {
      enviando = false;
      rodando = false;
      await avisar();
    }
  }

  return {
    estado,
    /** {ok:true} ou {ok:false, motivo:'cheia'} (o trecho NAO foi guardado). */
    async adicionar(item) {
      const e = await estado();
      const tamanho = item.blob && item.blob.size ? item.blob.size : 0;
      if (e.bytes + tamanho > teto) { await avisar(); return { ok: false, motivo: "cheia" }; }
      await armazem.adicionar({ ...item, tamanho, tentativas: 0, bloqueado: false });
      await avisar();
      drenar();
      return { ok: true };
    },
    kick() { return drenar(); },
    parar() { parado = true; },
    /** Espera o fim do envio atual (testes). */
    async ocioso() { while (rodando) await new Promise((r) => setTimeout(r, 1)); },
  };
}
