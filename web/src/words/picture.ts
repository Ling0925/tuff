import { say } from '../data/words.js'

/** A picture made fit to be a mark, and why one is refused — `data/picture.ts`. */
export const PICTURE = say({
  cantShow: [
    'Browsers can’t show this type of image. Use a PNG, JPEG, GIF or WebP.',
    'Les navigateurs ne peuvent pas afficher ce type d’image. Utilisez un PNG, JPEG, GIF ou WebP.',
    '浏览器无法显示此类图片。请使用 PNG、JPEG、GIF 或 WebP。',
  ],
  gifTooBig: ['An animated GIF can be up to 2 MB.', 'Un GIF animé peut faire jusqu’à 2 Mo.', '动态 GIF 最大 2 MB。'],
  cantRead: [
    'Couldn’t read this image. Try a different file.',
    'Impossible de lire cette image. Essayez un autre fichier.',
    '无法读取此图片。请尝试其他文件。',
  ],
})
