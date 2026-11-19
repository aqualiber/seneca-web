// Desenha markdown (ja parseado por puro.js) com nos DOM e textContent. Nenhum innerHTML.
import { parseMarkdown, parseInline } from "./puro.js";

function inline(doc, pai, txt) {
  for (const x of parseInline(txt)) {
    if (x.t === "texto") { pai.appendChild(doc.createTextNode(x.v)); continue; }
    const el = doc.createElement(x.t === "b" ? "strong" : x.t === "i" ? "em" : "code");
    el.textContent = x.v;
    pai.appendChild(el);
  }
}

export function renderizarMarkdown(doc, md) {
  const raiz = doc.createDocumentFragment();
  for (const b of parseMarkdown(md)) {
    let el;
    if (b.t === "h") { el = doc.createElement(`h${Math.min(6, b.n + 2)}`); inline(doc, el, b.v); }
    else if (b.t === "p") { el = doc.createElement("p"); inline(doc, el, b.v); }
    else if (b.t === "hr") el = doc.createElement("hr");
    else if (b.t === "pre") { el = doc.createElement("pre"); el.textContent = b.v; }
    else {
      el = doc.createElement(b.t);
      for (const i of b.itens) { const li = doc.createElement("li"); inline(doc, li, i); el.appendChild(li); }
    }
    raiz.appendChild(el);
  }
  return raiz;
}
