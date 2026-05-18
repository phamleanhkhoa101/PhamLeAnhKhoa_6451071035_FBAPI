import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "fb_api_db",
  user: process.env.POSTGRES_USER || "fb_api_user",
  password: process.env.POSTGRES_PASSWORD || "fb_api_password"
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      command_id VARCHAR(100) PRIMARY KEY,
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(20) NOT NULL
    );
  `);
}

export async function hasProcessedCommand(commandId) {
  const result = await pool.query(
    "SELECT command_id FROM idempotency_keys WHERE command_id = $1",
    [commandId]
  );

  return result.rowCount > 0;
}

export async function saveIdempotencyKey(commandId, status = "success") {
  await pool.query(
    `
    INSERT INTO idempotency_keys(command_id, status)
    VALUES($1, $2)
    ON CONFLICT(command_id) DO NOTHING
    `,
    [commandId, status]
  );
}