import { createHmac, randomBytes, createHash } from "node:crypto";

/**
 * 验证 Hub Webhook 签名
 * 签名算法: HMAC-SHA256(secret, timestamp + ":" + body)
 */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: Buffer,
  signature: string,
): boolean {
  const mac = createHmac("sha256", secret);
  mac.update(timestamp + ":");
  mac.update(body);
  const expected = "sha256=" + mac.digest("hex");
  // 定长比较防时序攻击
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 生成 PKCE code_verifier 和 code_challenge
 */
export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("hex");
  return { verifier, challenge };
}
