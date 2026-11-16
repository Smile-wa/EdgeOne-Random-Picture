// src/lib/upload.ts
// 上传图片时使用的最短、最快、无冲突命名规则。
// 由于图片分类由构建脚本按宽高自动完成（见 scripts/generate-images-metadata.js），
// 文件名无需携带 pc/mobile 之类的前缀，只要保证「唯一 + URL 安全」即可。

const SAFE_EXT_RE = /\.[a-z0-9]{1,8}$/i;

/**
 * 从原始文件名中提取安全的扩展名（最多 8 位字母数字），
 * 无扩展名时按图片默认回退到 .jpg。
 */
export function getImageExtension(originalName: string): string {
  const match = originalName.match(SAFE_EXT_RE);
  return match ? match[0].toLowerCase() : '.jpg';
}

/**
 * 生成上传用的唯一文件名：
 *   <毫秒时间戳 36 进制><3 位随机 36 进制>.<扩展名>
 * 例：m8x1k2f3g-x7q.webp
 *
 * 优点：
 * - 极短、纯 ASCII，天然 URL 安全（无空格 / 括号 / 中文，无需编码）
 * - 时间戳保证整体有序、跨设备/会话几乎不可能重名
 * - 不需要读取图片内容，零开销、同步完成
 */
export function generateUniqueImageName(originalName: string): string {
  const ext = getImageExtension(originalName);
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 5).padEnd(3, '0');
  return `${time}-${rand}${ext}`;
}
