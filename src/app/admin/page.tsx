// src/app/admin/page.tsx
"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { generateUniqueImageName } from '@/lib/upload';

// 从文件列表里过滤出图片文件
function pickImageFiles(fileList: FileList | null): File[] {
  if (!fileList) return [];
  return Array.from(fileList).filter((f) => f.type.startsWith('image/'));
}

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
  const [isDragging, setIsDragging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

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

  const deleteImage = async (name: string) => {
    if (!confirm(`确定要删除图片 ${name} 吗？\n删除后 NAS 上的文件将被移除。`)) return;
    setMessage(`正在删除 ${name}...`);
    try {
      const res = await fetch('/api/github', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '删除失败');
      }
      setImages(prev => prev.filter(img => img.name !== name));
      setSelected(prev => { const n = new Set(prev); n.delete(name); return n; });
      setMessage(`✅ ${name} 删除成功！`);
    } catch (err: any) {
      setMessage(`❌ 删除失败: ${err.message}`);
    }
  };

  // 批量删除选中图片
  const deleteSelected = async () => {
    const names = Array.from(selected);
    if (names.length === 0) return;
    if (!confirm(`确定要删除选中的 ${names.length} 张图片吗？\n删除后 NAS 上的文件将被移除。`)) return;
    setBusy(true);
    setMessage(`正在删除 ${names.length} 张图片...`);
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteBatch', names }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '批量删除失败');
      const nameSet = new Set(names);
      setImages(prev => prev.filter(img => !nameSet.has(img.name)));
      setSelected(new Set());
      setMessage(`✅ 批量删除完成！成功 ${data.deleted}/${data.total} 张${data.failed?.length ? `，失败 ${data.failed.length} 张` : ''}。`);
    } catch (err: any) {
      setMessage(`❌ 批量删除失败: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 一键整理：把NAS上所有不安全文件名（空格/括号/中文等）重命名为安全唯一名
  const organizeFiles = async () => {
    if (!confirm('确定要一键整理吗？\n将把 NAS 上所有带空格/括号/中文的旧文件名，自动重命名为「时间戳-随机码」安全文件名。\n图片内容不变，但旧链接会失效。')) return;
    setBusy(true);
    setMessage('正在整理文件名...');
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'organize' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '整理失败');
      setSelected(new Set());
      setMessage(`✅ 整理完成！重命名 ${data.renamedCount} 张${data.failed?.length ? `，失败 ${data.failed.length} 张` : ''}。正在刷新列表...`);
      handleLogin();
    } catch (err: any) {
      setMessage(`❌ 整理失败: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 自动分类：把图片按尺寸移动到 pc/ 与 mobile/ 文件夹
  const classifyFiles = async (undo = false) => {
    const tip = undo
      ? '确定要取消分类吗？\n将把 pc/ 与 mobile/ 文件夹里的图片全部移回根目录。'
      : '确定要自动分类吗？\n将按图片尺寸（宽>高=电脑，否则=手机）把图片移动到 NAS 的 pc/ 与 mobile/ 子文件夹。';
    if (!confirm(tip)) return;
    setBusy(true);
    setMessage(undo ? '正在取消分类...' : '正在自动分类...');
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'classify', undo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '分类失败');
      setSelected(new Set());
      setMessage(`✅ ${undo ? '已取消分类' : '分类完成'}！移动 ${data.moved} 张${data.failed?.length ? `，失败 ${data.failed.length} 张` : ''}。当前：电脑 ${data.pcCount} 张 / 手机 ${data.mobileCount} 张。`);
      handleLogin();
    } catch (err: any) {
      setMessage(`❌ 分类失败: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 单张重命名
  const renameFile = async (oldName: string) => {
    const newName = prompt(`重命名图片\n旧文件名：${oldName}\n请输入新文件名（留空则自动生成安全名）：`, '');
    if (newName === null) return;
    setBusy(true);
    setMessage(`正在重命名 ${oldName}...`);
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', from: oldName, to: newName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '重命名失败');
      setMessage(`✅ 重命名成功：${oldName} → ${data.to}`);
      handleLogin();
    } catch (err: any) {
      setMessage(`❌ 重命名失败: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  };

  // 🔥 并发多选上传 + 自动重命名（时间戳 + 短随机，极速且无重名）
  const uploadImages = async (files: FileList | File[]) => {
    if (!password) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    const total = fileArray.length;
    let done = 0;
    let successCount = 0;

    setMessage(`正在上传 0/${total} 张...`);

    // 并发上传；每张完成后更新进度
    await Promise.all(
      fileArray.map(async (file) => {
        try {
          // 重新命名为「时间戳+短随机.扩展名」，避免空格/括号/中文导致的编码与重名问题
          const name = generateUniqueImageName(file.name);

          const base64Content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
          });

          const res = await fetch('/api/github', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, base64Content }),
          });

          if (res.ok) {
            successCount++;
          } else {
            const data = await res.json();
            console.error(`${file.name} → ${name} 上传失败:`, data.error);
          }
        } catch (err) {
          console.error(`${file.name} 上传异常:`, err);
        } finally {
          done++;
          if (done < total) setMessage(`正在上传 ${done}/${total} 张...`);
        }
      })
    );

    setMessage(`✅ 批量上传完成！成功 ${successCount}/${total} 张，已自动重命名。`);
    setUploading(false);
    handleLogin();
  };

  // 📋 电脑端粘贴截图直接上传（对手机无影响）
  useEffect(() => {
    if (!isLoggedIn) return;
    const handlePaste = (e: ClipboardEvent) => {
      const files = pickImageFiles(e.clipboardData?.files ?? null);
      if (files.length > 0 && !uploading) {
        e.preventDefault();
        uploadImages(files);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isLoggedIn, uploading, password]);

  // 🖱️ 电脑端拖拽图片到页面上传（对手机无影响）
  useEffect(() => {
    if (!isLoggedIn) return;
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setIsDragging(false);
      if (uploading) return;
      const files = pickImageFiles(e.dataTransfer?.files ?? null);
      if (files.length > 0) uploadImages(files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [isLoggedIn, uploading, password]);

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
        <div className="flex items-center justify-between mb-4 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">图库管理后台</h1>
            <p className="text-sm text-neutral-500">共 {images.length} 张图片 · 点击右下角上传，也可拖拽 / 粘贴截图，多选自动批量重命名</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => classifyFiles(false)}
              disabled={busy}
              className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              🗂 自动分类
            </button>
            <button
              onClick={() => classifyFiles(true)}
              disabled={busy}
              className="px-3 py-2 bg-neutral-500 text-white rounded-lg text-sm font-medium hover:bg-neutral-600 transition-colors disabled:opacity-50"
              title="把所有图片移回根目录"
            >
              取消分类
            </button>
            <button
              onClick={organizeFiles}
              disabled={busy}
              className="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              🧹 整理命名
            </button>
            <Link href="/gallery" className="px-4 py-2 bg-neutral-200 dark:bg-white/10 rounded-lg text-sm font-medium hover:bg-neutral-300 dark:hover:bg-white/20 transition-colors">
              返回图库
            </Link>
          </div>
        </div>

        {/* 批量操作工具栏 */}
        <div className="mb-4 flex items-center gap-3 p-3 bg-white dark:bg-[#1a1a1a] rounded-lg border border-neutral-200 dark:border-white/10 text-sm">
          <button
            onClick={() => setSelected(selected.size === images.length ? new Set() : new Set(images.map(i => i.name)))}
            className="px-3 py-1.5 rounded border border-neutral-300 dark:border-white/20 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
          >
            {selected.size === images.length && images.length > 0 ? '取消全选' : '全选'}
          </button>
          <span className="text-neutral-500">已选 <b className="text-neutral-900 dark:text-white">{selected.size}</b> 张</span>
          <button
            onClick={deleteSelected}
            disabled={selected.size === 0 || busy}
            className="ml-auto px-4 py-1.5 bg-red-500 text-white rounded font-bold hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🗑 批量删除{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>

        {message && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg text-sm border border-blue-200 dark:border-blue-800">
            {message}
          </div>
        )}

        {/* 瀑布流布局 (横屏保持横屏，竖屏保持竖屏) */}
        <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-4">
          {images.slice(0, visibleCount).map((img) => (
            <div key={img.sha} className={`break-inside-avoid mb-4 group relative bg-white dark:bg-[#1a1a1a] rounded-xl overflow-hidden shadow-sm border-2 transition-colors ${selected.has(img.name) ? 'border-blue-500' : 'border-neutral-200 dark:border-white/10'}`}>
              {/* 选择复选框 */}
              <label className="absolute top-2 left-2 z-30 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(img.name)}
                  onChange={() => toggleSelect(img.name)}
                  className="w-5 h-5 accent-blue-600 cursor-pointer"
                />
              </label>
              <div className="relative bg-neutral-200 dark:bg-neutral-800 min-h-[100px] animate-pulse">
                <img
                  src={img.download_url}
                  alt={img.name}
                  className="w-full h-auto object-cover transition-opacity duration-500 opacity-0 relative z-10"
                  loading="lazy"
                  onError={(e) => {
                    const target = e.currentTarget;
                    // 加载失败时隐藏骨架屏即可（图片已由 /api/github 返回 NAS 地址）
                    target.style.opacity = '1';
                    target.parentElement?.classList.remove('animate-pulse');
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
              <div className="absolute inset-x-0 bottom-0 bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-20 py-2 sm:py-0 sm:inset-0">
                <button
                  onClick={() => renameFile(img.name)}
                  className="bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-600 transition-colors shadow-lg"
                >
                  重命名
                </button>
                <button
                  onClick={() => deleteImage(img.name)}
                  className="bg-red-500 text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-red-600 transition-colors shadow-lg"
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

      {/* 拖拽上传提示遮罩 */}
      {isDragging && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
          <div className="border-4 border-dashed border-white/80 rounded-3xl px-12 py-16 text-white text-2xl font-bold flex flex-col items-center gap-4">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            松开即可上传图片
          </div>
        </div>
      )}

      {/* 悬浮多选上传按钮 */}
      <div className="fixed bottom-24 right-6 z-[9999]">
        <label className="flex items-center justify-center w-14 h-14 bg-blue-600 text-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] cursor-pointer hover:bg-blue-700 transition-all hover:scale-110">
          <input
            type="file"
            // 手机/电脑通用的图片类型，capture 不设置以保留相册多选能力
            accept="image/*"
            multiple // 开启多选
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
