// src/lib/image-url.ts
// 生成图片的对外访问地址。NEXT_PUBLIC_IMAGE_BASE_URL 在构建时注入，
// 因此服务端和客户端都能用同一个函数（留空则走同源 /api/images 代理）。

const IMAGE_BASE = (process.env.NEXT_PUBLIC_IMAGE_BASE_URL || '').replace(/\/$/, '');

export function getImageUrl(name: string): string {
  const encoded = encodeURIComponent(name);
  if (IMAGE_BASE) return `${IMAGE_BASE}/images/${encoded}`;
  return `/api/images?name=${encoded}`;
}
