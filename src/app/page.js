import HomeClient from './HomeClient';
import { getImages } from '@/lib/images';

export default async function HomePage() {
  const images = await getImages();
  return <HomeClient images={images} />;
}
