import axios from 'axios';
import { logger } from './utils.js';

const BASE_URL = 'https://comix.to/api/v2';
const HEADERS = {
  'Referer': 'https://comix.to/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
};

export const ComixAPI = {
  /**
   * Extract manga code from URL
   * https://comix.to/title/93q1r-the-summoner -> 93q1r
   */
  extractMangaCode(url) {
    const cleanUrl = url.replace(/\/$/, '');
    const parts = cleanUrl.split('/');
    const last = parts[parts.length - 1] || parts[parts.length - 2];
    const code = last.split('-')[0];
    logger.debug(`Extracted code: ${code} from ${url}`);
    return code;
  },

  /**
   * Fetch manga info with retry logic
   */
  async getMangaInfo(mangaCode, retries = 3) {
    const url = `${BASE_URL}/manga/${mangaCode}/`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.debug(`Fetching manga info (attempt ${attempt}): ${url}`);
        const response = await axios.get(url, { 
          headers: HEADERS, 
          timeout: 30000 
        });
        
        const data = response.data?.result;
        if (!data) throw new Error('No result in API response');
        
        return {
          mangaId: data.manga_id,
          hashId: data.hash_id,
          title: data.title || 'Unknown',
          altTitles: data.alt_titles || [],
          slug: data.slug,
          posterUrl: data.poster?.large || data.poster?.medium,
          status: data.status,
          year: data.year,
          genres: data.term_ids || [],
          description: data.synopsis || '',
          latestChapter: data.latest_chapter,
          isNsfw: data.is_nsfw || false
        };
      } catch (error) {
        logger.warn(`Attempt ${attempt} failed: ${error.message}`);
        if (attempt === retries) throw error;
        await new Promise(res => setTimeout(res, 1000 * attempt)); // exponential backoff
      }
    }
  },

  /**
   * Fetch a single page of chapters
   */
  async fetchChapterPage(mangaCode, page) {
    const url = `${BASE_URL}/manga/${mangaCode}/chapters?limit=100&page=${page}&order[number]=asc`;
    try {
      const response = await axios.get(url, { 
        headers: HEADERS, 
        timeout: 30000 
      });
      const items = response.data?.result?.items || [];
      return { page, items, hasMore: items.length === 100 };
    } catch (error) {
      logger.warn(`Failed to fetch page ${page}: ${error.message}`);
      return { page, items: [], hasMore: false };
    }
  },

  /**
   * Fetch ALL chapters with parallel pagination + deduplication
   */
  async getAllChapters(mangaCode, concurrency = 5) {
    const allChapters = new Map(); // chapter_number -> best chapter
    let page = 1;
    let hasMore = true;
    const inFlight = new Set();

    logger.info(`Fetching chapters for ${mangaCode}...`);

    while (hasMore) {
      // Launch concurrent requests up to concurrency limit
      while (inFlight.size < concurrency && hasMore) {
        const currentPage = page++;
        const promise = this.fetchChapterPage(mangaCode, currentPage)
          .then(({ page: p, items, hasMore: more }) => {
            if (!more) hasMore = false;
            
            for (const chap of items) {
              const num = chap.number?.toString();
              if (!num) continue;
              
              // Deduplication: prefer official, then higher votes, then first seen
              const existing = allChapters.get(num);
              const isOfficial = chap.is_official || chap.scanlation_group?.name === 'Official';
              const votes = chap.votes || 0;
              
              if (!existing) {
                allChapters.set(num, { ...chap, _priority: isOfficial ? 2 : 1, _votes: votes });
              } else {
                const existingOfficial = existing.is_official || existing.scanlation_group?.name === 'Official';
                const existingVotes = existing.votes || 0;
                
                // Replace if: new is official & existing isn't, OR same official status but more votes
                if ((isOfficial && !existingOfficial) || 
                    (isOfficial === existingOfficial && votes > existingVotes)) {
                  allChapters.set(num, { ...chap, _priority: isOfficial ? 2 : 1, _votes: votes });
                }
              }
            }
          })
          .finally(() => inFlight.delete(promise));
          
        inFlight.add(promise);
      }
      
      // Wait for at least one to complete before launching more
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(res => setTimeout(res, 200));
    }
    
    // Wait for all remaining requests
    await Promise.all(inFlight);
    
    // Convert to sorted array
    const chapters = Array.from(allChapters.values())
      .map(({ _priority, _votes, ...chap }) => chap) // remove internal fields
      .sort((a, b) => {
        // Numeric sort that handles 1, 2, 2.7, 3, 3.8 correctly
        const numA = parseFloat(a.number);
        const numB = parseFloat(b.number);
        if (numA !== numB) return numA - numB;
        // Fallback: string compare for same numeric value (e.g., "1" vs "1.0")
        return a.number.localeCompare(b.number, undefined, { numeric: true });
      });
    
    logger.info(`Found ${chapters.length} unique chapters`);
    return chapters;
  },

  /**
   * Fetch chapter images
   */
  async getChapterImages(chapterId, retries = 3) {
    const url = `${BASE_URL}/chapters/${chapterId}/`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, { 
          headers: HEADERS, 
          timeout: 30000 
        });
        const images = response.data?.result?.images || [];
        return images
          .filter(img => img.url)
          .map(img => img.url);
      } catch (error) {
        logger.warn(`Attempt ${attempt} failed for chapter ${chapterId}: ${error.message}`);
        if (attempt === retries) throw error;
        await new Promise(res => setTimeout(res, 1000 * attempt));
      }
    }
  }
};
