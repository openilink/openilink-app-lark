import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * 验证 Hub Webhook 签名
 * 签名算法: HMAC-SHA256(secret, timestamp + ":" + body)
 * 期望签名格式: "sha256=" + hex
 * 使用 timingSafeEqual 防止时序攻击
 */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: Buffer | string,
  signature: string,
): boolean {
  const mac = createHmac("sha256", secret);
  mac.update(timestamp + ":");
  mac.update(body);
  const expected = "sha256=" + mac.digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * 生成 PKCE code_verifier 和 code_challenge
 * verifier: 32 字节随机数的 base64url 编码
 * challenge: verifier 的 SHA-256 哈希的 base64url 编码
 */
export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
