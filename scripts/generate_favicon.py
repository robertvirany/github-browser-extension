#!/usr/bin/env python3
"""
Generate an icon.ico for the extension.

This creates a simple 128x128 icon that renders the letters "GH"
on a blue gradient background, then saves the multi-size ICO file
to assets/icon.ico.

Requires Pillow (`pip install pillow`).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "assets" / "icon.ico"
ICON_SIZES = [16, 32, 48, 64, 128]


def generate_icon(size: int) -> Image.Image:
    """Create a single icon image with gradient background and text."""
    img = Image.new("RGBA", (size, size), "#1f6feb")
    draw = ImageDraw.Draw(img)

    # Gradient overlay
    for y in range(size):
        opacity = int(180 + (75 * y / size))
        draw.line([(0, y), (size, y)], fill=(17, 84, 189, opacity))

    # Text
    font_size = int(size * 0.5)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()

    text = "GH"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    position = ((size - text_width) / 2, (size - text_height) / 2 - font_size * 0.1)
    draw.text(position, text, font=font, fill="white")

    return img


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    icons = [generate_icon(size) for size in ICON_SIZES]
    # Pillow saves ICO from largest image, including provided sizes.
    icons[0].save(OUTPUT_PATH, sizes=[icon.size for icon in icons])
    print(f"Generated icon at {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
