// index.js - Manga Downloader for comix.to via GitHub Actions
// Usage: Set MANGA_URL env var and run: node index.js

import axios from 'axios';
import { Wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { createWriteStream, promises as fs, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sanitize from 'sanitize-filename';

const execAsync = promisify(exec);

// ============ CONFIG ============
const BASE_URL = 'https://comix.to/api/v2';
const RESULT_DIR = 'result';
const MAX_RETRIES = 3;
const REQUEST_DELAY = 1500; // ms between requests

// Browser-like headers to avoid 403
const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://comix.to/',
  'Origin': 'https://comix.to',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

// Cookie jar for Cloudflare support
const cookieJar = new CookieJar();
const http = Wrapper(axios.create({
  jar: cookieJar,
  withCredentials: true,
  headers: HEADERS,
  timeout: 45000,
  validateStatus: () => true // Handle errors manually
}));

// ============ UTILS ============
const log = {
  info: (m) => console.log(`[INFO] ${m}`),
  warn: (m) => console.warn(`[WARN] ${m}`),
  error: (m) => console.error(`[ERROR] ${m}`),
  debug: (m) => process.env.DEBUG && console.debug(`[DEBUG] ${m}`)
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);

function safeName(str, max = 100) {
  return sanitize(str).replace(/\s+/g, '_').substring(0, max);
}

function extractMangaCode(url) {
  const clean = url.replace(/\/$/, '');
  const parts = clean.split('/');
  const last = parts[parts.length - 1] || parts[parts.length - 2];
  return last.split('-')[0];
}

// ============ API FUNCTIONS ============
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await randomDelay(REQUEST_DELAY, REQUEST_DELAY + 1000);
    
    try {
      log.debug(`Request ${attempt}: ${url}`);
      const res = await http.get(url);
      
      if (res.status === 403) {
        log.warn(`403 on attempt ${attempt}. CF-Ray: ${res.headers['cf-ray'] || 'unknown'}`);
        if (attempt === retries) throw new Error('Blocked by Cloudflare (403)');
        continue;
      }
      
      if (res.status !== 200) {
        if (attempt === retries) throw new Error(`HTTP ${res.status}`);
        continue;
      }
      
      return res.data;
    } catch (e) {
      log.warn(`Attempt ${attempt} failed: ${e.message}`);
      if (attempt === retries) throw e;
      await sleep(1000 * attempt); // exponential backoff
    }
  }
}

async function getMangaInfo(code) {
  const data = await fetchWithRetry(`${BASE_URL}/manga/${code}/`);
  const r = data?.result;
  if (!r) throw new Error('Invalid API response');
  
  return {
    title: r.title || 'Unknown',
    poster: r.poster?.large || r.poster?.medium,
    status: r.status,
    latest: r.latest_chapter,
    isNsfw: r.is_nsfw
  };
}

async function getAllChapters(code) {
  const chaptersMap = new Map(); // number -> best chapter
  let page = 1, hasMore = true;
  
  log.info('Fetching chapters...');
  
  while (hasMore) {
    const url = `${BASE_URL}/manga/${code}/chapters?limit=100&page=${page}&order[number]=asc`;
    const data = await fetchWithRetry(url);
    const items = data?.result?.items || [];
    
    if (items.length === 0) hasMore = false;
    
    for (const c of items) {
      const num = c.number?.toString();
      if (!num) continue;
      
      const isOfficial = c.is_official || c.scanlation_group?.name === 'Official';
      const votes = c.votes || 0;
      const existing = chaptersMap.get(num);
      
      // Keep best version: official > more votes > first
      if (!existing) {
        chaptersMap.set(num, { ...c, _off: isOfficial, _votes: votes });
      } else if (
        (isOfficial && !existing._off) || 
        (isOfficial === existing._off && votes > existing._votes)
      ) {
        chaptersMap.set(num, { ...c, _off: isOfficial, _votes: votes });
      }
    }
    page++;
    
    // Safety break
    if (page > 50) {
      log.warn('Stopped at page 50 to avoid infinite loop');
      break;
    }
  }
  
  // Convert to array, clean internal fields, sort numerically
  return Array.from(chaptersMap.values())
    .map(({ _off, _votes, ...c }) => c)
    .sort((a, b) => {
      const na = parseFloat(a.number), nb = parseFloat(b.number);
      if (na !== nb) return na - nb;
      return a.number.localeCompare(b.number, undefined, { numeric: true });
    });
}

async function getChapterImages(chapterId) {
  const data = await fetchWithRetry(`${BASE_URL}/chapters/${chapterId}/`);
  return (data?.result?.images || [])
    .filter(img => img.url)
    .map(img => img.url);
}

async function downloadFile(url, dest) {
  await fs.mkdir(dirname(dest), { recursive: true });
  const res = await http.get(url, { responseType: 'stream', timeout: 60000 });
  
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(dest);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function createArchive(sourceDir, outputPath, format = 'zip') {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  
  if (format === 'rar') {
    try {
      await execAsync(`which rar`);
      const rarPath = outputPath.replace(/\.zip$/, '.rar');
      await execAsync(`rar a -r -y -inul "${rarPath}" "${sourceDir}/*"`);
      return rarPath;
    } catch {
      log.warn('rar not available, using zip instead');
    }
  }
  
  // Fallback to zip
  const zipPath = outputPath.endsWith('.zip') ? outputPath : outputPath.replace(/\.[^.]+$/, '.zip');
  await execAsync(`cd "${sourceDir}" && zip -r -q "${zipPath}" .`);
  return zipPath;
}

// ============ MAIN DOWNLOAD LOGIC ============
async function downloadManga({ url, start = '1', end = null, format = 'zip' }) {
  const code = extractMangaCode(url);
  log.info(`Manga code: ${code}`);
  
  // Fetch manga info
  const manga = await getMangaInfo(code);
  const safeTitle = safeName(manga.title);
  log.info(`Downloading: ${manga.title}`);
  
  if (manga.isNsfw) {
    log.warn('⚠️ This manga is marked as NSFW');
  }
  
  // Fetch & filter chapters
  const allChapters = await getAllChapters(code);
  let chapters = allChapters.filter(c => parseFloat(c.number) >= parseFloat(start));
  if (end) {
    chapters = chapters.filter(c => parseFloat(c.number) <= parseFloat(end));
  }
  
  if (chapters.length === 0) {
    throw new Error('No chapters found in specified range');
  }
  
  log.info(`Found ${chapters.length} chapters to download`);
  
  // Setup directories
  const mangaDir = join(RESULT_DIR, safeTitle);
  await fs.mkdir(mangaDir, { recursive: true });
  
  // Download each chapter
  for (const chap of chapters) {
    try {
      const chapNum = chap.number;
      const chapTitle = chap.name || chap.title || '';
      const safeChap = safeName(`Ch_${chapNum}${chapTitle ? '_' + chapTitle : ''}`, 80);
      const chapDir = join(mangaDir, safeChap);
      await fs.mkdir(chapDir, { recursive: true });
      
      log.info(`Chapter ${chapNum}: fetching images...`);
      const images = await getChapterImages(chap.chapter_id);
      
      // Download images sequentially (avoid rate limits)
      for (let i = 0; i < images.length; i++) {
        const ext = images[i].split('.').pop()?.split('?')[0] || 'jpg';
        const fname = `${String(i + 1).padStart(3, '0')}.${ext}`;
        await downloadFile(images[i], join(chapDir, fname));
      }
      
      log.info(`✓ Chapter ${chapNum} done (${images.length} pages)`);
      
    } catch (e) {
      log.warn(`Failed chapter ${chap.number}: ${e.message} - continuing...`);
    }
  }
  
  // Create archive
  const archiveName = `${safeTitle}.${format === 'rar' ? 'rar' : 'zip'}`;
  const archivePath = join(RESULT_DIR, archiveName);
  
  log.info(`Creating archive: ${archiveName}`);
  await createArchive(mangaDir, archivePath, format);
  
  // Cleanup
  await fs.rm(mangaDir, { recursive: true, force: true });
  
  log.info(`✅ Success! Archive: ${archivePath}`);
  return archivePath;
}

// ============ ENTRY POINT ============
async function main() {
  const {
    MANGA_URL,
    START_CHAPTER = '1',
    END_CHAPTER = '',
    OUTPUT_FORMAT = 'zip'
  } = process.env;
  
  if (!MANGA_URL) {
    console.error('❌ Set MANGA_URL environment variable');
    process.exit(1);
  }
  
  try {
    log.info('🚀 Starting download...');
    await fs.mkdir(RESULT_DIR, { recursive: true });
    
    await downloadManga({
      url: MANGA_URL,
      start: START_CHAPTER,
      end: END_CHAPTER || null,
      format: OUTPUT_FORMAT.toLowerCase()
    });
    
    console.log('\n✅ Done! Check the "result" folder or downloaded artifact.');
  } catch (e) {
    log.error(`Fatal: ${e.message}`);
    if (e.stack) log.debug(e.stack);
    process.exit(1);
  }
}

main();
