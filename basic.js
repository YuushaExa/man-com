// basic.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// == Configuration ==
const JSON_FILE = process.argv[2] || 'data.json';
const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));

// == Helper: Sanitize filenames ==
function sanitize(str) {
  return (str || '').toString().replace(/[^a-zA-Z0-9._-]/g, '_');
}

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
  
  // Format chapter folder: Chapter_001_Name or Chapter_001
  const chapterPadded = String(chapterNum).padStart(3, '0');
  const safeChapterName = sanitize(chapterName);
  const chapterDir = safeChapterName
    ? path.join(baseDir, `Chapter_${chapterPadded}_${safeChapterName}`)
    : path.join(baseDir, `Chapter_${chapterPadded}`);
  
  if (!fs.existsSync(chapterDir)) {
    fs.mkdirSync(chapterDir, { recursive: true });
  }
  
  console.log(`⬇️  Chapter ${chapterNum}: ${chapterDir} (${pagesCount} pages)`);
  
  // == Download Each Page with curl ==
  for (let pageIndex = 0; pageIndex < chapter.images.length; pageIndex++) {
    const imageUrl = chapter.images[pageIndex].trim();
    const pagePadded = String(pageIndex + 1).padStart(3, '0');
    const outputFile = path.join(chapterDir, `${pagePadded}.webp`);
    
    // Build curl command with required headers
    const curlCmd = `curl -sL \
      -H "Referer: https://comix.to/" \
      -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
      "${imageUrl}" \
      -o "${outputFile}" \
      --retry 3 \
      --retry-delay 2 \
      --connect-timeout 30`;
    
    try {
      execSync(curlCmd, { stdio: 'pipe' });
      process.stdout.write('.');
    } catch (error) {
      console.error(`\n❌ Failed to download ${imageUrl}: ${error.message}`);
    }
  }
  console.log(' ✅ Done');
}

// == Generate Zip Name with Chapter Range ==
const minChapter = Math.min(...chapterNumbers);
const maxChapter = Math.max(...chapterNumbers);
const zipName = `${mangaTitle}_ch${minChapter}-${maxChapter}.zip`;

// == Create Zip Archive ==
console.log(`\n🗜️  Creating zip archive: ${zipName}`);
execSync(`zip -rq "${zipName}" "${baseDir}"`, { stdio: 'inherit' });

// == Output to GitHub ENV for next steps ==
const githubEnv = process.env.GITHUB_ENV;
if (githubEnv) {
  fs.appendFileSync(githubEnv, `MANGA_OUTPUT=${zipName}\n`);
}

console.log(`✨ Download complete: ${zipName}`);
