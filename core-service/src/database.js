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
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      event_id VARCHAR(100) UNIQUE,
      comment_id VARCHAR(100),
      post_id VARCHAR(100),
      user_id VARCHAR(100),
      message TEXT,
      intent VARCHAR(50),
      sentiment VARCHAR(20),
      status VARCHAR(30) DEFAULT 'received',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function saveComment(event, aiResult, status) {
  await pool.query(
    `
    INSERT INTO comments(
      event_id, comment_id, post_id, user_id, message, intent, sentiment, status
    )
    VALUES($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT(event_id) DO NOTHING
    `,
    [
      event.event_id,
      event.comment_id,
      event.post_id,
      event.user_id,
      event.message,
      aiResult.intent,
      aiResult.sentiment,
      status
    ]
  );
}