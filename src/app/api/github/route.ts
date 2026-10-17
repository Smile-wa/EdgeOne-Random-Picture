// src/app/api/github/route.ts
import { NextResponse } from 'next/server';

const REPO_OWNER = 'Smile-wa';
const REPO_NAME = 'EdgeOne-Random-Picture';
const BRANCH = 'main';
const IMAGE_DIR = 'public/images';

// 验证客户端传来的密码是否与服务端环境变量一致
function isAuthorized(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  return authHeader === `Bearer ${password}`;
}

// 获取 GitHub Token
function getToken() {
  return process.env.GITHUB_TOKEN || '';
}

// 处理 GET 请求：获取图片列表
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权，密码错误' }, { status: 401 });
  }

  const token = getToken();
  if (!token) {
    return NextResponse.json({ error: '服务器未配置 GITHUB_TOKEN' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMAGE_DIR}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${token}` }, cache: 'no-store' }
    );
    
    if (!res.ok) throw new Error('获取文件列表失败');
    const data = await res.json();
    const files = data.filter((item: any) => item.type === 'file');
    return NextResponse.json(files);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 处理 DELETE 请求：删除图片
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const token = getToken();
  const { path, sha, name } = await request.json();

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `delete: 删除图片 ${name} (通过 Admin 面板)`,
          sha: sha,
          branch: BRANCH,
        }),
      }
    );

    if (!res.ok) throw new Error('删除失败');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 处理 PUT 请求：上传图片
export async function PUT(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const token = getToken();
  const { name, base64Content } = await request.json();

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMAGE_DIR}/${name}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `upload: 上传图片 ${name} (通过 Admin 面板)`,
          content: base64Content,
          branch: BRANCH,
        }),
      }
    );

    if (!res.ok) throw new Error('上传失败，可能已存在同名文件');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
