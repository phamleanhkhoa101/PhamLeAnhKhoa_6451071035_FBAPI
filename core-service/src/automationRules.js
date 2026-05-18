export function decideAction(event, aiResult, isSpam) {
  if (isSpam) {
    return {
      action: "hide_comment",
      reply_text: null,
      status: "spam_detected"
    };
  }

  if (aiResult.sentiment === "positive") {
    return {
      action: "reply",
      reply_text: "Cảm ơn bạn đã ủng hộ shop!",
      status: "auto_reply"
    };
  }

  if (aiResult.sentiment === "negative") {
    return {
      action: "reply",
      reply_text:
        "Rất xin lỗi vì trải nghiệm chưa tốt. Bên mình sẽ kiểm tra và hỗ trợ bạn ngay.",
      status: "auto_reply"
    };
  }

  if (aiResult.intent === "ask_price") {
    return {
      action: "reply",
      reply_text: "Dạ shop đã gửi thông tin chi tiết qua inbox cho bạn ạ.",
      status: "auto_reply"
    };
  }

  return {
    action: "pending_review",
    reply_text: null,
    status: "pending_review"
  };
}