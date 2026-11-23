import { escapeHtml } from './domain.js';

export const $ = (selector, root = document) => root.querySelector(selector);

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

/* ---------- avisos ---------- */

let toastTimer = null;

export function toast(message, { error = false } = {}) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('is-error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 4200);
}

/* ---------- formularios ---------- */

/**
 * Muestra errores junto a cada campo. Marca el campo con aria-invalid y lo
 * enlaza con su mensaje mediante aria-describedby. Devuelve el primer campo
 * inválido para moverle el foco.
 */
export function applyErrors(form, errors = {}) {
  const formKey = form.dataset.form ?? 'form';

  form.querySelectorAll('[data-error]').forEach((el) => {
    el.textContent = '';
  });
  form.querySelectorAll('[aria-invalid]').forEach((el) => {
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
  });

  let firstInvalid = null;

  for (const [field, message] of Object.entries(errors)) {
    const text = Array.isArray(message) ? message[0] : message;

    if (field === 'form') {
      const box = form.querySelector('[data-error="form"]');
      if (box) box.textContent = text;
      continue;
    }

    const el = form.querySelector(`[data-error="${field}"]`);
    if (el) {
      el.textContent = text;
      el.id = `${formKey}-${field}-error`;
    }

    const input = form.elements.namedItem(field);
    if (input instanceof HTMLElement) {
      input.setAttribute('aria-invalid', 'true');
      if (el) input.setAttribute('aria-describedby', el.id);
      firstInvalid ??= input;
    }
  }

  return firstInvalid;
}

export function formValues(form) {
  const values = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (value instanceof File) continue;
    values[key] = String(value).trim();
  }
  return values;
}

/**
 * Estado de carga del botón: conserva el ancho original para que la
 * interfaz no salte al cambiar el texto.
 */
export function setBusy(button, busy, label = 'Guardando…') {
  if (!button) return;

  if (busy) {
    button.dataset.label = button.textContent;
    button.dataset.wasDisabled = button.disabled ? '1' : '0';
    button.style.minWidth = `${button.offsetWidth}px`;
    button.textContent = label;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    return;
  }

  button.textContent = button.dataset.label ?? button.textContent;
  button.disabled = button.dataset.wasDisabled === '1';
  button.style.minWidth = '';
  button.removeAttribute('aria-busy');
  delete button.dataset.label;
  delete button.dataset.wasDisabled;
}

/* ---------- cajón lateral ---------- */

export function openDrawer(title, html) {
  const drawer = $('#drawer');
  $('#drawer-title').textContent = title;
  $('#drawer-content').innerHTML = html;
  if (!drawer.open) drawer.showModal();
  return drawer;
}

export function closeDrawer() {
  const drawer = $('#drawer');
  if (drawer.open) drawer.close();
}

/* ---------- plantillas auxiliares ---------- */

export function skeleton(lines = 3) {
  return Array.from({ length: lines }, () => '<span class="skeleton-line" aria-hidden="true"></span>').join('');
}

export function emptyState({ title, text, action = '' }) {
  return `
    <div class="empty">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
      ${action}
    </div>`;
}

export function statusText(online) {
  return online ? 'En línea' : 'Sin conexión';
}
