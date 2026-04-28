import fs from 'node:fs';
import { PNG } from 'pngjs';
import path from 'node:path';
import pngToIco from 'png-to-ico';

const outDir = path.resolve('assets');
const publicDir = path.resolve('public');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

function createIconPng(size) {
    const png = new PNG({ width: size, height: size });
    const radius = size * 0.24;
    const cx = size / 2;
    const cy = size / 2;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (size * y + x) << 2;
            const dx = Math.max(Math.abs(x - cx + 0.5) - (cx - radius), 0);
            const dy = Math.max(Math.abs(y - cy + 0.5) - (cy - radius), 0);
            const inside = dx * dx + dy * dy <= radius * radius;
            if (!inside) {
                png.data[idx + 3] = 0;
                continue;
            }

            const t = (x * 0.7 + y * 1.15) / (size * 1.85);
            png.data[idx] = Math.round(114 + t * 92);
            png.data[idx + 1] = Math.round(244 - t * 72);
            png.data[idx + 2] = Math.round(216 + t * 34);
            png.data[idx + 3] = 255;
        }
    }

    const ink = [7, 12, 26, 255];
    const glow = [233, 238, 247, 86];
    const stroke = Math.max(2, Math.round(size * 0.032));
    const glowStroke = Math.max(stroke + 1, Math.round(size * 0.052));
    const points = [
        [0.25, 0.55],
        [0.39, 0.55],
        [0.45, 0.36],
        [0.52, 0.72],
        [0.59, 0.48],
        [0.64, 0.55],
        [0.76, 0.55],
    ].map(([x, y]) => [Math.round(size * x), Math.round(size * y)]);

    function paint(px, py, color) {
        if (px < 0 || py < 0 || px >= size || py >= size) return;
        const idx = (size * py + px) << 2;
        png.data[idx] = color[0];
        png.data[idx + 1] = color[1];
        png.data[idx + 2] = color[2];
        png.data[idx + 3] = color[3];
    }

    function thickLine(x1, y1, x2, y2, width, color) {
        const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = Math.round(x1 + (x2 - x1) * t);
            const y = Math.round(y1 + (y2 - y1) * t);
            for (let yy = -width; yy <= width; yy++) {
                for (let xx = -width; xx <= width; xx++) {
                    if (xx * xx + yy * yy <= width * width) paint(x + xx, y + yy, color);
                }
            }
        }
    }

    function drawPulse(width, color) {
        for (let i = 0; i < points.length - 1; i++) {
            thickLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], width, color);
        }
    }

    drawPulse(glowStroke, glow);
    drawPulse(stroke, ink);

    return PNG.sync.write(png);
}

function createIcns(entries) {
    const chunks = entries.map(([type, png]) => {
        const header = Buffer.alloc(8);
        header.write(type, 0, 4, 'ascii');
        header.writeUInt32BE(png.length + 8, 4);
        return Buffer.concat([header, png]);
    });
    const header = Buffer.alloc(8);
    header.write('icns', 0, 4, 'ascii');
    header.writeUInt32BE(
        chunks.reduce((total, chunk) => total + chunk.length, 8),
        4,
    );
    return Buffer.concat([header, ...chunks]);
}

function createTrayPng(size) {
    const png = new PNG({ width: size, height: size });
    const scale = size / 16;
    const radius = 4 * scale;
    const cx = size / 2;
    const cy = size / 2;
    const background = [126, 246, 227, 255];
    const highlight = [199, 166, 255, 255];
    const ink = [6, 12, 26, 255];

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (size * y + x) << 2;
            const dx = Math.max(Math.abs(x - cx + 0.5) - (cx - radius), 0);
            const dy = Math.max(Math.abs(y - cy + 0.5) - (cy - radius), 0);
            const inside = dx * dx + dy * dy <= radius * radius;
            if (!inside) {
                png.data[idx + 3] = 0;
                continue;
            }

            const t = (x + y) / (size * 2);
            png.data[idx] = Math.round(background[0] + (highlight[0] - background[0]) * t);
            png.data[idx + 1] = Math.round(background[1] + (highlight[1] - background[1]) * t);
            png.data[idx + 2] = Math.round(background[2] + (highlight[2] - background[2]) * t);
            png.data[idx + 3] = 255;
        }
    }

    const points = [
        [2.7, 8],
        [5.7, 8],
        [7, 4.8],
        [8.3, 11.2],
        [9.8, 6.8],
        [11.1, 8],
        [13.4, 8],
    ].map(([x, y]) => [Math.round(x * scale), Math.round(y * scale)]);

    function paint(px, py, color) {
        if (px < 0 || py < 0 || px >= size || py >= size) return;
        const idx = (size * py + px) << 2;
        png.data[idx] = color[0];
        png.data[idx + 1] = color[1];
        png.data[idx + 2] = color[2];
        png.data[idx + 3] = color[3];
    }

    function thickLine(x1, y1, x2, y2, width, color) {
        const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 3;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = Math.round(x1 + (x2 - x1) * t);
            const y = Math.round(y1 + (y2 - y1) * t);
            for (let yy = -width; yy <= width; yy++) {
                for (let xx = -width; xx <= width; xx++) {
                    if (xx * xx + yy * yy <= width * width) paint(x + xx, y + yy, color);
                }
            }
        }
    }

    const width = Math.max(1, Math.round(1.45 * scale));
    for (let i = 0; i < points.length - 1; i++) {
        thickLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], width, ink);
    }

    return PNG.sync.write(png);
}

const png16 = createIconPng(16);
const png32 = createIconPng(32);
const png64 = createIconPng(64);
const png128 = createIconPng(128);
const png256 = createIconPng(256);
const png512 = createIconPng(512);

fs.writeFileSync(path.join(outDir, 'icon.png'), png256);
fs.writeFileSync(path.join(outDir, 'tray.png'), createTrayPng(16));
fs.writeFileSync(path.join(outDir, 'tray@2x.png'), createTrayPng(32));
fs.writeFileSync(path.join(publicDir, 'favicon.png'), png32);

const icoSources = [
    ['icon-16.png', png16],
    ['icon-32.png', png32],
    ['icon-48.png', createIconPng(48)],
    ['icon-256.png', png256],
].map(([file, data]) => {
    const target = path.join(outDir, file);
    fs.writeFileSync(target, data);
    return target;
});

fs.writeFileSync(path.join(outDir, 'icon.ico'), await pngToIco(icoSources));
for (const target of icoSources) fs.rmSync(target, { force: true });

fs.writeFileSync(
    path.join(outDir, 'icon.icns'),
    createIcns([
        ['icp4', png16],
        ['icp5', png32],
        ['icp6', png64],
        ['ic07', png128],
        ['ic08', png256],
        ['ic09', png512],
        ['ic11', png32],
        ['ic12', png64],
        ['ic13', png256],
        ['ic14', png512],
    ]),
);
