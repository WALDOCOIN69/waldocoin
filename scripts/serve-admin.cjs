#!/usr/bin/env node

// Simple HTTP server to serve the admin panel and avoid CORS issues
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ADMIN_FILE = path.join(__dirname, '..', 'WordPress', 'waldo-admin-panel.html');

const server = http.createServer((req, res) => {
  // Only serve the admin panel
  if (req.url === '/' || req.url === '/admin') {
    try {
      const content = fs.readFileSync(ADMIN_FILE, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key'
      });
      res.end(content);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading admin panel: ' + error.message);
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Admin Panel Server running at http://localhost:${PORT}`);
  console.log(`📊 Access admin panel at: http://localhost:${PORT}/admin`);
  console.log(`🔑 Admin password: waldogod2025`);
  console.log(`\n💡 This server avoids CORS issues when accessing the backend API.`);
});
