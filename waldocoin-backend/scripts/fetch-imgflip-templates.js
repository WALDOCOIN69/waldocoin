// Script to fetch all popular meme templates from Imgflip API
// Run: node scripts/fetch-imgflip-templates.js

import axios from 'axios';
import fs from 'fs';

async function fetchImgflipTemplates() {
  console.log('🔍 Fetching meme templates from Imgflip API...');
  
  try {
    const response = await axios.get('https://api.imgflip.com/get_memes');
    
    if (response.data.success) {
      const memes = response.data.data.memes;
      console.log(`✅ Found ${memes.length} templates!`);
      
      // Generate template array for our code
      const templates = memes.map(meme => {
        // Create a simple type identifier from the name
        const type = meme.name
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '-')
          .substring(0, 20);
        
        return {
          id: meme.id,
          name: meme.name,
          type: type,
          box_count: meme.box_count,
          captions: meme.captions
        };
      });
      
      // Sort by popularity (caption count)
      templates.sort((a, b) => b.captions - a.captions);
      
      // Take top 100
      const top100 = templates.slice(0, 100);
      
      // Generate JavaScript code
      let code = '// Auto-generated from Imgflip API - Top 100 most popular templates\n';
      code += '// Generated: ' + new Date().toISOString() + '\n\n';
      code += 'const templates = [\n';
      
      top100.forEach((template, index) => {
        code += `  { id: '${template.id}', name: '${template.name}', type: '${template.type}' }`;
        if (index < top100.length - 1) {
          code += ',';
        }
        code += '\n';
      });
      
      code += '];\n\n';
      code += `// Total: ${top100.length} templates\n`;
      code += `// Most popular: ${top100[0].name} (${top100[0].captions.toLocaleString()} captions)\n`;
      
      // Save to file
      fs.writeFileSync('scripts/imgflip-templates.js', code);
      console.log('✅ Saved to scripts/imgflip-templates.js');
      
      // Also create a JSON version
      fs.writeFileSync('scripts/imgflip-templates.json', JSON.stringify(top100, null, 2));
      console.log('✅ Saved JSON to scripts/imgflip-templates.json');
      
      // Print summary
      console.log('\n📊 SUMMARY:');
      console.log(`Total templates: ${top100.length}`);
      console.log(`\nTop 10 most popular:`);
      top100.slice(0, 10).forEach((t, i) => {
        console.log(`${i + 1}. ${t.name} (${t.captions.toLocaleString()} uses)`);
      });
      
    } else {
      console.error('❌ API request failed');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fetchImgflipTemplates();

