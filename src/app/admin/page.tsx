// src/app/admin/page.tsx
"use client";

import { useState } from 'react';
import Link from 'next/link';

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  // 1. 登录并读取图片列表
  const handleLogin = async () => {
    if (!password) {
      setMessage('请输入管理密码');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/github', {
        headers: { Authorization: `Bearer ${password}` },
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || '密码错误或服务器错误');
      }
      
      setImages(data);
      setIsLoggedIn(true);
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 2. 删除图片
  const deleteImage = async (path: string, sha: string, name: string) => {
    if (!confirm(`确定要删除图片 ${name} 吗？\n删除后 EdgeOne 将自动重新构建。`)) return;

    setMessage(`正在删除 ${name}...`);
    try {
      const res = await fetch('/api/github', {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${password}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ path, sha, name }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '删除失败');
      }
      
      // 删除成功后，从本地列表中移除
      setImages(prev => prev.filter(img => img.sha !== sha));
      setMessage(`✅ ${name} 删除成功！等待 EdgeOne 构建生效。`);
    } catch (err: any) {
      setMessage(`❌ 删除失败: ${err.message}`);
    }
  };

  // 3. 上传图片
  const uploadImage = async (file: File) => {
    if (!password) return;
    setUploading(true);
    setMessage(`正在上传 ${file.name}...`);
    
    try {
      // 将文件转为 Base64
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Content = (reader.result as string).split(',')[1];
        
        const res = await fetch('/api/github', {
          method: 'PUT',
          headers: { 
            'Authorization': `Bearer ${password}`,
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ name: file.name, base64Content }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '上传失败');
        }
        
        setMessage(`✅ ${file.name} 上传成功！等待 EdgeOne 构建生效。`);
        // 重新拉取列表
        handleLogin(); 
        setUploading(false);
      };
    } catch (err: any) {
      setMessage(`❌ 上传失败: ${err.message}`);
      setUploading(false);
    }
  };

  // 未登录时的界面
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-black p-4">
        <div className="max-w-md w-full bg-white dark:bg-[#1a1a1a] p-8 rounded-2xl shadow-xl border border-neutral-200 dark:border-white/10">
          <h1 className="text-2xl font-bold mb-6 text-neutral-900 dark:text-white text-center">图库管理后台</h1>
          <p className="text-sm text-neutral-500 mb-4">请输入管理密码以验证身份。</p>
          <input
            type="password"
            placeholder="输入 ADMIN_PASSWORD"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 mb-4 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-black dark:bg-white text-white dark:text-black py-3 rounded-lg font-bold hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {loading ? '验证中...' : '进入后台'}
          </button>
          {message && <p className="mt-4 text-sm text-red-500 text-center">{message}</p>}
          <div className="mt-6 text-center">
            <Link href="/gallery" className="text-sm text-neutral-400 hover:text-black dark:hover:text-white">← 返回图库</Link>
          </div>
        </div>
      </div>
    );
  }

  // 登录成功后的管理界面
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">图库管理后台</h1>
            <p className="text-sm text-neutral-500">共 {images.length} 张图片</p>
          </div>
          <div className="flex gap-4">
            <Link href="/gallery" className="px-4 py-2 bg-neutral-200 dark:bg-white/10 rounded-lg text-sm font-medium hover:bg-neutral-300 dark:hover:bg-white/20 transition-colors">
              返回图库
            </Link>
            <label className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold cursor-pointer hover:bg-blue-700 transition-colors">
              {uploading ? '上传中...' : '上传新图片'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadImage(file);
                  e.target.value = ''; 
                }}
              />
            </label>
          </div>
        </div>

        {message && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg text-sm border border-blue-200 dark:border-blue-800">
            {message}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {images.map((img) => (
            <div key={img.sha} className="group relative bg-white dark:bg-[#1a1a1a] rounded-xl overflow-hidden shadow-sm border border-neutral-200 dark:border-white/10">
              <div className="aspect-square bg-neutral-100 dark:bg-neutral-800 relative">
                <img
                  src={img.download_url}
                  alt={img.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-2">
                <p className="text-xs truncate text-neutral-600 dark:text-neutral-400" title={img.name}>
                  {img.name}
                </p>
              </div>
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button
                  onClick={() => deleteImage(img.path, img.sha, img.name)}
                  className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-600 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
