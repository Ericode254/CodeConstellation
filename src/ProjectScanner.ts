import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { GraphData, Node, Link } from './types';

/**
 * ProjectScanner is responsible for traversing the workspace and parsing
 * file dependencies to build a graph structure.
 */
export class ProjectScanner {
    private workspaceRoot: string;
    private visitedFiles: Set<string> = new Set();
    private nodes: Node[] = [];
    private links: Link[] = [];
    private ig: Ignore;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.ig = ignore();
        this.loadGitignore();
    }

    /**
     * Loads .gitignore patterns from the workspace root.
     */
    private loadGitignore() {
        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            const content = fs.readFileSync(gitignorePath, 'utf-8');
            this.ig.add(content);
        }
    }

    /**
     * Scans the workspace and returns the graph data.
     */
    public async scan(): Promise<GraphData> {
        this.nodes = [];
        this.links = [];
        this.visitedFiles.clear();

        await this.scanDirectory(this.workspaceRoot);
        return { nodes: this.nodes, links: this.links };
    }

    /**
     * Recursively scans a directory for code files.
     * @param dir The directory path to scan.
     */
    private async scanDirectory(dir: string) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.workspaceRoot, fullPath);

            // Skip hidden files (except .gitignore) and common artifacts
            if (entry.name.startsWith('.') && entry.name !== '.gitignore') {
                continue;
            }
            
            if (['node_modules', 'dist', 'out', 'build', 'target', 'vendor'].includes(entry.name)) {
                continue;
            }

            if (this.ig.ignores(relativePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath);
            } else if (entry.isFile()) {
                if (this.isCodeFile(entry.name)) {
                    await this.processFile(fullPath, relativePath, entry.name);
                }
            }
        }
    }

    /**
     * Extracts metadata and dependencies from a single file.
     */
    private async processFile(fullPath: string, relativePath: string, fileName: string) {
        try {
            const stats = await fs.promises.stat(fullPath);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            
            // Capture first 10 lines for the hover preview
            const preview = content.split('\n').slice(0, 10).join('\n');

            this.nodes.push({
                id: relativePath,
                name: fileName,
                type: path.extname(fileName),
                size: stats.size,
                preview: preview
            });

            await this.parseDependenciesFromContent(content, fullPath, relativePath);
        } catch (error) {
            console.error(`Error processing file ${fullPath}:`, error);
        }
    }

    /**
     * Determines if a file should be included in the graph based on extension.
     */
    private isCodeFile(filename: string): boolean {
        const ext = path.extname(filename).toLowerCase();
        const supportedExtensions = [
            '.ts', '.tsx', '.js', '.jsx', '.css', '.scss', 
            '.html', '.py', '.java', '.c', '.cpp', '.h', 
            '.json', '.md', '.go', '.rs', '.php'
        ];
        return supportedExtensions.includes(ext);
    }

    /**
     * Uses regex to identify imports and build dependency links.
     */
    private async parseDependenciesFromContent(content: string, filePath: string, relativeId: string) {
        try {
            const dir = path.dirname(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const importPaths: string[] = [];

            if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                const regex = /import\s+.*?from\s+['"](.*?)['"]|require\(['"](.*?)['"]\)|import\(['"](.*?)['"]\)/g;
                let match;
                while ((match = regex.exec(content)) !== null) {
                    importPaths.push(match[1] || match[2] || match[3]);
                }
            } else if (['.css', '.scss'].includes(ext)) {
                const regex = /@import\s+['"](.*?)['"]|url\(['"](.*?)['"]\)/g;
                let match;
                while ((match = regex.exec(content)) !== null) {
                    importPaths.push(match[1] || match[2]);
                }
            } else if (ext === '.py') {
                const regex = /^import\s+(\w+)|^from\s+(\w+)\s+import/gm;
                let match;
                while ((match = regex.exec(content)) !== null) {
                    importPaths.push(match[1] || match[2]);
                }
            }
            
            for (const importPath of importPaths) {
                if (!importPath) { continue; }

                if (importPath.startsWith('.')) {
                    const absoluteImportPath = path.resolve(dir, importPath);
                    let targetRelativePath = path.relative(this.workspaceRoot, absoluteImportPath);
                    
                    if (!this.fileExists(targetRelativePath)) {
                        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '/index.ts', '/index.js'];
                        for (const e of extensions) {
                            if (this.fileExists(targetRelativePath + e)) {
                                targetRelativePath += e;
                                break;
                            }
                        }
                    }

                    if (!targetRelativePath.startsWith('..') && this.fileExists(targetRelativePath)) {
                         this.links.push({ source: relativeId, target: targetRelativePath });
                    }
                } else if (ext === '.py') {
                    const possiblePyFile = importPath.replace(/\./g, '/') + '.py';
                    if (this.fileExists(possiblePyFile)) {
                        this.links.push({ source: relativeId, target: possiblePyFile });
                    }
                }
            }
        } catch (error) {
            console.error(`Error parsing dependencies in ${filePath}:`, error);
        }
    }

    private fileExists(relativePath: string): boolean {
        return fs.existsSync(path.join(this.workspaceRoot, relativePath));
    }
}
