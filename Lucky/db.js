const { Pool } = require("pg");
const fs = require("fs");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

let pool = null;

function dbEnabled() {
  return Boolean(DATABASE_URL);
}

function buildSslConfig() {
  // Neon and most managed Postgres require TLS. Prefer verifying the CA.
  // Set DATABASE_SSL_REJECT_UNAUTHORIZED=0 only as a temporary escape hatch.
  const rejectUnauthorized =
    String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || "1").trim() !== "0";
  const caPath = String(process.env.DATABASE_SSL_CA || "").trim();
  const ssl = { rejectUnauthorized };
  if (caPath && fs.existsSync(caPath)) {
    ssl.ca = fs.readFileSync(caPath, "utf8");
  }
  // Neon connection strings usually include sslmode=require; Node pg still needs ssl object.
  return ssl;
}

function getPool() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: buildSslConfig(),
      max: 8,
    });
  }
  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  dbEnabled,
  getPool,
  query,
  withTransaction,
};
