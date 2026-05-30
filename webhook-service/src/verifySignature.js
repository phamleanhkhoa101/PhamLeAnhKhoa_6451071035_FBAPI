import crypto from "crypto";

export function verifyFacebookSignature(req, appSecret) {
  const signature = req.headers["x-hub-signature-256"];

  if (!signature || !appSecret || !req.rawBody) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(req.rawBody)
      .digest("hex");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    actualBuffer,
    expectedBuffer
  );
}
