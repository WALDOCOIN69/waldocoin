// utils/templateLoader.js
// Template loader with tier filtering and search capabilities
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load ranked templates
let rankedTemplates = [];
try {
  const templatesPath = path.join(__dirname, '../scripts/templates-ranked.json');
  rankedTemplates = JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
  console.log(`✅ Loaded ${rankedTemplates.length} ranked templates`);
} catch (error) {
  console.error('❌ Error loading templates:', error.message);
  console.log('⚠️  Falling back to empty template list');
}

/**
 * Get templates for a specific tier
 * @param {string} tier - 'free', 'waldocoin', 'premium', 'gold', 'platinum', 'king'
 * @returns {Array} Array of templates
 */
export function getTemplatesForTier(tier) {
  if (!tier || tier === 'free') {
    // FREE tier: Top 50 templates only
    return rankedTemplates.filter(t => t.tier === 'free');
  }
  
  if (tier === 'waldocoin') {
    // WALDOCOIN tier: Top 150 templates (free + waldocoin)
    return rankedTemplates.filter(t => t.tier === 'free' || t.tier === 'waldocoin');
  }
  
  // PREMIUM/GOLD/PLATINUM/KING: ALL 380 templates
  if (['premium', 'gold', 'platinum', 'king'].includes(tier)) {
    return rankedTemplates;
  }
  
  // Default: free tier
  return rankedTemplates.filter(t => t.tier === 'free');
}

/**
 * Search templates by name, category, or keywords
 * @param {string} query - Search query
 * @param {string} tier - User's tier level
 * @param {string} category - Optional category filter
 * @returns {Array} Matching templates
 */
export function searchTemplates(query, tier = 'free', category = null) {
  // Get templates available for user's tier
  let templates = getTemplatesForTier(tier);
  
  // Filter by category if specified
  if (category) {
    templates = templates.filter(t => t.categories.includes(category));
  }
  
  // Search by query if provided
  if (query && query.trim()) {
    const searchTerm = query.toLowerCase().trim();

    // Split into individual words so long prompts like
    // "make a meme about monday mornings" still match
    // templates whose name or category contains "monday".
    const terms = searchTerm.split(/\s+/).filter(Boolean);

    // Common filler words we don't want to match on
    const STOPWORDS = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'about', 'into', 'onto',
      'make', 'create', 'do', 'did', 'when', 'while', 'that', 'this', 'just',
      'meme', 'memes', 'funny', 'hilarious', 'joke', 'please', 'pls', 'me', 'my', 'you', 'your'
    ]);

    templates = templates.filter(t => {
      const name = (t.name || '').toLowerCase();
      const source = (t.source || '').toLowerCase();
      const categories = Array.isArray(t.categories)
        ? t.categories.map(cat => (cat || '').toLowerCase())
        : [];

      const haystacks = [name, source, ...categories];

      // 1) Try full-phrase match first (old behaviour)
      const fullMatch = haystacks.some(h => h.includes(searchTerm));
      if (fullMatch) return true;

      // 2) Then fall back to per-word matching, ignoring very short
      // words and common filler like "make", "meme", "about".
      const usefulTerms = terms.filter(term =>
        term.length > 2 && !STOPWORDS.has(term)
      );
      if (!usefulTerms.length) return false;

      return usefulTerms.some(term =>
        haystacks.some(h => h.includes(term))
      );
    });
  }
  
  return templates;
}

/**
 * Get all available categories
 * @returns {Array} Array of category names with counts
 */
export function getCategories() {
  const categoryCount = {};
  
  rankedTemplates.forEach(template => {
    template.categories.forEach(cat => {
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });
  });
  
  return Object.entries(categoryCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get a random template for a tier
 * @param {string} tier - User's tier level
 * @param {string} category - Optional category filter
 * @returns {Object} Random template
 */
export function getRandomTemplate(tier = 'free', category = null) {
  let templates = getTemplatesForTier(tier);
  
  if (category) {
    templates = templates.filter(t => t.categories.includes(category));
  }
  
  if (templates.length === 0) {
    return null;
  }
  
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Get template by ID
 * @param {string} id - Template ID
 * @param {string} tier - User's tier level
 * @returns {Object|null} Template or null if not found/not accessible
 */
export function getTemplateById(id, tier = 'free') {
  const templates = getTemplatesForTier(tier);
  return templates.find(t => t.id === id) || null;
}

/**
 * Get tier statistics
 * @returns {Object} Statistics about templates per tier
 */
export function getTierStats() {
  return {
    total: rankedTemplates.length,
    free: rankedTemplates.filter(t => t.tier === 'free').length,
    waldocoin: rankedTemplates.filter(t => t.tier === 'waldocoin').length,
    premium: rankedTemplates.filter(t => t.tier === 'premium').length,
    categories: getCategories().length,
    sources: [...new Set(rankedTemplates.map(t => t.source))].length
  };
}

/**
 * Convert template to Imgflip format for meme generation
 * @param {Object} template - Template object
 * @returns {Object} Imgflip-compatible template
 */
export function toImgflipFormat(template) {
  // If it's already an Imgflip template, return the ID
  if (template.source === 'imgflip' && template.imgflip_id) {
    return {
      id: template.imgflip_id,
      name: template.name
    };
  }
  
  // For other sources, we'll need to use Memegen or custom generation
  return {
    id: template.id,
    name: template.name,
    source: template.source,
    url: template.url
  };
}

export default {
  getTemplatesForTier,
  searchTemplates,
  getCategories,
  getRandomTemplate,
  getTemplateById,
  getTierStats,
  toImgflipFormat
};

