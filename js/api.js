// Cliente da funcao `api`. Recebe fetch e armazenamento do token por injecao (testavel em Node).
// Nunca registra token, corpo ou resposta em console.

const CHAVE_TOKEN = "seneca_web_token";

/** Armazenamento do token no localStorage; so o token. Falha em silencio (modo privado, bloqueio). */
export function criarTokenStore(storage) {
  return {
    get() { try { return storage.getItem(CHAVE_TOKEN) || ""; } catch { return ""; } },
    set(t) { try { storage.setItem(CHAVE_TOKEN, t); return true; } catch { return false; } },
    clear() { try { storage.removeItem(CHAVE_TOKEN); } catch { /* nada */ } },
  };
}

/**
 * Resultado de toda chamada: {status, json}. status 0 = sem rede. Em 401 de rota com token: apaga o token e
 * chama aoNaoAutorizado.
 */
export function criarApi({ baseUrl, fetchFn, tokens, aoNaoAutorizado = () => {} }) {
  const base = String(baseUrl).replace(/\/+$/, "");

  async function chamar(rota, { metodo = "GET", corpo, cabecalhos = {}, comToken = true } = {}) {
    const h = { accept: "application/json", ...cabecalhos };
    if (comToken) {
      const t = tokens.get();
      if (!t) {
        aoNaoAutorizado();
        return { status: 401, json: { ok: false, erro: "sem_token" } };
      }
      h["x-device-token"] = t;
    }
    let r;
    try {
      r = await fetchFn(base + rota, { method: metodo, headers: h, body: corpo, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    } catch {
      return { status: 0, json: null };
    }
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    if (r.status === 401 && comToken) {
      tokens.clear();
      aoNaoAutorizado();
    }
    return { status: r.status, json };
  }

  const postJson = (rota, obj, comToken = true) =>
    chamar(rota, { metodo: "POST", corpo: JSON.stringify(obj), cabecalhos: { "content-type": "application/json; charset=utf-8" }, comToken });

  return {
    chamar,

    /** Pareia e guarda o token. Devolve {status, json, ok}. */
    async parear(codigo) {
      const r = await postJson("/parear", {
        codigo, nome: "Navegador do Túlio", modelo: "Chrome Android", android: "web", versao_app: "web-1.0.0",
      }, false);
      const token = r.json && typeof r.json.token === "string" ? r.json.token : "";
      if (r.status === 200 && token) {
        tokens.set(token);
        return { ...r, ok: true };
      }
      return { ...r, ok: false };
    },

    conversa: (limite = 40) => chamar(`/conversa?limite=${limite}`),
    perguntar: (pergunta, horas = 12) => postJson("/perguntar", { pergunta, horas }),
    resposta: (id) => chamar(`/resposta?id=${encodeURIComponent(id)}`),
    dias: (limite = 60) => chamar(`/dias?limite=${limite}`),
    dia: (data) => chamar(`/dia?data=${encodeURIComponent(data)}`),
    diaTexto: (data, aposMs = 0) => chamar(`/dia/texto?data=${encodeURIComponent(data)}&apos_ms=${Math.floor(aposMs)}`),

    /** Envia um trecho de audio (corpo cru). `item`: {blob, mime, inicioMs, duracaoMs, pico, media, nome}. */
    ingest(item) {
      return chamar("/ingest", {
        metodo: "POST",
        corpo: item.blob,
        cabecalhos: {
          "content-type": item.mime || "audio/webm",
          "x-inicio-ms": String(Math.floor(item.inicioMs)),
          "x-duracao-ms": String(Math.max(0, Math.floor(item.duracaoMs || 0))),
          "x-pico": String(Math.floor(item.pico || 0)),
          "x-media": String(Math.floor(item.media || 0)),
          "x-origem": "web",
          "x-nome-arquivo": encodeURIComponent(item.nome || "trecho.webm"),
        },
      });
    },
  };
}

/**
 * Consulta /resposta a cada passoMs ate `pronto`/`erro` ou ate max tentativas (100 x 3 s = 5 min).
 * Falha de rede passageira nao interrompe. 401 interrompe. Devolve {status:'pronto'|'erro'|'tempo'|'nao_autorizado', ...}.
 */
export async function aguardarResposta(api, id, { passoMs = 3000, max = 100, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), aoPassar = () => {}, cancelado = () => false } = {}) {
  for (let i = 0; i < max; i++) {
    if (cancelado()) return { status: "cancelado" };
    await dormir(passoMs);
    if (cancelado()) return { status: "cancelado" };
    const r = await api.resposta(id);
    if (r.status === 401) return { status: "nao_autorizado" };
    if (r.status === 200 && r.json) {
      const st = r.json.status;
      if (st === "pronto") return { status: "pronto", resposta: String(r.json.resposta || "") };
      if (st === "erro") return { status: "erro", erro: String(r.json.erro || "") };
      aoPassar(st);
    }
  }
  return { status: "tempo" };
}
