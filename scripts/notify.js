/* Envia, uma vez por dia, um resumo de alertas para o celular de cada família:
   - contas que vencem nos próximos dias (ou já venceram)
   - categorias perto de estourar (ou já estouradas) o limite do mês
   Roda no GitHub Actions (veja .github/workflows/alertas.yml). */
'use strict';

const BRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const SITE_URL = process.env.SITE_URL || './';

function todayISO() {
  // data de hoje no fuso de Brasília, no formato AAAA-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function toDay(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; }
function diffDays(a, b) { return Math.round(toDay(a) - toDay(b)); }
function dm(s) { return s.slice(8, 10) + '/' + s.slice(5, 7); }
function lastDayOfMonth(key) { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

const DESPESA = new Set(['conta', 'financiamento', 'emprestimo', 'consorcio']);
const CARD_CAT = 'Cartão de crédito';   // fatura do cartão: só caixa, não entra nos limites
const pad = n => String(n).padStart(2, '0');
function isDone(i) { return !!(i.totalParcelas && i.parcelasPagas >= i.totalParcelas); }
function catOf(i) {
  if (i.categoria) return i.categoria;
  if (i.tipo === 'conta') return 'Contas de casa';
  if (i.tipo === 'financiamento' || i.tipo === 'emprestimo' || i.tipo === 'consorcio') return 'Financiamentos';
  return 'Outros';
}
function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m = 1..12

const clamp = n => Math.max(1, Math.min(31, Number(n) || 1));
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;   // m = 1..12

/* Em qual fatura cai uma compra? (mesma regra do app) */
function invoiceKeyFor(card, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const fech = clamp(card.fechamento), venc = clamp(card.vencimento);
  let cy = y, cm = m;
  if (d > Math.min(fech, dim(cy, cm))) { cm++; if (cm > 12) { cm = 1; cy++; } }
  let dy = cy, dm = cm;
  if (venc <= fech) { dm++; if (dm > 12) { dm = 1; dy++; } }
  return `${dy}-${pad(dm)}`;
}
/* Período e vencimento padrão da fatura 'AAAA-MM' (mês do vencimento) */
function invoicePeriod(card, key) {
  const [dy, dm] = key.split('-').map(Number);
  const fech = clamp(card.fechamento), venc = clamp(card.vencimento);
  let cy = dy, cm = dm;
  if (venc <= fech) { cm--; if (cm < 1) { cm = 12; cy--; } }
  const closingDay = toDay(isoOf(cy, cm, Math.min(fech, dim(cy, cm))));
  let py = cy, pm = cm - 1; if (pm < 1) { pm = 12; py--; }
  const startDay = toDay(isoOf(py, pm, Math.min(fech, dim(py, pm)))) + 1;
  return { startDay, closingDay, due: isoOf(dy, dm, Math.min(venc, dim(dy, dm))) };
}
function monthKeyOfDay(day) { return new Date(Math.floor(day) * 86400000).toISOString().slice(0, 7); }

/* Faturas dos cartões: compras agrupadas + total/vencimento informados à mão */
function invoices(settings, payments) {
  const cards = settings.cartoes || [];
  const map = {};
  const get = (card, key) => {
    const k = card.id + '|' + key;
    if (!map[k]) {
      const per = invoicePeriod(card, key);
      map[k] = { card, key, due: per.due, per, detalhado: 0, informado: null, paid: 0 };
    }
    return map[k];
  };
  payments.forEach(p => {
    if (p.tipo !== 'cartao' || !p.data) return;
    const card = cards.find(c => c.id === p.cartaoId);
    if (!card) return;
    get(card, invoiceKeyFor(card, p.data)).detalhado += Number(p.valor) || 0;
  });
  Object.entries(settings.faturas || {}).forEach(([k, f]) => {
    const [cid, key] = k.split('|');
    const card = cards.find(c => c.id === cid);
    if (!card || !f) return;
    const inv = get(card, key);
    if (f.total != null && f.total !== '' && !isNaN(Number(f.total))) inv.informado = Number(f.total);
    if (f.due) inv.due = f.due;
  });
  payments.forEach(p => {
    if (p.tipo !== 'fatura') return;
    const inv = map[p.cartaoId + '|' + p.faturaKey];
    if (inv) inv.paid += Number(p.valor) || 0;
  });
  return Object.values(map).map(inv => {
    inv.detalhado = Math.round(inv.detalhado * 100) / 100;
    inv.total = inv.informado != null ? inv.informado : inv.detalhado;
    inv.semDetalhe = Math.max(0, Math.round((inv.total - inv.detalhado) * 100) / 100);
    inv.remaining = Math.max(0, Math.round((inv.total - inv.paid) * 100) / 100);
    // gasto sem detalhar pertence ao mês do meio do período da fatura (não ao mês do vencimento)
    inv.attrKey = monthKeyOfDay((inv.per.startDay + inv.per.closingDay) / 2);
    return inv;
  });
}

/* Mesma regra da tela "Gastos e limites":
   - gasto do mês por categoria = pagamentos e compras no cartão do MÊS DA COMPRA + contas ainda a pagar neste mês
   - a fatura do cartão NÃO entra no limite das categorias (só nos vencimentos)
   - limite do cartão = compras do mês + total de faturas sem detalhar geradas neste mês */
function buildAlerts({ items, payments, settings, today }) {
  const dias = Number.isFinite(Number(settings.alertaDias)) ? Number(settings.alertaDias) : 3;
  const pct = Number(settings.alertaPct) || 80;
  const lines = [];
  const invs = invoices(settings, payments);

  // 1) vencimentos: contas e faturas de cartão
  const due = [];
  items.forEach(i => {
    if (!DESPESA.has(i.tipo) || isDone(i) || !i.dataVencimento) return;
    const d = diffDays(i.dataVencimento, today);
    if (d <= dias) due.push({ nome: i.nome, valor: i.valorParcela, venc: i.dataVencimento, d, icone: '🔔' });
  });
  invs.filter(inv => inv.remaining >= 0.005 && inv.total > 0).forEach(inv => {
    const d = diffDays(inv.due, today);
    if (d <= dias) due.push({ nome: `Fatura ${inv.card.nome}`, valor: inv.remaining, venc: inv.due, d, icone: '💳' });
  });
  due.sort((a, b) => a.d - b.d);
  due.forEach(({ nome, valor, venc, d, icone }) => {
    if (d < 0) lines.push(`⚠️ ${nome} venceu há ${-d} dia${-d === 1 ? '' : 's'} — ${BRL(valor)}`);
    else if (d === 0) lines.push(`${icone} ${nome} vence hoje — ${BRL(valor)}`);
    else lines.push(`${icone} ${nome} vence em ${d} dia${d === 1 ? '' : 's'} (${dm(venc)}) — ${BRL(valor)}`);
  });

  // 2) limites por categoria no mês atual
  const key = today.slice(0, 7);
  const start = key + '-01';
  const end = key + '-' + pad(lastDayOfMonth(key));
  const cats = {};
  const bucket = c => cats[c] || (cats[c] = { pago: 0, previsto: 0 });
  payments.forEach(p => {
    if (p.natureza !== 'despesa' || (p.data || '').slice(0, 7) !== key) return;
    if (p.tipo === 'fatura' || p.categoria === CARD_CAT) return;
    bucket(p.categoria || 'Outros').pago += Number(p.valor) || 0;
  });
  items.forEach(i => {
    if (!DESPESA.has(i.tipo) || isDone(i) || !i.dataVencimento) return;
    if (catOf(i) === CARD_CAT) return;
    if ((i.dataVencimento >= start && i.dataVencimento <= end) || i.dataVencimento < start) bucket(catOf(i)).previsto += Number(i.valorParcela) || 0;
  });
  Object.entries(cats).forEach(([c, v]) => {
    const lim = Number((settings.limites || {})[c]) || 0;
    if (!(lim > 0)) return;
    const total = v.pago + v.previsto;
    const p = total / lim * 100;
    if (p >= 100) lines.push(`🚨 ${c}: limite estourado (${BRL(total)} de ${BRL(lim)})`);
    else if (p >= pct) lines.push(`⚠️ ${c}: ${Math.round(p)}% do limite (${BRL(total)} de ${BRL(lim)})`);
  });

  // 3) limite de gastos de cada cartão no mês atual
  (settings.cartoes || []).forEach(card => {
    const lim = Number(card.limite) || 0;
    if (!(lim > 0)) return;
    let total = 0;
    payments.forEach(p => { if (p.tipo === 'cartao' && p.cartaoId === card.id && (p.data || '').slice(0, 7) === key) total += Number(p.valor) || 0; });
    invs.forEach(inv => { if (inv.card.id === card.id && inv.semDetalhe > 0 && inv.attrKey === key) total += inv.semDetalhe; });
    const p = total / lim * 100;
    if (p >= 100) lines.push(`🚨 Cartão ${card.nome}: limite do mês estourado (${BRL(total)} de ${BRL(lim)})`);
    else if (p >= pct) lines.push(`⚠️ Cartão ${card.nome}: ${Math.round(p)}% do limite do mês (${BRL(total)} de ${BRL(lim)})`);
  });

  return { lines };
}

function safeJSON(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }

async function main() {
  const admin = require('firebase-admin');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: process.env.DATABASE_URL || 'https://financaspessoais-92164-default-rtdb.firebaseio.com'
  });
  const dryRun = process.env.DRY_RUN === '1';
  const users = (await admin.database().ref('users').once('value')).val() || {};
  const today = todayISO();
  console.log(`Hoje (Brasília): ${today} — famílias: ${Object.keys(users).length}${dryRun ? ' [TESTE: nada será enviado]' : ''}`);

  let familiasAvisadas = 0;
  for (const [uid, u] of Object.entries(users)) {
    if (u.profile && u.profile.disabled) continue;
    const tokenEntries = Object.entries(u.tokens || {}).filter(([, t]) => t && t.token);
    if (!tokenEntries.length) { console.log(`- ${uid}: sem aparelhos com notificação ativada`); continue; }

    const items = safeJSON(u.items, []);
    const payments = safeJSON(u.payments, []);
    const settings = Object.assign({ alertaDias: 3, alertaPct: 80, limites: {} }, safeJSON(u.settings, {}));
    const { lines } = buildAlerts({ items, payments, settings, today });
    if (!lines.length) { console.log(`- ${uid}: nada a avisar hoje`); continue; }

    const title = `Nossas finanças · ${lines.length} alerta${lines.length === 1 ? '' : 's'}`;
    const shown = lines.slice(0, 4);
    const body = shown.join('\n') + (lines.length > shown.length ? `\n+ ${lines.length - shown.length} mais` : '');
    console.log(`- ${uid}: ${lines.length} alerta(s) → ${tokenEntries.length} aparelho(s)\n${body}`);
    if (dryRun) continue;

    const res = await admin.messaging().sendEachForMulticast({
      tokens: tokenEntries.map(([, t]) => t.token),
      data: { title, body, url: SITE_URL },
      webpush: { headers: { Urgency: 'high', TTL: '43200' } }
    });
    familiasAvisadas++;
    // limpa aparelhos que não existem mais
    const dead = [];
    res.responses.forEach((r, idx) => {
      const code = r.error && r.error.code;
      if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) dead.push(tokenEntries[idx][0]);
    });
    for (const key of dead) await admin.database().ref(`users/${uid}/tokens/${key}`).remove();
    console.log(`  enviado: ${res.successCount} ok, ${res.failureCount} falha(s), ${dead.length} aparelho(s) removido(s)`);
  }
  console.log(`Concluído. Famílias avisadas: ${familiasAvisadas}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { buildAlerts, todayISO };
