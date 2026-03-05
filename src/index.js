import { downloadManga } from './downloader.js';
import { logger } from './utils.js';

// Read config from environment (set by GitHub Actions)
const config = {
  mangaUrl: process.env.MANGA_URL,
  startChapter: process.env.START_CHAPTER || '1',
  endChapter: process.env.END_CHAPTER || null,
  outputFormat: process.env.OUTPUT_FORMAT || 'rar',
  resultDir: 'result'
};

async function main() {
  if (!config.mangaUrl) {
    console.error('❌ MANGA_URL environment variable is required');
    process.exit(1);
  }
  
  try {
    logger.info('🚀 Starting manga download...');
    logger.info(`URL: ${config.mangaUrl}`);
    logger.info(`Range: ${config.startChapter} to ${config.endChapter || 'latest'}`);
    logger.info(`Format: ${config.outputFormat}`);
    
    const archivePath = await downloadManga(config);
    
    console.log(`\n✅ SUCCESS! Downloaded archive: ${archivePath}`);
    console.log('📦 The file will be available in the "manga-result" artifact.');
    
  } catch (error) {
    logger.error(`❌ Fatal error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

main();
