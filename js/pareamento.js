import { codigoValido, normalizarCodigo, mensagemDeErro } from "./puro.js";

/** Tela de pareamento. aoPareado() e chamado depois que o token foi guardado. */
export function iniciarPareamento({ api, aoPareado }) {
  const form = document.getElementById("form-parear");
  const campo = document.getElementById("codigo");
  const msg = document.getElementById("parear-msg");
  const botao = document.getElementById("parear-botao");

  campo.addEventListener("input", () => {
    const pos = campo.selectionStart;
    campo.value = normalizarCodigo(campo.value).slice(0, 8);
    try { campo.setSelectionRange(pos, pos); } catch { /* nada */ }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const codigo = normalizarCodigo(campo.value);
    if (!codigoValido(codigo)) {
      msg.textContent = "O código tem 8 letras e números. Confira e digite de novo.";
      return;
    }
    botao.disabled = true;
    msg.textContent = "Pareando...";
    const r = await api.parear(codigo);
    botao.disabled = false;
    if (r.ok) {
      campo.value = "";
      msg.textContent = "";
      aoPareado();
    } else {
      msg.textContent = mensagemDeErro(r.status, "parear");
    }
  });

  return { mostrarAviso(t) { msg.textContent = t; } };
}
