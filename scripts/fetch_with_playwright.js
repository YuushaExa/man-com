// scripts/fetch_with_playwright.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const API_URL = "https://comix.to/api/v2/manga/93q1r/chapters?limit=100&page=1";
const OUTPUT_FILE = "data/chapters_93q1r.json";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });
  
  const page = await context.newPage();
  
  try {
    // Intercept network responses to capture API data
    let apiResponse = null;
    await page.route('**/api/v2/manga/93q1r/chapters**', route => {
      route.continue();
    });
    
    page.on('response', async response => {
      if (response.url().includes('/api/v2/manga/93q1r/chapters')) {
        apiResponse = await response.json();
      }
    });
    
    // Load the page (triggers API call)
    await page.goto("https://comix.to/manga/93q1r", { waitUntil: 'networkidle', timeout: 60000 });
    
    // Fallback: try direct fetch if interception didn't catch it
    if (!apiResponse) {
      apiResponse = await page.evaluate(async (url) => {
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });
        return res.json();
      }, API_URL);
    }
    
    if (!apiResponse || apiResponse.status !== 200) {
      console.error("❌ Invalid API response:", apiResponse);
      process.exit(1);
    }
    
    // Save to file
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(apiResponse, null, 2));
    
    const chapters = apiResponse.result?.items || [];
    console.log(`✅ Fetched ${chapters.length} chapters`);
    chapters.slice(0, 5).forEach(ch => {
      console.log(`  • Ch. ${ch.number}: ${ch.name || 'No title'} [${ch.language}]`);
    });
    
    // Output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `chapter_count=${chapters.length}\n`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
