const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const CATALOGUE_URL  = process.env.CATALOGUE_URL;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const conversations = {};
console.log("🤖 Bot Hammami EMTOP démarré !");

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
    console.error("Erreur chargement catalogue:", e.message);
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text) return;

  await loadCatalogue();

  if (!conversations[chatId]) conversations[chatId] = [];
  conversations[chatId].push({ role: "user", content: text });
  if (conversations[chatId].length > 10) conversations[chatId].shift();

  const catalogueText = catalogue.slice(0, 800).map(p =>
    `REF:${p.ref} | ${p.nom} | STOCK:${p.stock} ${p.unite} | PRIX HT:${p.prix.toFixed(3)} DT`
  ).join("\n");

  const systemPrompt = `Tu es l'assistant commercial de Comptoir Hammami, spécialisé dans la gamme EMTOP.
Tu réponds uniquement aux questions sur le stock et les prix des articles EMTOP.
Réponds toujours en français, de façon claire et concise.
Si le stock est 0, dis clairement "rupture de stock".
Si le stock est faible (moins de 5), avertis que le stock est faible.
Voici le catalogue complet :

${catalogueText}

Règles :
- Si on demande le prix, donne le prix unitaire HT en DT avec 3 décimales
- Si on demande la dispo, donne le stock exact + unité
- Si on demande les deux, donne les deux
- Si l'article n'existe pas, dis-le clairement
- Tu peux faire des recherches approximatives (ex: "meule 115" trouve tous les articles meule 115)
- Pour plusieurs articles similaires, liste-les tous`;

  try {
    bot.sendChatAction(chatId, "typing");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: conversations[chatId]
      })
    });
    const data = await response.json();
    const reply = data.content?.[0]?.text || "Désolé, je n'ai pas pu traiter ta demande.";
    conversations[chatId].push({ role: "assistant", content: reply });
    bot.sendMessage(chatId, reply);
  } catch (e) {
    console.error("Erreur API:", e.message);
    bot.sendMessage(chatId, "⚠️ Erreur technique, réessaie dans quelques secondes.");
  }
});

console.log("En attente de messages...");
