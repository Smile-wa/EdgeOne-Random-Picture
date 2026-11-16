// src/lib/nas.ts
// EdgeOne 端访问 NAS 图片服务的统一封装。
// 所有对 NAS 的请求都走服务端，避免把 NAS 地址与密钥暴露给浏览器。

import type { ImagesMetadata } from '@/types';
import localMetadata from './images-metadata.json';

const NAS_API_URL = (process.env.NAS_API_URL || '').replace(/\/$/, '');
const NAS_API_TOKEN = process.env.NAS_API_TOKEN || '';

export function isNasConfigured(): boolean {
  return Boolean(NAS_API_URL);
}

function authHeaders(): Record<string, string> {
  return { 'X-Api-Token': NAS_API_TOKEN, 'Content-Type': 'application/json' };
}

/** 把 NAS 返回的清单条目映射成项目内的图片元数据（补上 thumb: null） */
function normalize(m: any): ImagesMetadata {
  const map = (arr: any[] = []) =>
    arr.map((x) => ({
      src: x.src,
      thumb: null, // NAS 端不生成缩略图，直接显示原图（由 EdgeOne CDN 缓存加速）
      width: x.width,
      height: x.height,
      size: x.size,
      mtime: x.mtime,
    }));
  return { pc: map(m.pc), mobile: map(m.mobile), updatedAt: m.updatedAt || new Date().toISOString() };
}

/**
 * 获取图片清单。优先 NAS（带 revalidate 缓存）；未配置或失败时回退到本地 metadata.json。
 */
export async function getImagesFromNas(): Promise<ImagesMetadata> {
  if (!isNasConfigured()) {
    return localMetadata as ImagesMetadata;
  }
  try {
    const res = await fetch(`${NAS_API_URL}/manifest`, {
      headers: { 'X-Api-Token': NAS_API_TOKEN },
      next: { revalidate: 60 }, // EdgeOne 侧缓存 60 秒
    });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    return normalize(await res.json());
  } catch (e) {
    console.error('[nas] 获取清单失败，回退本地:', e);
    return localMetadata as ImagesMetadata;
  }
}

/** 转发上传到 NAS */
export async function nasUpload(name: string, base64Content: string) {
  const res = await fetch(`${NAS_API_URL}/upload`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name, base64Content }),
  });
  return res;
}

/** 转发删除到 NAS */
export async function nasDelete(name: string) {
  const res = await fetch(`${NAS_API_URL}/delete`, {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  return res;
}
