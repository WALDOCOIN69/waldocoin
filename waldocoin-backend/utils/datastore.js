// utils/dataStore.js
import fs from "fs/promises";
const DB_PATH = "./db.json";

export async function readData() {
  try {
    const data = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("❌ Failed to read DB:", err);
    return {};
  }
}

export async function writeData(data) {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ Failed to write DB:", err);
  }
}
