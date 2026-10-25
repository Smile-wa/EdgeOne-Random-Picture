// src/app/api/github/route.ts
import { NextResponse } from 'next/server';

const REPO_OWNER = 'Smile-wa';
const REPO_NAME = 'EdgeOne-Random-Picture';
const BRANCH = 'main';
const IMAGE_DIR = 'public/images';

// 🔥 本地开发默认密码，如果线上环境变量未配置，则使用这个
const DEV_FALLBACK_PASSWORD = 'admin123';

function isAuthorized(request: Request) {
  const authHeader = request.headers.get('Authorization');
  // 优先读取线上配置的环境变量，没有则使用本地默认密码
  const password = process.env.ADMIN_PASSWORD || DEV_FALLBACK_PASSWORD;
  return authHeader === `Bearer ${password}`;
}

function getToken() {
  return process.env.GITHUB_TOKEN || '';
}

// 获取图片列表
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
      { 
        headers: { Authorization: `token ${token}` },
        next: { revalidate: 3600 } // 缓存 1 小时，提升加载速度
      }
    );
    
    if (!res.ok) throw new Error('获取文件列表失败');
    const data = await res.json();
    
    const files = data
      .filter((item: any) => item.type === 'file')
      .map((item: any) => ({
        name: item.name,
        path: item.path,
        sha: item.sha,
        // 使用 CDN 代理并压缩图片，提升后台缩略图加载速度
        download_url: `https://images.weserv.nl/?url=${encodeURIComponent(item.download_url.replace('https://', ''))}&w=400&output=webp&q=80`
      }));

    return NextResponse.json(files);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 删除图片
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
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
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

// 上传图片
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
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
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
