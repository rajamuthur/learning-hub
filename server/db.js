import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('\n[db] DATABASE_URL is not set. Copy .env.example to .env and set your Neon/Postgres connection string.\n');
}

// Neon (and most hosted Postgres) require SSL. Allow disabling for a purely
// local Postgres via PGSSL=disable.
const ssl =
  process.env.PGSSL === 'disable'
    ? false
    : { rejectUnauthorized: false };

export const pool = new Pool({
  connectionString,
  ssl,
  max: 5,
  idleTimeoutMillis: 30000,
});

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
