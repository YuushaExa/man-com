// basic.js - ES Module Version with Optional Squoosh Optimization
import fs from 'fs/promises';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// == Configuration ==
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_FILE = process.argv[2] || 'data.json';
const OPTIMIZE = process.argv[3] === 'true'; // Pass 'true' to enable optimization

// == Helper: Sanitize filenames ==
function sanitize(str) {
  return (str || '').toString().replace(/[^a-zA-Z0-9._-]/g, '_');
}

// == Helper: Run Squoosh CLI on a file ==
async function optimizeWithSquoosh(inputPath, outputPath) {
  // WebP config: quality 75, effort 4 (balance speed/compression) [[74]]
  // Note: CLI requires escaped JSON string [[2]]
  const webpConfig = '{"quality":75,"effort":4}';
  
  const cmd = `npx @squoosh/cli --webp '${webpConfig}' -d "${path.dirname(outputPath)}" "${inputPath}"`;
  
  try {
    execSync(cmd, { stdio: 'pipe', cwd: __dirname });
    // Squoosh outputs to same dir with same name, so we may need to move/rename
    const squooshOutput = path.join(path.dirname(outputPath), path.basename(inputPath).replace(/\.\w+$/, '.webp'));
    if (squooshOutput !== outputPath && existsSync(squooshOutput)) {
      await fs.rename(squooshOutput, outputPath);
    }
    return true;
  } catch (error) {
    console.error(`\n⚠️  Squoosh failed for ${path.basename(inputPath)}: ${error.message}`);
    // Fallback: keep original
    return false;
  }
}

// == Main Logic ==
async function run() {
  const data = JSON.parse(await fs.readFile(JSON_FILE, 'utf8'));
  
  // == Manga Info ==
  const mangaTitle = sanitize(data.manga.title);
  console.log(`📚 Downloading: ${mangaTitle}`);
  
  // == Create Base Directory ==
  const baseDir = mangaTitle;
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }
  
  // == Track Chapters for Range Naming ==
  const chapterNumbers = [];
  
  // == Process Each Chapter ==
  for (const chapter of data.chapters) {
    const chapterNum = chapter.number;
    chapterNumbers.push(chapterNum);
    
    const pagesCount = chapter.pages_count;
    const chapterName = chapter.name || '';
    
    // Format chapter folder: Chapter_001_Name or Chapter_001
    const chapterPadded = String(chapterNum).padStart(3, '0');
    const safeChapterName = sanitize(chapterName);
    const chapterDir = safeChapterName
      ? path.join(baseDir, `Chapter_${chapterPadded}_${safeChapterName}`)
      : path.join(baseDir, `Chapter_${chapterPadded}`);
    
    if (!existsSync(chapterDir)) {
      mkdirSync(chapterDir, { recursive: true });
    }
    
    console.log(`⬇️  Chapter ${chapterNum}: ${chapterDir} (${pagesCount} pages)`);
    
    // == Download Each Page with curl ==
    for (let pageIndex = 0; pageIndex < chapter.images.length; pageIndex++) {
      const imageUrl = chapter.images[pageIndex].trim();
      const pagePadded = String(pageIndex + 1).padStart(3, '0');
      const tempFile = path.join(chapterDir, `${pagePadded}_temp.webp`);
      const finalFile = path.join(chapterDir, `${pagePadded}.webp`);
      
      // Build curl command with required headers
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
        
        // == Optional: Optimize with Squoosh ==
        if (OPTIMIZE) {
          await optimizeWithSquoosh(tempFile, finalFile);
          // Clean up temp file if optimization succeeded
          if (existsSync(finalFile)) {
            await fs.unlink(tempFile).catch(() => {});
          }
        } else {
          // No optimization: just rename temp to final
          await fs.rename(tempFile, finalFile);
        }
      } catch (error) {
        console.error(`\n❌ Failed to download ${imageUrl}: ${error.message}`);
        // Clean up failed download
        if (existsSync(tempFile)) {
          await fs.unlink(tempFile).catch(() => {});
        }
      }
    }
    console.log(' ✅ Done');
  }
  
  // == Generate Zip Name with Chapter Range ==
  const minChapter = Math.min(...chapterNumbers);
  const maxChapter = Math.max(...chapterNumbers);
  const optimizeSuffix = OPTIMIZE ? '_optimized' : '';
  const zipName = `${mangaTitle}_ch${minChapter}-${maxChapter}${optimizeSuffix}.zip`;
  
  // == Create Zip Archive ==
  console.log(`\n🗜️  Creating zip archive: ${zipName}`);
  execSync(`zip -rq "${zipName}" "${baseDir}"`, { stdio: 'inherit' });
  
  // == Output to GitHub ENV for next steps ==
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    appendFileSync(githubEnv, `MANGA_OUTPUT=${zipName}\n`);
  }
  
  console.log(`✨ Download complete: ${zipName}`);
  if (OPTIMIZE) {
    console.log(`🎨 Images optimized with Squoosh (WebP, quality: 75, effort: 4)`);
  }
}

// == Run ==
run().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
