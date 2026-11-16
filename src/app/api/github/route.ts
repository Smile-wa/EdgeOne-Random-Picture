// src/app/api/github/route.ts
// 管理接口：保留原 /api/github 路径，内部改为转发到 NAS 图片服务。
// 管理密码校验仍在 EdgeOne 侧完成，NAS 的 API Token 不会暴露给浏览器。

import { NextResponse } from 'next/server';
import { getImagesFromNas, nasUpload, nasDelete, isNasConfigured } from '@/lib/nas';
import { getImageUrl } from '@/lib/image-url';

const DEV_FALLBACK_PASSWORD = 'admin123';

function isAuthorized(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.ADMIN_PASSWORD || DEV_FALLBACK_PASSWORD;
  return authHeader === `Bearer ${password}`;
}

function notConfigured() {
  return NextResponse.json(
    { error: '服务器未配置 NAS_API_URL，请在 EdgeOne 环境变量中配置后使用' },
    { status: 500 }
  );
}

// 获取图片列表（管理后台用）
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权，密码错误' }, { status: 401 });
  }
  if (!isNasConfigured()) return notConfigured();

  try {
    const meta = await getImagesFromNas();
    const all = [...meta.pc, ...meta.mobile].map((img: any) => ({
      name: img.src,
      path: img.src,
      sha: img.mtime + img.src, // 用 mtime+name 作为稳定 key（删除用 name 即可）
      download_url: getImageUrl(img.src),
      width: img.width,
      height: img.height,
    }));
    return NextResponse.json(all);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 上传图片
export async function PUT(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  if (!isNasConfigured()) return notConfigured();

  let name: string;
  let base64Content: string;
  try {
    ({ name, base64Content } = await request.json());
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  if (
    typeof name !== 'string' ||
    !/^[\w.\-]+$/.test(name) ||
    name.includes('..') ||
    typeof base64Content !== 'string'
  ) {
    return NextResponse.json({ error: '文件名或内容不合法' }, { status: 400 });
  }

  const res = await nasUpload(name, base64Content);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: data.error || '上传失败' },
      { status: res.status }
    );
  }
  return NextResponse.json({ success: true });
}

// 删除图片
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  if (!isNasConfigured()) return notConfigured();

  const { name } = await request.json().catch(() => ({}));
  if (typeof name !== 'string' || !/^[\w.\-]+$/.test(name) || name.includes('..')) {
    return NextResponse.json({ error: '文件名不合法' }, { status: 400 });
  }

  const res = await nasDelete(name);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: data.error || '删除失败' },
      { status: res.status }
    );
  }
  return NextResponse.json({ success: true });
}
