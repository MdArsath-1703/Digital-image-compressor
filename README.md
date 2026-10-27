# Image Compressor & Converter

A frontend-only image utility website built with HTML, CSS and JavaScript for VS Code.

## Run it
1. Extract `image-compressor-converter.zip`.
2. Open the `image-compressor-converter` folder in VS Code.
3. Install the **Live Server** extension.
4. Right-click `index.html` and choose **Open with Live Server**.

You can also open `index.html` directly in a modern browser, but Live Server is recommended.

## Features
- Image upload and drag/drop (multiple files, up to 50 MB per file)
- Browser-side compression and conversion to JPG, PNG, WebP and AVIF where supported
- Optional resizing while preserving aspect ratio
- Before/after comparison slider
- Batch processing and ZIP download of processed images
- Reversible ZIP archive containing original files, plus ZIP extraction
- Dashboard with size reduction, sampled PSNR/SSIM-like estimates, and illustrative curve
- Responsive dark theme and light-theme toggle

## Important limitations
- Lossy compression cannot recreate the exact original pixels. For exact file recovery, use **Create Reversible ZIP** before editing/compressing elsewhere, then use **Restore Images from ZIP**.
- Browser support for AVIF encoding varies.
- Animated GIF and SVG are intentionally excluded from canvas compression to avoid silently destroying animation/vector data. Preserve them using Reversible ZIP.
- The PSNR and SSIM-like values are simplified 64×64 browser sample estimates, not a certified benchmark. The curve is illustrative, not measured model training loss.
- JSZip is loaded from jsDelivr, so ZIP features require an internet connection. Core image compression is local in your browser.
- Large images may be limited by your browser's memory and canvas capabilities.

## Privacy
Image pixels are processed locally by this page. The JSZip library is fetched from a CDN, but image files are not uploaded to a server by this app.
