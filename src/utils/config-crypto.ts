/**
 * AES-256-GCM 加解密工具
 * 用于加密存储用户配置到本地数据库
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";

/**
 * 从环境变量读取加密密钥，没有则用默认值（开发模式）
 */
function getKey(): Buffer {
  const passphrase = process.env.CONFIG_ENCRYPT_KEY || "openilink-default-dev-key-change-in-prod";
  return scryptSync(passphrase, "openilink-salt", 32);
}

/**
 * 加密配置明文
 * 返回格式: iv:authTag:ciphertext（均为 hex 编码）
 */
export function encryptConfig(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return iv.toString("hex") + ":" + tag + ":" + encrypted;
}

/**
 * 解密配置密文
 * 输入格式: iv:authTag:ciphertext（均为 hex 编码）
 */
export function decryptConfig(ciphertext: string): string {
  const key = getKey();
  const [ivHex, tagHex, encrypted] = ciphertext.split(":");
  if (!ivHex || !tagHex || !encrypted) return "{}";
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
