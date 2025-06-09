import { NFTStorage, File } from 'nft.storage'
import mime from 'mime'
import fs from 'fs'
import path from 'path'

const NFT_STORAGE_KEY = process.env.NFT_STORAGE_API_KEY

if (!NFT_STORAGE_KEY) {
  throw new Error('❌ Missing NFT_STORAGE_API_KEY in environment variables')
}

const client = new NFTStorage({ token: NFT_STORAGE_KEY })

export async function uploadToIPFS(tweetId, imagePath, metadata = {}) {
  try {
    const content = await fs.promises.readFile(imagePath)
    const type = mime.getType(imagePath) || 'application/octet-stream'
    const fileName = path.basename(imagePath)

    const imageFile = new File([content], fileName, { type })

    const metadataContent = {
      ...metadata,
      image: fileName, // reference the image filename, not the whole blob
    }

    const metadataFile = new File(
      [JSON.stringify(metadataContent)],
      `${tweetId}.json`,
      { type: 'application/json' }
    )

    const cid = await client.storeDirectory([imageFile, metadataFile])

    const ipfsURL = `ipfs://${cid}/${tweetId}.json`
    console.log(`✅ Uploaded to IPFS: ${ipfsURL}`)
    return ipfsURL
  } catch (err) {
    console.error(`❌ Failed to upload ${tweetId} to IPFS:`, err.message)
    throw err
  }
}

