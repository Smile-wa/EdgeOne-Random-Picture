// src/app/api/github/route.ts
// 管理接口：保留原 /api/github 路径，内部改为转发到 NAS 图片服务。
// 管理密码校验仍在 EdgeOne 侧完成，NAS 的 API Token 不会暴露给浏览器。

import { NextResponse } from 'next/server';
import { getImagesFromNas, nasUpload, nasDelete, nasDeleteBatch, nasRename, nasOrganize, isNasConfigured } from '@/lib/nas';
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

// 仅防路径穿越，允许空格/括号/中文等从 GitHub 迁来的旧文件名
function isValidName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..') &&
    !/[\x00-\x1f\x7f]/.test(name)
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

  if (!isValidName(name) || typeof base64Content !== 'string') {
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
  if (!isValidName(name)) {
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

// 批量操作 / 重命名 / 整理：POST /api/github  { action, ... }
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  if (!isNasConfigured()) return notConfigured();

  const body = await request.json().catch(() => ({}));
  const { action } = body;

  let res: Response;
  if (action === 'deleteBatch') {
    const names = Array.isArray(body.names) ? body.names : [];
    if (!names.length || !names.every(isValidName)) {
      return NextResponse.json({ error: '文件名列表不合法' }, { status: 400 });
    }
    res = await nasDeleteBatch(names);
  } else if (action === 'rename') {
    const { from, to } = body;
    if (!isValidName(from) || (to !== undefined && !isValidName(to))) {
      return NextResponse.json({ error: '文件名不合法' }, { status: 400 });
    }
    res = await nasRename(from, to);
  } else if (action === 'organize') {
    res = await nasOrganize();
  } else {
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: data.error || '操作失败' }, { status: res.status });
  }
  return NextResponse.json(data);
}
