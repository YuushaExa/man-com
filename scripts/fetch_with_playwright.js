// scripts/fetch_with_playwright.js
import { chromium } from 'playwright';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_URL = "https://comix.to/api/v2/manga/93q1r/chapters?limit=100&page=1";
const OUTPUT_FILE = join(__dirname, '..', 'data', 'chapters_93q1r.json');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for GitHub Actions
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });
  
  const page = await context.newPage();
  
  try {
    let apiResponse = null;
    
    // Intercept the API response
    page.on('response', async response => {
      if (response.url().includes('/api/v2/manga/93q1r/chapters') && response.request().method() === 'GET') {
        try {
          apiResponse = await response.json();
        } catch (e) {
          // Ignore non-JSON responses
        }
      }
    });
    
    // Navigate to manga page to trigger API call
    console.log("🌐 Loading manga page...");
    await page.goto("https://comix.to/manga/93q1r", { 
      waitUntil: 'networkidle', 
      timeout: 90000 
    });
    
    // Small delay to ensure API call completes
    await page.waitForTimeout(2000);
    
    // Fallback: direct fetch via page context if interception missed it
    if (!apiResponse) {
      console.log("🔄 Interception missed, trying direct fetch...");
      apiResponse = await page.evaluate(async (url) => {
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          credentials: 'omit'
        });
        return res.json();
      }, API_URL);
    }
    
    if (!apiResponse || apiResponse.status !== 200) {
      console.error("❌ Invalid API response:", JSON.stringify(apiResponse).slice(0, 200));
      process.exit(1);
    }
    
    // Save to file
    const outputDir = join(__dirname, '..', 'data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(apiResponse, null, 2), 'utf-8');
    
    const chapters = apiResponse.result?.items || [];
    console.log(`✅ Successfully fetched ${chapters.length} chapters`);
    
    // Print preview
    chapters.slice(0, 5).forEach(ch => {
      console.log(`  • Ch. ${ch.number}: ${ch.name || 'No title'} [${ch.language}] (ID: ${ch.chapter_id})`);
    });
    
    // Output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `chapter_count=${chapters.length}\n`);
    }
    
    // Also output summary JSON for easy parsing
    const summary = {
      total: chapters.length,
      latest: chapters[0]?.number || null,
      languages: [...new Set(chapters.map(c => c.language))]
    };
    console.log("📊 Summary:", JSON.stringify(summary));
    
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    // Save error screenshot for debugging
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      console.log("📸 Screenshot saved: error-screenshot.png");
    } catch {}
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
