// Script to rank and categorize all 380 meme templates
// Assigns quality scores, categories, and tier levels
// Run: node scripts/rank-and-categorize-templates.js

import fs from 'fs';

// Load all templates
const allTemplates = JSON.parse(fs.readFileSync('scripts/all-templates.json', 'utf8'));

console.log(`📊 Processing ${allTemplates.length} templates...\n`);

// Category keywords for auto-categorization
const categoryKeywords = {
  reaction: ['surprised', 'shocked', 'pikachu', 'monkey', 'puppet', 'harold', 'fry', 'thinking', 'roll safe', 'disaster girl', 'grumpy', 'yelling', 'screaming'],
  comparison: ['drake', 'boyfriend', 'pooh', 'brain', 'doge', 'cheems', 'chad', 'virgin', 'handshake', 'same picture', 'two buttons'],
  success: ['success kid', 'stonks', 'cheers', 'dicaprio', 'winning', 'celebration'],
  failure: ['bad luck', 'not stonks', 'sad', 'pablo escobar', 'disappointed', 'crying'],
  sarcasm: ['wonka', 'aliens', 'one does not simply', 'y u no', 'really', 'sure'],
  wholesome: ['good guy', 'wholesome', 'happy', 'love', 'friendship', 'cute'],
  argument: ['change my mind', 'chopper', 'debate', 'meeting', 'boardroom', 'slapping'],
  advice: ['mallard', 'advice', 'tips', 'pro tip'],
  confession: ['bear', 'confession', 'admit'],
  panic: ['panik', 'kalm', 'sweating', 'nervous', 'anxiety', 'stress'],
  mocking: ['spongebob', 'mocking', 'clown', 'makeup'],
  escalation: ['expanding brain', 'galaxy brain', 'levels', 'stages'],
  classic: ['pepe', 'wojak', 'doge', 'trollface', 'rage', 'forever alone', 'me gusta'],
  modern: ['trade offer', 'squid game', 'gigachad', 'megamind', 'absolute cinema'],
  business: ['business', 'office', 'meeting', 'corporate', 'professional']
};

// Assign categories based on name
function categorizeTemplate(template) {
  const name = template.name.toLowerCase();
  const categories = [];
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => name.includes(keyword))) {
      categories.push(category);
    }
  }
  
  // Default category if none found
  if (categories.length === 0) {
    categories.push('general');
  }
  
  return categories;
}

// Calculate quality score (0-100)
function calculateQualityScore(template) {
  let score = 50; // Base score
  
  // Source quality bonus
  const sourceBonus = {
    'imgflip': 30,      // Imgflip = most popular
    'memegen': 25,      // Memegen = well-curated
    'classic': 20,      // Classics = timeless
    'knowyourmeme': 15, // KYM = iconic
    'reddit': 10,       // Reddit = fresh
    'tenor': 5,         // Tenor = GIFs
    'giphy': 5          // Giphy = GIFs
  };
  
  score += sourceBonus[template.source] || 0;
  
  // Popularity bonus (if available)
  if (template.popularity) {
    score += Math.min(20, Math.log10(template.popularity) * 3);
  }
  
  if (template.upvotes) {
    score += Math.min(15, Math.log10(template.upvotes) * 2);
  }
  
  // Name quality (shorter, cleaner names = better)
  if (template.name.length < 20) {
    score += 5;
  }
  
  return Math.min(100, Math.round(score));
}

// Process all templates
const processedTemplates = allTemplates.map(template => {
  const categories = categorizeTemplate(template);
  const qualityScore = calculateQualityScore(template);
  
  return {
    ...template,
    categories,
    qualityScore,
    primaryCategory: categories[0]
  };
});

// Sort by quality score (highest first)
processedTemplates.sort((a, b) => b.qualityScore - a.qualityScore);

// Assign tier levels
const tieredTemplates = processedTemplates.map((template, index) => {
  let tier = 'premium'; // Default
  
  if (index < 50) {
    tier = 'free'; // Top 50 = FREE tier
  } else if (index < 150) {
    tier = 'waldocoin'; // Top 150 = WALDOCOIN tier
  }
  
  return {
    ...template,
    tier,
    rank: index + 1
  };
});

// Save processed templates
fs.writeFileSync('scripts/templates-ranked.json', JSON.stringify(tieredTemplates, null, 2));

console.log('✅ Templates processed and ranked!\n');
console.log('📊 TIER DISTRIBUTION:');
console.log(`  🆓 FREE (Top 50):       ${tieredTemplates.filter(t => t.tier === 'free').length} templates`);
console.log(`  🪙 WALDOCOIN (51-150):  ${tieredTemplates.filter(t => t.tier === 'waldocoin').length} templates`);
console.log(`  💎 PREMIUM (151-380):   ${tieredTemplates.filter(t => t.tier === 'premium').length} templates`);

console.log('\n📂 CATEGORY DISTRIBUTION:');
const categoryCount = {};
tieredTemplates.forEach(t => {
  t.categories.forEach(cat => {
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });
});

Object.entries(categoryCount)
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, count]) => {
    console.log(`  ${cat.padEnd(15)} ${count} templates`);
  });

console.log('\n🏆 TOP 10 TEMPLATES:');
tieredTemplates.slice(0, 10).forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name} (${t.source}) - Score: ${t.qualityScore}`);
});

console.log('\n✅ Saved to scripts/templates-ranked.json');

