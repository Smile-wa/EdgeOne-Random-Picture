// src/app/api/debug/route.ts
// 诊断接口：查看 NAS 配置、清单来源，并实测图片能否加载。
// 排查完可删除本文件。

import { NextResponse } from 'next/server';
import { getImageUrl } from '@/lib/image-url';
import { getImagesFromNas } from '@/lib/nas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const NAS_API_URL = process.env.NAS_API_URL || '';
  const NAS_API_TOKEN = process.env.NAS_API_TOKEN || '';
  const IMAGE_BASE = process.env.NEXT_PUBLIC_IMAGE_BASE_URL || '';

  const result: any = {
    configured: {
      NAS_API_URL: NAS_API_URL || '(未设置)',
      NAS_API_TOKEN: NAS_API_TOKEN ? `已设置(${NAS_API_TOKEN.length}位)` : '(未设置)',
      NEXT_PUBLIC_IMAGE_BASE_URL: IMAGE_BASE || '(未设置 → 走同源 /api/images 代理)',
    },
  };

  // 1) 直接测 NAS manifest 原始返回
  if (NAS_API_URL) {
    try {
      const res = await fetch(`${NAS_API_URL.replace(/\/$/, '')}/manifest`, {
        headers: { 'X-Api-Token': NAS_API_TOKEN },
        cache: 'no-store',
      });
      const data = await res.json();
      result.rawManifest = {
        status: `HTTP ${res.status}`,
        pcCount: data.pc?.length ?? 0,
        mobileCount: data.mobile?.length ?? 0,
        firstFewSrc: [...(data.pc || []), ...(data.mobile || [])].slice(0, 3).map((x: any) => x.src),
      };
    } catch (e: any) {
      result.rawManifest = { error: e.message };
    }
  } else {
    result.rawManifest = { error: 'NAS_API_URL 未配置' };
  }

  // 2) 走项目逻辑拿清单，并实测第一张图能否加载
  try {
    const meta = await getImagesFromNas();
    const all = [...meta.pc, ...meta.mobile];
    result.appManifest = {
      count: all.length,
      firstSrc: all[0]?.src ?? null,
      firstUrl: all[0] ? getImageUrl(all[0].src) : null,
    };

    if (all[0] && NAS_API_URL) {
      const url = getImageUrl(all[0].src);
      // 直接测 NAS 静态图片地址（NAS 服务 /images/<name>），这是图片加载的源头
      try {
        const staticUrl = `${NAS_API_URL.replace(/\/$/, '')}/images/${encodeURIComponent(all[0].src)}`;
        const imgRes = await fetch(staticUrl, { redirect: 'manual' });
        result.imageProbe = {
          frontendUrl: url,
          nasStaticUrl: staticUrl,
          status: imgRes.status,
          contentType: imgRes.headers.get('content-type'),
        };
      } catch (e: any) {
        result.imageProbe = { frontendUrl: url, error: e.message };
      }
    }
  } catch (e: any) {
    result.appManifest = { error: e.message };
  }

  result.conclusion = !NAS_API_URL
    ? '❌ NAS_API_URL 未配置 → 走本地旧数据'
    : result.rawManifest?.error
    ? '❌ 无法访问 NAS manifest'
    : (result.rawManifest?.pcCount ?? 0) + (result.rawManifest?.mobileCount ?? 0) === 0
    ? '⚠️ NAS 可达但清单为空 → 图片没迁移到 NAS 目录'
    : result.imageProbe?.status && result.imageProbe.status >= 200 && result.imageProbe.status < 400
    ? '✅ 配置正常，图片可访问（若页面仍不显示，多为浏览器缓存或跨域问题）'
    : '⚠️ 清单正常但图片访问异常 → 看 imageProbe 详情';

  return NextResponse.json(result);
}
