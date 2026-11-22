import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { GraphData, Node, Link } from './types';

const SUPPORTED_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss',
    '.html', '.py', '.java', '.c', '.cpp', '.h',
    '.json', '.md', '.go', '.rs', '.php'
]);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'out', 'build', 'target', 'vendor']);
const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const STYLE_EXTENSIONS = new Set(['.css', '.scss']);
const SCRIPT_RESOLVE_SUFFIXES = [
    '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss',
    '/index.ts', '/index.tsx', '/index.js', '/index.jsx'
];

const SCRIPT_IMPORT_REGEX = /\b(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]|\brequire\(\s*['"]([^'"\n]+)['"]\s*\)|\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const STYLE_IMPORT_REGEX = /@import\s+['"]([^'"\n]+)['"]|url\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const PYTHON_IMPORT_REGEX = /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*))/gm;

const PREVIEW_LINES = 10;
const PREVIEW_BYTES = 4096;
const MAX_PARSE_BYTES = 1024 * 1024;
const READ_BATCH_SIZE = 64;

interface FileEntry {
    fullPath: string;
    id: string;
    name: string;
    ext: string;
}

interface ScannedFile {
    node: Node;
    ext: string;
    specifiers: string[];
}

function toPosix(p: string): string {
    return p.split(path.sep).join('/');
}

async function readHead(filePath: string, bytes: number): Promise<string> {
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(bytes), 0, bytes, 0);
        return buffer.toString('utf-8', 0, bytesRead);
    } finally {
        await handle.close();
    }
}

function extractImports(content: string, ext: string): string[] {
    let regex: RegExp | undefined;
    if (SCRIPT_EXTENSIONS.has(ext)) {
        regex = SCRIPT_IMPORT_REGEX;
    } else if (STYLE_EXTENSIONS.has(ext)) {
        regex = STYLE_IMPORT_REGEX;
    } else if (ext === '.py') {
        regex = PYTHON_IMPORT_REGEX;
    }
    if (!regex) {
        return [];
    }

    const specifiers: string[] = [];
    for (const match of content.matchAll(regex)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (specifier) {
            specifiers.push(specifier);
        }
    }
    return specifiers;
}

/**
 * Walks the workspace and builds a file dependency graph from import statements.
 */
export class ProjectScanner {
    private ig: Ignore = ignore();

    constructor(private readonly workspaceRoot: string) {}

    public async scan(): Promise<GraphData> {
        this.ig = ignore();
        try {
            this.ig.add(await fs.promises.readFile(path.join(this.workspaceRoot, '.gitignore'), 'utf-8'));
        } catch {
            // No .gitignore at the workspace root.
        }

        const files: FileEntry[] = [];
        await this.collectFiles(this.workspaceRoot, files);

        const scanned: ScannedFile[] = [];
        for (let i = 0; i < files.length; i += READ_BATCH_SIZE) {
            const batch = await Promise.all(files.slice(i, i + READ_BATCH_SIZE).map(f => this.processFile(f)));
            for (const result of batch) {
                if (result) {
                    scanned.push(result);
                }
            }
        }

        const ids = new Set(scanned.map(s => s.node.id));
        const links: Link[] = [];
        const seen = new Set<string>();
        for (const { node, ext, specifiers } of scanned) {
            for (const specifier of specifiers) {
                const target = this.resolveImport(node.id, ext, specifier, ids);
                if (!target || target === node.id) {
                    continue;
                }
                const key = node.id + '\0' + target;
                if (!seen.has(key)) {
                    seen.add(key);
                    links.push({ source: node.id, target });
                }
            }
        }

        return { nodes: scanned.map(s => s.node), links };
    }

    private async collectFiles(dir: string, files: FileEntry[]): Promise<void> {
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
            return;
        }

        const subdirectories: Promise<void>[] = [];
        for (const entry of entries) {
            if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) {
                continue;
            }

            const fullPath = path.join(dir, entry.name);
            const id = toPosix(path.relative(this.workspaceRoot, fullPath));

            if (entry.isDirectory()) {
                if (!this.ig.ignores(id + '/')) {
                    subdirectories.push(this.collectFiles(fullPath, files));
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (SUPPORTED_EXTENSIONS.has(ext) && !this.ig.ignores(id)) {
                    files.push({ fullPath, id, name: entry.name, ext });
                }
            }
        }
        await Promise.all(subdirectories);
    }

    private async processFile(file: FileEntry): Promise<ScannedFile | undefined> {
        try {
            const { size } = await fs.promises.stat(file.fullPath);
            const tooLarge = size > MAX_PARSE_BYTES;
            const content = tooLarge
                ? await readHead(file.fullPath, PREVIEW_BYTES)
                : await fs.promises.readFile(file.fullPath, 'utf-8');

            return {
                node: {
                    id: file.id,
                    name: file.name,
                    type: file.ext,
                    size,
                    preview: content.split('\n', PREVIEW_LINES).join('\n')
                },
                ext: file.ext,
                specifiers: tooLarge ? [] : extractImports(content, file.ext)
            };
        } catch (error) {
            console.error(`Error processing file ${file.fullPath}:`, error);
            return undefined;
        }
    }

    private resolveImport(sourceId: string, ext: string, specifier: string, ids: Set<string>): string | undefined {
        const dir = path.posix.dirname(sourceId);

        if (ext === '.py') {
            const modulePath = specifier.replace(/\./g, '/');
            return [
                `${modulePath}.py`,
                `${modulePath}/__init__.py`,
                path.posix.join(dir, `${modulePath}.py`)
            ].find(candidate => ids.has(candidate));
        }

        if (!specifier.startsWith('.')) {
            return undefined;
        }

        const base = path.posix.join(dir, specifier);
        if (base.startsWith('..')) {
            return undefined;
        }

        const candidates = SCRIPT_RESOLVE_SUFFIXES.map(suffix => base + suffix);
        if (/\.[cm]?js$/.test(base)) {
            // TypeScript ESM code imports './foo.js' for a './foo.ts' source file.
            candidates.push(base.replace(/\.([cm]?)js$/, '.$1ts'), base.replace(/\.js$/, '.tsx'));
        }
        return candidates.find(candidate => ids.has(candidate));
    }
}
