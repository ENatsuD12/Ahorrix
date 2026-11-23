/**
 * Gráficas en canvas. Los colores salen de los tokens CSS para que el tema
 * viva en un solo lugar (css/styles.css).
 */

function token(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function palette() {
  return {
    income: token('--positive', '#3e6b4a'),
    expense: token('--negative', '#a4452c'),
    track: token('--surface-subtle', '#eae6da'),
    ink: token('--text-primary', '#1e1c18'),
    muted: token('--text-secondary', '#5c584e'),
    font: token('--font-ui', 'system-ui, sans-serif'),
  };
}

function setupCanvas(canvas) {
  const ratio = globalThis.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  return { ctx, width, height };
}

/**
 * Dona con el gasto por categoría.
 * slices: [{ label, value, color }]
 */
export function drawDonut(canvas, slices, { centerLabel = '', centerValue = '' } = {}) {
  const colors = palette();
  const { ctx, width, height } = setupCanvas(canvas);
  const total = slices.reduce((sum, s) => sum + Number(s.value), 0);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 4;
  const inner = radius * 0.66;

  if (total <= 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
    ctx.fillStyle = colors.track;
    ctx.fill();
  } else {
    let start = -Math.PI / 2;
    for (const slice of slices) {
      const angle = (Number(slice.value) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      start += angle;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = token('--surface-card', '#fbfaf6');
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colors.muted;
  ctx.font = `600 12px ${colors.font}`;
  ctx.fillText(centerLabel, cx, cy - 10);
  ctx.fillStyle = colors.ink;
  ctx.font = `700 15px ${colors.font}`;
  ctx.fillText(centerValue, cx, cy + 9);
}

/**
 * Barras agrupadas de ingresos y gastos por mes.
 * series: [{ label, income, expense }]
 */
export function drawBars(canvas, series) {
  const colors = palette();
  const { ctx, width, height } = setupCanvas(canvas);
  const padding = { top: 12, right: 4, bottom: 26, left: 4 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...series.flatMap((s) => [Number(s.income), Number(s.expense)]));
  const groupW = chartW / Math.max(series.length, 1);
  const barW = Math.min(16, groupW / 3);
  const base = padding.top + chartH;

  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, base + 0.5);
  ctx.lineTo(width - padding.right, base + 0.5);
  ctx.stroke();

  series.forEach((s, i) => {
    const x = padding.left + i * groupW + groupW / 2;
    const incomeH = (Number(s.income) / max) * chartH;
    const expenseH = (Number(s.expense) / max) * chartH;

    ctx.fillStyle = colors.income;
    ctx.fillRect(x - barW - 1, base - incomeH, barW, incomeH);
    ctx.fillStyle = colors.expense;
    ctx.fillRect(x + 1, base - expenseH, barW, expenseH);

    ctx.fillStyle = colors.muted;
    ctx.font = `500 11px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(s.label, x, base + 8);
  });
}
