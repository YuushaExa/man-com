// basic.js - ES Module Version
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// == Setup __dirname for ES Modules ==
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// == Configuration ==
// Args: node basic.js <json_file> <optimize_flag>
const JSON_FILE = process.argv[2] || 'data.json';
const OPTIMIZE = process.argv[3] === 'true';

// == Helper: Sanitize filenames ==
function sanitize(str) {
  return (str || '').toString().replace(/[^a-zA-Z0-9._-]/g, '_');
}

// == Helper: Run Squoosh CLI ==
function optimizeWithSquoosh(inputPath) {
  // Squoosh 0.7.3 CLI usage: squoosh --webp '{"quality":75}' input.webp
  // It overwrites the file by default if extension matches, or creates .webp
  const webpConfig = '{"quality":75,"effort":4}';
  
  // Use npx to ensure local node_modules version is used
  const cmd = `npx squoosh --webp '${webpConfig}' "${inputPath}"`;
  
  try {
    execSync(cmd, { stdio: 'pipe', cwd: __dirname });
    return true;
  } catch (error) {
    console.error(`\n⚠️  Squoosh failed for ${path.basename(inputPath)}: ${error.message}`);
    return false;
  }
}

// == Main Logic ==
function run() {
  if (!fs.existsSync(JSON_FILE)) {
    console.error(`❌ Error: ${JSON_FILE} not found!`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  
  // == Manga Info ==
  const mangaTitle = sanitize(data.manga.title);
  console.log(`📚 Downloading: ${mangaTitle}`);
  
  // == Create Base Directory ==
  const baseDir = mangaTitle;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  
  // == Track Chapters for Range Naming ==
  const chapterNumbers = [];
  
  // == Process Each Chapter ==
  for (const chapter of data.chapters) {
    const chapterNum = chapter.number;
    chapterNumbers.push(chapterNum);
    
    const pagesCount = chapter.pages_count;
    const chapterName = chapter.name || '';
    
    // Format chapter folder
    const chapterPadded = String(chapterNum).padStart(3, '0');
    const safeChapterName = sanitize(chapterName);
    const chapterDir = safeChapterName
      ? path.join(baseDir, `Chapter_${chapterPadded}_${safeChapterName}`)
      : path.join(baseDir, `Chapter_${chapterPadded}`);
    
    if (!fs.existsSync(chapterDir)) {
      fs.mkdirSync(chapterDir, { recursive: true });
    }
    
    console.log(`⬇️  Chapter ${chapterNum}: ${chapterDir} (${pagesCount} pages)`);
    
    // == Download Each Page ==
    for (let pageIndex = 0; pageIndex < chapter.images.length; pageIndex++) {
      const imageUrl = chapter.images[pageIndex].trim();
      const pagePadded = String(pageIndex + 1).padStart(3, '0');
      
      // Download to temp file first
      const tempFile = path.join(chapterDir, `${pagePadded}_temp.webp`);
      const finalFile = path.join(chapterDir, `${pagePadded}.webp`);
      
      const curlCmd = `curl -sL \
        -H "Referer: https://comix.to/" \
        -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
        "${imageUrl}" \
        -o "${tempFile}" \
        --retry 3 \
        --retry-delay 2 \
        --connect-timeout 30`;
      
      try {
        execSync(curlCmd, { stdio: 'pipe' });
        process.stdout.write('.');
        
        // == Optional: Optimize ==
        if (OPTIMIZE) {
          const success = optimizeWithSquoosh(tempFile);
          if (success) {
            // Squoosh outputs to same name usually, but ensure finalFile exists
            if (fs.existsSync(tempFile)) {
              fs.renameSync(tempFile, finalFile);
            }
          } else {
            // Fallback: keep original if optimization fails
            fs.renameSync(tempFile, finalFile);
          }
        } else {
          // No optimization: rename temp to final
          fs.renameSync(tempFile, finalFile);
        }
      } catch (error) {
        console.error(`\n❌ Failed to download ${imageUrl}: ${error.message}`);
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    }
    console.log(' ✅ Done');
  }
  
  // == Generate Zip Name ==
  const minChapter = Math.min(...chapterNumbers);
  const maxChapter = Math.max(...chapterNumbers);
  const optimizeSuffix = OPTIMIZE ? '_optimized' : '';
  const zipName = `${mangaTitle}_ch${minChapter}-${maxChapter}${optimizeSuffix}.zip`;
  
  // == Create Zip Archive ==
  console.log(`\n🗜️  Creating zip archive: ${zipName}`);
  execSync(`zip -rq "${zipName}" "${baseDir}"`, { stdio: 'inherit' });
  
  // == Output to GitHub ENV ==
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    fs.appendFileSync(githubEnv, `MANGA_OUTPUT=${zipName}\n`);
  }
  
  console.log(`✨ Download complete: ${zipName}`);
  if (OPTIMIZE) {
    console.log(`🎨 Images optimized with Squoosh v0.7.3 (WebP, quality: 75, effort: 4)`);
  }
}

// == Run ==
try {
  run();
} catch (error) {
  console.error('💥 Fatal error:', error);
  process.exit(1);
}
