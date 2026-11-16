import type { ImagesMetadata } from '@/types';
import { getImagesFromNas } from './nas';

/**
 * 获取图片列表（pc / mobile）。
 * 配置了 NAS 时从 NAS 实时读取（60s 缓存），否则使用本地构建时生成的 metadata。
 * 注意：此函数现在是异步的，调用方需 await。
 */
export async function getImages(): Promise<{
  pc: ImagesMetadata['pc'];
  mobile: ImagesMetadata['mobile'];
}> {
  const data = await getImagesFromNas();
  return {
    pc: data.pc || [],
    mobile: data.mobile || [],
  };
}
