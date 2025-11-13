# Memeology - AI Meme Generator

A full-featured meme generator with AI assistance, integrated with WALDOCOIN ecosystem.

## Features

### Free Tier
- 📋 Meme templates (Imgflip)
- 🖼️ Stock photos (Unsplash)
- ✏️ Text overlay
- ⬇️ Download memes
- 🤖 Groq AI suggestions (free, fast)

### Premium Tier (WLO/XRP)
- ✨ Claude AI (best suggestions)
- 🎨 AI image generation (Replicate)
- Unlimited meme creation
- No watermark
- Custom templates
- Advanced filters

## Setup

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Start dev server
npm run dev

# Build for production
npm run build
```

## Architecture

- **Frontend**: React + Vite
- **Backend**: Python FastAPI (shared with waldocoin)
- **Database**: PostgreSQL
- **AI Models**: Claude, Groq, Ollama
- **Image Generation**: Replicate (Stable Diffusion)
- **Stock Photos**: Unsplash API
- **Meme Templates**: Imgflip API

## Integration with Waldocoin

- Shared authentication (XUMM wallet)
- Shared database
- Premium payment in WLO/XRP
- Link from waldocoin.live to memeology.fun

## Environment Variables

```
VITE_API_URL=http://localhost:8000
VITE_WALDOCOIN_URL=https://waldocoin.live
```

## Development

```bash
npm run dev      # Start dev server on http://localhost:3000
npm run build    # Build for production
npm run preview  # Preview production build
```

## Deployment

Deploy to Hostinger on memeology.fun domain:

```bash
npm run build
# Upload dist/ folder to Hostinger
```

