import { aguardarResposta } from "./api.js";
import { mensagemDeErro, formatarDataHora, textoParaFala } from "./puro.js";
import { renderizarMarkdown } from "./render.js";

const CHAVE_FALA = "seneca_web_ouvir";

function lerFala() { try { return localStorage.getItem(CHAVE_FALA) === "1"; } catch { return false; } }
function gravarFala(v) { try { localStorage.setItem(CHAVE_FALA, v ? "1" : "0"); } catch { /* nada */ } }

export function iniciarChat({ api }) {
  const lista = document.getElementById("chat-lista");
  const form = document.getElementById("chat-form");
  const texto = document.getElementById("chat-texto");
  const enviar = document.getElementById("chat-enviar");
  const voz = document.getElementById("chat-voz");
  const ouvir = document.getElementById("chat-ouvir");
  const aviso = document.getElementById("chat-aviso");

  let ocupado = false;
  let geracao = 0; // muda ao despareiar/recarregar: cancela esperas antigas
  let ouvirOn = lerFala();
  ouvir.checked = ouvirOn;
  ouvir.addEventListener("change", () => {
    ouvirOn = ouvir.checked;
    gravarFala(ouvirOn);
    if (!ouvirOn && "speechSynthesis" in window) speechSynthesis.cancel();
  });

  function rolarAoFim() { lista.scrollTop = lista.scrollHeight; }

  function balao(classe, conteudo, quando) {
    const d = document.createElement("div");
    d.className = `balao ${classe}`;
    if (typeof conteudo === "string") d.textContent = conteudo; else d.appendChild(conteudo);
    if (quando) {
      const h = document.createElement("span");
      h.className = "hora";
      h.textContent = quando;
      d.appendChild(h);
    }
    lista.appendChild(d);
    return d;
  }

  function balaoResposta(md, quando) {
    const corpo = document.createElement("div");
    corpo.appendChild(renderizarMarkdown(document, md));
    return balao("sen", corpo, quando);
  }

  function pensando() { return balao("sen pensando", "Pensando…"); }

  function falar(md) {
    if (!ouvirOn || !("speechSynthesis" in window)) return;
    const t = textoParaFala(md);
    if (!t) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = "pt-BR";
      speechSynthesis.speak(u);
    } catch { /* nada */ }
  }

  function mostrarAviso(t) { aviso.textContent = t || ""; aviso.hidden = !t; }

  async function esperar(id, balaoPensando) {
    const minha = geracao;
    const r = await aguardarResposta(api, id, {
      cancelado: () => minha !== geracao,
    });
    if (minha !== geracao) return;
    balaoPensando.remove();
    if (r.status === "pronto") {
      balaoResposta(r.resposta || "(resposta vazia)");
      falar(r.resposta);
    } else if (r.status === "erro") {
      balao("sen erro", "O Sêneca não conseguiu responder a esta pergunta. Tente de novo ou reformule.");
    } else if (r.status === "tempo") {
      balao("sen erro", "A resposta está demorando mais de 5 minutos. Abra a aba Conversar de novo daqui a pouco para ver se ela chegou.");
    }
    rolarAoFim();
  }

  async function carregar() {
    geracao++;
    lista.textContent = "";
    mostrarAviso("");
    const r = await api.conversa(40);
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.mensagens)) {
      if (r.status !== 401) mostrarAviso(mensagemDeErro(r.status) + " (não deu para carregar a conversa)");
      if (!lista.firstChild) balao("sen", "Pergunte qualquer coisa sobre o que foi gravado.");
      return;
    }
    let ultimaAberta = null;
    for (const m of r.json.mensagens) {
      if (!m || !m.id) continue;
      balao("eu", String(m.pergunta || ""), formatarDataHora(m.criado_em));
      if (m.status === "pronto") balaoResposta(String(m.resposta || ""), formatarDataHora(m.respondido_em));
      else if (m.status === "erro") balao("sen erro", "Esta pergunta deu erro no servidor.");
      else ultimaAberta = m;
    }
    if (!lista.firstChild) balao("sen", "Pergunte qualquer coisa sobre o que foi gravado.");
    if (ultimaAberta) esperar(ultimaAberta.id, pensando());
    rolarAoFim();
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pergunta = texto.value.trim();
    if (!pergunta || ocupado) return;
    if ([...pergunta].length > 2000) { mostrarAviso("A pergunta passa de 2000 caracteres. Encurte e envie de novo."); return; }
    ocupado = true;
    enviar.disabled = true;
    mostrarAviso("");
    balao("eu", pergunta);
    const p = pensando();
    rolarAoFim();
    const r = await api.perguntar(pergunta, 12);
    if (r.status === 200 && r.json && r.json.id) {
      texto.value = "";
      await esperar(String(r.json.id), p);
    } else {
      p.remove();
      mostrarAviso(r.status === 429
        ? "Você já tem perguntas demais abertas ou fez muitas na última hora. Espere um pouco e envie de novo."
        : mensagemDeErro(r.status));
    }
    ocupado = false;
    enviar.disabled = false;
  });

  // ditado por voz
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    voz.hidden = true;
  } else {
    let rec = null;
    voz.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = "pt-BR";
      rec.interimResults = true;
      rec.continuous = false;
      const base = texto.value ? texto.value.replace(/\s*$/, " ") : "";
      rec.onresult = (e) => {
        let t = "";
        for (const r of e.results) t += r[0].transcript;
        texto.value = base + t;
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed") mostrarAviso("O navegador não deixou usar o microfone para ditar. Libere o microfone nas configurações do site.");
        else if (e.error !== "aborted" && e.error !== "no-speech") mostrarAviso("O ditado falhou. Digite a pergunta ou tente de novo.");
      };
      rec.onend = () => { rec = null; voz.classList.remove("ativo"); voz.textContent = "Ditar"; };
      voz.classList.add("ativo");
      voz.textContent = "Parar ditado";
      try { rec.start(); } catch { rec = null; voz.classList.remove("ativo"); voz.textContent = "Ditar"; }
    });
  }

  return {
    carregar,
    limpar() { geracao++; lista.textContent = ""; },
  };
}
