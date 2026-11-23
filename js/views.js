import {
  LIMITS,
  TYPES,
  escapeHtml,
  formatDate,
  formatMoney,
  formatMonth,
  todayISO,
  typeOf,
} from './domain.js';
import { emptyState, icon, skeleton } from './ui.js';

const esc = escapeHtml;

const ROUTE_TITLES = {
  inicio: 'Inicio',
  movimientos: 'Movimientos',
  presupuestos: 'Presupuestos',
  ajustes: 'Ajustes',
};

export const routeTitle = (route) => ROUTE_TITLES[route] ?? 'Ahorrix';

/* ---------- piezas reutilizables ---------- */

export function monthPicker(month) {
  return `
    <div class="month-picker" role="group" aria-label="Seleccionar mes">
      <button class="icon-btn" type="button" data-action="month" data-delta="-1" aria-label="Mes anterior">‹</button>
      <output class="month-label" aria-live="polite">${esc(formatMonth(month))}</output>
      <button class="icon-btn" type="button" data-action="month" data-delta="1" aria-label="Mes siguiente">›</button>
    </div>`;
}

export function pageHead(title, controls = '') {
  return `
    <header class="page-head">
      <h1>${esc(title)}</h1>
      <div class="page-tools">${controls}</div>
    </header>`;
}

function field({ label, name, type = 'text', value = '', attrs = '', hint = '', prefix = 'f' }) {
  const id = `${prefix}-${name}`;
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>
      ${hint ? `<small class="hint">${esc(hint)}</small>` : ''}
      <small class="error" data-error="${name}"></small>
    </div>`;
}

function select({ label, name, options, attrs = '', hint = '', prefix = 'f' }) {
  const id = `${prefix}-${name}`;
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <select id="${id}" name="${name}" ${attrs}>${options}</select>
      ${hint ? `<small class="hint">${esc(hint)}</small>` : ''}
      <small class="error" data-error="${name}"></small>
    </div>`;
}

function option(value, label, selected) {
  return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
}

function placeholderOption() {
  return '<option value="">Selecciona…</option>';
}

function categoryOptions(categories, selected) {
  const groups = [TYPES.EXPENSE, TYPES.INCOME].map((type) => {
    const items = categories.filter((c) => typeOf(c) === type);
    const label = type === TYPES.EXPENSE ? 'Gastos' : 'Ingresos';
    return `<optgroup label="${label}">${items.map((c) => option(c.id, c.name, selected)).join('')}</optgroup>`;
  });
  return placeholderOption() + groups.join('');
}

function plainOptions(items, labelFn, selected, valueFn = (item) => item.id) {
  return placeholderOption() + items.map((item) => option(valueFn(item), labelFn(item), selected)).join('');
}

/**
 * Confirmación en línea: al pulsar "Eliminar" la fila cambia a "¿Eliminar?"
 * sin abrir diálogos del sistema.
 */
function deleteControls(kind, id, label) {
  return `
    <div class="row-actions" data-deletable>
      <div class="row-actions-default">
        <button class="link" type="button" data-action="ask-delete" aria-label="Eliminar ${esc(label)}">Eliminar</button>
      </div>
      <div class="row-actions-confirm" role="group" aria-label="Confirmar eliminación">
        <span>¿Eliminar?</span>
        <button class="link is-danger" type="button" data-action="confirm-delete" data-kind="${kind}" data-id="${esc(id)}">Sí, eliminar</button>
        <button class="link" type="button" data-action="cancel-delete">Cancelar</button>
      </div>
    </div>`;
}

function meter(percent, name, exceeded) {
  const width = Math.min(Number(percent) || 0, 100);
  return `
    <div class="meter ${exceeded ? 'is-exceeded' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"
      aria-valuenow="${width}" aria-label="Avance de ${esc(name)}">
      <span style="width:${width}%"></span>
    </div>`;
}

/* ---------- autenticación ---------- */

export function authView({ mode, currencies }) {
  const isRegister = mode === 'register';

  return `
    <section class="auth" aria-labelledby="auth-title">
      <div class="auth-intro">
        <p class="eyebrow">Control de gastos</p>
        <h1 id="auth-title">Ahorrix</h1>
        <p class="lede">Registra ingresos y gastos, controla tus presupuestos y úsala incluso sin internet.</p>
      </div>

      <div class="auth-card">
        <div class="segmented" role="group" aria-label="Tipo de acceso">
          <button type="button" data-action="auth-mode" data-mode="login" aria-pressed="${!isRegister}">Iniciar sesión</button>
          <button type="button" data-action="auth-mode" data-mode="register" aria-pressed="${isRegister}">Crear cuenta</button>
        </div>

        <form id="auth-form" data-form="auth" novalidate>
          <input type="hidden" name="mode" value="${mode}">
          ${isRegister ? field({ label: 'Nombre', name: 'name', attrs: 'autocomplete="name" maxlength="100"' }) : ''}
          ${field({ label: 'Correo electrónico', name: 'email', type: 'email', attrs: 'autocomplete="email" required' })}
          ${field({
            label: 'Contraseña',
            name: 'password',
            type: 'password',
            attrs: `autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="${LIMITS.minPassword}" required`,
            hint: isRegister ? `Mínimo ${LIMITS.minPassword} caracteres.` : '',
          })}
          ${isRegister ? select({
            label: 'Moneda base',
            name: 'base_currency_code',
            options: plainOptions(currencies, (c) => `${c.code} · ${c.name}`, '', (c) => c.code),
            hint: 'Todos tus montos se convierten a esta moneda.',
          }) : ''}
          <p class="form-error" data-error="form" role="alert"></p>
          <button class="btn btn-primary btn-block" type="submit">${isRegister ? 'Crear cuenta' : 'Entrar'}</button>
        </form>
      </div>
    </section>`;
}

/* ---------- inicio ---------- */

export function homeSkeleton() {
  return `
    <header class="page-head"><h1>Inicio</h1></header>
    <section class="ledger" aria-hidden="true">
      <div class="ledger-cell"><span class="skeleton-line short"></span><span class="skeleton-line"></span></div>
      <div class="ledger-cell"><span class="skeleton-line short"></span><span class="skeleton-line"></span></div>
      <div class="ledger-cell"><span class="skeleton-line short"></span><span class="skeleton-line"></span></div>
    </section>
    <div class="home-grid" aria-hidden="true">
      <section class="panel"><div class="chart skeleton-block"></div></section>
      <section class="panel"><div class="chart skeleton-block round"></div>${skeleton(3)}</section>
    </div>`;
}

export function homeView({ month, summary, base }) {
  const money = (value) => formatMoney(value, base);
  const categories = summary.by_category;
  const total = categories.reduce((sum, c) => sum + c.total, 0);

  const categoryRows = categories.length
    ? categories.map((c) => `
        <tr>
          <th scope="row"><span class="swatch" style="--swatch:${esc(c.color)}" aria-hidden="true"></span><span class="truncate">${esc(c.name)}</span></th>
          <td class="num">${money(c.total)}</td>
          <td class="num">${total ? Math.round((c.total / total) * 100) : 0}%</td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="muted">Sin gastos en este mes.</td></tr>';

  const budgets = summary.budgets.length
    ? `<ul class="budget-list">${summary.budgets.map(budgetItem(money)).join('')}</ul>`
    : emptyState({
      title: 'Sin presupuestos este mes',
      text: 'Define un límite por categoría para saber cuándo vas por encima.',
      action: '<a class="btn" href="#/presupuestos">Definir presupuestos</a>',
    });

  return `
    ${pageHead('Inicio', `
      ${monthPicker(month)}
      <button class="btn btn-primary" type="button" data-action="new-tx">Nuevo movimiento</button>
    `)}

    <section class="ledger" aria-label="Resumen de ${esc(formatMonth(month))}">
      <div class="ledger-cell is-income">
        <span class="label">Ingresos</span>
        <strong class="figure">${money(summary.income)}</strong>
      </div>
      <div class="ledger-cell is-expense">
        <span class="label">Gastos</span>
        <strong class="figure">${money(summary.expense)}</strong>
      </div>
      <div class="ledger-cell">
        <span class="label">Balance</span>
        <strong class="figure ${summary.balance < 0 ? 'is-expense' : ''}">${money(summary.balance)}</strong>
      </div>
    </section>

    <div class="home-grid">
      <section class="panel" aria-labelledby="h-flow">
        <div class="panel-head">
          <h2 id="h-flow">Flujo de los últimos 6 meses</h2>
          <span class="legend-inline"><span class="swatch is-income" aria-hidden="true"></span>Ingresos
            <span class="swatch is-expense" aria-hidden="true"></span>Gastos</span>
        </div>
        <div class="chart"><canvas id="bars" role="img" aria-label="Ingresos y gastos de los últimos seis meses"></canvas></div>
      </section>

      <section class="panel" aria-labelledby="h-cat">
        <div class="panel-head"><h2 id="h-cat">Gasto por categoría</h2></div>
        <div class="chart chart-donut"><canvas id="donut" role="img" aria-label="Distribución del gasto por categoría"></canvas></div>
        <div class="table-wrap">
          <table class="data-table">
            <caption class="sr-only">Gasto por categoría en ${esc(formatMonth(month))}</caption>
            <thead><tr><th scope="col">Categoría</th><th scope="col" class="num">Monto</th><th scope="col" class="num">Parte</th></tr></thead>
            <tbody>${categoryRows}</tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="panel" aria-labelledby="h-budgets">
      <div class="panel-head">
        <h2 id="h-budgets">Presupuestos del mes</h2>
        <a class="link" href="#/presupuestos">Administrar</a>
      </div>
      ${budgets}
    </section>

    <div class="secondary-actions">
      <button class="btn btn-ghost" type="button" data-action="share-summary">${icon('share')}Compartir resumen</button>
    </div>`;
}

function budgetItem(money) {
  return (b) => {
    const state = b.exceeded
      ? `<span class="state is-exceeded">Excedido por ${money(b.spent - b.budget)}</span>`
      : `<span class="state">${esc(String(b.percent))}% utilizado</span>`;

    return `
      <li class="budget-item">
        <div class="budget-head">
          <span class="budget-name"><span class="swatch" style="--swatch:${esc(b.color)}" aria-hidden="true"></span><span class="truncate">${esc(b.name)}</span></span>
          <span class="figures num">${money(b.spent)} <span class="muted">de ${money(b.budget)}</span></span>
        </div>
        ${meter(b.percent, b.name, b.exceeded)}
        ${state}
      </li>`;
  };
}

/* ---------- movimientos ---------- */

export function movementsSkeleton() {
  return `
    <header class="page-head"><h1>Movimientos</h1></header>
    <div class="table-wrap" aria-hidden="true">${skeleton(6)}</div>`;
}

export function movementsView({ month, items, catalog, typeById, baseCode, receiptUrl }) {
  const head = items.length
    ? '<button class="btn btn-primary" type="button" data-action="new-tx">Nuevo movimiento</button>'
    : '';

  const body = items.length
    ? `
      <div class="table-wrap">
        <table class="tx-table">
          <caption class="sr-only">Movimientos de ${esc(formatMonth(month))}</caption>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Descripción</th>
              <th scope="col">Cuenta</th>
              <th scope="col" class="num">Monto</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>${items.map((t) => txRow(t, { catalog, typeById, baseCode, receiptUrl })).join('')}</tbody>
        </table>
      </div>`
    : emptyState({
      title: `Sin movimientos en ${formatMonth(month)}`,
      text: 'Registra un gasto o un ingreso. Si no tienes conexión, se guarda en este dispositivo y se sincroniza después.',
      action: '<button class="btn btn-primary" type="button" data-action="new-tx">Registrar movimiento</button>',
    });

  return `
    ${pageHead('Movimientos', `${monthPicker(month)}${head}`)}
    ${body}`;
}

function txRow(t, { catalog, typeById, baseCode, receiptUrl }) {
  const type = typeById.get(Number(t.category_id));
  const isIncome = type === TYPES.INCOME;
  const code = t.currency?.code ?? baseCode;
  const category = t.category ?? catalog.categories.find((c) => Number(c.id) === Number(t.category_id));
  const title = t.description || category?.name || 'Movimiento';
  const amount = `${isIncome ? '+' : '−'}${formatMoney(t.amount, code)}`;
  const receipt = t.receipt_path && !t.local
    ? `<a class="link small" href="${esc(receiptUrl(t.receipt_path))}" target="_blank" rel="noopener">Ver ticket</a>`
    : '';

  return `
    <tr data-id="${esc(t.id)}">
      <td data-label="Fecha"><time class="num" datetime="${esc(String(t.transaction_date).slice(0, 10))}">${esc(formatDate(t.transaction_date))}</time></td>
      <td data-label="Descripción">
        <div class="tx-title"><span class="swatch" style="--swatch:${esc(category?.color ?? '#6b7280')}" aria-hidden="true"></span><span class="truncate">${esc(title)}</span></div>
        <div class="tx-meta"><span class="truncate">${esc(category?.name ?? 'Sin categoría')}</span>
          ${t.local ? '<span class="tag">Pendiente de sincronizar</span>' : ''}
          ${receipt}</div>
      </td>
      <td data-label="Cuenta"><span class="truncate">${esc(t.account?.name ?? '')}</span></td>
      <td data-label="Monto" class="num figure ${isIncome ? 'is-income' : 'is-expense'}">${esc(amount)}</td>
      <td class="actions-cell">
        <div class="row-actions">
          <button class="link" type="button" data-action="edit-tx" data-id="${esc(t.id)}" aria-label="Editar ${esc(title)}">Editar</button>
          ${deleteControls('transaction', t.id, title)}
        </div>
      </td>
    </tr>`;
}

/* ---------- formulario de movimiento (cajón) ---------- */

export function transactionForm({ value, catalog, id }) {
  const hasLocation = value.latitude !== '' && value.latitude != null;

  return `
    <form id="tx-form" data-form="transaction" data-id="${id ? esc(id) : ''}" novalidate>
      <div class="field amount-field">
        <label for="f-amount">Monto</label>
        <div class="amount-input">
          <input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" value="${esc(value.amount)}" placeholder="0.00" aria-describedby="hint-amount" required>
        </div>
        <small id="hint-amount" class="hint">Máximo dos decimales.</small>
        <small class="error" data-error="amount"></small>
      </div>

      <div class="form-row">
        ${select({ label: 'Moneda', name: 'currency_id', options: plainOptions(catalog.currencies, (c) => `${c.code} · ${c.name}`, value.currency_id) })}
        ${select({ label: 'Cuenta', name: 'account_id', options: plainOptions(catalog.accounts, (a) => a.name, value.account_id) })}
      </div>

      ${select({ label: 'Categoría', name: 'category_id', options: categoryOptions(catalog.categories, value.category_id) })}

      <div class="form-row">
        ${field({ label: 'Fecha', name: 'transaction_date', type: 'date', value: String(value.transaction_date).slice(0, 10), attrs: `max="${todayISO()}" required` })}
        ${field({ label: 'Descripción', name: 'description', value: value.description ?? '', attrs: `maxlength="${LIMITS.maxDescription}" placeholder="Opcional"` })}
      </div>

      <fieldset class="group">
        <legend>Ubicación</legend>
        <div class="group-row">
          <button class="btn" type="button" data-action="geo">${icon('pin')}Usar mi ubicación</button>
          ${hasLocation ? '<button class="btn btn-ghost" type="button" data-action="geo-clear">Quitar</button>' : ''}
        </div>
        <small id="geo-status" class="hint" aria-live="polite">${hasLocation ? `Lat ${esc(value.latitude)}, Lng ${esc(value.longitude)}` : 'Sin ubicación asignada.'}</small>
        <input type="hidden" name="latitude" value="${esc(value.latitude ?? '')}">
        <input type="hidden" name="longitude" value="${esc(value.longitude ?? '')}">
        <small class="error" data-error="latitude"></small>
        <small class="error" data-error="longitude"></small>
      </fieldset>

      <fieldset class="group">
        <legend>Ticket</legend>
        <label class="file-input">
          ${icon('camera')}<span>${value.receipt_path ? 'Reemplazar foto del ticket' : 'Tomar o elegir foto'}</span>
          <input name="receipt" type="file" accept="image/*" capture="environment">
        </label>
        <img id="receipt-preview" class="receipt-preview" alt="Vista previa del ticket" hidden>
        <small class="hint">${value.receipt_path ? 'Este movimiento ya tiene un ticket. Si eliges otra foto, se reemplaza.' : `Imagen de hasta ${LIMITS.maxReceiptMb} MB.`}</small>
        <small class="error" data-error="receipt"></small>
      </fieldset>

      <p class="form-error" data-error="form" role="alert"></p>

      <div class="drawer-footer">
        <button class="btn" type="button" data-action="close-drawer">Cancelar</button>
        <button class="btn btn-primary" type="submit">Guardar movimiento</button>
      </div>
    </form>`;
}

/* ---------- presupuestos ---------- */

export function budgetsSkeleton() {
  return `
    <header class="page-head"><h1>Presupuestos</h1></header>
    <div class="panel" aria-hidden="true">${skeleton(4)}</div>`;
}

export function budgetsView({ month, budgets, summary, categories, online }) {
  const expenseCategories = categories.filter((c) => typeOf(c) === TYPES.EXPENSE);
  const spentById = new Map(summary.budgets.map((b) => [Number(b.category_id), b]));

  const list = budgets.length
    ? `<ul class="budget-list">${budgets.map((b) => {
      const row = spentById.get(Number(b.category_id)) ?? { spent: 0, percent: 0, exceeded: false };
      const name = b.category?.name ?? 'Categoría';
      return `
        <li class="budget-item">
          <div class="budget-head">
            <span class="budget-name"><span class="swatch" style="--swatch:${esc(b.category?.color ?? '#6b7280')}" aria-hidden="true"></span><span class="truncate">${esc(name)}</span></span>
            <span class="figures num">${esc(String(row.spent))} <span class="muted">de ${esc(String(b.amount))}</span></span>
          </div>
          ${meter(row.percent, name, row.exceeded)}
          <div class="budget-foot">
            <span class="state ${row.exceeded ? 'is-exceeded' : ''}">${row.exceeded ? 'Excedido' : `${esc(String(row.percent))}% utilizado`}</span>
            <div class="row-actions" data-deletable>
              <div class="row-actions-default">
                <button class="link" type="button" data-action="edit-budget" data-category="${esc(b.category_id)}" data-amount="${esc(b.amount)}" aria-label="Editar presupuesto de ${esc(name)}">Editar</button>
                <button class="link is-danger" type="button" data-action="ask-delete" aria-label="Eliminar presupuesto de ${esc(name)}" ${online ? '' : 'disabled'}>Eliminar</button>
              </div>
              <div class="row-actions-confirm" role="group" aria-label="Confirmar eliminación">
                <span>¿Eliminar?</span>
                <button class="link is-danger" type="button" data-action="confirm-delete" data-kind="budget" data-id="${esc(b.id)}">Sí, eliminar</button>
                <button class="link" type="button" data-action="cancel-delete">Cancelar</button>
              </div>
            </div>
          </div>
        </li>`;
    }).join('')}</ul>`
    : emptyState({
      title: 'Sin presupuestos para este mes',
      text: 'Un presupuesto fija un límite mensual por categoría de gasto. Empieza con la categoría que más pesa en tu mes.',
    });

  return `
    ${pageHead('Presupuestos', monthPicker(month))}

    <section class="panel" aria-labelledby="h-define">
      <div class="panel-head">
        <h2 id="h-define">Definir presupuesto</h2>
        ${online ? '' : '<span class="tag">Requiere conexión</span>'}
      </div>
      <form id="budget-form" class="inline-form" data-form="budget" novalidate>
        ${select({ label: 'Categoría de gasto', name: 'category_id', options: plainOptions(expenseCategories, (c) => c.name, '') })}
        ${field({ label: 'Monto mensual', name: 'amount', value: '', attrs: 'inputmode="decimal" placeholder="0.00"' })}
        <button class="btn btn-primary" type="submit" ${online ? '' : 'disabled'}>Guardar</button>
        <p class="form-error" data-error="form" role="alert"></p>
      </form>
    </section>

    <section class="panel" aria-labelledby="h-month">
      <div class="panel-head"><h2 id="h-month">${esc(formatMonth(month))}</h2></div>
      ${list}
    </section>`;
}

/* ---------- ajustes ---------- */

export function settingsSkeleton() {
  return `
    <header class="page-head"><h1>Ajustes</h1></header>
    <div class="panel" aria-hidden="true">${skeleton(5)}</div>`;
}

export function settingsView({ catalog, lastSync, pending, online, notifState, geolocation, standalone, apiUrl }) {
  const base = catalog.user?.base_currency;
  const notifLabel = {
    granted: 'activadas',
    denied: 'bloqueadas',
    default: 'sin activar',
    unsupported: 'no disponible',
  }[notifState] ?? 'no disponible';
  const typeLabel = (t) => (t.name === TYPES.EXPENSE ? 'Gasto' : 'Ingreso');

  return `
    ${pageHead('Ajustes')}

    <div class="settings">
      <section class="panel" aria-labelledby="h-account">
        <div class="panel-head"><h2 id="h-account">Cuenta</h2></div>
        <p class="strong">${esc(catalog.user?.name ?? '')}</p>
        <p class="muted">${esc(catalog.user?.email ?? '')} · Moneda base ${esc(base?.code ?? '')}</p>
        <div class="actions start"><button class="btn btn-ghost is-danger" type="button" data-action="logout">Cerrar sesión</button></div>
      </section>

      <section class="panel" aria-labelledby="h-sync">
        <div class="panel-head"><h2 id="h-sync">Sincronización</h2></div>
        <dl class="facts">
          <div><dt>Último cambio sincronizado</dt><dd>${lastSync ? esc(new Date(lastSync).toLocaleString('es-MX')) : 'Nunca'}</dd></div>
          <div><dt>Cambios pendientes</dt><dd class="num">${esc(String(pending))}</dd></div>
        </dl>
        <div class="actions start"><button class="btn" type="button" data-action="sync" ${online ? '' : 'disabled'}>Sincronizar ahora</button></div>
      </section>

      <section class="panel" aria-labelledby="h-device">
        <div class="panel-head"><h2 id="h-device">Dispositivo</h2></div>
        <dl class="facts">
          <div><dt>Notificaciones de presupuesto</dt><dd>${esc(notifLabel)}</dd></div>
          <div><dt>Ubicación</dt><dd>${geolocation ? 'Disponible' : 'No disponible'}</dd></div>
          <div><dt>Instalada como app</dt><dd>${standalone ? 'Sí' : 'No'}</dd></div>
        </dl>
        <div class="actions start">
          <button class="btn" type="button" data-action="enable-notifications" ${notifState === 'unsupported' ? 'disabled' : ''}>Activar notificaciones</button>
        </div>
      </section>

      <section class="panel" aria-labelledby="h-categories">
        <div class="panel-head"><h2 id="h-categories">Categorías</h2></div>
        <ul class="catalog-list">
          ${catalog.categories.map((c) => `
            <li>
              <span class="catalog-name"><span class="swatch" style="--swatch:${esc(c.color)}" aria-hidden="true"></span><span class="truncate">${esc(c.name)}</span><small>${esc(typeLabel({ name: typeOf(c) }))}</small></span>
              ${online ? deleteControls('category', c.id, c.name) : ''}
            </li>`).join('')}
        </ul>
        <form id="category-form" data-form="category" class="inline-form" novalidate>
          ${field({ label: 'Nombre', name: 'name', prefix: 'cat', attrs: `maxlength="${LIMITS.maxName}"` })}
          ${select({ label: 'Tipo', name: 'transaction_type_id', prefix: 'cat', options: plainOptions(catalog.transactionTypes, typeLabel, '') })}
          <div class="field">
            <label for="cat-color">Color</label>
            <input id="cat-color" name="color" type="color" value="#6b7280" class="color-input">
            <small class="error" data-error="color"></small>
          </div>
          <button class="btn btn-primary" type="submit" ${online ? '' : 'disabled'}>Agregar categoría</button>
          <p class="form-error" data-error="form" role="alert"></p>
        </form>
      </section>

      <section class="panel" aria-labelledby="h-accounts">
        <div class="panel-head"><h2 id="h-accounts">Cuentas</h2></div>
        <ul class="catalog-list">
          ${catalog.accounts.map((a) => `
            <li>
              <span class="catalog-name"><span class="truncate">${esc(a.name)}</span><small>${esc(a.currency?.code ?? '')}</small></span>
              ${online ? deleteControls('account', a.id, a.name) : ''}
            </li>`).join('')}
        </ul>
        <form id="account-form" data-form="account" class="inline-form" novalidate>
          ${field({ label: 'Nombre', name: 'name', prefix: 'acc', attrs: `maxlength="${LIMITS.maxName}"` })}
          ${select({ label: 'Moneda', name: 'currency_id', prefix: 'acc', options: plainOptions(catalog.currencies, (c) => c.code, '') })}
          ${field({ label: 'Saldo inicial', name: 'initial_balance', prefix: 'acc', attrs: 'inputmode="decimal" placeholder="0.00"' })}
          <button class="btn btn-primary" type="submit" ${online ? '' : 'disabled'}>Agregar cuenta</button>
          <p class="form-error" data-error="form" role="alert"></p>
        </form>
      </section>

      <section class="panel" aria-labelledby="h-server">
        <div class="panel-head"><h2 id="h-server">Servidor API</h2></div>
        <form id="server-form" data-form="server" class="inline-form" novalidate>
          ${field({ label: 'URL base de la API', name: 'apiUrl', type: 'url', value: apiUrl, prefix: 'srv', hint: 'Por ejemplo, https://tu-tunel.trycloudflare.com/api' })}
          <button class="btn" type="submit">Guardar y recargar</button>
          <p class="form-error" data-error="form" role="alert"></p>
        </form>
      </section>
    </div>`;
}
