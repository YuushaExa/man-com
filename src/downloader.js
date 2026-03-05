import { ComixAPI } from './comix-api.js';
import { logger, safeFilename, downloadFile, createArchive } from './utils.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import PQueue from 'p-queue';

export async function downloadManga({ mangaUrl, startChapter = '1', endChapter = null, outputFormat = 'rar', resultDir = 'result' }) {
  // 1. Extract manga code & fetch info
  const mangaCode = ComixAPI.extractMangaCode(mangaUrl);
  logger.info(`Fetching manga: ${mangaCode}`);
  
  const manga = await ComixAPI.getMangaInfo(mangaCode);
  const safeTitle = safeFilename(manga.title);
  logger.info(`Manga: ${manga.title}`);
  
  // 2. Fetch all chapters with deduplication
  const allChapters = await ComixAPI.getAllChapters(mangaCode);
  
  // 3. Filter by chapter range
  let chapters = allChapters;
  if (startChapter) {
    const startNum = parseFloat(startChapter);
    chapters = chapters.filter(c => parseFloat(c.number) >= startNum);
  }
  if (endChapter) {
    const endNum = parseFloat(endChapter);
    chapters = chapters.filter(c => parseFloat(c.number) <= endNum);
  }
  
  logger.info(`Downloading ${chapters.length} chapters (${startChapter} to ${endChapter || 'latest'})`);
  
  // 4. Setup download directory
  const mangaDir = join(resultDir, safeTitle);
  await fs.mkdir(mangaDir, { recursive: true });
  
  // 5. Download chapters concurrently (with rate limiting)
  const queue = new PQueue({ concurrency: 3 }); // Avoid overwhelming the API
  
  const downloadChapter = async (chapter) => {
    try {
      const chapNum = chapter.number;
      const chapTitle = chapter.name || chapter.title || '';
      const safeChapName = safeFilename(`Chapter_${chapNum}${chapTitle ? '_' + chapTitle : ''}`, 80);
      const chapDir = join(mangaDir, safeChapName);
      
      await fs.mkdir(chapDir, { recursive: true });
      
      // Fetch images
      const images = await ComixAPI.getChapterImages(chapter.chapter_id);
      logger.info(`Chapter ${chapNum}: ${images.length} images`);
      
      // Download images with concurrency limit
      const imageQueue = new PQueue({ concurrency: 5 });
      const downloads = images.map((url, idx) => {
        const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
        const filename = `${String(idx + 1).padStart(3, '0')}.${ext}`;
        const dest = join(chapDir, filename);
        
        return imageQueue.add(() => downloadFile(url, dest));
      });
      
      await Promise.all(downloads);
      logger.info(`✓ Chapter ${chapNum} downloaded`);
      
    } catch (error) {
      logger.error(`Failed to download chapter ${chapter.number}: ${error.message}`);
      // Continue with other chapters
    }
  };
  
  // Queue all chapter downloads
  for (const chapter of chapters) {
    queue.add(() => downloadChapter(chapter));
  }
  
  await queue.onIdle();
  logger.info('All chapters processed');
  
  // 6. Create archive
  const archiveName = `${safeTitle}.${outputFormat === 'rar' ? 'rar' : 'zip'}`;
  const archivePath = join(resultDir, archiveName);
  
  logger.info(`Creating ${outputFormat.toUpperCase()} archive: ${archiveName}`);
  await createArchive(mangaDir, archivePath, outputFormat);
  
  // 7. Cleanup: remove unpacked folder to save space
  await fs.rm(mangaDir, { recursive: true, force: true });
  
  logger.info(`✅ Done! Archive saved to: ${archivePath}`);
  return archivePath;
}
