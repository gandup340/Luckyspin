const fs = require("fs");

/** Fully mixed order: cash amounts shuffled, No Prize spaced apart. */
const SPIN_ORDER = [
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
];

const path = "data/config.json";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.spinPrizes = SPIN_ORDER;
fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log(SPIN_ORDER.map((p) => p.label).join(" | "));
