const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

let pool = null;

function dbEnabled() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
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
