import { cookies } from 'next/headers';
import { getImages } from '@/lib/images';
import { isGalleryProtected, verifyToken, GALLERY_COOKIE } from '@/lib/gallery-auth';
import GalleryClient from './GalleryClient';
import GalleryLogin from './GalleryLogin';
import type { TypedImage } from '@/types';

export const metadata = {
  title: '图库',
  description: '浏览所有随机图片素材，支持搜索、排序、预览和下载',
};

// 使用 NAS 时图片清单在请求时读取，避免构建时固化成本地旧数据
export const dynamic = 'force-dynamic';

export default async function GalleryPage() {
  // 密码保护校验
  const protectedGallery = isGalleryProtected();
  if (protectedGallery) {
    const cookieStore = await cookies();
    const token = cookieStore.get(GALLERY_COOKIE)?.value;
    if (!verifyToken(token)) {
      return <GalleryLogin />;
    }
  }

  const { pc, mobile } = await getImages();
  // 服务端保持确定性顺序，随机排序移至客户端以支持 SSG 缓存
  const allImages: TypedImage[] = [
    ...pc.map(img => ({ ...img, type: 'PC' as const })),
    ...mobile.map(img => ({ ...img, type: 'Mobile' as const })),
  ];

  return <GalleryClient initialImages={allImages} galleryProtected={protectedGallery} />;
}
