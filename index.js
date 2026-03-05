// index.js - Manga Downloader for comix.to via GitHub Actions
// ZIP only + hardcoded proxy. Edit PROXY_CONFIG below to use a proxy.

import axios from 'axios';
import { createWriteStream, promises as fs } from 'fs';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sanitize from 'sanitize-filename';

const execAsync = promisify(exec);

// ============ CONFIG ============
const BASE_URL = 'https://comix.to/api/v2';
const RESULT_DIR = 'result';
const MAX_RETRIES = 3;
const REQUEST_DELAY = 2000;

// 🔄 PROXY CONFIGURATION - Edit this to use a proxy
// Format: 'http://username:password@host:port' or null to disable
// Example: 'http://user123:pass456@residential.proxy.com:8080'
const PROXY_CONFIG = 'http://84.17.47.124:9002';

// Build axios config with optional proxy
function getAxiosConfig() {
  const config = {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://comix.to/',
      'Origin': 'https://comix.to',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    timeout: 45000,
    validateStatus: () => true
  };
  
  // Add proxy if configured
  if (PROXY_CONFIG) {
    try {
      const url = new URL(PROXY_CONFIG);
      config.proxy = {
        protocol: url.protocol.replace(':', ''),
        host: url.hostname,
        port: parseInt(url.port) || 80,
        auth: url.username ? {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password || '')
        } : undefined
      };
      console.log(`[INFO] Using proxy: ${url.hostname}:${url.port}`);
    } catch (e) {
      console.warn(`[WARN] Invalid proxy config: ${e.message}`);
    }
  }
  
  return config;
}

const http = axios.create(getAxiosConfig());

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
        log.warn(`403 on attempt ${attempt}${PROXY_CONFIG ? ' (using proxy)' : ''}`);
        if (attempt === retries) throw new Error('Blocked by server (403)');
        continue;
      }
      
      if (res.status !== 200) {
        log.warn(`HTTP ${res.status} on attempt ${attempt}`);
        if (attempt === retries) throw new Error(`HTTP ${res.status}`);
        continue;
      }
      
      return res.data;
    } catch (e) {
      log.warn(`Attempt ${attempt} failed: ${e.message}`);
      if (attempt === retries) throw e;
      await sleep(1000 * attempt);
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
  const chaptersMap = new Map();
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
    if (page > 50) {
      log.warn('Stopped at page 50 to avoid infinite loop');
      break;
    }
  }
  
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

// ============ ZIP ARCHIVE ONLY ============
async function createZip(sourceDir, outputPath) {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  
  // Ensure .zip extension
  const zipPath = outputPath.endsWith('.zip') ? outputPath : outputPath + '.zip';
  
  // Use system zip command (faster & reliable on Ubuntu)
  await execAsync(`cd "${sourceDir}" && zip -r -q "${zipPath}" .`);
  
  return zipPath;
}

// ============ MAIN ============
async function downloadManga({ url, start = '1', end = null }) {
  const code = extractMangaCode(url);
  log.info(`Manga code: ${code}`);
  
  const manga = await getMangaInfo(code);
  const safeTitle = safeName(manga.title);
  log.info(`Downloading: ${manga.title}`);
  
  if (manga.isNsfw) log.warn('⚠️ This manga is marked as NSFW');
  
  const allChapters = await getAllChapters(code);
  let chapters = allChapters.filter(c => parseFloat(c.number) >= parseFloat(start));
  if (end) chapters = chapters.filter(c => parseFloat(c.number) <= parseFloat(end));
  
  if (chapters.length === 0) throw new Error('No chapters found in specified range');
  log.info(`Found ${chapters.length} chapters to download`);
  
  const mangaDir = join(RESULT_DIR, safeTitle);
  await fs.mkdir(mangaDir, { recursive: true });
  
  for (const chap of chapters) {
    try {
      const chapNum = chap.number;
      const chapTitle = chap.name || chap.title || '';
      const safeChap = safeName(`Ch_${chapNum}${chapTitle ? '_' + chapTitle : ''}`, 80);
      const chapDir = join(mangaDir, safeChap);
      await fs.mkdir(chapDir, { recursive: true });
      
      log.info(`Chapter ${chapNum}: fetching images...`);
      const images = await getChapterImages(chap.chapter_id);
      
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
  
  // Create ZIP archive with manga title as filename
  const zipName = `${safeTitle}.zip`;
  const zipPath = join(RESULT_DIR, zipName);
  
  log.info(`Creating ZIP archive: ${zipName}`);
  await createZip(mangaDir, zipPath);
  
  // Cleanup temp folder
  await fs.rm(mangaDir, { recursive: true, force: true });
  
  log.info(`✅ Success! Archive: ${zipPath}`);
  return zipPath;
}

// ============ ENTRY ============
async function main() {
  const {
    MANGA_URL,
    START_CHAPTER = '1',
    END_CHAPTER = ''
  } = process.env;
  
  if (!MANGA_URL) {
    console.error('❌ Set MANGA_URL environment variable');
    process.exit(1);
  }
  
  try {
    log.info('🚀 Starting download...');
    log.info(`Proxy: ${PROXY_CONFIG || 'disabled'}`);
    await fs.mkdir(RESULT_DIR, { recursive: true });
    
    await downloadManga({
      url: MANGA_URL,
      start: START_CHAPTER,
      end: END_CHAPTER || null
    });
    
    console.log('\n✅ Done! Check the "result" folder or downloaded artifact.');
  } catch (e) {
    log.error(`Fatal: ${e.message}`);
    if (e.stack) log.debug(e.stack);
    process.exit(1);
  }
}

main();
