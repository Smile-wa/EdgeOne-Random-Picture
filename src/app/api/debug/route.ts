// src/app/api/debug/route.ts
// 临时诊断接口：查看 NAS 环境变量是否生效、清单来源是否正确。
// 排查完可删除本文件。

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const NAS_API_URL = process.env.NAS_API_URL || '';
  const NAS_API_TOKEN = process.env.NAS_API_TOKEN || '';
  const NEXT_PUBLIC_IMAGE_BASE_URL = process.env.NEXT_PUBLIC_IMAGE_BASE_URL || '';

  let manifestStatus = 'not attempted';
  let manifestSample: any = null;
  let manifestError: string | null = null;

  if (NAS_API_URL) {
    try {
      const res = await fetch(`${NAS_API_URL.replace(/\/$/, '')}/manifest`, {
        headers: { 'X-Api-Token': NAS_API_TOKEN },
        cache: 'no-store',
      });
      manifestStatus = `HTTP ${res.status}`;
      const data = await res.json();
      manifestSample = {
        pcCount: data.pc?.length ?? 0,
        mobileCount: data.mobile?.length ?? 0,
        baseUrl: data.baseUrl ?? null,
        first: data.pc?.[0] ?? data.mobile?.[0] ?? null,
      };
    } catch (e: any) {
      manifestError = e.message;
    }
  }

  return NextResponse.json({
    configured: {
      NAS_API_URL: NAS_API_URL || '(未设置)',
      NAS_API_TOKEN: NAS_API_TOKEN ? `已设置(${NAS_API_TOKEN.length}位)` : '(未设置)',
      NEXT_PUBLIC_IMAGE_BASE_URL: NEXT_PUBLIC_IMAGE_BASE_URL || '(未设置 → 走同源 /api/images 代理)',
    },
    manifest: { status: manifestStatus, sample: manifestSample, error: manifestError },
    conclusion: !NAS_API_URL
      ? '❌ NAS_API_URL 未配置 → 当前走本地/GitHub 旧数据'
      : manifestError
      ? '❌ 无法访问 NAS → 清单回退到本地旧数据'
      : manifestSample && (manifestSample.pcCount + manifestSample.mobileCount) > 0
      ? '✅ NAS 已生效'
      : '⚠️ NAS 可达但清单为空 → 检查图片是否已迁移到 NAS 目录',
  });
}
