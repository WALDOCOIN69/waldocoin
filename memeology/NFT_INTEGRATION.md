# 🖼️ NFT Integration - Technical Documentation

## Overview
Memeology integrates with the **XRP Ledger (XRPL)** to fetch NFTs owned by users and allow them to use their NFTs as meme templates.

---

## How It Works

### 1. **User Authentication**
- User connects their XUMM wallet
- Wallet address is stored in user session
- Tier is checked (WALDOCOIN or Premium required for NFT access)

### 2. **NFT Fetching from XRPL**
When user clicks "🖼️ Use My NFTs":

```javascript
// Frontend calls backend
const response = await fetch(`/api/user/nfts?wallet_address=${user.wallet}`)
```

### 3. **Backend XRPL Integration**
Backend connects to XRPL and fetches NFTs:

```python
from xrpl.clients import JsonRpcClient
from xrpl.models.requests import AccountNFTs

# Connect to XRPL Mainnet
client = JsonRpcClient("https://s1.ripple.com:51234")

# Fetch NFTs for wallet
request = AccountNFTs(account=wallet_address)
response = client.request(request)
```

### 4. **Metadata Resolution**
For each NFT:
- Extract `URI` field (hex-encoded)
- Decode URI to get metadata URL
- Fetch metadata JSON from URI (IPFS, HTTP, etc.)
- Extract `name`, `image`, `collection` from metadata
- Convert IPFS URLs to HTTP gateway URLs

### 5. **Display in UI**
- NFTs with images are displayed in a grid
- User clicks NFT to use as meme template
- NFT image is loaded into canvas editor
- User adds text and downloads meme

---

## API Endpoint

### `GET /api/user/nfts`

**Parameters:**
- `wallet_address` (string, required) - XRPL wallet address (r-address)

**Response:**
```json
{
  "success": true,
  "wallet": "rN7n7otQDd6FczFgLdlqtyMVrn3NnrcVcU",
  "nfts": [
    {
      "id": "00080000...",
      "name": "WALDOCOIN #42",
      "image_url": "https://ipfs.io/ipfs/Qm...",
      "collection": "WALDOCOIN",
      "token_id": "00080000...",
      "issuer": "rIssuerAddress...",
      "uri": "ipfs://Qm..."
    }
  ],
  "count": 5,
  "total_nfts": 10
}
```

**Notes:**
- Only NFTs with valid image URLs are returned
- `count` = NFTs with images
- `total_nfts` = all NFTs owned (including those without images)

---

## Supported NFT Standards

### ✅ XRPL NFTs with URI
- NFTs must have a `URI` field
- URI should point to metadata JSON
- Metadata should follow standard format:

```json
{
  "name": "NFT Name",
  "description": "NFT Description",
  "image": "ipfs://Qm... or https://...",
  "collection": "Collection Name",
  "attributes": [...]
}
```

### ✅ IPFS Support
- IPFS URIs are automatically converted to HTTP gateway
- `ipfs://Qm...` → `https://ipfs.io/ipfs/Qm...`
- Works for both metadata and image URLs

### ✅ HTTP/HTTPS URIs
- Direct HTTP/HTTPS URLs are supported
- Metadata is fetched with 10-second timeout

---

## Example: Testing with Real Wallet

### 1. Get a wallet address with NFTs
```bash
# Example WALDOCOIN holder address
wallet_address = "rN7n7otQDd6FczFgLdlqtyMVrn3NnrcVcU"
```

### 2. Test the endpoint
```bash
curl "http://localhost:8000/api/user/nfts?wallet_address=rN7n7otQDd6FczFgLdlqtyMVrn3NnrcVcU"
```

### 3. Expected response
- List of NFTs with images
- Each NFT has name, image_url, collection
- Ready to use as meme templates

---

## Configuration

### XRPL Server
Set in `backend/main.py`:

```python
# Mainnet (production)
XRPL_SERVER = "https://s1.ripple.com:51234"

# Testnet (development)
# XRPL_SERVER = "https://s.altnet.rippletest.net:51234"
```

### Environment Variable
Can be set via `.env`:
```
XRPL_SERVER=https://s1.ripple.com:51234
```

---

## Error Handling

### No NFTs Found
- Returns empty array
- UI shows "No NFTs found in your wallet"

### Invalid Wallet Address
- Returns 400 error
- UI shows error message

### XRPL Connection Error
- Returns 500 error
- Falls back to empty NFT list

### Metadata Fetch Failure
- NFT is skipped
- Only NFTs with valid metadata are returned

---

## Performance

### Caching (Future Enhancement)
- Cache NFT metadata for 1 hour
- Reduce IPFS gateway calls
- Faster loading for repeat users

### Pagination (Future Enhancement)
- Support wallets with 100+ NFTs
- Load NFTs in batches of 50
- Infinite scroll in UI

---

## Security

### Tier Verification
- Backend should verify user tier before returning NFTs
- Only WALDOCOIN and Premium users can access

### Rate Limiting
- Limit NFT fetches to prevent abuse
- Max 10 requests per minute per wallet

### IPFS Gateway
- Use trusted IPFS gateways
- Fallback to multiple gateways if one fails

---

## Future Enhancements

1. **NFT Minting** - Mint memes as NFTs (separate feature)
2. **Collection Filtering** - Filter NFTs by collection
3. **Favorite NFTs** - Save favorite NFTs for quick access
4. **NFT Search** - Search NFTs by name
5. **Multi-Chain Support** - Support Ethereum, Polygon NFTs

