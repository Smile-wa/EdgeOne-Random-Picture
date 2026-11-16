// src/app/api/images/route.ts
// 同源图片代理：?name=xxx.jpg
// 当未配置 NEXT_PUBLIC_IMAGE_BASE_URL 时，前端所有图片走这里，
// 由服务端从 NAS 拉取并透传，从而对外隐藏 NAS 地址、并复用 EdgeOne 缓存。

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const NAS_API_URL = (process.env.NAS_API_URL || '').replace(/\/$/, '');

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name') || '';
  // 只防路径穿越，允许空格/括号/中文等旧文件名
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return NextResponse.json({ error: '非法文件名' }, { status: 400 });
  }
  if (!NAS_API_URL) {
    return NextResponse.json({ error: '未配置 NAS' }, { status: 404 });
  }

  try {
    const upstream = await fetch(`${NAS_API_URL}/images/${encodeURIComponent(name)}`, {
      next: { revalidate: 31536000 }, // 长期缓存（文件名唯一，内容不可变）
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: '图片不存在' }, { status: 404 });
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '代理失败' }, { status: 500 });
  }
}
