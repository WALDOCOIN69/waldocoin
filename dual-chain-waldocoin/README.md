# 🚀 WALDOCOIN DUAL-CHAIN ECOSYSTEM

## 🎯 Architecture Overview

This is a complete dual-chain implementation supporting both XRPL and Solana blockchains simultaneously.

## 📁 Project Structure

```
dual-chain-waldocoin/
├── shared/                 # Shared utilities and types
│   ├── types/             # TypeScript interfaces
│   ├── utils/             # Common utilities
│   └── config/            # Configuration files
├── chains/                # Blockchain-specific implementations
│   ├── xrpl/              # XRPL implementation
│   │   ├── wallet/        # XRPL wallet operations
│   │   ├── tokens/        # WALDO token operations
│   │   └── transactions/  # Transaction handling
│   └── solana/            # Solana implementation
│       ├── wallet/        # Solana wallet operations
│       ├── tokens/        # SPL token operations
│       └── transactions/  # Transaction handling
├── backend/               # Unified backend API
│   ├── routes/            # API routes
│   ├── services/          # Business logic
│   └── middleware/        # Express middleware
├── frontend/              # React frontend
│   ├── components/        # Reusable components
│   ├── pages/             # Page components
│   └── hooks/             # Custom React hooks
├── bots/                  # Telegram/Twitter bots
│   ├── telegram/          # Telegram bot
│   └── twitter/           # Twitter bot
└── deployment/            # Deployment configurations
    ├── docker/            # Docker configurations
    └── render/            # Render.com configs
```

## 🎯 Features

### ✅ Dual-Chain Support
- **XRPL**: Existing WALDO token integration
- **Solana**: New SPL token implementation
- **Unified API**: Single backend for both chains

### ✅ Wallet Integration
- **XRPL**: XUMM wallet support
- **Solana**: Phantom, Solflare, Sollet support
- **Chain Selection**: Users choose preferred blockchain

### ✅ Token Operations
- **Presale**: Support both chains
- **Rewards**: Meme rewards on both chains
- **Staking**: Cross-chain staking system

### ✅ Social Integration
- **Twitter Bot**: Rewards on both chains
- **Telegram Bot**: Purchases on both chains
- **Dashboard**: Unified stats and management

## 🚀 Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Configure your environment variables
   ```

3. **Start Development**
   ```bash
   npm run dev
   ```

## 🔧 Configuration

See `shared/config/` for blockchain-specific configurations.

## 📖 Documentation

- [XRPL Integration](./chains/xrpl/README.md)
- [Solana Integration](./chains/solana/README.md)
- [API Documentation](./backend/README.md)
- [Frontend Guide](./frontend/README.md)

## 🎯 Deployment

See `deployment/` folder for production deployment guides.
