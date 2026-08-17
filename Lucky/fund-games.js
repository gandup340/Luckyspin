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
  gamevault: {
    id: "gamevault",
    label: "GameVault",
    aliases: ["gamevault", "game vault", "game-vault", "gvault", "gv"],
  },
  orion: {
    id: "orion",
    label: "Orion",
    aliases: ["orion", "orionstar", "orionstars", "orion star", "orion stars"],
  },
};

function allAliases() {
  return Object.values(GAMES).flatMap((g) => g.aliases.map((a) => a.toLowerCase()));
}

function gameLabel(id) {
  return GAMES[id]?.label || "Juwa";
}

function supportedGameIds() {
  return Object.keys(GAMES);
}

function isSupportedGame(id) {
  return Boolean(GAMES[String(id || "").toLowerCase()]);
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
  const ids = Object.values(GAMES).map((g) => g.id);
  const options =
    ids.length <= 2 ? ids.join(" or ") : `${ids.slice(0, -1).join(", ")}, or ${ids[ids.length - 1]}`;
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
  supportedGameIds,
  isSupportedGame,
};
