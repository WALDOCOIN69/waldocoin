// WALDO Staking Page Server
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Add error handling
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
});

// Middleware
app.use(express.static(__dirname, {
  maxAge: '1h',
  etag: false
}));

// Routes
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Staking page not found');
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'WALDO Staking Page',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Fallback for any other routes
app.get('*', (req, res) => {
  res.redirect('/');
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏦 WALDO Staking page running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
