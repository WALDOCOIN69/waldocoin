#!/usr/bin/env python3
"""
Simple X (Twitter) meme poster for WALDOCOIN
- Posts images with caption including #waldocoin
- Supports local folder or direct image URL
- Can run once or on an interval

Env vars required (User context OAuth 1.0a):
  TWITTER_API_KEY
  TWITTER_API_SECRET
  TWITTER_ACCESS_TOKEN
  TWITTER_ACCESS_SECRET

Examples:
  # Post a single local image
  python poster.py --image ./memes/sample.png --text "WALDO vibes"

  # Post from a folder every 60 minutes (random image each time)
  python poster.py --dir ./memes --every-min 60

  # Post a remote URL once
  python poster.py --url https://example.com/meme.jpg --text "Let’s go"
"""
import argparse
import os
import random
import sys
import time
import tempfile
import logging
from pathlib import Path
from typing import Optional

import requests
import tweepy

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s'
)
logger = logging.getLogger("meme-poster")

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".gif"}


def ensure_hashtag(text: Optional[str]) -> str:
    base = (text or "").strip()
    if "#waldocoin" not in base.lower():
        base = (base + " ").strip() + "#waldocoin"
    return base.strip()


def get_api() -> tweepy.API:
    api_key = os.getenv("TWITTER_API_KEY")
    api_secret = os.getenv("TWITTER_API_SECRET")
    access_token = os.getenv("TWITTER_ACCESS_TOKEN")
    access_secret = os.getenv("TWITTER_ACCESS_SECRET")

    if not all([api_key, api_secret, access_token, access_secret]):
        logger.error("Missing one or more Twitter credentials (API key/secret, access token/secret)")
        sys.exit(1)

    auth = tweepy.OAuth1UserHandler(api_key, api_secret, access_token, access_secret)
    api = tweepy.API(auth)

    # Verify credentials
    try:
        api.verify_credentials()
        logger.info("✅ Authenticated with Twitter API")
    except Exception as e:
        logger.error(f"❌ Twitter auth failed: {e}")
        sys.exit(1)

    return api


def _download_to_temp(url: str) -> str:
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    suffix = Path(url).suffix or ".png"
    fd, tmp_path = tempfile.mkstemp(prefix="waldo-meme-", suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(r.content)
    return tmp_path


def post_once(api: tweepy.API, image_path: Optional[str], url: Optional[str], text: Optional[str]) -> Optional[int]:
    caption = ensure_hashtag(text)

    # Resolve image path
    tmp_to_cleanup = None
    try:
        if url:
            logger.info(f"⬇️ Downloading image from URL: {url}")
            tmp_to_cleanup = _download_to_temp(url)
            media_path = tmp_to_cleanup
        elif image_path:
            media_path = image_path
        else:
            logger.error("No image provided. Use --image or --url or --dir mode.")
            return None

        logger.info(f"📤 Uploading media: {media_path}")
        media = api.media_upload(media_path)
        logger.info("✍️ Posting tweet")
        status = api.update_status(status=caption, media_ids=[media.media_id])
        logger.info(f"✅ Posted: https://x.com/i/web/status/{status.id}")
        return status.id
    finally:
        if tmp_to_cleanup and os.path.exists(tmp_to_cleanup):
            try:
                os.remove(tmp_to_cleanup)
            except Exception:
                pass


def pick_random_image_from_dir(dir_path: str) -> Optional[str]:
    p = Path(dir_path)
    if not p.exists() or not p.is_dir():
        logger.error(f"Directory not found: {dir_path}")
        return None
    candidates = [str(fp) for fp in p.iterdir() if fp.suffix.lower() in ALLOWED_EXTS and fp.is_file()]
    if not candidates:
        logger.error(f"No images found in {dir_path} (allowed: {', '.join(sorted(ALLOWED_EXTS))})")
        return None
    return random.choice(candidates)


def run_interval_mode(api: tweepy.API, dir_path: str, every_min: int, text: Optional[str]):
    logger.info(f"⏱️ Interval mode: dir={dir_path}, every={every_min} min")
    while True:
        try:
            img = pick_random_image_from_dir(dir_path)
            if img:
                post_once(api, img, None, text)
            else:
                logger.warning("Skipping post this cycle (no image)")
        except Exception as e:
            logger.error(f"Post cycle failed: {e}")
        # Sleep until next cycle
        time.sleep(max(60, every_min * 60))


def parse_args():
    ap = argparse.ArgumentParser(description="Post memes to X with #waldocoin")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", help="Path to local image file")
    group.add_argument("--url", help="Direct image URL")
    group.add_argument("--dir", help="Directory with image files (random pick)")
    ap.add_argument("--text", help="Additional caption text (hashtag auto-appended)")
    ap.add_argument("--every-min", type=int, help="If set with --dir, post every N minutes")
    return ap.parse_args()


def main():
    args = parse_args()
    api = get_api()

    if args.dir:
        if not args.every_min:
            # Post one random image and exit
            img = pick_random_image_from_dir(args.dir)
            if not img:
                sys.exit(1)
            post_once(api, img, None, args.text)
        else:
            run_interval_mode(api, args.dir, args.every_min, args.text)
    else:
        post_once(api, args.image, args.url, args.text)


if __name__ == "__main__":
    main()

