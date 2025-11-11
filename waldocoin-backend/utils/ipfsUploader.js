import mime from 'mime'
import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'

const PINATA_GATEWAY = process.env.PINATA_GATEWAY
const PINATA_JWT = process.env.PINATA_JWT

if (!PINATA_GATEWAY || !PINATA_JWT) {
  console.warn('⚠️ PINATA_GATEWAY or PINATA_JWT not configured - IPFS uploads will be disabled')
}

export async function uploadToIPFS(tweetId, imagePath, metadata = {}) {
  try {
    if (!PINATA_GATEWAY || !PINATA_JWT) {
      console.warn(`⚠️ IPFS upload skipped for ${tweetId} - Pinata not configured`)
      return null
    }

    // Read image file
    const imageContent = await fs.promises.readFile(imagePath)
    const fileName = path.basename(imagePath)

    // Create FormData for image upload
    const formData = new FormData()
    const imageBlob = new Blob([imageContent], { type: mime.getType(imagePath) || 'application/octet-stream' })
    formData.append('file', imageBlob, fileName)

    // Upload image to Pinata
    const imageResponse = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PINATA_JWT}`
      },
      body: formData
    })

    if (!imageResponse.ok) {
      throw new Error(`Pinata image upload failed: ${imageResponse.statusText}`)
    }

    const imageData = await imageResponse.json()
    const imageHash = imageData.IpfsHash

    // Create and upload metadata
    const metadataContent = {
      ...metadata,
      image: `ipfs://${imageHash}/${fileName}`
    }

    const metadataBlob = new Blob([JSON.stringify(metadataContent)], { type: 'application/json' })
    const metadataFormData = new FormData()
    metadataFormData.append('file', metadataBlob, `${tweetId}.json`)

    const metadataResponse = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PINATA_JWT}`
      },
      body: metadataFormData
    })

    if (!metadataResponse.ok) {
      throw new Error(`Pinata metadata upload failed: ${metadataResponse.statusText}`)
    }

    const metadataData = await metadataResponse.json()
    const metadataHash = metadataData.IpfsHash

    const ipfsURL = `ipfs://${metadataHash}/${tweetId}.json`
    console.log(`✅ Uploaded to IPFS via Pinata: ${ipfsURL}`)
    return ipfsURL
  } catch (err) {
    console.error(`❌ Failed to upload ${tweetId} to IPFS:`, err.message)
    throw err
  }
}

