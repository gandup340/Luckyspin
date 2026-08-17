require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

async function main() {
  const url = process.env.DATABASE_URL;
  console.log("has DATABASE_URL:", Boolean(url));
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'players' ORDER BY 1`
  );
  console.log("columns:", cols.rows.map((r) => r.column_name).join(", "));
  await client.end();
}

main().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});
