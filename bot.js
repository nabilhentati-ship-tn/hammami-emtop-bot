const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");
 
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CATALOGUE_URL  = process.env.CATALOGUE_URL;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const PHOTOS_URL     = process.env.PHOTOS_URL;
 
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log("🤖 Back Office Hammami EMTOP + IA + Photos démarré !");
 
// ─────────────────────────────────────────────
// CATALOGUE
// ─────────────────────────────────────────────
let catalogue = [];
let lastFetch = 0;
 
async function loadCatalogue() {
  if (Date.now() - lastFetch < 5 * 60 * 1000) return;
  try {
    const res = await fetch(CATALOGUE_URL);
    const buffer = await res.buffer();
    const csv = buffer.toString("utf-8");
    const lines = csv.trim().split("\n").slice(1);
    catalogue = lines.map(line => {
      const cols = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || line.split(",");
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
// PHOTOS
// ─────────────────────────────────────────────
let photos = {};
let lastPhotoFetch = 0;
 
async function loadPhotos() {
  if (Date.now() - lastPhotoFetch < 30 * 60 * 1000) return;
  try {
    const res = await fetch(PHOTOS_URL);
    const buffer = await res.buffer();
    const csv = buffer.toString("utf-8");
    const lines = csv.trim().split("\n").slice(1);
    photos = {};
    lines.forEach(line => {
      const cols = line.split(",");
      const ref = (cols[0] || "").replace(/"/g, "").trim();
      const fileId = (cols[1] || "").replace(/"/g, "").trim();
const url = `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
      if (ref && url) photos[ref] = url;
    });
    lastPhotoFetch = Date.now();
    console.log(`✅ Photos chargées : ${Object.keys(photos).length} URLs`);
  } catch (e) {
    console.error("Erreur photos:", e.message);
  }
}
 
// ─────────────────────────────────────────────
// NORMALISATION
// ─────────────────────────────────────────────
function normaliser(texte) {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, " ");
}
 
// ─────────────────────────────────────────────
// RECHERCHE FLOUE
// ─────────────────────────────────────────────
function rechercher(query) {
  const mots = normaliser(query)
    .trim()
    .split(/\s+/)
    .filter(m => m.length > 2);
  if (mots.length === 0) return [];
  return catalogue
    .map(p => {
      const texte = normaliser(p.ref + " " + p.nom);
      const score = mots.filter(mot => texte.includes(mot)).length;
      return { ...p, score };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
 
// ─────────────────────────────────────────────
// FORMAT ARTICLE (texte)
// ─────────────────────────────────────────────
function formatArticle(p) {
  const stockInfo = p.stock === 0
    ? "❌ Rupture de stock"
    : p.stock < 5
    ? `⚠️ Stock faible : ${p.stock} ${p.unite}`
    : `✅ Stock : ${p.stock} ${p.unite}`;
  return `📦 *${p.nom}*\n🔖 Réf : \`${p.ref}\`\n${stockInfo}\n💰 Prix HT : ${p.prix.toFixed(3)} DT`;
}
 
// ─────────────────────────────────────────────
// ENVOYER ARTICLE AVEC PHOTO
// ─────────────────────────────────────────────
async function envoyerArticle(chatId, article) {
  const texte = formatArticle(article);
  const photoUrl = photos[article.ref];
 
  if (photoUrl) {
    try {
      await bot.sendPhoto(chatId, photoUrl, {
        caption: texte,
        parse_mode: "Markdown"
      });
      return;
    } catch (e) {
      console.error(`Photo échouée pour ${article.ref}:`, e.message);
    }
  }
  // Fallback texte si pas de photo
  await bot.sendMessage(chatId, texte, { parse_mode: "Markdown" });
}
 
// ─────────────────────────────────────────────
// ROUTEUR
// ─────────────────────────────────────────────
function estQuestionComplexe(text) {
  const t = normaliser(text);
  if (/^[a-z]{2,6}[\-\d]{4,}$/i.test(text.trim())) return false;
  const motsComplexes = [
    "meilleur", "mieux", "conseil", "recommande", "comparer", "comparaison",
    "difference", "lequel", "laquelle", "choisir", "besoin", "chantier",
    "beton", "bois", "metal", "budget", "moins cher", "pas cher", "qualite",
    "puissant", "adapte", "convient", "utiliser", "usage", "professionnel"
  ];
  if (motsComplexes.some(m => t.includes(m))) return true;
  if (text.includes("?")) return true;
  if (text.trim().split(/\s+/).length > 4) return true;
  return false;
}
 
function extraireMotsCles(texte) {
  const stopWords = [
    "quelle", "quel", "quels", "quelles", "pour", "une", "les", "des",
    "est", "son", "sur", "chantier", "besoin", "meilleur", "meilleure",
    "bon", "bonne", "usage", "utiliser", "adapter", "adapte", "conseille",
    "recommande", "avoir", "faire", "avec", "dans", "plus", "tres"
  ];
  return texte.split(/\s+/)
    .filter(m => m.length > 3 && !stopWords.includes(normaliser(m)))
    .join(" ");
}
 
// ─────────────────────────────────────────────
// AGENT GROQ
// ─────────────────────────────────────────────
async function demanderGroq(question, articles) {
  if (!GROQ_API_KEY) return null;
  const contexte = articles.slice(0, 8).map(p =>
    `- ${p.nom} (Réf: ${p.ref}) | Prix: ${p.prix.toFixed(3)} DT | Stock: ${p.stock} ${p.unite}`
  ).join("\n");
  const prompt = articles.length > 0
    ? `Tu es l'assistant commercial de Comptoir Hammami, distributeur d'outillage EMTOP en Tunisie.
Question du commercial : "${question}"
 
Articles disponibles :
${contexte}
 
Réponds en français, max 4 lignes. Recommande le meilleur article, explique pourquoi en une phrase, mentionne prix et stock.`
    : `Tu es l'assistant commercial de Comptoir Hammami, distributeur d'outillage EMTOP en Tunisie.
Question : "${question}"
Aucun article trouvé. Suggère en 2 lignes comment reformuler avec des termes techniques précis.`;
 
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
    if (data.choices && data.choices[0]) return data.choices[0].message.content.trim();
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
  await loadPhotos();
 
  // Commandes
  if (text === "/start" || text === "/aide") {
    return bot.sendMessage(chatId,
      `👋 *Back Office Hammami — EMTOP IA*\n\n` +
      `Je comprends le langage naturel et j'affiche les photos produits !\n\n` +
      `*Recherche directe :*\n• meule 115\n• motopompe diesel\n• ECDL12620\n\n` +
      `*Questions intelligentes :*\n• Quelle motopompe pour chantier ?\n• Meilleure visseuse 20V ?\n• Comparer deux références ?\n\n` +
      `✨ _Propulsé par IA Groq — Gratuit_`,
      { parse_mode: "Markdown" }
    );
  }
 
  const complexe = estQuestionComplexe(text);
  const queryRecherche = complexe ? extraireMotsCles(text) || text : text;
  const resultats = rechercher(queryRecherche);
 
  // CAS 1 : Simple + résultats → photo + fiche
  if (!complexe && resultats.length > 0) {
    if (resultats.length > 5) {
      const liste = resultats.slice(0, 5).map(p =>
        `• ${p.nom}\n  Stock: ${p.stock} ${p.unite} — ${p.prix.toFixed(3)} DT`
      ).join("\n\n");
      return bot.sendMessage(chatId,
        `🔍 *${resultats.length} articles trouvés* (top 5) :\n\n${liste}\n\n_Précise ta recherche pour voir les photos._`,
        { parse_mode: "Markdown" }
      );
    }
    // Envoyer chaque article avec sa photo
    for (const article of resultats) {
      await envoyerArticle(chatId, article);
    }
    return;
  }
 
  // CAS 2 : Complexe → IA + photos
  const msgAttente = await bot.sendMessage(chatId, "🤖 _Analyse en cours..._", { parse_mode: "Markdown" });
  const reponseIA = await demanderGroq(text, resultats);
  try { await bot.deleteMessage(chatId, msgAttente.message_id); } catch(e) {}
 
  if (reponseIA) {
    await bot.sendMessage(chatId, `🧠 *Assistant IA :*\n\n${reponseIA}`, { parse_mode: "Markdown" });
    // Envoyer les 3 meilleurs articles avec photos
    for (const article of resultats.slice(0, 3)) {
      await envoyerArticle(chatId, article);
    }
    return;
  }
 
  // CAS 3 : Fallback
  if (resultats.length === 0) {
    return bot.sendMessage(chatId,
      `❓ Aucun article trouvé pour *"${text}"*\n\nEssaie avec :\n• motopompe, electropompe, vibreur\n• une dimension : 115, 125, 20V\n• une référence : ECDL, EGWP, EWPP`,
      { parse_mode: "Markdown" }
    );
  }
 
  for (const article of resultats.slice(0, 3)) {
    await envoyerArticle(chatId, article);
  }
});
 
console.log("En attente de messages...");
 
