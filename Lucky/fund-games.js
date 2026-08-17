/** Supported add-funds games (chat + automation). */

const GAMES = {
  juwa: {
    id: "juwa",
    label: "Juwa",
    aliases: ["juwa", "juwa777"],
  },
  juwa2: {
    id: "juwa2",
    label: "Juwa 2",
    aliases: ["juwa2", "juwa 2", "juwa-2"],
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
  const raw = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!raw) return null;
  if (GAMES[raw]) return raw;
  const aliases = Object.values(GAMES).flatMap((g) =>
    g.aliases.map((alias) => ({ id: g.id, alias: String(alias).toLowerCase() }))
  );
  aliases.sort((a, b) => b.alias.length - a.alias.length);
  for (const { id, alias } of aliases) {
    if (raw === alias) return id;
    if (alias.includes(" ") && raw.includes(alias)) return id;
    if (!alias.includes(" ") && new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(raw)) {
      return id;
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
