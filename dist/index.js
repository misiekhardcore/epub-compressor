#!/usr/bin/env node
/**
 * epub-compress.js
 *
 * Basic EPUB compressor/minifier:
 * - Extracts EPUB to a temp dir
 * - Minifies XHTML/HTML (html-minifier-terser)
 * - Minifies CSS (csso)
 * - Minifies JS (terser)
 * - Optionally optimizes images (imagemin + plugins)
 * - Recreates EPUB with mimetype stored and first (required by EPUB)
 *
 * NOTE: This is example code — test resulting EPUB in an EPUB reader.
 */
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { pipeline } from "stream";
import unzipper from "unzipper"; // npm i unzipper
import archiver from "archiver"; // npm i archiver
import { minify as htmlMinify } from "html-minifier-terser"; // npm i html-minifier-terser
import * as csso from "csso"; // npm i csso
import { minify as terser } from "terser"; // npm i terser
import imagemin from "imagemin"; // npm i imagemin
import imageminMozjpeg from "imagemin-mozjpeg"; // npm i imagemin-mozjpeg
import imageminPngquant from "imagemin-pngquant"; // npm i imagemin-pngquant
import minimist from "minimist"; // npm i minimist
const fsp = fs.promises;
async function run() {
    const argv = minimist(process.argv.slice(2), {
        boolean: ["images"],
        default: { images: false, quality: 80, level: 9 },
    });
    const [inPath, outPath] = argv._;
    if (!inPath || !outPath) {
        console.error("Usage: node epub-compress.js input.epub output.epub [--images] [--quality=75] [--level=9]");
        process.exit(2);
    }
    console.info("Compressing", inPath, "to", outPath);
    const tmp = path.join(os.tmpdir(), "epub-compress-" + crypto.randomBytes(6).toString("hex"));
    await fsp.mkdir(tmp, { recursive: true });
    // 1) Extract archive
    await extractTo(inPath, tmp);
    // 2) Process files
    await processFiles(tmp, {
        images: argv["images"],
        quality: Number(argv["quality"]),
    });
    // 3) Repack into output EPUB
    await createEpub(tmp, outPath, { level: Number(argv["level"]) });
    // 4) cleanup
    await removeDir(tmp);
    console.info("Done:", outPath);
}
async function extractTo(epubPath, outDir) {
    await fsp.mkdir(outDir, { recursive: true });
    const extract = unzipper.Extract({ path: outDir });
    await new Promise((resolve, reject) => {
        extract.on("close", resolve);
        extract.on("error", reject);
        pipeline(fs.createReadStream(epubPath), extract, (err) => {
            if (err)
                reject(err);
        });
    });
    // Wait a bit to ensure all file system writes are fully flushed
    await new Promise((resolve) => setTimeout(resolve, 100));
}
async function processFiles(root, opts) {
    const entries = await walk(root);
    for (const filePath of entries) {
        const rel = path.relative(root, filePath);
        const ext = path.extname(filePath).toLowerCase();
        try {
            if (ext === ".html" ||
                ext === ".xhtml" ||
                ext === ".htm" ||
                ext === ".xml" ||
                ext === ".opf") {
                // be conservative on .xml; only minify if looks like XHTML (heuristic)
                await minifyHtmlFile(filePath);
            }
            else if (ext === ".css") {
                await minifyCssFile(filePath);
            }
            else if (ext === ".js") {
                await minifyJsFile(filePath);
            }
            else if (opts.images && [".jpg", ".jpeg", ".png"].includes(ext)) {
                await optimizeImage(filePath, opts.quality);
            }
            else if (ext === ".svg") {
                // cheap svg minification (remove whitespace). For serious use svgo.
                await minifySvg(filePath);
            }
            else {
                console.warn("Skipping", rel);
            }
            // else: leave other files alone (fonts, container.xml, .opf etc.)
        }
        catch (e) {
            console.warn("Failed to process", rel, e.message);
            // continue — don't let one failure stop the whole job
        }
    }
}
async function minifyHtmlFile(filePath) {
    const src = await fsp.readFile(filePath, "utf8");
    // html-minifier-terser is not fully XML-aware, but works for most XHTML; use conservatively
    const min = await htmlMinify(src, {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: true,
        minifyJS: true, // we handle JS files separately
        minifyCSS: true,
        keepClosingSlash: true,
        conservativeCollapse: true,
        collapseBooleanAttributes: true,
    });
    await fsp.writeFile(filePath, min, "utf8");
}
async function minifyCssFile(filePath) {
    const src = await fsp.readFile(filePath, "utf8");
    const out = csso.minify(src, { comments: false }).css;
    await fsp.writeFile(filePath, out, "utf8");
}
async function minifyJsFile(filePath) {
    const src = await fsp.readFile(filePath, "utf8");
    const r = await terser(src, { compress: true, mangle: true });
    // @ts-expect-error - terser.error is not typed
    if (r.error)
        throw r.error;
    if (r.code)
        await fsp.writeFile(filePath, r.code, "utf8");
}
async function optimizeImage(filePath, quality = 80) {
    const ext = path.extname(filePath).toLowerCase();
    const input = await fsp.readFile(filePath);
    const plugins = [];
    if (ext === ".jpg" || ext === ".jpeg") {
        plugins.push(imageminMozjpeg({ quality }));
    }
    else if (ext === ".png") {
        plugins.push(imageminPngquant({
            quality: [Math.max(0.1, (quality - 30) / 100), quality / 100],
        }));
    }
    else {
        return;
    }
    const out = await imagemin.buffer(input, { plugins });
    // If optimization produced a smaller buffer, overwrite, otherwise keep original
    if (out.length < input.length)
        await fsp.writeFile(filePath, out);
}
async function minifySvg(filePath) {
    const src = await fsp.readFile(filePath, "utf8");
    // Minimal conservative SVG minify: collapse whitespace and remove comments
    const min = src
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    await fsp.writeFile(filePath, min, "utf8");
}
async function createEpub(dir, outPath, opts = { level: 9 }) {
    // EPUB requires a file named "mimetype" as the first entry, stored with no compression.
    const mimePath = path.join(dir, "mimetype");
    if (!fs.existsSync(mimePath)) {
        throw new Error("No mimetype file found at root of EPUB. Aborting.");
    }
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: opts.level } });
    archive.on("warning", (err) => console.warn("archiver warning", err));
    archive.on("error", (err) => {
        throw err;
    });
    archive.pipe(output);
    // Append mimetype first, store (no compression)
    archive.append(fs.createReadStream(mimePath), {
        name: "mimetype",
        store: true,
    });
    // Add the rest of files
    const allFiles = await walk(dir);
    // sort to keep output deterministic: exclude mimetype and ensure consistent order
    allFiles.sort();
    for (const file of allFiles) {
        const rel = path.relative(dir, file);
        if (rel === "mimetype")
            continue;
        const stat = await fsp.stat(file);
        if (stat.isFile()) {
            archive.file(file, { name: rel });
        }
    }
    await archive.finalize();
}
async function walk(dir) {
    const files = [];
    async function _walk(p) {
        const entries = await fsp.readdir(p, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(p, entry.name);
            if (entry.isDirectory()) {
                await _walk(full);
            }
            else if (entry.isFile() || entry.isSymbolicLink()) {
                files.push(full);
            }
            // Skip other special files
        }
    }
    await _walk(dir);
    return files;
}
async function removeDir(dir) {
    // recursive rm
    await fsp.rm(dir, { recursive: true, force: true });
}
// Run
run().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map