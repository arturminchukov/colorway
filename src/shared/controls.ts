/**
 * Caption and control on one row, the same row on both surfaces: the class is what
 * carries the layout (see `.field` in sections.css), so a field of the options page
 * and a field of the panel window cannot drift apart by living under different
 * element-level rules.
 */
export function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "field";
  label.append(text, control);
  return label;
}

export function textInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  return input;
}

export function colorInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "color";
  // <input type="color"> rejects shorthand hex, so a bad value would silently become
  // black; a known-good default is more honest than a wrong color.
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#3f51b5";
  return input;
}

export function checkbox(checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  return input;
}
