const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CATALOGUE_URL  = process.env.CATALOGUE_URL;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log("🤖 Back Office Hammami démarré !");

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

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!text) return;

  await loadCatalogue();

  if (text === "/start" || text === "/aide") {
    return bot.sendMessage(chatId,
      `👋 *Back Office Hammami — EMTOP*\n\nTape un mot-clé pour chercher un article :\n\nExemples :\n• meule 115\n• perforateur 800\n• EAGR07581\n• pompe submersible\n\nJe te donne le stock et le prix HT instantanément.`,
      { parse_mode: "Markdown" }
    );
  }

  const resultats = rechercher(text);

  if (resultats.length === 0) {
    return bot.sendMessage(chatId,
      `❓ Aucun article trouvé pour *"${text}"*\n\nEssaie avec d'autres mots-clés.`,
      { parse_mode: "Markdown" }
    );
  }

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
  bot.sendMessage(chatId, reponse, { parse_mode: "Markdown" });
});

console.log("En attente de messages...");
