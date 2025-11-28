// Master script to fetch meme templates from ALL free sources
// Combines: Imgflip, Memegen, Reddit, Giphy, Tenor, and more
// Run: node scripts/fetch-all-templates.js

import axios from 'axios';
import fs from 'fs';

const allTemplates = [];

// SOURCE 1: Imgflip (100 templates)
async function fetchImgflip() {
  console.log('\n📥 Fetching from Imgflip API...');
  try {
    const response = await axios.get('https://api.imgflip.com/get_memes');
    if (response.data.success) {
      const memes = response.data.data.memes;
      memes.forEach(meme => {
        allTemplates.push({
          id: `imgflip_${meme.id}`,
          imgflip_id: meme.id,
          name: meme.name,
          source: 'imgflip',
          url: meme.url,
          box_count: meme.box_count,
          popularity: meme.captions || 0
        });
      });
      console.log(`✅ Imgflip: ${memes.length} templates`);
    }
  } catch (error) {
    console.error('❌ Imgflip error:', error.message);
  }
}

// SOURCE 2: Memegen.link (210+ templates)
async function fetchMemegen() {
  console.log('\n📥 Fetching from Memegen.link API...');
  try {
    const response = await axios.get('https://api.memegen.link/templates/');
    const templates = response.data;
    templates.forEach(template => {
      allTemplates.push({
        id: `memegen_${template.id}`,
        memegen_id: template.id,
        name: template.name,
        source: 'memegen',
        url: template.blank,
        lines: template.lines || 2,
        example: template.example?.text || []
      });
    });
    console.log(`✅ Memegen: ${templates.length} templates`);
  } catch (error) {
    console.error('❌ Memegen error:', error.message);
  }
}

// SOURCE 3: Reddit Meme API (random memes from r/memes, r/dankmemes, r/MemeTemplatesOfficial)
async function fetchRedditMemes() {
  console.log('\n📥 Fetching from Reddit Meme API...');
  try {
    // Using D3vd's Meme API that pulls from Reddit
    const response = await axios.get('https://meme-api.com/gimme/MemeTemplatesOfficial/50');
    if (response.data.memes) {
      response.data.memes.forEach((meme, index) => {
        allTemplates.push({
          id: `reddit_${index}_${Date.now()}`,
          name: meme.title,
          source: 'reddit',
          url: meme.url,
          subreddit: meme.subreddit,
          author: meme.author,
          upvotes: meme.ups
        });
      });
      console.log(`✅ Reddit: ${response.data.memes.length} templates`);
    }
  } catch (error) {
    console.error('❌ Reddit API error:', error.message);
  }
}

// SOURCE 4: Giphy Stickers API (meme-style stickers)
async function fetchGiphy() {
  console.log('\n📥 Fetching from Giphy API...');
  try {
    // Giphy has a free tier - search for "meme template"
    const response = await axios.get('https://api.giphy.com/v1/stickers/search', {
      params: {
        api_key: 'sXpGFDGZs0Dv1mmNFvYaGUvYwKX0PWIh', // Public beta key
        q: 'meme template',
        limit: 50,
        rating: 'g'
      }
    });

    if (response.data.data) {
      response.data.data.forEach((gif, index) => {
        allTemplates.push({
          id: `giphy_${gif.id}`,
          name: gif.title || `Giphy Meme ${index}`,
          source: 'giphy',
          url: gif.images.original.url,
          gif_url: gif.images.original.url,
          static_url: gif.images.original_still.url
        });
      });
      console.log(`✅ Giphy: ${response.data.data.length} templates`);
    }
  } catch (error) {
    console.error('❌ Giphy error:', error.message);
  }
}

// SOURCE 5: Tenor API (Google's GIF platform)
async function fetchTenor() {
  console.log('\n📥 Fetching from Tenor API...');
  try {
    const response = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        key: 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ', // Public API key
        q: 'meme template',
        limit: 50
      }
    });

    if (response.data.results) {
      response.data.results.forEach((gif, index) => {
        allTemplates.push({
          id: `tenor_${gif.id}`,
          name: gif.content_description || `Tenor Meme ${index}`,
          source: 'tenor',
          url: gif.media_formats.gif.url,
          gif_url: gif.media_formats.gif.url
        });
      });
      console.log(`✅ Tenor: ${response.data.results.length} templates`);
    }
  } catch (error) {
    console.error('❌ Tenor error:', error.message);
  }
}

// SOURCE 6: Know Your Meme (classic templates)
async function fetchKnowYourMeme() {
  console.log('\n📥 Adding Know Your Meme classics...');
  // These are iconic public domain/creative commons memes
  const kymTemplates = [
    { name: 'Pepe the Frog', type: 'reaction' },
    { name: 'Wojak', type: 'reaction' },
    { name: 'Chad', type: 'comparison' },
    { name: 'Doge', type: 'reaction' },
    { name: 'Trollface', type: 'reaction' },
    { name: 'Rage Guy', type: 'reaction' },
    { name: 'Forever Alone', type: 'reaction' },
    { name: 'Y U No', type: 'reaction' },
    { name: 'Me Gusta', type: 'reaction' },
    { name: 'Poker Face', type: 'reaction' },
    { name: 'Stonks', type: 'reaction' },
    { name: 'Not Stonks', type: 'reaction' },
    { name: 'Big Brain', type: 'reaction' },
    { name: 'Galaxy Brain', type: 'escalation' },
    { name: 'NPC Wojak', type: 'reaction' },
    { name: 'Soyjak', type: 'reaction' },
    { name: 'Gigachad', type: 'comparison' },
    { name: 'Virgin vs Chad', type: 'comparison' },
    { name: 'Doomer', type: 'reaction' },
    { name: 'Bloomer', type: 'reaction' }
  ];

  kymTemplates.forEach((meme, index) => {
    allTemplates.push({
      id: `kym_${index}`,
      name: meme.name,
      source: 'knowyourmeme',
      type: meme.type
    });
  });
  console.log(`✅ Know Your Meme: ${kymTemplates.length} templates`);
}

// SOURCE 7: Quickmeme-style classics (manual curated list)
async function fetchClassicMemes() {
  console.log('\n📥 Adding classic meme templates...');
  const classics = [
    { name: 'Success Kid', category: 'success' },
    { name: 'Bad Luck Brian', category: 'failure' },
    { name: 'Overly Attached Girlfriend', category: 'reaction' },
    { name: 'Scumbag Steve', category: 'reaction' },
    { name: 'Good Guy Greg', category: 'wholesome' },
    { name: 'Socially Awkward Penguin', category: 'reaction' },
    { name: 'First World Problems', category: 'complaint' },
    { name: 'Third World Success', category: 'success' },
    { name: 'Confession Bear', category: 'confession' },
    { name: 'Unpopular Opinion Puffin', category: 'opinion' },
    { name: 'Actual Advice Mallard', category: 'advice' },
    { name: 'Insanity Wolf', category: 'extreme' },
    { name: 'Courage Wolf', category: 'motivation' },
    { name: 'Business Cat', category: 'business' },
    { name: 'Grumpy Cat', category: 'reaction' },
    { name: 'Condescending Wonka', category: 'sarcasm' },
    { name: 'Philosoraptor', category: 'philosophy' },
    { name: 'Skeptical Third World Kid', category: 'skeptical' },
    { name: 'Annoyed Picard', category: 'annoyed' },
    { name: 'Captain Picard Facepalm', category: 'facepalm' }
  ];

  classics.forEach((meme, index) => {
    allTemplates.push({
      id: `classic_${index}`,
      name: meme.name,
      source: 'classic',
      category: meme.category
    });
  });
  console.log(`✅ Classic Memes: ${classics.length} templates`);
}

// Main function
async function fetchAll() {
  console.log('🚀 Fetching meme templates from ALL FREE sources...\n');
  console.log('Sources: Imgflip, Memegen, Reddit, Giphy, Tenor, Know Your Meme, Classics\n');

  await fetchImgflip();
  await fetchMemegen();
  await fetchRedditMemes();
  await fetchGiphy();
  await fetchTenor();
  await fetchKnowYourMeme();
  await fetchClassicMemes();

  console.log('\n' + '='.repeat(60));
  console.log(`📊 TOTAL TEMPLATES FETCHED: ${allTemplates.length}`);
  console.log('='.repeat(60));

  // Remove duplicates by name
  const uniqueTemplates = [];
  const seen = new Set();

  allTemplates.forEach(template => {
    const key = template.name.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTemplates.push(template);
    }
  });

  console.log(`\n✨ After removing duplicates: ${uniqueTemplates.length} unique templates`);

  // Save combined templates
  fs.writeFileSync('scripts/all-templates.json', JSON.stringify(uniqueTemplates, null, 2));
  console.log('✅ Saved to scripts/all-templates.json');

  // Group by source
  const bySource = {};
  uniqueTemplates.forEach(t => {
    bySource[t.source] = (bySource[t.source] || 0) + 1;
  });

  console.log('\n📈 Templates by source:');
  Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      console.log(`  ${source.padEnd(20)} ${count} templates`);
    });

  console.log('\n🎯 SUMMARY:');
  console.log(`  Total unique templates: ${uniqueTemplates.length}`);
  console.log(`  Sources used: ${Object.keys(bySource).length}`);
  console.log(`  Ready to use in Memeology!`);
}

fetchAll();

