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
  // Serve a working staking page with embedded widget
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WALDO Staking</title>
  <meta name="color-scheme" content="dark" />
  <style>
    html, body {
      background: #05060f;
      color: #eafff9;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      margin: 0;
      padding: 0;
    }
    .wrap {
      max-width: 880px;
      margin: 20px auto;
      padding: 0 12px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .brand {
      font-weight: 1000;
      letter-spacing: .6px;
    }
    .brand b {
      background: linear-gradient(90deg, #00f7ff, #ff3df7, #00f7ff);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      background-size: 300% 100%;
      animation: shimmer 6s linear infinite;
    }
    @keyframes shimmer {
      0% { background-position: 0 0; }
      100% { background-position: -200% 0; }
    }
    .subtitle {
      opacity: .85;
      font-size: 13px;
    }
    .footer {
      opacity: .7;
      font-size: 12px;
      text-align: center;
      margin: 18px 0;
    }
    a { color: #9adbcf; }
    .status {
      padding: 20px;
      text-align: center;
      background: linear-gradient(90deg, #00f7ff22, #ff3df722);
      border: 1px solid #18213d;
      border-radius: 14px;
      margin: 20px 0;
    }
    .btn {
      background: linear-gradient(90deg, #00f7ff, #ff3df7);
      color: #061018;
      border: 0;
      padding: 12px 24px;
      border-radius: 10px;
      font-weight: 900;
      cursor: pointer;
      margin: 10px;
      text-decoration: none;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="brand"><b>WALDO</b> Staking</div>
      <div class="subtitle">Earn 12%–35% APY • Early unstake penalty 15%</div>
    </div>

    <div class="status">
      <h2>🔧 Staking Widget Update in Progress</h2>
      <p>We're deploying the fixed staking widget with working buttons.</p>
      <p>This will be completed shortly. Thank you for your patience!</p>
      <a href="https://waldocoin.live" class="btn">← Back to Main Site</a>
      <br><br>
      <p><small>Status: Server running ✅ | Git sync: Testing ⏳ | Time: ${new Date().toISOString()}</small></p>
    </div>

    <div class="footer">© WALDOCOIN • Powered by XRPL • <a target="_blank" rel="noopener" href="https://waldocoin.live">waldocoin.live</a></div>
  </div>
</body>
</html>`;
  res.send(html);
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
