import { v4 as uuidv4 } from "uuid";

function normalizeChangeEvent(entry, change) {
  const value = change?.value;

  if (!entry || !change || !value) {
    return null;
  }

  // Only forward comment events that the rest of the pipeline can process safely.
  if (change.field !== "feed" || value.item !== "comment") {
    return null;
  }

  // Bo qua comment/reply do chinh Page tao ra de tranh vong lap tu reply chinh minh.
  if (value.from?.id && entry.id && value.from.id === entry.id) {
    return null;
  }
  
  return {
    schema_version: 1,
    event_id: `evt_${uuidv4()}`,
    event_type: "comment_created",
    source: "facebook",
    page_id: entry.id,
    post_id: value.post_id || null,
    comment_id: value.comment_id || null,
    user_id: value.from?.id || null,
    message: value.message || "",
    created_at: value.created_time || new Date().toISOString()
  };
}

export function normalizeFacebookEvents(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const events = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const normalizedEvent = normalizeChangeEvent(entry, change);

      if (normalizedEvent) {
        events.push(normalizedEvent);
      }
    }
  }

  return events;
}
