// Funcoes puras (sem DOM, sem rede): testadas por `node --test`.

export const TRECHO_MS = 60000;
export const TETO_FILA_BYTES = 300 * 1024 * 1024;
export const AMPLITUDE_MAX = 32767; // mesma escala do MediaRecorder.getMaxAmplitude do Android

const MIMES = ["audio/webm;codecs=opus", "audio/webm"];

/** Escolhe o mime de gravacao; null se o navegador nao grava webm/opus. `MR` = MediaRecorder (ou simulado). */
export function escolherMime(MR) {
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  for (const m of MIMES) {
    try { if (MR.isTypeSupported(m)) return m; } catch { /* tenta o proximo */ }
  }
  return null;
}

export function extensaoDoMime(mime) {
  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") return "webm";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mp4") return "m4a";
  return "bin";
}

const p2 = (n) => String(n).padStart(2, "0");

/** Brasilia = UTC-3 fixo (sem horario de verao). Devolve partes. */
export function partesBrasilia(ms) {
  const d = new Date(ms - 3 * 3600 * 1000);
  return {
    ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), sem: d.getUTCDay(),
  };
}

export function dataBrasilia(ms) {
  const t = partesBrasilia(ms);
  return `${t.ano}-${p2(t.mes)}-${p2(t.dia)}`;
}

export function horaBrasilia(ms) {
  const t = partesBrasilia(ms);
  return `${p2(t.h)}:${p2(t.mi)}`;
}

/** Nome do trecho: web_AAAAMMDD_HHMMSS.webm (horario de Brasilia). */
export function nomeTrecho(inicioMs, mime = "audio/webm") {
  const t = partesBrasilia(inicioMs);
  return `web_${t.ano}${p2(t.mes)}${p2(t.dia)}_${p2(t.h)}${p2(t.mi)}${p2(t.s)}.${extensaoDoMime(mime)}`;
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "2026-11-19" -> "19/11/2026 (qui)". Entrada invalida volta como veio. */
export function formatarDia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const sem = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${m[3]}/${m[2]}/${m[1]} (${SEMANA[sem]})`;
}

/** Instante ISO do servidor -> "19/11 14:05" em Brasilia; "" se invalido. */
export function formatarDataHora(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const t = partesBrasilia(ms);
  return `${p2(t.dia)}/${p2(t.mes)} ${p2(t.h)}:${p2(t.mi)}`;
}

/** Milissegundos -> "mm:ss" (ou "h:mm:ss" a partir de 1 h). */
export function formatarTempo(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

export function formatarBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Espera entre tentativas de envio: 2 s, 4 s, 8 s... teto de 60 s. `tentativa` comeca em 1. */
export function backoffMs(tentativa) {
  const n = Math.max(1, Math.floor(Number(tentativa) || 1));
  return Math.min(60000, 2000 * 2 ** (n - 1));
}

/** Codigo de pareamento digitado/colado: maiusculas, sem espacos nem tracos. */
export function normalizarCodigo(txt) {
  return String(txt || "").toUpperCase().replace(/[\s\-_.]/g, "");
}

export function codigoValido(txt) {
  return /^[A-Z0-9]{8}$/.test(normalizarCodigo(txt));
}

/**
 * Mede pico e media como o Android: amostras de amplitude (0..1) a cada ~50 ms; a cada 500 ms fecha-se uma
 * janela e guarda-se o maior valor dela. pico = maior de todas; media = media dos maiores das janelas.
 * Saida na escala 0..32767.
 */
export class MedidorNivel {
  constructor(amostrasPorJanela = 10) {
    this.n = amostrasPorJanela;
    this.zerar();
  }
  zerar() {
    this.atual = 0; this.cont = 0; this.pico = 0; this.soma = 0; this.janelas = 0;
  }
  empurrar(amp) {
    const a = Math.min(1, Math.max(0, Number(amp) || 0));
    if (a > this.atual) this.atual = a;
    this.cont++;
    if (this.cont >= this.n) this.fecharJanela();
  }
  fecharJanela() {
    if (this.cont === 0) return;
    if (this.atual > this.pico) this.pico = this.atual;
    this.soma += this.atual;
    this.janelas++;
    this.atual = 0; this.cont = 0;
  }
  resultado() {
    this.fecharJanela();
    return {
      pico: Math.round(this.pico * AMPLITUDE_MAX),
      media: this.janelas ? Math.round((this.soma / this.janelas) * AMPLITUDE_MAX) : 0,
    };
  }
}

/** Mensagem em portugues para uma resposta de erro da API. `contexto`: "parear" | "geral". */
export function mensagemDeErro(status, contexto = "geral") {
  if (status === 0) return "Sem conexão com o Sêneca agora. Confira a internet e tente de novo.";
  if (contexto === "parear") {
    if (status === 429) return "Muitas tentativas. Espere 10 minutos e tente de novo.";
    if (status === 400 || status === 401 || status === 404) return "Código inválido ou vencido. Gere um código novo e tente de novo.";
  }
  if (status === 401) return "Este navegador não está mais pareado. Pareie de novo com um código novo.";
  if (status === 429) return "Muitos pedidos em pouco tempo. Espere alguns minutos e tente de novo.";
  if (status === 413) return "O arquivo é grande demais para o servidor.";
  if (status === 415) return "O servidor não aceitou o formato do áudio.";
  if (status === 404) return "Não encontrado no servidor.";
  if (status >= 500) return "O servidor está com problema agora. Tente de novo em alguns minutos.";
  return `Não deu certo (erro ${status}). Tente de novo.`;
}

// ---------------------------------------------------------------- mini-markdown
// Produz uma arvore de dados (nunca HTML). Quem desenha usa textContent; por isso nada vindo do servidor
// vira marcacao. `blocosParaHtml` existe so como forma textual com escape (e para teste).

export function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Inline: **negrito**, *italico*, `codigo`. Sem links, sem aninhamento. -> [{t:'texto'|'b'|'i'|'cod', v}] */
export function parseInline(txt) {
  const out = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;
  let ult = 0;
  let m;
  const s = String(txt);
  while ((m = re.exec(s))) {
    if (m.index > ult) out.push({ t: "texto", v: s.slice(ult, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ t: "b", v: tok.slice(2, -2) });
    else if (tok.startsWith("`")) out.push({ t: "cod", v: tok.slice(1, -1) });
    else out.push({ t: "i", v: tok.slice(1, -1) });
    ult = m.index + tok.length;
  }
  if (ult < s.length) out.push({ t: "texto", v: s.slice(ult) });
  return out;
}

/** Blocos: {t:'h',n,v} | {t:'p',v} | {t:'ul',itens} | {t:'ol',itens} | {t:'hr'} | {t:'pre',v}; v/itens sao texto cru. */
export function parseMarkdown(md) {
  const linhas = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocos = [];
  let par = [];
  let lista = null;
  let cerca = null;
  const fechaPar = () => { if (par.length) { blocos.push({ t: "p", v: par.join(" ") }); par = []; } };
  const fechaLista = () => { if (lista) { blocos.push(lista); lista = null; } };
  for (const bruta of linhas) {
    if (cerca) {
      if (/^\s*```/.test(bruta)) { blocos.push({ t: "pre", v: cerca.join("\n") }); cerca = null; } else cerca.push(bruta);
      continue;
    }
    const l = bruta.replace(/\s+$/, "");
    if (/^\s*```/.test(l)) { fechaPar(); fechaLista(); cerca = []; continue; }
    if (l.trim() === "") { fechaPar(); fechaLista(); continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { fechaPar(); fechaLista(); blocos.push({ t: "h", n: m[1].length, v: m[2] }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { fechaPar(); fechaLista(); blocos.push({ t: "hr" }); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(l))) {
      fechaPar();
      if (!lista || lista.t !== "ul") { fechaLista(); lista = { t: "ul", itens: [] }; }
      lista.itens.push(m[1]);
      continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) {
      fechaPar();
      if (!lista || lista.t !== "ol") { fechaLista(); lista = { t: "ol", itens: [] }; }
      lista.itens.push(m[1]);
      continue;
    }
    fechaLista();
    par.push(l.trim());
  }
  if (cerca) blocos.push({ t: "pre", v: cerca.join("\n") });
  fechaPar(); fechaLista();
  return blocos;
}

function inlineHtml(txt) {
  return parseInline(txt).map((x) => {
    const v = escaparHtml(x.v);
    return x.t === "b" ? `<strong>${v}</strong>` : x.t === "i" ? `<em>${v}</em>` : x.t === "cod" ? `<code>${v}</code>` : v;
  }).join("");
}

export function blocosParaHtml(blocos) {
  return blocos.map((b) => {
    if (b.t === "h") return `<h${b.n}>${inlineHtml(b.v)}</h${b.n}>`;
    if (b.t === "p") return `<p>${inlineHtml(b.v)}</p>`;
    if (b.t === "hr") return "<hr>";
    if (b.t === "pre") return `<pre>${escaparHtml(b.v)}</pre>`;
    return `<${b.t}>${b.itens.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${b.t}>`;
  }).join("");
}

/** Texto para o sintetizador de voz: tira marcas de markdown. */
export function textoParaFala(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*#_>]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
