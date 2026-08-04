const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const gamesSrc = fs.readFileSync(path.join(__dirname, "games.js"), "utf8");
const match = gamesSrc.match(/window\.LUCKY_VIPS_GAMES = (\[[\s\S]*?\]);?\s*$/m);
if (!match) {
  // fallback: strip assignment
  const start = gamesSrc.indexOf("[");
  const end = gamesSrc.lastIndexOf("]");
  var raw = gamesSrc.slice(start, end + 1);
} else {
  var raw = match[1];
}

const games = Function(`"use strict"; return (${raw});`)().map((g, i) => ({
  id: `g${i + 1}`,
  ...g,
}));

const bootstrapPassword = String(process.env.ADMIN_PASSWORD || "luckyvipsadmin");

const config = {
  users: [
    {
      id: "u_admin",
      username: "admin",
      name: "Admin",
      passwordHash: bcrypt.hashSync(bootstrapPassword, 12),
      role: "admin",
      createdAt: Date.now(),
    },
  ],
  whatsapp: "0000000000",
  telegram: "lucky_vips_game",
  messenger: "luckyvipsgame",
  facebook: [
    {
      id: "fb1",
      name: "LUCKY VIPS GAME Official",
      url: "https://www.facebook.com/",
      desc: "Announcements & promos",
    },
    {
      id: "fb2",
      name: "LUCKY VIPS GAME Players",
      url: "https://www.facebook.com/",
      desc: "Community & winners",
    },
    {
      id: "fb3",
      name: "LUCKY VIPS GAME Agents",
      url: "https://www.facebook.com/",
      desc: "Agent network updates",
    },
    {
      id: "fb4",
      name: "LUCKY VIPS GAME Support",
      url: "https://www.facebook.com/",
      desc: "Help & verified contact",
    },
  ],
  winners: [
    { rank: 1, name: "Maya Cruz", amount: "$128.40" },
    { rank: 2, name: "Jordan Lee", amount: "$97.25" },
    { rank: 3, name: "Sam Rivera", amount: "$84.10" },
  ],
  payments: [
    { id: "pay_1", name: "Cash App", enabled: true },
    { id: "pay_2", name: "Venmo", enabled: true },
    { id: "pay_3", name: "Zelle", enabled: true },
    { id: "pay_4", name: "PayPal", enabled: true },
    { id: "pay_5", name: "Chime", enabled: true },
    { id: "pay_6", name: "Apple Pay", enabled: true },
    { id: "pay_7", name: "Crypto", enabled: true },
  ],
  spinPrizes: [
    { id: "sp7", label: "$7", enabled: true },
    { id: "sp2", label: "$2", enabled: true },
    { id: "sp11", label: "No Prize", enabled: true },
    { id: "sp10", label: "$10", enabled: true },
    { id: "sp4", label: "$4", enabled: true },
    { id: "sp8", label: "$8", enabled: true },
    { id: "sp12", label: "No Prize", enabled: true },
    { id: "sp1", label: "$1", enabled: true },
    { id: "sp6", label: "$6", enabled: true },
    { id: "sp9", label: "$9", enabled: true },
    { id: "sp13", label: "No Prize", enabled: true },
    { id: "sp3", label: "$3", enabled: true },
    { id: "sp5", label: "$5", enabled: true },
  ],
  games,
};

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, "data", "config.json"),
  JSON.stringify(config, null, 2)
);
fs.writeFileSync(
  path.join(__dirname, "data", "chats.json"),
  JSON.stringify({ conversations: [] }, null, 2)
);
fs.writeFileSync(
  path.join(__dirname, "data", "spins.json"),
  JSON.stringify({ spins: [] }, null, 2)
);
console.log(`Seeded ${games.length} games. Admin password: luckyvipsadmin`);
