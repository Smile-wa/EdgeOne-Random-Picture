"use client";

import { useState } from 'react';

export default function GalleryLogin({ onSuccess }: { onSuccess?: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!password) { setError('请输入密码'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/gallery-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '验证失败');
      if (onSuccess) onSuccess();
      else window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#fafafa] dark:bg-black text-neutral-900 dark:text-white p-4">
      <div className="max-w-sm w-full bg-white dark:bg-[#1a1a1a] p-8 rounded-2xl shadow-xl border border-neutral-200 dark:border-white/10">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-xl font-bold">图库需要密码</h1>
          <p className="text-sm text-neutral-500 mt-1">请输入访问密码查看所有图片</p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="访问密码"
          autoFocus
          className="w-full px-4 py-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 mb-4 focus:outline-none focus:ring-2 focus:ring-neutral-500"
        />
        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-neutral-900 dark:bg-white text-white dark:text-black py-3 rounded-lg font-bold hover:opacity-80 transition-opacity disabled:opacity-50"
        >
          {loading ? '验证中...' : '进入图库'}
        </button>
        {error && <p className="mt-4 text-sm text-red-500 text-center">{error}</p>}
      </div>
    </div>
  );
}
