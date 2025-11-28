// Script to fetch ALL meme templates from Memegen.link API
// Memegen has 1000+ templates - way more than Imgflip!
// Run: node scripts/fetch-memegen-templates.js

import axios from 'axios';
import fs from 'fs';

async function fetchMemegenTemplates() {
  console.log('🔍 Fetching meme templates from Memegen.link API...');
  
  try {
    const response = await axios.get('https://api.memegen.link/templates/');
    
    const templates = response.data;
    console.log(`✅ Found ${templates.length} templates!`);
    
    // Convert to our format
    const converted = templates.map((template, index) => {
      return {
        id: template.id,
        name: template.name,
        type: template.id, // Memegen uses ID as type
        lines: template.lines || 2,
        example: template.example?.text || [],
        url: template.blank
      };
    });
    
    // Generate JavaScript code
    let code = '// Auto-generated from Memegen.link API\n';
    code += '// Generated: ' + new Date().toISOString() + '\n';
    code += `// Total: ${converted.length} templates\n\n`;
    code += 'const memegenTemplates = [\n';
    
    converted.forEach((template, index) => {
      const safeName = template.name.replace(/'/g, "\\'");
      code += `  { id: '${template.id}', name: '${safeName}', type: '${template.type}', lines: ${template.lines} }`;
      if (index < converted.length - 1) {
        code += ',';
      }
      code += '\n';
    });
    
    code += '];\n\n';
    code += `export default memegenTemplates;\n`;
    
    // Save to file
    fs.writeFileSync('scripts/memegen-templates.js', code);
    console.log('✅ Saved to scripts/memegen-templates.js');
    
    // Also create a JSON version
    fs.writeFileSync('scripts/memegen-templates.json', JSON.stringify(converted, null, 2));
    console.log('✅ Saved JSON to scripts/memegen-templates.json');
    
    // Print summary
    console.log('\n📊 SUMMARY:');
    console.log(`Total templates: ${converted.length}`);
    console.log(`\nRandom sample (20 templates):`);
    
    // Show random 20
    const shuffled = [...converted].sort(() => 0.5 - Math.random());
    shuffled.slice(0, 20).forEach((t, i) => {
      console.log(`${i + 1}. ${t.name} (${t.id})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fetchMemegenTemplates();

