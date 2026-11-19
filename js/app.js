import { URL_FUNCAO } from "../config.js";
import { criarApi, criarTokenStore } from "./api.js";
import { criarFila, criarArmazemIDB } from "./fila.js";
import { iniciarPareamento } from "./pareamento.js";
import { iniciarChat } from "./chat.js";
import { iniciarGravador } from "./gravador.js";
import { iniciarResumos } from "./resumos.js";

const $ = (id) => document.getElementById(id);
const telaParear = $("tela-parear");
const telaApp = $("tela-app");
const abas = ["conversar", "gravar", "resumos"];

let pareamento;
let chat;
let resumos;
let gravador;
let chatCarregado = false;

function mostrarAba(nome) {
  for (const a of abas) {
    $(`aba-${a}`).hidden = a !== nome;
    const b = $(`tab-${a}`);
    b.classList.toggle("ativa", a === nome);
    b.setAttribute("aria-selected", a === nome ? "true" : "false");
  }
  if (nome === "conversar" && !chatCarregado) { chatCarregado = true; chat.carregar(); }
  if (nome === "resumos") resumos.carregarLista();
}

function mostrarPareamento(aviso) {
  telaApp.hidden = true;
  telaParear.hidden = false;
  chatCarregado = false;
  if (chat) chat.limpar();
  if (resumos) resumos.limpar();
  if (aviso) pareamento.mostrarAviso(aviso);
}

function mostrarApp() {
  telaParear.hidden = true;
  telaApp.hidden = false;
  mostrarAba("conversar");
}

const tokens = criarTokenStore(window.localStorage);
let fila;
const api = criarApi({
  baseUrl: URL_FUNCAO,
  fetchFn: (...a) => fetch(...a),
  tokens,
  aoNaoAutorizado: () => {
    if (fila) fila.parar();
    if (gravador && gravador.estaGravando()) gravador.pararSeGravando();
    mostrarPareamento("Este navegador não está mais pareado. Gere um código novo e pareie de novo. Os trechos já gravados continuam guardados.");
  },
});

fila = criarFila({
  armazem: criarArmazemIDB(),
  api,
  aoMudar: (e) => { if (gravador) gravador.atualizarFila(e); },
});

pareamento = iniciarPareamento({ api, aoPareado: () => { mostrarApp(); fila.kick(); } });
chat = iniciarChat({ api });
resumos = iniciarResumos({ api });
gravador = iniciarGravador({ fila });

for (const a of abas) $(`tab-${a}`).addEventListener("click", () => mostrarAba(a));

// menu
const menu = $("menu");
$("menu-botao").addEventListener("click", () => { menu.hidden = !menu.hidden; });
$("menu-desparear").addEventListener("click", () => {
  if (window.confirm("Desparear este navegador? Para voltar a usar, você precisará de um código novo. Trechos ainda na fila continuam guardados.")) {
    if (gravador.estaGravando()) gravador.pararSeGravando();
    fila.parar();
    tokens.clear();
    menu.hidden = true;
    mostrarPareamento("Navegador despareado.");
  }
});

window.addEventListener("online", () => { if (tokens.get()) fila.kick(); });

if (tokens.get()) { mostrarApp(); fila.kick(); fila.estado().then((e) => gravador.atualizarFila(e)).catch(() => {}); }
else mostrarPareamento("");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* sem service worker a pagina funciona igual */ });
}
