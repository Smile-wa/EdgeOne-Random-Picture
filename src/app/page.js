import HomeClient from './HomeClient';
import { getImages } from '@/lib/images';

// 使用 NAS 时图片清单在请求时读取，避免构建时固化成本地旧数据
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const images = await getImages();
  return <HomeClient images={images} />;
}
