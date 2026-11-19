// Resumos dos dias. Tudo fica so na memoria da pagina: nada do servidor vai para localStorage/IndexedDB/cache.
import { formatarDia, horaBrasilia, mensagemDeErro } from "./puro.js";
import { renderizarMarkdown } from "./render.js";

export function iniciarResumos({ api }) {
  const vistaLista = document.getElementById("res-lista-vista");
  const lista = document.getElementById("res-lista");
  const vistaDia = document.getElementById("res-dia-vista");
  const titulo = document.getElementById("res-titulo");
  const corpo = document.getElementById("res-corpo");
  const botTexto = document.getElementById("res-ver-texto");
  const botMais = document.getElementById("res-mais-texto");
  const textoEl = document.getElementById("res-texto");
  const voltar = document.getElementById("res-voltar");
  const aviso = document.getElementById("res-aviso");

  let diaAtual = "";
  let proximoMs = null;
  let carregandoTexto = false;

  const mostrarAviso = (t) => { aviso.textContent = t || ""; aviso.hidden = !t; };

  function irParaLista() {
    vistaDia.hidden = true;
    vistaLista.hidden = false;
    diaAtual = "";
    corpo.textContent = "";
    textoEl.textContent = "";
    textoEl.hidden = true;
    botMais.hidden = true;
    proximoMs = null;
  }
  voltar.addEventListener("click", () => { mostrarAviso(""); irParaLista(); });

  async function carregarLista() {
    mostrarAviso("");
    irParaLista();
    lista.textContent = "";
    const carregando = document.createElement("p");
    carregando.className = "vazio";
    carregando.textContent = "Carregando…";
    lista.appendChild(carregando);
    const r = await api.dias(60);
    lista.textContent = "";
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.dias)) {
      if (r.status !== 401) mostrarAviso(mensagemDeErro(r.status));
      return;
    }
    if (!r.json.dias.length) {
      const p = document.createElement("p");
      p.className = "vazio";
      p.textContent = "Ainda não há resumos de dias.";
      lista.appendChild(p);
      return;
    }
    for (const d of r.json.dias) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "item-dia";
      const t = document.createElement("strong");
      t.textContent = formatarDia(d.dia);
      const s = document.createElement("span");
      const partes = [];
      if (Number.isFinite(Number(d.trechos))) partes.push(`${d.trechos} trechos`);
      if (Number.isFinite(Number(d.minutos_fala))) partes.push(`${Math.round(Number(d.minutos_fala))} min de fala`);
      s.textContent = partes.join(" · ");
      b.append(t, s);
      b.addEventListener("click", () => abrirDia(String(d.dia)));
      lista.appendChild(b);
    }
  }

  async function abrirDia(dia) {
    mostrarAviso("");
    vistaLista.hidden = true;
    vistaDia.hidden = false;
    diaAtual = dia;
    titulo.textContent = formatarDia(dia);
    corpo.textContent = "Carregando…";
    textoEl.textContent = "";
    textoEl.hidden = true;
    botMais.hidden = true;
    botTexto.hidden = false;
    const r = await api.dia(dia);
    if (diaAtual !== dia) return;
    corpo.textContent = "";
    if (r.status === 200 && r.json && typeof r.json.texto_md === "string") {
      corpo.appendChild(renderizarMarkdown(document, r.json.texto_md));
    } else if (r.status === 404) {
      corpo.textContent = "Este dia não tem resumo ainda.";
    } else if (r.status !== 401) {
      corpo.textContent = mensagemDeErro(r.status);
    }
  }

  async function carregarTexto(reiniciar) {
    if (carregandoTexto || !diaAtual) return;
    carregandoTexto = true;
    const dia = diaAtual;
    if (reiniciar) { textoEl.textContent = ""; proximoMs = 0; }
    textoEl.hidden = false;
    botTexto.hidden = true;
    const r = await api.diaTexto(dia, proximoMs || 0);
    carregandoTexto = false;
    if (dia !== diaAtual) return;
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.trechos)) {
      if (r.status !== 401) mostrarAviso(mensagemDeErro(r.status));
      botTexto.hidden = false;
      return;
    }
    if (!r.json.trechos.length && !textoEl.firstChild) {
      const p = document.createElement("p");
      p.className = "vazio";
      p.textContent = "Nenhum trecho transcrito neste dia.";
      textoEl.appendChild(p);
    }
    for (const t of r.json.trechos) {
      const p = document.createElement("p");
      p.className = "trecho";
      const h = document.createElement("span");
      h.className = "hora";
      h.textContent = Number.isFinite(Number(t.inicio_ms)) ? horaBrasilia(Number(t.inicio_ms)) : "";
      p.append(h, document.createTextNode(" " + String(t.texto || "")));
      textoEl.appendChild(p);
    }
    proximoMs = Number.isFinite(Number(r.json.proximo_ms)) && r.json.proximo_ms !== null ? Number(r.json.proximo_ms) : null;
    botMais.hidden = proximoMs === null;
  }

  botTexto.addEventListener("click", () => carregarTexto(true));
  botMais.addEventListener("click", () => carregarTexto(false));

  return {
    carregarLista,
    limpar() { lista.textContent = ""; irParaLista(); },
  };
}
