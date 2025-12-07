# epub-compressor

A command-line tool for compressing and minifying EPUB files. This tool extracts EPUB archives, minifies HTML/XHTML, CSS, and JavaScript files, optionally optimizes images, and repackages everything into a smaller EPUB file while maintaining EPUB specification compliance.

## Features

- **HTML/XHTML Minification**: Removes whitespace, comments, and redundant attributes from HTML/XHTML files
- **CSS Minification**: Compresses CSS files using CSSO
- **JavaScript Minification**: Minifies and mangles JavaScript files using Terser
- **SVG Optimization**: Basic SVG minification (removes comments and collapses whitespace)
- **Image Optimization** (optional): Optimizes JPEG and PNG images using imagemin plugins
- **EPUB Compliance**: Ensures the output EPUB follows the EPUB specification (mimetype file stored first, uncompressed)

## Installation

```bash
yarn install
yarn build
```

## Usage

### Basic Usage

```bash
node dist/index.js input.epub output.epub
```

### With Image Optimization

```bash
node dist/index.js input.epub output.epub --images
```

### Advanced Options

```bash
node dist/index.js input.epub output.epub --images --quality=75 --level=9
```

### Command-Line Options

- `input.epub`: Path to the input EPUB file (required)
- `output.epub`: Path to the output EPUB file (required)
- `--images`: Enable image optimization (default: `false`)
- `--quality`: Image quality for JPEG/PNG optimization (default: `80`, range: 0-100)
- `--level`: ZIP compression level (default: `9`, range: 0-9)

## How It Works

1. **Extraction**: The EPUB file is extracted to a temporary directory
2. **Processing**: Files are processed based on their extension:
   - `.html`, `.xhtml`, `.htm`, `.xml`, `.opf` → HTML minification
   - `.css` → CSS minification
   - `.js` → JavaScript minification
   - `.svg` → Basic SVG minification
   - `.jpg`, `.jpeg`, `.png` → Image optimization (if `--images` flag is set)
3. **Repackaging**: Files are repackaged into a new EPUB with:
   - `mimetype` file stored first and uncompressed (EPUB requirement)
   - All other files compressed using the specified compression level
4. **Cleanup**: Temporary files are removed

## Technical Details

- Built with TypeScript
- Uses `html-minifier-terser` for HTML minification
- Uses `csso` for CSS minification
- Uses `terser` for JavaScript minification
- Uses `imagemin` with `imagemin-mozjpeg` and `imagemin-pngquant` for image optimization
- Maintains EPUB specification compliance (mimetype handling)

## Notes

- This tool processes EPUB files conservatively to avoid breaking EPUB structure
- Always test the resulting EPUB in an EPUB reader to ensure compatibility
- Image optimization only overwrites files if the optimized version is smaller
- Some XML files may be skipped if they don't appear to be XHTML

## License

MIT
