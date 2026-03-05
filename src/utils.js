import sanitize from 'sanitize-filename';
import { createWriteStream, promises as fs } from 'fs';
import { join, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';

const execAsync = promisify(exec);

// Simple logger
export const logger = {
  debug: (msg) => console.debug(`[DEBUG] ${msg}`),
  info: (msg) => console.info(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

/**
 * Sanitize string for filesystem
 */
export function safeFilename(str, maxLength = 100) {
  return sanitize(str).replace(/\s+/g, '_').substring(0, maxLength);
}

/**
 * Download file with progress
 */
export async function downloadFile(url, destPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, { 
        responseType: 'stream',
        timeout: 60000,
        headers: { 'User-Agent': HEADERS['User-Agent'] }
      });
      
      const writer = createWriteStream(destPath);
      return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (error) {
      logger.warn(`Download attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) throw error;
      await new Promise(res => setTimeout(res, 1000 * attempt));
    }
  }
}

/**
 * Create archive (zip or rar)
 */
export async function createArchive(sourceDir, outputPath, format = 'zip') {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  
  if (format === 'rar' && await isRarAvailable()) {
    // Use system rar for better compression
    const rarPath = outputPath.replace(/\.zip$/, '.rar');
    await execAsync(`rar a -r -y "${rarPath}" "${sourceDir}/*"`);
    return rarPath;
  } else {
    // Fallback to zip via archiver
    if (!outputPath.endsWith('.zip')) outputPath = outputPath.replace(/\.[^.]+$/, '.zip');
    
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      output.on('close', () => resolve(outputPath));
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }
}

async function isRarAvailable() {
  try {
    await execAsync('which rar');
    return true;
  } catch {
    logger.warn('rar not found, falling back to zip');
    return false;
  }
}

// Helper for dirname (Node 20+ has path.dirname in fs, but let's be safe)
import { dirname } from 'path';
