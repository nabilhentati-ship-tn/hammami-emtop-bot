const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");
 
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CATALOGUE_URL  = process.env.CATALOGUE_URL;
const GROQ_API_KEY   = process.env.GROQ_API_KEY; // Nouvelle variable à ajouter sur Railway
 
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log("🤖 Back Office Hammami EMTOP + IA démarré !");
 
// ─────────────────────────────────────────────
// CATALOGUE
// ─────────────────────────────────────────────
let catalogue = [];
let lastFetch = 0;
 
async function loadCatalogue() {
  if (Date.now() - lastFetch < 5 * 60 * 1000) return;
  try {
    const res = await fetch(CATALOGUE_URL);
    const csv = await res.text();
    const lines = csv.trim().split("\n").slice(1);
    catalogue = lines.map(line => {
      const cols = line.split(",");
      return {
        ref:   (cols[0] || "").replace(/"/g, "").trim(),
        nom:   (cols[1] || "").replace(/"/g, "").trim(),
        stock: parseFloat((cols[2] || "0").replace(/"/g, "")) || 0,
        unite: (cols[3] || "").replace(/"/g, "").trim(),
        prix:  parseFloat((cols[4] || "0").replace(/"/g, "")) || 0,
      };
    }).filter(p => p.ref);
    lastFetch = Date.now();
    console.log(`✅ Catalogue chargé : ${catalogue.length} articles`);
  } catch (e) {
    console.error("Erreur catalogue:", e.message);
  }
}
 
// ─────────────────────────────────────────────
// RECHERCHE CATALOGUE
// ─────────────────────────────────────────────
function rechercher(query) {
  const mots = query.toLowerCase().trim().split(/\s+/);
  return catalogue.filter(p => {
    const texte = (p.ref + " " + p.nom).toLowerCase();
    return mots.every(mot => texte.includes(mot));
  });
}
 
function formatArticle(p) {
  const stockInfo = p.stock === 0
    ? "❌ Rupture de stock"
    : p.stock < 5
    ? `⚠️ Stock faible : ${p.stock} ${p.unite}`
    : `✅ Stock : ${p.stock} ${p.unite}`;
  return `📦 *${p.nom}*\n🔖 Réf : ${p.ref}\n${stockInfo}\n💰 Prix HT : ${p.prix.toFixed(3)} DT`;
}
 
// ─────────────────────────────────────────────
// ROUTEUR : simple ou complexe ?
// ─────────────────────────────────────────────
function estQuestionComplexe(text) {
  const t = text.toLowerCase();
 
  // Référence exacte connue → simple
  const estReference = /^[a-z]{2,6}[\-\d]{4,}$/i.test(text.trim());
  if (estReference) return false;
 
  // Mots-clés qui indiquent une intention de conseil ou comparaison
  const motsComplexes = [
    "meilleur", "mieux", "conseil", "recommande", "comparer", "comparaison",
    "différence", "lequel", "laquelle", "pour quoi", "pourquoi", "choisir",
    "besoin", "travaux", "chantier", "béton", "beton", "bois", "métal", "metal",
    "budget", "moins cher", "pas cher", "qualité", "puissant", "adapté",
    "convient", "utiliser", "usage", "professionnel", "débutant"
  ];
 
  if (motsComplexes.some(m => t.includes(m))) return true;
 
  // Question avec point d'interrogation
  if (text.includes("?")) return true;
 
  // Phrase longue (plus de 4 mots) → probablement complexe
  if (text.trim().split(/\s+/).length > 4) return true;
 
  return false;
}
 
// ─────────────────────────────────────────────
// AGENT GROQ IA
// ─────────────────────────────────────────────
async function demanderGroq(question, articles) {
  if (!GROQ_API_KEY) return null;
 
  // On prépare un résumé compact des articles trouvés pour le contexte
  const contexte = articles.slice(0, 10).map(p =>
    `- ${p.nom} (Réf: ${p.ref}) | Prix: ${p.prix.toFixed(3)} DT | Stock: ${p.stock} ${p.unite}`
  ).join("\n");
 
  const prompt = articles.length > 0
    ? `Tu es l'assistant commercial de Comptoir Hammami, spécialisé en outillage EMTOP.
Un commercial te pose cette question : "${question}"
 
Voici les articles disponibles dans le catalogue qui correspondent :
${contexte}
 
Réponds en français, de façon concise (max 5 lignes). Conseille le meilleur choix selon la question, mentionne le prix et le stock. Si plusieurs articles, compare-les brièvement et recommande un.`
    : `Tu es l'assistant commercial de Comptoir Hammami, spécialisé en outillage EMTOP.
Un commercial te pose cette question : "${question}"
 
Aucun article correspondant n'a été trouvé dans le catalogue.
Réponds en français, suggère comment reformuler la recherche ou quels mots-clés utiliser.`;
 
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.3
      })
    });
 
    const data = await res.json();
    if (data.choices && data.choices[0]) {
      return data.choices[0].message.content.trim();
    }
    return null;
  } catch (e) {
    console.error("Erreur Groq:", e.message);
    return null;
  }
}
 
// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!text) return;
 
  await loadCatalogue();
 
  // Commandes de base
  if (text === "/start" || text === "/aide") {
    return bot.sendMessage(chatId,
      `👋 *Back Office Hammami — EMTOP IA*\n\nJe comprends maintenant le langage naturel !\n\n*Recherche directe :*\n• meule 115\n• perforateur 800\n• EAGR07581\n\n*Questions intelligentes :*\n• Quelle perceuse pour béton armé ?\n• Meilleure meuleuse pas chère ?\n• Comparer deux références\n\n✨ _Propulsé par IA Groq — Gratuit_`,
      { parse_mode: "Markdown" }
    );
  }
 
  const complexe = estQuestionComplexe(text);
  const resultats = rechercher(text);
 
  // ── CAS 1 : Question simple + résultats trouvés → réponse directe
  if (!complexe && resultats.length > 0) {
    if (resultats.length > 5) {
      const liste = resultats.slice(0, 5).map(p =>
        `• ${p.nom} — Stock: ${p.stock} ${p.unite} — ${p.prix.toFixed(3)} DT`
      ).join("\n");
      return bot.sendMessage(chatId,
        `🔍 *${resultats.length} articles trouvés* (top 5) :\n\n${liste}\n\n_Précise ta recherche pour plus de détails._`,
        { parse_mode: "Markdown" }
      );
    }
    const reponse = resultats.map(formatArticle).join("\n\n─────────────\n\n");
    return bot.sendMessage(chatId, reponse, { parse_mode: "Markdown" });
  }
 
  // ── CAS 2 : Question complexe ou aucun résultat → agent IA
  // Envoyer un message d'attente
  const msgAttente = await bot.sendMessage(chatId, "🤖 _Analyse en cours..._", { parse_mode: "Markdown" });
 
  const reponseIA = await demanderGroq(text, resultats);
 
  // Supprimer le message d'attente
  try { await bot.deleteMessage(chatId, msgAttente.message_id); } catch(e) {}
 
  if (reponseIA) {
    // Réponse IA + articles bruts en dessous si trouvés
    let message = `🧠 *Assistant IA :*\n\n${reponseIA}`;
 
    if (resultats.length > 0) {
      message += `\n\n─────────────\n📋 *Articles correspondants :*\n\n`;
      message += resultats.slice(0, 3).map(formatArticle).join("\n\n─────────────\n\n");
    }
 
    return bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  }
 
  // ── CAS 3 : Groq indisponible → fallback recherche classique
  if (resultats.length === 0) {
    return bot.sendMessage(chatId,
      `❓ Aucun article trouvé pour *"${text}"*\n\nEssaie avec d'autres mots-clés.`,
      { parse_mode: "Markdown" }
    );
  }
 
  const reponse = resultats.map(formatArticle).join("\n\n─────────────\n\n");
  return bot.sendMessage(chatId, reponse, { parse_mode: "Markdown" });
});
 
console.log("En attente de messages...");
