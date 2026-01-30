import * as vscode from 'vscode';
import { ProjectScanner } from './ProjectScanner';
import { GraphData } from './types';
import * as path from 'path';

export class GraphPanel {
    public static currentPanel: GraphPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._panel.webview.html = this._getWebviewContent();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openFile':
                        this._openFile(message.path);
                        return;
                    case 'refresh':
                        this._update();
                        return;
                }
            },
            null,
            this._disposables
        );

        // Initial update
        this._update();
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (GraphPanel.currentPanel) {
            GraphPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'codeConstellation',
            'Code Constellation',
            column || vscode.ViewColumn.One,
            {
                // Enable scripts in the webview
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out'),
                    vscode.Uri.joinPath(extensionUri, 'node_modules')
                ]
            }
        );

        GraphPanel.currentPanel = new GraphPanel(panel, extensionUri);
    }

    private async _update() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const scanner = new ProjectScanner(rootPath);
        
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Scanning project...",
            cancellable: false
        }, async (progress) => {
            const data = await scanner.scan();
            this._panel.webview.postMessage({ command: 'updateData', data: data });
        });
    }

    private _openFile(relativePath: string) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }
        
        const rootPath = workspaceFolders[0].uri.fsPath;
        const fullPath = path.join(rootPath, relativePath);
        const uri = vscode.Uri.file(fullPath);
        
        vscode.workspace.openTextDocument(uri).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }

    public dispose() {
        GraphPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getWebviewContent() {
        const forceGraphPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'force-graph', 'dist', 'force-graph.js');
        const forceGraphUri = this._panel.webview.asWebviewUri(forceGraphPath);

        const d3Path = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'd3', 'dist', 'd3.min.js');
        const d3Uri = this._panel.webview.asWebviewUri(d3Path);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${this._panel.webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Constellation</title>
    <script src="${d3Uri}"></script>
    <script src="${forceGraphUri}"></script>
    <style>
        :root {
            --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            --bg-color: #1e1e1e;
            --panel-bg: rgba(37, 37, 38, 0.85);
            --border-color: #444;
            --accent-color: #0e639c;
            --text-color: #cccccc;
            --text-bright: #ffffff;
        }

        html, body { 
            width: 100%; 
            height: 100%; 
            margin: 0; 
            padding: 0; 
            overflow: hidden; 
            background-color: var(--bg-color); 
            color: var(--text-color); 
            font-family: var(--vscode-font-family); 
        }

        #graph { 
            position: absolute;
            top: 0;
            left: 0;
            width: 100%; 
            height: 100%; 
            z-index: 1;
        }

        /* Toolbar Styling */
        #toolbar {
            position: absolute;
            top: 15px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 100;
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--panel-bg);
            backdrop-filter: blur(10px);
            padding: 8px 15px;
            border-radius: 30px;
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
        }

        .search-container {
            display: flex;
            align-items: center;
            background: rgba(0,0,0,0.2);
            border-radius: 20px;
            padding: 2px 12px;
            border: 1px solid var(--border-color);
        }

        input {
            background: transparent;
            border: none;
            color: white;
            padding: 5px;
            outline: none;
            width: 150px;
            font-size: 13px;
        }

        button {
            background-color: var(--accent-color);
            color: white;
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 15px;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        button:hover { background-color: #1177bb; transform: translateY(-1px); }
        button:active { transform: translateY(0); }

        /* Legend Styling */
        #legend {
            position: absolute;
            bottom: 20px;
            right: 20px;
            z-index: 100;
            background: var(--panel-bg);
            backdrop-filter: blur(10px);
            padding: 12px;
            border-radius: 12px;
            border: 1px solid var(--border-color);
            font-size: 11px;
            max-width: 180px;
        }

        .legend-title {
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--text-bright);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            margin-bottom: 5px;
            cursor: pointer;
            padding: 2px 5px;
            border-radius: 4px;
            transition: background 0.2s;
        }
        .legend-item:hover { background: rgba(255,255,255,0.05); }

        .dot { 
            width: 8px; 
            height: 8px; 
            border-radius: 50%; 
            margin-right: 8px; 
            box-shadow: 0 0 5px rgba(0,0,0,0.5);
        }

        /* Stats & Info */
        #stats {
            position: absolute;
            bottom: 20px;
            left: 20px;
            z-index: 100;
            font-size: 11px;
            color: #888;
            background: rgba(0,0,0,0.3);
            padding: 4px 10px;
            border-radius: 10px;
        }

        /* Tooltip styling */
        .scene-tooltip {
            background: rgba(25, 25, 25, 0.95) !important;
            border: 1px solid #444 !important;
            border-radius: 8px !important;
            padding: 12px !important;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
            max-width: 400px;
            z-index: 200;
            color: #ddd;
        }
        .tooltip-header {
            font-weight: 600;
            color: #58a6ff;
            border-bottom: 1px solid #333;
            padding-bottom: 8px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tooltip-path {
            font-size: 10px;
            color: #7d8590;
            margin-bottom: 10px;
            word-break: break-all;
            font-family: monospace;
        }
        pre {
            margin: 0;
            font-size: 11px;
            color: #c9d1d9;
            background: #0d1117;
            padding: 8px;
            border-radius: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: pre-wrap;
            font-family: 'Consolas', 'Monaco', monospace;
            border: 1px solid #30363d;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <div class="search-container">
            <input type="text" id="searchInput" placeholder="Search files..." oninput="handleSearch(this.value)">
        </div>
        <button onclick="refresh()">↺ Refresh</button>
        <button onclick="fitToScreen()">▢ Fit</button>
    </div>

    <div id="legend">
        <div class="legend-title">File Types</div>
        <div id="legend-items"></div>
    </div>

    <div id="stats">0 files, 0 links</div>
    <div id="graph"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let Graph;
        let hoverNode = null;
        let searchNode = null;
        let graphData = { nodes: [], links: [] };
        const neighbors = new Set();
        const neighborLinks = new Set();
        
        const typeColors = {
            '.ts': '#3178c6',
            '.tsx': '#3178c6',
            '.js': '#f7df1e',
            '.jsx': '#f7df1e',
            '.css': '#563d7c',
            '.scss': '#c6538c',
            '.html': '#e34c26',
            '.json': '#cbcb41',
            '.py': '#3776ab',
            '.md': '#083fa1',
            'other': '#888888'
        };

        function initGraph() {
            if (typeof ForceGraph === 'undefined') {
                setTimeout(initGraph, 100);
                return;
            }

            try {
                Graph = ForceGraph()(document.getElementById('graph'));
                
                Graph.d3Force('charge').strength(-200);
                Graph.d3Force('link').distance(50);
                Graph.d3Force('center').strength(0.01);
                Graph.d3Force('collide', d3.forceCollide(node => Math.sqrt(node.size || 1000) / 3 + 6));
                
                Graph.d3VelocityDecay(0.1);
                Graph.enableNodeDrag(true);
                Graph.enableZoomPanInteraction(true);
                Graph.autoPauseRedraw(false);

                setupGraphProperties();
                renderLegend();

            } catch (e) {
                console.error('Error initializing graph:', e);
                document.getElementById('graph').innerText = 'Error: ' + e.message;
            }
        }

        function renderLegend() {
            const container = document.getElementById('legend-items');
            container.innerHTML = '';
            Object.keys(typeColors).forEach(type => {
                const item = document.createElement('div');
                item.className = 'legend-item';
                item.innerHTML = \`<div class="dot" style="background: \${typeColors[type]}"></div>\${type}\`;
                item.onclick = () => highlightType(type);
                container.appendChild(item);
            });
        }

        function highlightType(type) {
            // Find first node of this type and center on it
            const node = graphData.nodes.find(n => n.type === type || (type === 'other' && !typeColors[n.type]));
            if (node) {
                Graph.centerAt(node.x, node.y, 1000);
                Graph.zoom(3, 1000);
            }
        }

        function handleSearch(query) {
            if (!query) {
                searchNode = null;
                return;
            }
            const node = graphData.nodes.find(n => n.name.toLowerCase().includes(query.toLowerCase()));
            if (node) {
                searchNode = node;
                Graph.centerAt(node.x, node.y, 500);
                Graph.zoom(4, 500);
            }
        }

        function fitToScreen() {
            Graph.zoomToFit(800, 50);
        }

        function setupGraphProperties() {
            if (!Graph) return;

            const getTypeColor = type => typeColors[type] || typeColors['other'];
            const escapeHtml = unsafe => unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

            Graph
                .backgroundColor('#1e1e1e')
                .nodeId('id')
                .nodeLabel(node => {
                    const preview = node.preview ? escapeHtml(node.preview) : '';
                    return \`
                        <div class="scene-tooltip">
                            <div class="tooltip-header">
                                <span>\${node.name}</span>
                                <span style="font-size: 10px; color: #888;">\${(node.size / 1024).toFixed(1)} KB</span>
                            </div>
                            <div class="tooltip-path">\${node.id}</div>
                            <pre>\${preview}</pre>
                        </div>
                    \`;
                })
                .nodeVal(node => Math.sqrt(node.size || 1000) / 3)
                .onNodeClick(node => {
                    vscode.postMessage({ command: 'openFile', path: node.id });
                })
                .onNodeHover(node => {
                    if (node === hoverNode) return;
                    document.body.style.cursor = node ? 'pointer' : null;
                    hoverNode = node;
                    neighbors.clear();
                    neighborLinks.clear();
                    if (node) {
                        const { links } = Graph.graphData();
                        links.forEach(link => {
                            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                            if (sourceId === node.id) { neighbors.add(targetId); neighborLinks.add(link); }
                            else if (targetId === node.id) { neighbors.add(sourceId); neighborLinks.add(link); }
                        });
                    }
                })
                .linkCanvasObject((link, ctx, globalScale) => {
                    const isHovered = hoverNode && neighborLinks.has(link);
                    const isDimmed = hoverNode && !isHovered;
                    
                    ctx.beginPath();
                    ctx.moveTo(link.source.x, link.source.y);
                    ctx.lineTo(link.target.x, link.target.y);
                    
                    ctx.strokeStyle = isHovered ? '#58a6ff' : (isDimmed ? 'rgba(50, 50, 50, 0.05)' : 'rgba(85, 85, 85, 0.5)');
                    ctx.lineWidth = isHovered ? 2 / globalScale : 0.8 / globalScale;
                    ctx.stroke();

                    if (!isDimmed && globalScale > 1) {
                        const arrowLength = 4 / globalScale;
                        const angle = Math.atan2(link.target.y - link.source.y, link.target.x - link.source.x);
                        ctx.beginPath();
                        ctx.moveTo(link.target.x, link.target.y);
                        ctx.lineTo(link.target.x - arrowLength * Math.cos(angle - Math.PI / 6), link.target.y - arrowLength * Math.sin(angle - Math.PI / 6));
                        ctx.lineTo(link.target.x - arrowLength * Math.cos(angle + Math.PI / 6), link.target.y - arrowLength * Math.sin(angle + Math.PI / 6));
                        ctx.closePath();
                        ctx.fillStyle = isHovered ? '#58a6ff' : 'rgba(85, 85, 85, 0.5)';
                        ctx.fill();
                    }
                })
                .nodeCanvasObject((node, ctx, globalScale) => {
                    const isHovered = hoverNode && (node === hoverNode || neighbors.has(node.id));
                    const isSearching = searchNode && node === searchNode;
                    const isDimmed = (hoverNode || searchNode) && !isHovered && !isSearching;
                    
                    const size = Math.sqrt(node.size || 1000) / 3;
                    
                    // Shadow
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 10 / globalScale;

                    // Node
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
                    ctx.fillStyle = isDimmed ? 'rgba(50, 50, 50, 0.15)' : getTypeColor(node.type);
                    ctx.fill();
                    
                    ctx.shadowBlur = 0;

                    // Focus/Search Ring
                    if (node === hoverNode || isSearching) {
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, size + 2.5 / globalScale, 0, 2 * Math.PI, false);
                        ctx.strokeStyle = isSearching ? '#ff0055' : '#ffffff';
                        ctx.lineWidth = 2 / globalScale;
                        ctx.stroke();
                        
                        if (isSearching) {
                            // Pulsing effect handled by the fact that this is called every frame
                            const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
                            ctx.beginPath();
                            ctx.arc(node.x, node.y, size + (5 + pulse * 5) / globalScale, 0, 2 * Math.PI, false);
                            ctx.strokeStyle = \`rgba(255, 0, 85, \${0.5 - pulse * 0.5})\`;
                            ctx.stroke();
                        }
                    }

                    // Label
                    if (globalScale > 1.2 || isHovered || isSearching) {
                        const alpha = globalScale > 1.2 ? Math.min(1, (globalScale - 1.2) * 2) : 1;
                        const fontSize = (isHovered || isSearching ? 14 : 12) / globalScale;
                        ctx.font = \`\${isHovered || isSearching ? 'bold' : 'normal'} \${fontSize}px var(--vscode-font-family)\`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = isDimmed ? \`rgba(100, 100, 100, \${alpha * 0.2})\` : \`rgba(255, 255, 255, \${isHovered || isSearching ? 1 : alpha})\`;
                        ctx.fillText(node.name, node.x, node.y + size + fontSize + 2/globalScale);
                    }
                })
                .nodeCanvasObjectMode(() => 'replace');
        }

        initGraph();

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateData':
                    if (!Graph) return;
                    graphData = message.data;
                    const { nodes, links } = graphData;
                    document.getElementById('stats').innerText = \`\${nodes.length} files, \${links.length} links\`;
                    
                    const nodeIds = new Set(nodes.map(n => n.id));
                    const cleanLinks = links.filter((link, index, self) => {
                        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                        const isDuplicate = index !== self.findIndex((l) => (
                            (typeof l.source === 'object' ? l.source.id : l.source) === sourceId && 
                            (typeof l.target === 'object' ? l.target.id : l.target) === targetId
                        ));
                        return !isDuplicate && nodeIds.has(sourceId) && nodeIds.has(targetId);
                    });

                    Graph.graphData({ nodes, links: cleanLinks });
                    // Fit to screen on first load
                    setTimeout(() => Graph.zoomToFit(800, 50), 500);
                    break;
            }
        });

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
    }
}
