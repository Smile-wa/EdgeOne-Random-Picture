// src/app/admin/page.tsx
"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const [visibleCount, setVisibleCount] = useState(30);
  const loaderRef = useRef<HTMLDivElement>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // 监听滚动，控制回到顶部按钮
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      setShowBackToTop(scrollTop > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); 
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogin = async (pwd = password) => {
    if (!pwd) {
      setMessage('请输入管理密码');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/github', {
        headers: { Authorization: `Bearer ${pwd}` },
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '密码错误或服务器错误');
      
      setImages(data);
      setIsLoggedIn(true);
      setPassword(pwd); // 保存密码用于后续操作
      setVisibleCount(30); 
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 滚动到底部自动加载更多
  useEffect(() => {
    if (!isLoggedIn || !loaderRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && visibleCount < images.length) {
        setVisibleCount(prev => prev + 30);
      }
    }, { rootMargin: '200px' });
    observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [isLoggedIn, visibleCount, images.length]);

  const deleteImage = async (path: string, sha: string, name: string) => {
    if (!confirm(`确定要删除图片 ${name} 吗？\n删除后 EdgeOne 将自动重新构建。`)) return;
    setMessage(`正在删除 ${name}...`);
    try {
      const res = await fetch('/api/github', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sha, name }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '删除失败');
      }
      setImages(prev => prev.filter(img => img.sha !== sha));
      setMessage(`✅ ${name} 删除成功！等待 EdgeOne 构建生效。`);
    } catch (err: any) {
      setMessage(`❌ 删除失败: ${err.message}`);
    }
  };

  // 🔥 并发多选上传逻辑（速度快）
  const uploadImages = async (files: FileList) => {
    if (!password) return;
    setUploading(true);
    const total = files.length;
    let successCount = 0;

    setMessage(`正在并发上传 ${total} 张图片...`);

    const fileArray = Array.from(files);

    // 使用 Promise.all 并发处理多个文件的上传
    await Promise.all(
      fileArray.map(async (file) => {
        try {
          // 将文件转为 Base64
          const base64Content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
          });

          const res = await fetch('/api/github', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, base64Content }),
          });

          if (res.ok) {
            successCount++;
          } else {
            const data = await res.json();
            console.error(`${file.name} 上传失败:`, data.error);
          }
        } catch (err) {
          console.error(`${file.name} 上传异常:`, err);
        }
      })
    );

    setMessage(`✅ 批量上传完成！成功 ${successCount}/${total} 张。等待 EdgeOne 构建生效。`);
    handleLogin(); 
    setUploading(false);
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-black p-4">
        <div className="max-w-md w-full bg-white dark:bg-[#1a1a1a] p-8 rounded-2xl shadow-xl border border-neutral-200 dark:border-white/10">
          <h1 className="text-2xl font-bold mb-6 text-neutral-900 dark:text-white text-center">图库管理后台</h1>
          <p className="text-sm text-neutral-500 mb-4">请输入管理密码 (本地开发默认: admin123)</p>
          <input
            type="password"
            placeholder="输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 mb-4 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
          <button
            onClick={() => handleLogin()}
            disabled={loading}
            className="w-full bg-black dark:bg-white text-white dark:text-black py-3 rounded-lg font-bold hover:opacity-80 transition-opacity disabled:opacity-50 flex justify-center items-center gap-2"
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

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black p-4 md:p-8 relative pb-24">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">图库管理后台</h1>
            <p className="text-sm text-neutral-500">共 {images.length} 张图片</p>
          </div>
          <div>
            <Link href="/gallery" className="px-4 py-2 bg-neutral-200 dark:bg-white/10 rounded-lg text-sm font-medium hover:bg-neutral-300 dark:hover:bg-white/20 transition-colors">
              返回图库
            </Link>
          </div>
        </div>

        {message && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg text-sm border border-blue-200 dark:border-blue-800">
            {message}
          </div>
        )}

        {/* 瀑布流布局 (横屏保持横屏，竖屏保持竖屏) */}
        <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-4">
          {images.slice(0, visibleCount).map((img) => (
            <div key={img.sha} className="break-inside-avoid mb-4 group relative bg-white dark:bg-[#1a1a1a] rounded-xl overflow-hidden shadow-sm border border-neutral-200 dark:border-white/10">
              <div className="relative bg-neutral-200 dark:bg-neutral-800 min-h-[100px] animate-pulse">
                <img
                  src={img.download_url}
                  alt={img.name}
                  className="w-full h-auto object-cover transition-opacity duration-500 opacity-0 relative z-10"
                  loading="lazy"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.src.includes('githubusercontent')) {
                      target.src = `https://raw.githubusercontent.com/Smile-wa/EdgeOne-Random-Picture/main/public/images/${img.name}`;
                    } else {
                      target.style.opacity = '1';
                      target.parentElement?.classList.remove('animate-pulse');
                    }
                  }}
                  onLoad={(e) => {
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.parentElement?.classList.remove('animate-pulse');
                  }}
                />
              </div>
              <div className="p-3">
                <p className="text-xs truncate text-neutral-600 dark:text-neutral-400 font-mono" title={img.name}>
                  {img.name}
                </p>
              </div>
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20">
                <button
                  onClick={() => deleteImage(img.path, img.sha, img.name)}
                  className="bg-red-500 text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-red-600 transition-colors shadow-lg"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        {visibleCount < images.length && (
          <div ref={loaderRef} className="py-8 text-center text-sm text-neutral-400">
            正在加载更多图片...
          </div>
        )}
      </div>

      {/* 悬浮多选上传按钮 */}
      <div className="fixed bottom-24 right-6 z-[9999]">
        <label className="flex items-center justify-center w-14 h-14 bg-blue-600 text-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] cursor-pointer hover:bg-blue-700 transition-all hover:scale-110">
          <input
            type="file"
            // 🔥 增加更精确的 accept 格式，兼容部分手机的多选逻辑
            accept="image/*,image/jpeg,image/png,image/webp,image/gif"
            multiple // 🔥 开启多选
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) {
                uploadImages(files);
              }
              e.target.value = ''; 
            }}
          />
          {uploading ? (
            <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          )}
        </label>
      </div>

      {/* 悬浮回到顶部按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-8 right-6 p-3.5 rounded-full bg-black text-white dark:bg-white dark:text-black shadow-2xl transition-all duration-300 z-[9999] hover:scale-110 flex items-center justify-center ${
          showBackToTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
        }`}
        aria-label="回到顶部"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      </button>

    </div>
  );
}
