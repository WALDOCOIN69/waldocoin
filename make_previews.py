# make_previews.py
# Usage:
#   python make_previews.py --mode pad   --src images --dst previews --size 512
#   python make_previews.py --mode crop  --src images --dst previews --size 512

import os, argparse
from PIL import Image

def ensure_dir(p): 
    os.makedirs(p, exist_ok=True)

def to_rgba(img):
    return img.convert("RGBA")  # preserve transparency

def resize_with_padding(img, target):
    # keep aspect ratio, then letterbox to exact square with transparent padding
    img = to_rgba(img)
    img.thumbnail((target, target), Image.LANCZOS)
    canvas = Image.new("RGBA", (target, target), (0, 0, 0, 0))
    x = (target - img.width) // 2
    y = (target - img.height) // 2
    canvas.paste(img, (x, y), img)
    return canvas

def resize_with_center_crop(img, target):
    # center-crop to square, then resize
    img = to_rgba(img)
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top  = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    return img.resize((target, target), Image.LANCZOS)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["pad", "crop"], required=True, help="pad = keep full image with transparent borders, crop = center crop to square")
    ap.add_argument("--src", default="images", help="source folder with originals")
    ap.add_argument("--dst", default="previews", help="destination folder for previews")
    ap.add_argument("--size", type=int, default=512, help="final width/height")
    args = ap.parse_args()

    ensure_dir(args.dst)
    processed = 0
    skipped = 0

    for name in os.listdir(args.src):
        if not name.lower().endswith(".png"):
            continue
        src_path = os.path.join(args.src, name)
        dst_path = os.path.join(args.dst, name)

        # skip if already exists
        if os.path.exists(dst_path):
            skipped += 1
            continue

        with Image.open(src_path) as im:
            if args.mode == "pad":
                out = resize_with_padding(im, args.size)
            else:
                out = resize_with_center_crop(im, args.size)
            out.save(dst_path, format="PNG", optimize=True)
            processed += 1

    print(f"Done. Processed: {processed}, Skipped existing: {skipped}, Output: {args.dst}")

if __name__ == "__main__":
    main()

