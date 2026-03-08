// scripts/process-summary.js
const fs = require('fs');
const path = require('path');

// Read output.log
const logPath = path.join(process.cwd(), 'output.log');
if (!fs.existsSync(logPath)) {
  console.error('❌ output.log not found');
  process.exit(1);
}

const logContent = fs.readFileSync(logPath, 'utf8');

// Parse values matching basic.js output format
const parseValue = (regex) => {
  const match = logContent.match(regex);
  return match ? match[1] : null;
};

const duration = parseValue(/Duration:\s*([0-9.]+)s/) || '0';
const downloads = parseValue(/Downloads:\s*([0-9]+)\/([0-9]+)/);
const downloadsDone = downloads ? downloads.split('/')[0] : '0';
const downloadsTotal = downloads ? downloads.split('/')[1] : '0';

const optimizations = parseValue(/Optimizations:\s*([0-9]+)\/([0-9]+)/);
const optimDone = optimizations ? optimizations.split('/')[0] : '0';
const optimTotal = optimizations ? optimizations.split('/')[1] : '0';

const telegram = parseValue(/Telegram:\s*([0-9]+)\/([0-9]+)\s+sent/);
const tgSent = telegram ? telegram.split('/')[0] : '0';
const tgTotal = telegram ? telegram.split('/')[1] : '0';

// Manga: `w10r` • Ch.`4`  (note the backticks)
const mangaMatch = logContent.match(/Manga:\s*`([^`]+)`\s*•\s*Ch\.`([^`]+)`/);
const mangaName = mangaMatch ? mangaMatch[1].trim() : '';
const chapterRaw = mangaMatch ? mangaMatch[2].trim() : '';
const chapterNum = /^\d+$/.test(chapterRaw) ? parseFloat(chapterRaw) : 0;

const outputMatch = logContent.match(/Total output:\s*([0-9.]+)\s*(MB|GB)/i);
const outputSize = outputMatch ? outputMatch[1] : '0';
const outputUnit = outputMatch ? outputMatch[2].toUpperCase() : 'MB';

console.log(`Parsed: ${mangaName} Ch.${chapterNum} | ${downloadsDone}/${downloadsTotal} downloads | ${outputSize}${outputUnit}`);

// === MERGE status.json ===
let status = {
  total_downloads: 0,
  total_duration: 0,
  total_output_mb: 0,
  total_chapters: 0,
  last_run: null,
  status: 'Ready',
  icon: '🟢'
};

const statusPath = path.join(process.cwd(), 'status.json');
if (fs.existsSync(statusPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    status = { ...status, ...existing };
  } catch (e) {
    console.warn('⚠️ Could not parse status.json:', e.message);
  }
}

status.total_downloads = (status.total_downloads || 0) + parseInt(downloadsDone);
status.total_duration = parseFloat((status.total_duration || 0) + parseFloat(duration)).toFixed(1);

const sizeInMB = outputUnit === 'GB' ? parseFloat(outputSize) * 1024 : parseFloat(outputSize);
status.total_output_mb = parseFloat((status.total_output_mb || 0) + sizeInMB).toFixed(2);

if (chapterNum > 0) {
  status.total_chapters = (status.total_chapters || 0) + chapterNum;
}

status.last_run = new Date().toISOString();
status.timestamp = status.last_run;

fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n');
console.log('✅ status.json merged');

// === UPDATE list.json ===
let mangaList = [];
const listPath = path.join(process.cwd(), 'list.json');
if (fs.existsSync(listPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(listPath, 'utf8'));
    mangaList = Array.isArray(existing) ? existing : (existing.items || []);
  } catch (e) {
    console.warn('⚠️ Could not parse list.json:', e.message);
  }
}

if (mangaName && chapterNum > 0) {
  const existingIndex = mangaList.findIndex(item => item.name === mangaName);
  
  if (existingIndex !== -1) {
    mangaList[existingIndex] = { name: mangaName, chapter: chapterNum };
    console.log(`✅ Updated "${mangaName}" → chapter ${chapterNum}`);
  } else {
    mangaList.push({ name: mangaName, chapter: chapterNum });
    console.log(`✅ Added "${mangaName}" chapter ${chapterNum}`);
  }
  
  fs.writeFileSync(listPath, JSON.stringify({ items: mangaList }, null, 2) + '\n');
}

// === WRITE GITHUB_STEP_SUMMARY ===
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    '## ✅ Process Complete',
    '- 📤 Files sent directly to Telegram',
    '- 🗑️ No artifacts saved (Telegram delivery only)',
    '',
    '### 📊 This Run',
    '```',
    `⏱️ Duration: ${duration}s`,
    `📥 Downloads: ${downloadsDone}/${downloadsTotal}`,
    `🎨 Optimizations: ${optimDone}/${optimTotal}`,
    `📤 Telegram: ${tgSent}/${tgTotal} sent`,
    `🔗 Manga: ${mangaName} • Ch.${chapterNum}`,
    `📦 Total output: ${outputSize} ${outputUnit}`,
    '```',
    '',
    '### 📈 Cumulative Totals',
    '```',
    `Total Downloads: ${status.total_downloads}`,
    `Total Duration: ${status.total_duration}s`,
    `Total Output: ${status.total_output_mb} MB`,
    `Total Chapters: ${status.total_chapters}`,
    '```'
  ].join('\n');
  
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  console.log('✅ GitHub summary written');
}
