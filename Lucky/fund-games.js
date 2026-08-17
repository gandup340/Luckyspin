/** Supported add-funds games (chat + automation). */

const GAMES = {
  juwa: {
    id: "juwa",
    label: "Juwa",
    aliases: ["juwa", "juwa777"],
  },
  milkyway: {
    id: "milkyway",
    label: "MilkyWay",
    aliases: ["milkyway", "milky way", "milky-way", "milky", "mw"],
  },
};

function allAliases() {
  return Object.values(GAMES).flatMap((g) => g.aliases.map((a) => a.toLowerCase()));
}

function gameLabel(id) {
  return GAMES[id]?.label || "Juwa";
}

function parseGameId(text) {
  const raw = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;
  if (GAMES[raw]) return raw;
  for (const g of Object.values(GAMES)) {
    for (const alias of g.aliases) {
      const a = alias.toLowerCase();
      if (raw === a) return g.id;
      if (a.includes(" ") && raw.includes(a)) return g.id;
      if (!a.includes(" ") && new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(raw)) {
        return g.id;
      }
    }
  }
  return null;
}

function askGameText(username) {
  const options = Object.values(GAMES)
    .map((g) => g.id)
    .join(" or ");
  const who = String(username || "").trim();
  if (who) return `Which game for ${who}? Reply ${options}.`;
  return `Which game? Reply ${options}.`;
}

module.exports = {
  GAMES,
  allAliases,
  gameLabel,
  parseGameId,
  askGameText,
};
