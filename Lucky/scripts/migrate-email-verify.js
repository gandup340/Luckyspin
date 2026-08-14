require("dotenv").config();
const { Client } = require("pg");

const sql = `
ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verify_code_hash TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verify_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS players_email_unique ON players (lower(email)) WHERE email <> '';
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'players' AND column_name LIKE 'email%'
     ORDER BY 1`
  );
  console.log("OK columns:", r.rows.map((row) => row.column_name).join(", "));
  await client.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
