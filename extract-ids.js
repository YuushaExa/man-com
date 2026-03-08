// extract-ids.js (ES Module version)
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataFile = process.argv[2] || 'data.json';
const outputFile = 'list.json';

try {
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  
  // Support both array and object with entries
  const entries = Array.isArray(data) ? data : (data.entries || data.items || []);
  
  const ids = entries
    .map(item => {
      const url = item.url || item.link || '';
      // Extract slug after last slash: "8jv70-mashira"
      const slug = url.split('/').pop() || '';
      // Get part before first dash: "8jv70"
      const id = slug.split('-')[0].trim();
      return id || null;
    })
    .filter(id => id && id.length > 0);
  
  // Remove duplicates while preserving order
  const uniqueIds = [...new Set(ids)];
  
  fs.writeFileSync(outputFile, JSON.stringify({ ids: uniqueIds, updated: new Date().toISOString() }, null, 2));
  console.log(`✅ Extracted ${uniqueIds.length} IDs to ${outputFile}`);
  
} catch (err) {
  console.error('❌ Error processing data.json:', err.message);
  process.exit(1);
}
