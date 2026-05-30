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
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id VARCHAR(100) PRIMARY KEY,
      status VARCHAR(20) NOT NULL,
      command_id VARCHAR(100),
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blacklist_users (
      user_id VARCHAR(100) PRIMARY KEY,
      reason TEXT NOT NULL,
      strike_count INTEGER NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function tryStartEventProcessing(event) {
  const inserted = await pool.query(
    `
    INSERT INTO processed_events(event_id, status)
    VALUES($1, 'processing')
    ON CONFLICT(event_id) DO NOTHING
    RETURNING event_id, status
    `,
    [event.event_id]
  );

  if (inserted.rowCount > 0) {
    return {
      started: true,
      status: "processing"
    };
  }

  const recovered = await pool.query(
    `
    UPDATE processed_events
    SET
      status = 'processing',
      command_id = NULL,
      error_message = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = $1 AND status = 'failed'
    RETURNING event_id, status
    `,
    [event.event_id]
  );

  if (recovered.rowCount > 0) {
    return {
      started: true,
      status: "processing"
    };
  }

  const existing = await pool.query(
    `
    SELECT status, command_id
    FROM processed_events
    WHERE event_id = $1
    `,
    [event.event_id]
  );

  return {
    started: false,
    status: existing.rows[0]?.status || "unknown",
    command_id: existing.rows[0]?.command_id || null
  };
}

export async function markEventProcessed(eventId, commandId) {
  await pool.query(
    `
    UPDATE processed_events
    SET
      status = 'processed',
      command_id = $2,
      error_message = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = $1
    `,
    [eventId, commandId]
  );
}

export async function markEventFailed(eventId, errorMessage) {
  await pool.query(
    `
    UPDATE processed_events
    SET
      status = 'failed',
      error_message = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = $1
    `,
    [eventId, errorMessage]
  );
}

export async function saveComment(event, aiResult, status, metadata = {}) {
  await pool.query(
    `
    INSERT INTO comments(
      event_id, comment_id, post_id, user_id, message, intent, sentiment, status, risk_level, review_reason
    )
    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT(event_id) DO UPDATE
    SET
      comment_id = EXCLUDED.comment_id,
      post_id = EXCLUDED.post_id,
      user_id = EXCLUDED.user_id,
      message = EXCLUDED.message,
      intent = EXCLUDED.intent,
      sentiment = EXCLUDED.sentiment,
      status = EXCLUDED.status,
      risk_level = EXCLUDED.risk_level,
      review_reason = EXCLUDED.review_reason,
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      event.event_id,
      event.comment_id,
      event.post_id,
      event.user_id,
      event.message,
      aiResult.intent,
      aiResult.sentiment,
      status,
      metadata.riskLevel || "low",
      metadata.reviewReason || null
    ]
  );
}

export async function updateCommentStatus(eventId, status, metadata = {}) {
  await pool.query(
    `
    UPDATE comments
    SET
      status = $2,
      risk_level = COALESCE($3, risk_level),
      review_reason = COALESCE($4, review_reason),
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = $1
    `,
    [
      eventId,
      status,
      metadata.riskLevel || null,
      metadata.reviewReason || null
    ]
  );
}

export async function isUserBlacklisted(userId) {
  if (!userId) {
    return false;
  }

  const result = await pool.query(
    `
    SELECT 1
    FROM blacklist_users
    WHERE user_id = $1 AND is_active = TRUE
    `,
    [userId]
  );

  return result.rowCount > 0;
}

export async function blacklistUser(userId, reason) {
  if (!userId) {
    return;
  }

  await pool.query(
    `
    INSERT INTO blacklist_users(user_id, reason, strike_count, is_active)
    VALUES($1, $2, 1, TRUE)
    ON CONFLICT(user_id) DO UPDATE
    SET
      reason = EXCLUDED.reason,
      strike_count = blacklist_users.strike_count + 1,
      is_active = TRUE,
      updated_at = CURRENT_TIMESTAMP
    `,
    [userId, reason]
  );
}

export async function countRecentCommentsByUser(userId, windowSeconds = 60) {
  if (!userId) {
    return 0;
  }

  const result = await pool.query(
    `
    SELECT COUNT(*)::INT AS total
    FROM comments
    WHERE user_id = $1
      AND created_at >= NOW() - ($2 * INTERVAL '1 second')
    `,
    [userId, windowSeconds]
  );

  return result.rows[0]?.total || 0;
}

export async function countRecentSpamEventsByUser(userId, lookbackHours = 24) {
  if (!userId) {
    return 0;
  }

  const result = await pool.query(
    `
    SELECT COUNT(*)::INT AS total
    FROM comments
    WHERE user_id = $1
      AND status IN ('spam_detected', 'hidden_pending_review', 'blacklisted')
      AND updated_at >= NOW() - ($2 * INTERVAL '1 hour')
    `,
    [userId, lookbackHours]
  );

  return result.rows[0]?.total || 0;
}
export async function countDuplicateRecentMessagesByUser(
  userId,
  message,
  windowMinutes = 10
) {
  if (!userId || !message) {
    return 0;
  }

  const result = await pool.query(
    `
    SELECT COUNT(*)::INT AS total
    FROM comments
    WHERE user_id = $1
      AND LOWER(TRIM(message)) = LOWER(TRIM($2))
      AND created_at >= NOW() - ($3 * INTERVAL '1 minute')
    `,
    [userId, message, windowMinutes]
  );

  return result.rows[0]?.total || 0;
}

export async function countRecentLowValueCommentsByUser(
  userId,
  windowMinutes = 5,
  maxLength = 2
) {
  if (!userId) {
    return 0;
  }

  const result = await pool.query(
    `
    SELECT COUNT(*)::INT AS total
    FROM comments
    WHERE user_id = $1
      AND LENGTH(TRIM(COALESCE(message, ''))) <= $2
      AND created_at >= NOW() - ($3 * INTERVAL '1 minute')
    `,
    [userId, maxLength, windowMinutes]
  );

  return result.rows[0]?.total || 0;
}