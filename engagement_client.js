// ============================================================
// MODULE ENGAGEMENT CLIENT — Comptoir Hammami
// Google Sheet ID : 1y96F4UKFrysX032wjFJKuTLl67LaLXrDJ5YuP9-dXQo
// ============================================================

const fetch = require('node-fetch');

const SHEET_ID   = '1y96F4UKFrysX032wjFJKuTLl67LaLXrDJ5YuP9-dXQo';
const SHEET_NAME = encodeURIComponent('eng 26-02-2026');

// ---- Cache des données ----
let engagementData = [];
let lastEngFetch   = 0;

// ---- Chargement via Google Sheets JSON API (public) ----
async function loadEngagement() {
  if (Date.now() - lastEngFetch < 10 * 60 * 1000) return; // cache 10 min
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:T?key=${process.env.GOOGLE_API_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    const rows = data.values || [];
    if (rows.length < 2) return;
    const headers = rows[0];
    engagementData = rows.slice(1).map(row => ({
      code:            (row[0]  || '').trim(),
      name:            (row[1]  || '').trim(),
      vendeur:         (row[2]  || '').trim(),
      plafond:         parseFloat(row[3])  || 0,
      depassement:     parseFloat(row[4])  || 0,
      soldeImpaye:     parseFloat(row[6])  || 0,
      soldeFact:       parseFloat(row[8])  || 0,
      blNonFact:       parseFloat(row[9])  || 0,
      nonEchus:        parseFloat(row[10]) || 0,
      commandeEnCours: parseFloat(row[11]) || 0,
      soldeAvoir:      parseFloat(row[12]) || 0,
      paymentTerms:    (row[13] || '').trim(),
      paymentMethod:   (row[14] || '').trim(),
      quota:           parseFloat(row[16]) || 0,
      soldeEnCours:    parseFloat(row[17]) || 0,
      contentieux:     parseFloat(row[18]) || 0,
    })).filter(r => r.code);
    lastEngFetch = Date.now();
    console.log(`✅ Engagement chargé : ${engagementData.length} clients`);
  } catch (e) {
    console.error('Erreur engagement:', e.message);
  }
}

// ---- Recherche par nom ou code ----
function findClient(query) {
  const q = query.toLowerCase().trim();
  return engagementData.find(c =>
    c.code.toLowerCase().includes(q) ||
    c.name.toLowerCase().includes(q)
  );
}

// ---- Formatage de la réponse ----
function formatEngagement(c) {
  const fmt = n => Math.round(n).toLocaleString('fr-TN');

  const plafond   = c.plafond > 0 ? c.plafond : c.quota;
  const encours   = c.soldeEnCours;
  const margeDisp = plafond - encours;
  const pct       = plafond > 0 ? Math.round((encours / plafond) * 100) : null;

  // Statut
  let statut;
  if (!plafond || plafond === 0) {
    statut = '⚪ Pas de plafond défini — consulter direction';
  } else if (pct <= 70) {
    statut = `🟢 Situation saine — ${fmt(margeDisp)} DT disponibles`;
  } else if (pct <= 90) {
    statut = `🟡 Surveillance — ${fmt(margeDisp)} DT restants`;
  } else if (pct <= 100) {
    statut = `🔴 Proche limite — autorisation requise`;
  } else {
    statut = `⛔ Plafond dépassé de ${fmt(-margeDisp)} DT`;
  }

  // Suggestions
  const suggestions = [];
  if (c.soldeImpaye > 0)
    suggestions.push(`⚠️ Relancer impayés échus : ${fmt(c.soldeImpaye)} DT`);
  if (c.nonEchus > 0)
    suggestions.push(`✅ Paiements non échus : ${fmt(c.nonEchus)} DT`);
  if (c.blNonFact > 0)
    suggestions.push(`🚚 BL en attente facturation : ${fmt(c.blNonFact)} DT`);
  if (c.commandeEnCours > 0)
    suggestions.push(`📦 Commandes en cours : ${fmt(c.commandeEnCours)} DT`);
  if (c.contentieux > 0)
    suggestions.push(`🔒 Contentieux : ${fmt(c.contentieux)} DT`);
  if (suggestions.length === 0)
    suggestions.push('✅ Aucune alerte particulière');

  return (
    `🏢 *${c.name}*\n` +
    `📋 Code : \`${c.code}\`\n` +
    `👤 Vendeur : ${c.vendeur}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 Plafond crédit  : *${fmt(plafond)} DT*\n` +
    `📊 Encours total   : *${fmt(encours)} DT*${pct !== null ? ` (${pct}%)` : ''}\n` +
    `📉 Non échus       : ${fmt(c.nonEchus)} DT\n` +
    `⚠️  Échus (impayés): ${fmt(c.soldeImpaye)} DT\n` +
    `🚚 BL non facturés : ${fmt(c.blNonFact)} DT\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *STATUT*\n${statut}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 *SUGGESTIONS*\n${suggestions.join('\n')}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 ${c.paymentMethod} — ${c.paymentTerms}`
  );
}

// ---- Handler principal ----
async function handleClientEngagement(bot, chatId, text) {
  const query = text
    .replace(/^\/(client|eng)\s*/i, '')
    .trim();

  if (!query) {
    return bot.sendMessage(chatId,
      '📋 Usage : /client NomClient ou /client CL-XXXXXX\n\nExemple : /client SOGECAP'
    );
  }

  await loadEngagement();
  const client = findClient(query);

  if (!client) {
    return bot.sendMessage(chatId,
      `❌ Client introuvable : *${query}*\n\nVérifie le nom ou le code client.`,
      { parse_mode: 'Markdown' }
    );
  }

  bot.sendMessage(chatId, formatEngagement(client), { parse_mode: 'Markdown' });
}

module.exports = { handleClientEngagement };
