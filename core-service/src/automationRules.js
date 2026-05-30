export function decideAction(event, aiResult, moderationContext = {}) {
  const {
    isBlacklisted = false,
    isRateLimited = false,
    isHighRisk = false,
    highRiskReason = null,
    isSpam = false,
    spamStrikeCount = 0,
    spamThreshold = 3
  } = moderationContext;

  if (isBlacklisted) {
    return {
      action: "pending_review",
      reply_text: null,
      status: "blacklisted",
      review_reason: "user_blacklisted",
      risk_level: "high",
      blacklistUser: false
    };
  }

  if (isRateLimited) {
    return {
      action: "pending_review",
      reply_text: null,
      status: "pending_review",
      review_reason: "rate_limited",
      risk_level: "medium",
      blacklistUser: false
    };
  }

  if (isHighRisk) {
    return {
      action: "hide_comment",
      reply_text: null,
      status: "hidden_pending_review",
      review_reason: highRiskReason || "high_risk_content",
      risk_level: "high",
      blacklistUser: true,
      blacklistReason: highRiskReason || "high_risk_content"
    };
  }

  if (isSpam && spamStrikeCount >= spamThreshold) {
    return {
      action: "hide_comment",
      reply_text: null,
      status: "blacklisted",
      review_reason: "spam_repeat_offender",
      risk_level: "high",
      blacklistUser: true,
      blacklistReason: "spam_repeat_offender"
    };
  }

  if (isSpam) {
    return {
      action: "hide_comment",
      reply_text: null,
      status: "spam_detected",
      review_reason: "light_spam",
      risk_level: "medium",
      blacklistUser: false
    };
  }

  if (aiResult.intent === "ask_price") {
    return {
      action: "reply",
      reply_text: "Da shop da gui thong tin chi tiet qua inbox cho ban a.",
      status: "auto_reply",
      review_reason: null,
      risk_level: "low",
      blacklistUser: false
    };
  }

  if (aiResult.sentiment === "negative") {
    return {
      action: "reply",
      reply_text: "Rat xin loi vi trai nghiem chua tot. Ben minh se kiem tra va ho tro ban ngay.",
      status: "auto_reply",
      review_reason: null,
      risk_level: "low",
      blacklistUser: false
    };
  }

  if (aiResult.sentiment === "positive") {
    return {
      action: "reply",
      reply_text: "Cam on ban da ung ho shop!",
      status: "auto_reply",
      review_reason: null,
      risk_level: "low",
      blacklistUser: false
    };
  }

  return {
    action: "pending_review",
    reply_text: null,
    status: "pending_review",
    review_reason: "manual_review_needed",
    risk_level: "low",
    blacklistUser: false
  };
}