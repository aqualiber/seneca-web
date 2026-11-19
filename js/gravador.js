// Gravador: ciclo "grava 60 s -> fecha -> enfileira -> novo trecho". Cada trecho e um webm/opus completo
// (um MediaRecorder novo por trecho, sem timeslice). O proximo comeca ANTES de fechar o anterior (sem buraco).
import { TRECHO_MS, escolherMime, nomeTrecho, MedidorNivel, formatarTempo, formatarBytes, horaBrasilia } from "./puro.js";

const MIN_TRECHO_MS = 1500;

export function iniciarGravador({ fila }) {
  const botao = document.getElementById("grav-botao");
  const estadoEl = document.getElementById("grav-estado");
  const tempoEl = document.getElementById("grav-tempo");
  const avisoEl = document.getElementById("grav-aviso");
  const bgEl = document.getElementById("grav-segundo-plano");
  const cEnviados = document.getElementById("grav-enviados");
  const cFila = document.getElementById("grav-fila");
  const cBytes = document.getElementById("grav-bytes");
  const filaAviso = document.getElementById("grav-fila-aviso");

  let gravando = false;
  let parando = false;
  let stream = null;
  let ctx = null;
  let analisador = null;
  let buffer = null;
  let atual = null;
  let mime = null;
  let inicioGeralMs = 0;
  let timerRelogio = null;
  let timerNivel = null;
  let wake = null;
  let perdidos = 0;

  const aviso = (t) => { avisoEl.textContent = t || ""; avisoEl.hidden = !t; };

  function atualizarTela() {
    botao.textContent = gravando ? "Parar" : "Gravar";
    botao.classList.toggle("gravando", gravando);
    estadoEl.textContent = gravando ? "Gravando" : "Parado";
    if (!gravando) tempoEl.textContent = "00:00";
  }

  async function pedirWake() {
    try {
      if ("wakeLock" in navigator && gravando && document.visibilityState === "visible") {
        wake = await navigator.wakeLock.request("screen");
        wake.addEventListener("release", () => { wake = null; });
      }
    } catch { wake = null; }
  }

  function aoMudarVisibilidade() {
    if (!gravando) return;
    if (document.visibilityState === "hidden") {
      bgEl.hidden = false;
      bgEl.textContent = `A página foi para segundo plano às ${horaBrasilia(Date.now())}. A gravação pode parar com a tela apagada: volte a este app e confira.`;
    } else {
      bgEl.textContent = bgEl.textContent.replace(/^A página foi/, "A página ficou") + " (voltou agora)";
      pedirWake();
    }
  }
  document.addEventListener("visibilitychange", aoMudarVisibilidade);
  window.addEventListener("beforeunload", (e) => {
    if (gravando) { e.preventDefault(); e.returnValue = ""; }
  });

  function novoSegmento() {
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    const seg = { rec, chunks: [], inicioMs: Date.now(), medidor: new MedidorNivel(), timer: null, ultimo: false };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) seg.chunks.push(e.data); };
    rec.onstop = () => fechar(seg);
    rec.onerror = () => { aviso("O gravador falhou. O trecho em curso foi fechado; toque em Gravar para recomeçar."); parar(); };
    rec.start(); // sem timeslice: o arquivo sai inteiro e autocontido no stop()
    seg.timer = setTimeout(girar, TRECHO_MS);
    atual = seg;
    return seg;
  }

  function girar() {
    if (!gravando || parando) return;
    const velho = atual;
    try { novoSegmento(); } catch { aviso("Não deu para abrir o próximo trecho. Toque em Gravar para recomeçar."); parar(); return; }
    try { if (velho.rec.state !== "inactive") velho.rec.stop(); } catch { /* ja parou */ }
  }

  async function fechar(seg) {
    clearTimeout(seg.timer);
    const duracaoMs = Date.now() - seg.inicioMs;
    const blob = new Blob(seg.chunks, { type: mime });
    seg.chunks = [];
    const { pico, media } = seg.medidor.resultado();
    if (blob.size > 0 && duracaoMs >= MIN_TRECHO_MS) {
      const r = await fila.adicionar({ blob, mime, inicioMs: seg.inicioMs, duracaoMs, pico, media, nome: nomeTrecho(seg.inicioMs, mime) });
      if (!r.ok) { perdidos++; aviso(`A fila está cheia (limite de 300 MB): ${perdidos} trecho(s) NÃO foram guardados. Conecte-se à internet para esvaziar a fila.`); }
    }
    if (parando && seg === atual) liberar();
  }

  function liberar() {
    clearInterval(timerRelogio);
    clearInterval(timerNivel);
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch { /* nada */ }
    try { if (ctx) ctx.close(); } catch { /* nada */ }
    try { if (wake) wake.release(); } catch { /* nada */ }
    stream = ctx = analisador = buffer = wake = atual = null;
    gravando = false;
    parando = false;
    bgEl.hidden = true;
    atualizarTela();
  }

  function amplitude() {
    analisador.getFloatTimeDomainData(buffer);
    let m = 0;
    for (let i = 0; i < buffer.length; i++) { const v = Math.abs(buffer[i]); if (v > m) m = v; }
    return m;
  }

  async function iniciar() {
    aviso("");
    perdidos = 0;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      aviso("Este navegador não grava áudio. Use o Chrome atualizado."); return;
    }
    mime = escolherMime(MediaRecorder);
    if (!mime) { aviso("Este navegador não grava em webm/opus. Use o Chrome atualizado no Android."); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch (e) {
      aviso(e && e.name === "NotAllowedError"
        ? "O microfone foi bloqueado. Toque no cadeado ao lado do endereço, libere o microfone e tente de novo."
        : "Não consegui abrir o microfone. Veja se outro app o está usando e tente de novo.");
      stream = null; return;
    }
    gravando = true;
    parando = false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      analisador = ctx.createAnalyser();
      analisador.fftSize = 2048;
      buffer = new Float32Array(analisador.fftSize);
      ctx.createMediaStreamSource(stream).connect(analisador); // nao liga na saida: sem eco
      timerNivel = setInterval(() => { if (atual && analisador) atual.medidor.empurrar(amplitude()); }, 50);
    } catch { /* sem medidor: pico e media ficam 0 */ }
    stream.getAudioTracks().forEach((t) => t.addEventListener("ended", () => {
      if (gravando) { aviso("O microfone foi interrompido (ligação ou outro app). A gravação parou; toque em Gravar para recomeçar."); parar(); }
    }));
    inicioGeralMs = Date.now();
    try { novoSegmento(); } catch { aviso("Não deu para iniciar a gravação."); liberar(); return; }
    timerRelogio = setInterval(() => {
      tempoEl.textContent = formatarTempo(Date.now() - inicioGeralMs);
    }, 1000);
    await pedirWake();
    atualizarTela();
  }

  function parar() {
    if (!gravando || parando) return;
    parando = true;
    const seg = atual;
    clearTimeout(seg.timer);
    try {
      if (seg.rec.state !== "inactive") seg.rec.stop(); else liberar();
    } catch { liberar(); }
  }

  botao.addEventListener("click", () => { if (gravando) parar(); else iniciar(); });
  atualizarTela();

  return {
    atualizarFila(e) {
      cEnviados.textContent = String(e.enviados);
      cFila.textContent = String(e.naFila + e.bloqueados);
      cBytes.textContent = formatarBytes(e.bytes);
      const msgs = [];
      if (e.cheia) msgs.push("Fila cheia (300 MB). Novos trechos não serão guardados até enviar os atuais.");
      if (e.bloqueados) msgs.push(`${e.bloqueados} trecho(s) foram recusados pelo servidor e ficaram guardados neste navegador.`);
      if (e.ultimoErro === "sem_rede") msgs.push("Sem conexão: os trechos ficam guardados e serão enviados quando a internet voltar.");
      else if (e.ultimoErro === "nao_pareado") msgs.push("Navegador não pareado: pareie de novo para enviar a fila.");
      else if (e.ultimoErro && e.ultimoErro.startsWith("http_")) msgs.push(`O servidor respondeu com erro (${e.ultimoErro.slice(5)}); vou tentar de novo.`);
      filaAviso.textContent = msgs.join(" ");
      filaAviso.hidden = msgs.length === 0;
    },
    estaGravando: () => gravando,
    pararSeGravando: () => parar(),
  };
}
