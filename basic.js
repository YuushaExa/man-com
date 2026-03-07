// basic.js - ES Module | Sharp | Telegram | Split Zips | FIXED
import fs from 'fs/promises';
import * as fsSync from 'fs'; // For sync methods: existsSync, statSync, etc.
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

// == Configuration ==
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_FILE = process.argv[2] || 'data.json';
const OPTIMIZE = process.argv[3] === 'true';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

// == Sharp WebP Settings ==
const WEBP_OPTIONS = {
  quality: 75,
  effort: 4,
  lossless: false,
  smartSubsample: true
};

// == Telegram Config ==
const TG_API = 'https://api.telegram.org/bot';
const TG_DELAY_MS = 3000;
const MAX_ZIP_SIZE_BYTES = 49 * 1024 * 1024;
const TARGET_ZIP_SIZE_BYTES = 45 * 1024 * 1024;

// == Helpers ==
function sanitize(str) {
  return (str || '').toString().replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getOptimizedFilename(originalPath) {
  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath, '.webp');
  return path.join(dir, `${base}ds.webp`);
}

async function optimizeWithSharp(inputPath) {
  const outputPath = getOptimizedFilename(inputPath);
  try {
    await sharp(inputPath).webp(WEBP_OPTIONS).toFile(outputPath);
    await fs.unlink(inputPath);
    return outputPath;
  } catch (error) {
    console.error(`\n⚠️  Sharp failed for ${path.basename(inputPath)}: ${error.message}`);
    if (fsSync.existsSync(outputPath)) await fs.unlink(outputPath).catch(() => {});
    return inputPath;
  }
}

// == Async folder size calculator (FIXED) ==
async function getFolderSize(folderPath) {
  let total = 0;
  
  const walk = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          const stat = await fs.stat(fullPath);
          total += stat.size;
        }
      }
    } catch (e) {
      // Folder might not exist yet, skip
    }
  };
  
  await walk(folderPath);
  return total;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// == Telegram Helpers ==
async function telegramSendPhoto(caption, photoPath, thumbPath) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return null;
  
  const formData = new FormData();
  formData.append('chat_id', TG_CHAT_ID);
  formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');
  
  const photoBlob = await fs.readFile(photoPath);
  formData.append('photo', new Blob([photoBlob]), path.basename(photoPath));
  
  if (thumbPath && fsSync.existsSync(thumbPath)) {
    const thumbBlob = await fs.readFile(thumbPath);
    formData.append('thumbnail', new Blob([thumbBlob]), path.basename(thumbPath));
  }
  
  const response = await fetch(`${TG_API}${TG_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: formData
  });
  
  const result = await response.json();
  return result.ok ? result.result.message_id : null;
}

async function telegramSendDocument(filePath, caption, replyToMessageId, thumbPath) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  
  const formData = new FormData();
  formData.append('chat_id', TG_CHAT_ID);
  formData.append('document', new Blob([await fs.readFile(filePath)]), path.basename(filePath));
  formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');
  
  if (replyToMessageId) {
    formData.append('reply_to_message_id', replyToMessageId);
  }
  
  if (thumbPath && fsSync.existsSync(thumbPath)) {
    formData.append('thumbnail', new Blob([await fs.readFile(thumbPath)]), path.basename(thumbPath));
  }
  
  await fetch(`${TG_API}${TG_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: formData
  });
  
  await new Promise(resolve => setTimeout(resolve, TG_DELAY_MS));
}

async function sendMangaInfo(manga, coverPath) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.log('⚠️  Telegram not configured (missing TG_BOT_TOKEN or TG_CHAT_ID)');
    return null;
  }
  
  const caption = `<b>${sanitize(manga.title)}</b>\n` +
    `📖 ${manga.description?.substring(0, 800) || 'No description'}\n\n` +
    `🏷️ Type: ${manga.type || 'N/A'}\n` +
    `🌐 Language: ${manga.language || 'N/A'}\n` +
    `📊 Status: ${manga.status || 'N/A'}\n` +
    `📅 Year: ${manga.year || 'N/A'}\n` +
    `🔢 Latest Chapter: ${manga.latest_chapter || 'N/A'}`;
  
  console.log('📤 Sending manga info to Telegram...');
  const messageId = await telegramSendPhoto(caption, coverPath, coverPath);
  
  if (messageId) {
    console.log(`✅ Manga info sent (message_id: ${messageId})`);
  }
  return messageId;
}

// == Split chapters into zip groups under size limit ==
async function createZipGroups(baseDir, chapters, mangaTitle) {
  const groups = [];
  let currentGroup = [];
  let currentSize = 0;
  
  // Estimate size per chapter folder (async)
  const chapterSizes = [];
  for (const chapter of chapters) {
    const chapterPadded = String(chapter.number).padStart(3, '0');
    const safeChapterName = sanitize(chapter.name || '');
    const chapterDir = safeChapterName
      ? path.join(baseDir, `Chapter_${chapterPadded}_${safeChapterName}`)
      : path.join(baseDir, `Chapter_${chapterPadded}`);
    
    const size = await getFolderSize(chapterDir);
    chapterSizes.push({ chapter, dir: chapterDir, size });
  }
  
  // Group chapters to stay under target size
  for (const item of chapterSizes) {
    // Add buffer for zip overhead (~10%)
    const estimatedZipSize = item.size * 1.1;
    
    if (currentSize + estimatedZipSize > TARGET_ZIP_SIZE_BYTES && currentGroup.length > 0) {
      // Start new group
      groups.push(currentGroup);
      currentGroup = [item];
      currentSize = item.size;
    } else {
      currentGroup.push(item);
      currentSize += item.size;
    }
  }
  
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  // Create zip files for each group
  const zipFiles = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const minChapter = group[0].chapter.number;
    const maxChapter = group[group.length - 1].chapter.number;
    const zipName = `${mangaTitle}_ch${minChapter}-${maxChapter}_ds.zip`;
    
    console.log(`🗜️  Creating zip ${i + 1}/${groups.length}: ${zipName}`);
    
    // Build zip command with only chapters in this group
    const filesToZip = group.map(g => `"${path.relative(baseDir, g.dir)}"`).join(' ');
    execSync(`cd "${baseDir}" && zip -rq "../${zipName}" ${filesToZip}`, { stdio: 'pipe' });
    
    const zipPath = path.join(__dirname, zipName);
    const zipSize = fsSync.statSync(zipPath).size; // sync is fine here
    console.log(`   📦 ${zipName}: ${formatBytes(zipSize)}`);
    
    zipFiles.push({ path: zipPath, name: zipName, minChapter, maxChapter });
  }
  
  return zipFiles;
}

// == Main Logic ==
async function run() {
  const data = JSON.parse(await fs.readFile(JSON_FILE, 'utf8'));
  const manga = data.manga;
  const chapters = data.chapters;
  
  const mangaTitle = sanitize(manga.title);
  console.log(`📚 Downloading: ${mangaTitle}`);
  
  // == Download cover image for Telegram thumbnail ==
  let coverPath = null;
  if (manga.cover && TG_BOT_TOKEN) {
    coverPath = path.join(__dirname, `${mangaTitle}_cover.jpg`);
    const curlCmd = `curl -sL -o "${coverPath}" "${manga.cover}" --retry 3 --connect-timeout 30`;
    try {
      execSync(curlCmd, { stdio: 'pipe' });
      console.log('🖼️  Cover downloaded for Telegram thumbnail');
    } catch (e) {
      console.warn('⚠️  Failed to download cover:', e.message);
      coverPath = null;
    }
  }
  
  // == Create Base Directory ==
  const baseDir = mangaTitle;
  if (!fsSync.existsSync(baseDir)) {
    await fs.mkdir(baseDir, { recursive: true });
  }
  
  // == Download & Optimize Chapters ==
  for (const chapter of chapters) {
    const chapterNum = chapter.number;
    const pagesCount = chapter.pages_count;
    const chapterName = chapter.name || '';
    
    const chapterPadded = String(chapterNum).padStart(3, '0');
    const safeChapterName = sanitize(chapterName);
    const chapterDir = safeChapterName
      ? path.join(baseDir, `Chapter_${chapterPadded}_${safeChapterName}`)
      : path.join(baseDir, `Chapter_${chapterPadded}`);
    
    if (!fsSync.existsSync(chapterDir)) {
      await fs.mkdir(chapterDir, { recursive: true });
    }
    
    console.log(`⬇️  Chapter ${chapterNum}: ${chapterDir} (${pagesCount} pages)`);
    
    for (let pageIndex = 0; pageIndex < chapter.images.length; pageIndex++) {
      const imageUrl = chapter.images[pageIndex].trim();
      const pagePadded = String(pageIndex + 1).padStart(3, '0');
      const outputFile = path.join(chapterDir, `${pagePadded}.webp`);
      
      const curlCmd = `curl -sL \
        -H "Referer: https://comix.to/" \
        -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
        "${imageUrl}" \
        -o "${outputFile}" \
        --retry 3 --retry-delay 2 --connect-timeout 30`;
      
      try {
        execSync(curlCmd, { stdio: 'pipe' });
        process.stdout.write('.');
        
        if (OPTIMIZE) {
          await optimizeWithSharp(outputFile);
        }
      } catch (error) {
        console.error(`\n❌ Failed: ${imageUrl}`);
        if (fsSync.existsSync(outputFile)) await fs.unlink(outputFile).catch(() => {});
      }
    }
    console.log(' ✅ Done');
  }
  
  // == Create Split Zips ==
  console.log('\n📦 Calculating zip groups...');
  const zipFiles = await createZipGroups(baseDir, chapters, mangaTitle);
  
  // == Send to Telegram ==
  if (TG_BOT_TOKEN && TG_CHAT_ID) {
    // Send manga info first
    const infoMessageId = await sendMangaInfo(manga, coverPath);
    
    // Send each zip as reply
    for (const zip of zipFiles) {
      const caption = `📦 <b>${mangaTitle}</b>\nChapters ${zip.minChapter}-${zip.maxChapter}\n🎨 WebP ${OPTIMIZE ? '(optimized, ds)' : ''}\n📁 ${formatBytes(fsSync.statSync(zip.path).size)}`;
      
      console.log(`📤 Sending ${zip.name} to Telegram...`);
      await telegramSendDocument(zip.path, caption, infoMessageId, coverPath);
      console.log(`✅ Sent: ${zip.name}`);
    }
    
    console.log('✨ All files sent to Telegram!');
  } else {
    console.log('\n⚠️  Telegram not configured. Zips created locally:');
    zipFiles.forEach(z => console.log(`   - ${z.name}`));
  }
}

// == Run ==
run().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
