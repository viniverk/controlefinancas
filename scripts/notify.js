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
function isDone(i) { return !!(i.totalParcelas && i.parcelasPagas >= i.totalParcelas); }
function catOf(i) {
  if (i.categoria) return i.categoria;
  if (i.tipo === 'conta') return 'Contas de casa';
  if (i.tipo === 'financiamento' || i.tipo === 'emprestimo' || i.tipo === 'consorcio') return 'Financiamentos';
  return 'Outros';
}

/* Mesma regra usada na tela "Gastos e limites": gasto do mês = pagamentos do mês + contas ainda a pagar neste mês. */
function buildAlerts({ items, payments, settings, today }) {
  const dias = Number.isFinite(Number(settings.alertaDias)) ? Number(settings.alertaDias) : 3;
  const pct = Number(settings.alertaPct) || 80;
  const lines = [];

  // 1) contas perto de vencer / vencidas
  const due = [];
  items.forEach(i => {
    if (!DESPESA.has(i.tipo) || isDone(i) || !i.dataVencimento) return;
    const d = diffDays(i.dataVencimento, today);
    if (d <= dias) due.push({ i, d });
  });
  due.sort((a, b) => a.d - b.d);
  due.forEach(({ i, d }) => {
    if (d < 0) lines.push(`⚠️ ${i.nome} venceu há ${-d} dia${-d === 1 ? '' : 's'} — ${BRL(i.valorParcela)}`);
    else if (d === 0) lines.push(`🔔 ${i.nome} vence hoje — ${BRL(i.valorParcela)}`);
    else lines.push(`🔔 ${i.nome} vence em ${d} dia${d === 1 ? '' : 's'} (${dm(i.dataVencimento)}) — ${BRL(i.valorParcela)}`);
  });

  // 2) limites por categoria no mês atual
  const key = today.slice(0, 7);
  const start = key + '-01';
  const end = key + '-' + String(lastDayOfMonth(key)).padStart(2, '0');
  const cats = {};
  const bucket = c => cats[c] || (cats[c] = { pago: 0, previsto: 0 });
  payments.forEach(p => {
    if (p.natureza === 'despesa' && (p.data || '').slice(0, 7) === key) bucket(p.categoria || 'Outros').pago += Number(p.valor) || 0;
  });
  items.forEach(i => {
    if (!DESPESA.has(i.tipo) || isDone(i) || !i.dataVencimento) return;
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
