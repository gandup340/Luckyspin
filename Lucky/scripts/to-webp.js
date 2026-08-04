const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function convertDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (![".jpg", ".jpeg", ".png"].includes(ext)) continue;
    const src = path.join(dir, file);
    const base = path.basename(file, ext);
    const dest = path.join(dir, `${base}.webp`);
    const quality = dir.includes("payments") ? 90 : 78;
    await sharp(src).webp({ quality, effort: 4 }).toFile(dest);
    fs.unlinkSync(src);
    console.log(path.relative(process.cwd(), dest), fs.statSync(dest).size);
  }
}

function rewriteAssetExt(text) {
  return text.replace(
    /assets\/(games|payments|bg)\/([a-z0-9-]+)\.(jpg|jpeg|png)/gi,
    "assets/$1/$2.webp"
  );
}

(async () => {
  await convertDir(path.join("assets", "games"));
  await convertDir(path.join("assets", "payments"));
  await convertDir(path.join("assets", "bg"));

  for (const file of ["data/config.json", "games.js", "styles.css"]) {
    const next = rewriteAssetExt(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, next);
  }

  let js = fs.readFileSync("script.js", "utf8");
  js = js.replace(
    /"(cashapp|venmo|zelle|paypal|chime|applepay|googlepay|bitcoin|stripe|bank|generic)\.png"/g,
    '"$1.webp"'
  );
  fs.writeFileSync("script.js", js);

  const sample = JSON.parse(fs.readFileSync("data/config.json", "utf8")).games[0].image;
  console.log("sample", sample);
  console.log("done");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
