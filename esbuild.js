const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const webviewLibraries = [
    'node_modules/force-graph/dist/force-graph.min.js',
    'node_modules/d3/dist/d3.min.js'
];

function copyWebviewLibraries() {
    const mediaDir = path.join(__dirname, 'dist', 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    for (const file of webviewLibraries) {
        fs.copyFileSync(path.join(__dirname, file), path.join(mediaDir, path.basename(file)));
    }
}

async function main() {
    copyWebviewLibraries();
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: 'info'
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
