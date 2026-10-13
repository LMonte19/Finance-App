// Keep rendered content in place when background reads return the same values.
// Compare the source template so translations and presentation decorators survive.
const rendered = new WeakMap();

export function setStableMarkup(node, html, force = false) {
  if (!node || (!force && rendered.get(node) === html)) return false;
  node.innerHTML = html;
  rendered.set(node, html);
  return true;
}
