// src/app/api/gallery-auth/route.ts
// 图库密码登录 / 登出 / 状态查询

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  checkPassword,
  isGalleryProtected,
  makeToken,
  verifyToken,
  GALLERY_COOKIE,
} from '@/lib/gallery-auth';

export const dynamic = 'force-dynamic';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 天
  secure: process.env.NODE_ENV === 'production',
};

// 查询状态
export async function GET(request: NextRequest) {
  const token = request.cookies.get(GALLERY_COOKIE)?.value;
  return NextResponse.json({
    protected: isGalleryProtected(),
    unlocked: !isGalleryProtected() || verifyToken(token),
  });
}

// 登录
export async function POST(request: NextRequest) {
  if (!isGalleryProtected()) {
    return NextResponse.json({ success: true, unlocked: true });
  }
  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== 'string' || !checkPassword(password)) {
    return NextResponse.json({ error: '密码错误' }, { status: 401 });
  }
  const res = NextResponse.json({ success: true, unlocked: true });
  res.cookies.set(GALLERY_COOKIE, makeToken(), cookieOptions);
  return res;
}

// 登出
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(GALLERY_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return res;
}
