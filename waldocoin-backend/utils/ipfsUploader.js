import { NFTStorage, File } from "nft.storage";
import mime from "mime";
import fs from "fs";
import path from "path";

const NFT_STORAGE_KEY = process.env.NFT_STORAGE_API_KEY;
const client = new NFTStorage({ token: NFT_STORAGE_KEY });

export async function uploadToIPFS(tweetId, imagePath, metadata) {
  const content = await fs.promises.readFile(imagePath);
  const type = mime.getType(imagePath);
  const imageFile = new File([content], path.basename(imagePath), { type });

  const metadataFile = new File(
    [JSON.stringify({ ...metadata, image: imageFile })],
    `${tweetId}.json`,
    { type: "application/json" }
  );

  const cid = await client.storeDirectory([imageFile, metadataFile]);
  return `ipfs://${cid}/${tweetId}.json`;
}
