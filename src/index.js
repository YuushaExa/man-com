/**
 * Cloudflare Worker: Fetch manga chapters from comix.to API
 * Triggered by cron or manual HTTP request
 */

const API_URL = "https://comix.to/api/v2/manga/93q1r/chapters";
const LIMIT = 100;
const PAGE = 1;

export default {
  // Cron trigger handler
  async scheduled(event, env, ctx) {
    console.log(`⏰ Cron triggered at ${new Date().toISOString()}`);
    await fetchAndProcess(env);
  },

  // HTTP request handler (for manual testing/webhook)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Manual trigger via ?force=1
    if (url.searchParams.get("force") === "1") {
      const result = await fetchAndProcess(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    return new Response("✅ Worker is running. Use ?force=1 to trigger fetch.", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};

async function fetchAndProcess(env) {
  const params = new URLSearchParams({
    limit: LIMIT.toString(),
    page: PAGE.toString()
  });
  
  const fetchUrl = `${API_URL}?${params}`;
  
  try {
    // 🌐 Make the request (Cloudflare handles HTTPS automatically)
    const response = await fetch(fetchUrl, {
      method: "GET",
      headers: {
        "User-Agent": "ComixFetcher/1.0 (Cloudflare Worker)",
        // Add auth if needed: "Authorization": `Bearer ${env.COMIX_API_KEY}`
      },
      cf: {
        cacheTtl: 300 // Cache response at edge for 5 min (optional)
      }
    });
    
    // ❌ Check HTTP status
    if (!response.ok) {
      const errorText = await response.text().catch(() => "No body");
      console.error(`❌ HTTP ${response.status}: ${errorText}`);
      throw new Error(`API request failed: ${response.status}`);
    }
    
    // 📦 Parse JSON
    const data = await response.json();
    
    // ✅ Validate API status field
    if (data.status !== 200) {
      console.warn(`⚠️ API returned status: ${data.status}`);
    }
    
    const items = data.result?.items || [];
    console.log(`✅ Fetched ${items.length} chapters`);
    
    // 📋 Log first few chapters (visible in Workers console)
    items.slice(0, 5).forEach(ch => {
      console.log(`  • Ch.${ch.number}: "${ch.name || 'No name'}" [${ch.language}]`);
    });
    
    // 💾 Optional: Store in KV (uncomment if KV namespace configured)
    /*
    if (env.CHAPTERS_KV) {
      await env.CHAPTERS_KV.put(
        `chapters:93q1r:${Date.now()}`,
        JSON.stringify(data),
        { expirationTtl: 86400 } // 24 hours
      );
      console.log("💾 Saved to KV storage");
    }
    */
    
    // 📤 Optional: Send to webhook (Discord/Telegram/etc)
    /*
    if (env.WEBHOOK_URL) {
      await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `📚 Found ${items.length} chapters for manga 93q1r`,
          chapters: items.slice(0, 3).map(c => `Ch.${c.number}: ${c.name}`)
        })
      });
    }
    */
    
    return {
      success: true,
      timestamp: new Date().toISOString(),
      chapterCount: items.length,
      firstChapter: items[0]?.number || null
    };
    
  } catch (error) {
    console.error(`❌ Fetch failed: ${error.message}`);
    
    // Optional: Alert on failure
    if (env.ALERT_WEBHOOK) {
      await fetch(env.ALERT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `🚨 Worker error: ${error.message}` })
      });
    }
    
    throw error; // Re-throw to mark cron as failed in dashboard
  }
}
