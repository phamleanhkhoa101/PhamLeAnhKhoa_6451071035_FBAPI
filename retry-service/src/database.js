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

  await pool.query(`
    ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);

  await pool.query(`
    ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'low';
  `);

  await pool.query(`
    ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS review_reason TEXT;
  `);

  await pool.query(`
    ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS current_action VARCHAR(30);
  `);

  await pool.query(`
    ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS command_id VARCHAR(100);
  `);

  await pool.query(`
    ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS last_error TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comment_status_history (
      id SERIAL PRIMARY KEY,
      event_id VARCHAR(100) NOT NULL,
      status VARCHAR(30) NOT NULL,
      source_service VARCHAR(50) NOT NULL,
      command_id VARCHAR(100),
      retry_count INTEGER DEFAULT 0,
      note TEXT,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_comment_status_history_event_id
    ON comment_status_history(event_id, created_at);
  `);
}

export async function updateCommentStatus(eventId, status, metadata = {}) {
  await pool.query(
    `
    INSERT INTO comments(event_id, status, risk_level, review_reason, current_action, command_id, retry_count, last_error)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT(event_id) DO NOTHING
    `,
    [
      eventId,
      status,
      metadata.riskLevel || "low",
      metadata.reviewReason || null,
      metadata.currentAction || null,
      metadata.commandId || null,
      metadata.retryCount || 0,
      metadata.errorMessage || null
    ]
  );

  await pool.query(
    `
    UPDATE comments
    SET
      status = $2,
      risk_level = COALESCE($3, risk_level),
      review_reason = COALESCE($4, review_reason),
      current_action = COALESCE($5, current_action),
      command_id = COALESCE($6, command_id),
      retry_count = COALESCE($7, retry_count),
      last_error = $8,
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = $1
    `,
    [
      eventId,
      status,
      metadata.riskLevel || null,
      metadata.reviewReason || null,
      metadata.currentAction || null,
      metadata.commandId || null,
      metadata.retryCount ?? null,
      metadata.errorMessage || null
    ]
  );
}

export async function appendCommentStatusHistory({
  eventId,
  status,
  sourceService,
  commandId = null,
  retryCount = 0,
  note = null,
  errorMessage = null
}) {
  await pool.query(
    `
    INSERT INTO comment_status_history(
      event_id, status, source_service, command_id, retry_count, note, error_message
    )
    VALUES($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      eventId,
      status,
      sourceService,
      commandId,
      retryCount,
      note,
      errorMessage
    ]
  );
}
