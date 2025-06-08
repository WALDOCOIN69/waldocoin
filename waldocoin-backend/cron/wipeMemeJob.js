// cron/wipeMemeJob.js
import cron from "node-cron";
import { wipeMemeKeys } from "../utils/wipeMemeKeys.js";

export function scheduleWipeMemeJob() {
  // Runs at 3:00 AM every day
  cron.schedule("0 3 * * *", async () => {
    console.log("🕒 Running scheduled meme key wipe...");
    await wipeMemeKeys();
  });
}