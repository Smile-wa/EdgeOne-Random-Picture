// src/lib/gallery-auth.ts
// 图库访问的简易密码保护：用 GALLERY_PASSWORD 作为 HMAC 密钥签发 cookie。
// 未配置 GALLERY_PASSWORD 时不启用保护，行为与之前完全一致。

import crypto from 'crypto';

export const GALLERY_COOKIE = 'eop_gallery_auth';
const PASSWORD = process.env.GALLERY_PASSWORD || '';

export function isGalleryProtected(): boolean {
  return Boolean(PASSWORD);
}

function sign(value: string): string {
  return crypto.createHmac('sha256', PASSWORD).update(value).digest('hex');
}

/** 生成一个可写入 cookie 的令牌（内容:签名） */
export function makeToken(): string {
  const payload = `ok:${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

/** 校验令牌是否有效 */
export function verifyToken(token: string | undefined): boolean {
  if (!PASSWORD || !token) return false;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!payload.startsWith('ok:')) return false;
  const expected = sign(payload);
  // 定长比较，避免时序攻击
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** 校验密码是否正确 */
export function checkPassword(input: string): boolean {
  if (!PASSWORD) return true;
  return input === PASSWORD;
}
