import { v4 as uuidv4 } from "uuid";

export function normalizeFacebookEvent(body) {
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  if (!entry || !change || !value) {
    return null;
  }

  return {
    schema_version: 1,
    event_id: `evt_${uuidv4()}`,
    event_type: change.field || "comment_created",
    source: "facebook",
    page_id: entry.id,
    post_id: value.post_id || null,
    comment_id: value.comment_id || null,
    user_id: value.from?.id || null,
    message: value.message || "",
    created_at: new Date().toISOString()
  };
}