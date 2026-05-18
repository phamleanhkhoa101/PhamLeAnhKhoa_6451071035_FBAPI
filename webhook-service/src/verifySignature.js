import crypto from "crypto";

export function verifyFacebookSignature(req, appSecret) {
  const signature = req.headers["x-hub-signature-256"];

  if (!signature || !appSecret) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(req.rawBody)
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}