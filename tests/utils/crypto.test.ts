/**
 * utils/crypto.ts 测试
 * 验证签名校验和 PKCE 生成
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature, generatePKCE } from "../../src/utils/crypto.js";

describe("verifySignature", () => {
  const secret = "test-webhook-secret";
  const timestamp = "1700000000";
  const body = Buffer.from('{"type":"event","data":{}}');

  /** 辅助函数：用相同算法计算正确的签名 */
  function computeSignature(sec: string, ts: string, b: Buffer): string {
    const mac = createHmac("sha256", sec);
    mac.update(ts + ":");
    mac.update(b);
    return "sha256=" + mac.digest("hex");
  }

  it("正确的签名应返回 true", () => {
    const sig = computeSignature(secret, timestamp, body);
    expect(verifySignature(secret, timestamp, body, sig)).toBe(true);
  });

  it("错误的签名应返回 false", () => {
    const wrongSig = "sha256=" + "a".repeat(64);
    expect(verifySignature(secret, timestamp, body, wrongSig)).toBe(false);
  });

  it("长度不匹配的签名应返回 false", () => {
    expect(verifySignature(secret, timestamp, body, "sha256=short")).toBe(false);
  });

  it("空签名应返回 false", () => {
    expect(verifySignature(secret, timestamp, body, "")).toBe(false);
  });

  it("不同 timestamp 应导致签名不匹配", () => {
    const sig = computeSignature(secret, timestamp, body);
    expect(verifySignature(secret, "9999999999", body, sig)).toBe(false);
  });

  it("不同 secret 应导致签名不匹配", () => {
    const sig = computeSignature(secret, timestamp, body);
    expect(verifySignature("wrong-secret", timestamp, body, sig)).toBe(false);
  });

  it("不同 body 应导致签名不匹配", () => {
    const sig = computeSignature(secret, timestamp, body);
    const differentBody = Buffer.from('{"different":"data"}');
    expect(verifySignature(secret, timestamp, differentBody, sig)).toBe(false);
  });
});

describe("generatePKCE", () => {
  it("应返回包含 verifier 和 challenge 的对象", () => {
    const result = generatePKCE();
    expect(result).toHaveProperty("verifier");
    expect(result).toHaveProperty("challenge");
    expect(typeof result.verifier).toBe("string");
    expect(typeof result.challenge).toBe("string");
  });

  it("verifier 应为 64 字符的十六进制字符串（32 字节）", () => {
    const { verifier } = generatePKCE();
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
  });

  it("challenge 应为 64 字符的十六进制字符串（SHA256 哈希）", () => {
    const { challenge } = generatePKCE();
    expect(challenge).toHaveLength(64);
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
  });

  it("每次调用应生成不同的 verifier", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.verifier).not.toBe(b.verifier);
  });

  it("不同的 verifier 应生成不同的 challenge", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("challenge 应为 verifier 的 SHA256 哈希", async () => {
    const { createHash } = await import("node:crypto");
    const { verifier, challenge } = generatePKCE();
    const expected = createHash("sha256").update(verifier).digest("hex");
    expect(challenge).toBe(expected);
  });
});
