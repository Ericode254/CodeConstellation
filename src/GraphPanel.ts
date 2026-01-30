import * as vscode from 'vscode';
import { ProjectScanner } from './ProjectScanner';
import { GraphData } from './types';
import * as path from 'path';
import * as fs from 'fs';

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

        const cspSource = this._panel.webview.cspSource;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' ` + cspSource + `;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Constellation</title>
    <script>
        window.onerror = function(message, source, lineno, colno, error) {
            console.error('Global Error:', message, source, lineno, colno, error);
            const errDiv = document.createElement('div');
            errDiv.style.color = 'red';
            errDiv.style.position = 'absolute';
            errDiv.style.top = '0';
            errDiv.style.left = '0';
            errDiv.style.zIndex = '1000';
            errDiv.style.background = 'black';
            errDiv.innerText = 'JS Error: ' + message;
            document.body.appendChild(errDiv);
        };
    </script>
    <script src="` + d3Uri + `" onerror="console.error('Failed to load d3')"></script>
    <script src="` + forceGraphUri + `" onerror="console.error('Failed to load force-graph')"></script>
    <style>
        :root {
            --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            --bg-deep: #050508;
            --bg-nebula: #0a0a14;
            --panel-bg: rgba(20, 20, 25, 0.7);
            --border-color: rgba(255, 255, 255, 0.1);
            --accent-color: #58a6ff;
            --text-color: #a3b3bc;
            --text-bright: #ffffff;
        }

        html, body { 
            width: 100%; 
            height: 100%; 
            margin: 0; 
            padding: 0; 
            overflow: hidden; 
            background: radial-gradient(circle at center, var(--bg-nebula) 0%, var(--bg-deep) 100%);
            color: var(--text-color); 
            font-family: var(--vscode-font-family); 
        }

        #stars-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
        }

        .star {
            position: absolute;
            background: white;
            border-radius: 50%;
            opacity: 0.5;
            animation: twinkle var(--duration) infinite ease-in-out;
        }

        @keyframes twinkle {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.2); }
        }

        #graph { 
            position: absolute;
            top: 0;
            left: 0;
            width: 100%; 
            height: 100%; 
            z-index: 1;
        }

        #toolbar {
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 100;
            display: flex;
            align-items: center;
            gap: 12px;
            background: var(--panel-bg);
            backdrop-filter: blur(15px);
            padding: 10px 20px;
            border-radius: 40px;
            border: 1px solid var(--border-color);
            box-shadow: 0 0 30px rgba(0,0,0,0.5), inset 0 0 10px rgba(255,255,255,0.05);
        }

        .search-container {
            display: flex;
            align-items: center;
            background: rgba(0,0,0,0.3);
            border-radius: 20px;
            padding: 4px 15px;
            border: 1px solid var(--border-color);
        }

        input {
            background: transparent;
            border: none;
            color: white;
            padding: 5px;
            outline: none;
            width: 180px;
            font-size: 13px;
            letter-spacing: 0.5px;
        }

        button {
            background-color: rgba(88, 166, 255, 0.15);
            color: #58a6ff;
            border: 1px solid rgba(88, 166, 255, 0.3);
            padding: 7px 15px;
            cursor: pointer;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        button:hover { 
            background-color: rgba(88, 166, 255, 0.3);
            border-color: #58a6ff;
            color: white;
            box-shadow: 0 0 15px rgba(88, 166, 255, 0.4);
        }

        #legend {
            position: absolute;
            bottom: 30px;
            right: 30px;
            z-index: 100;
            background: var(--panel-bg);
            backdrop-filter: blur(15px);
            padding: 15px;
            border-radius: 15px;
            border: 1px solid var(--border-color);
            font-size: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }

        .legend-title {
            font-weight: 800;
            margin-bottom: 12px;
            color: #58a6ff;
            text-transform: uppercase;
            letter-spacing: 2px;
            font-size: 9px;
            opacity: 0.8;
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

        .scene-tooltip {
            background: rgba(10, 10, 15, 0.95) !important;
            border: 1px solid rgba(88, 166, 255, 0.3) !important;
            border-radius: 12px !important;
            padding: 15px !important;
            box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 20px rgba(88, 166, 255, 0.1) !important;
            backdrop-filter: blur(10px);
            color: #ddd;
        }
        .tooltip-header {
            font-weight: 700;
            color: #ffffff;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            padding-bottom: 10px;
            margin-bottom: 10px;
            font-size: 14px;
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
    </style>
</head>
<body>
    <div id="stars-container"></div>
    <div id="toolbar">
        <div class="search-container">
            <input type="text" id="searchInput" placeholder="SCAN SECTOR..." oninput="handleSearch(this.value)">
        </div>
        <button onclick="refresh()">↺ Rescan</button>
        <button onclick="fitToScreen()">▢ Center</button>
    </div>

    <div id="legend">
        <div class="legend-title">Galactic Clusters (Types)</div>
        <div id="legend-items"></div>
        <div class="legend-title" style="margin-top: 15px;">Star Magnitude (Size)</div>
        <div id="size-legend" style="display: flex; align-items: flex-end; gap: 12px; padding: 5px 0;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                <div style="width: 4px; height: 4px; border-radius: 50%; background: #fff; box-shadow: 0 0 5px #fff;"></div>
                <div style="font-size: 8px; opacity: 0.6;">SMALL</div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                <div style="width: 8px; height: 8px; border-radius: 50%; background: #fff; box-shadow: 0 0 5px #fff;"></div>
                <div style="font-size: 8px; opacity: 0.6;">MEDIUM</div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                <div style="width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 0 8px #fff;"></div>
                <div style="font-size: 8px; opacity: 0.6;">LARGE</div>
            </div>
        </div>
    </div>

    <div id="stats">0 files detected • 0 links established</div>
    <div id="graph"></div>

    <script>
        const starsContainer = document.getElementById('stars-container');
        for (let i = 0; i < 150; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            const size = Math.random() * 2 + 1;
            star.style.width = size + 'px';
            star.style.height = size + 'px';
            star.style.left = (Math.random() * 100) + '%';
            star.style.top = (Math.random() * 100) + '%';
            star.style.setProperty('--duration', (Math.random() * 3 + 2) + 's');
            star.style.opacity = Math.random();
            starsContainer.appendChild(star);
        }

        const vscode = acquireVsCodeApi();
        let Graph;
        let hoverNode = null;
        let searchNode = null;
        let graphData = { nodes: [], links: [] };
        const neighbors = new Set();
        const neighborLinks = new Set();
        
        const colorScale = d3.scaleOrdinal(d3.schemeTableau10);
        
        const typeColorsMap = {
            '.ts': '#3178c6',
            '.tsx': '#58a6ff',
            '.js': '#f7df1e',
            '.jsx': '#ffd33d',
            '.css': '#79c0ff',
            '.scss': '#d299ff',
            '.html': '#ffa657',
            '.json': '#7ee787',
            '.py': '#3776ab',
            '.md': '#ffffff'
        };

        function getTypeColor(type) {
            return typeColorsMap[type] || colorScale(type);
        }

        function initGraph() {
            if (typeof ForceGraph === 'undefined' || typeof d3 === 'undefined') {
                setTimeout(initGraph, 100);
                return;
            }

            try {
                Graph = ForceGraph()(document.getElementById('graph'));
                
                // Optimized forces for an even, expansive "constellation" layout
                Graph.d3Force('charge').strength(-600).distanceMax(1000); // Stronger repulsion with a range limit
                Graph.d3Force('link').distance(100);                      // Increased distance between connected stars
                Graph.d3Force('center').strength(0.01);                  // Very gentle centering to prevent "the ball"
                Graph.d3Force('collide', d3.forceCollide(function(node) { 
                    return Math.sqrt(node.size || 1000) / 3 + 15;        // Increased buffer radius to prevent crowding
                }));
                
                Graph.d3VelocityDecay(0.15); // Slightly higher friction for a more stable, even spread
                Graph.enableNodeDrag(true);
                Graph.enableZoomPanInteraction(true);
                Graph.autoPauseRedraw(false);

                setupGraphProperties();

            } catch (e) {
                console.error('Error initializing graph:', e);
                document.getElementById('graph').innerText = 'Error: ' + e.message;
            }
        }

        function renderLegend() {
            const container = document.getElementById('legend-items');
            if (!container) return;
            container.innerHTML = '';
            
            const types = [];
            graphData.nodes.forEach(function(n) {
                const t = n.type || 'other';
                if (types.indexOf(t) === -1) types.push(t);
            });
            types.sort();
            
            types.forEach(function(type) {
                const color = getTypeColor(type);
                const item = document.createElement('div');
                item.className = 'legend-item';
                item.innerHTML = '<div class="dot" style="background: ' + color + '; box-shadow: 0 0 8px ' + color + '"></div>' + type.toUpperCase();
                item.onclick = function() { highlightType(type); };
                container.appendChild(item);
            });
        }

        function highlightType(type) {
            const node = graphData.nodes.find(function(n) { return n.type === type || (type === 'other' && !n.type); });
            if (node) {
                Graph.centerAt(node.x, node.y, 1000);
                Graph.zoom(3, 1000);
                
                hoverNode = node;
                neighbors.clear();
                neighborLinks.clear();
                const links = Graph.graphData().links;
                links.forEach(function(link) {
                    const sId = typeof link.source === 'object' ? link.source.id : link.source;
                    const tId = typeof link.target === 'object' ? link.target.id : link.target;
                    if (sId === node.id) { neighbors.add(tId); neighborLinks.add(link); }
                    else if (tId === node.id) { neighbors.add(sId); neighborLinks.add(link); }
                });
            }
        }

        function handleSearch(query) {
            if (!query) {
                searchNode = null;
                return;
            }
            const node = graphData.nodes.find(function(n) { return n.name.toLowerCase().indexOf(query.toLowerCase()) !== -1; });
            if (node) {
                searchNode = node;
                Graph.centerAt(node.x, node.y, 800);
                Graph.zoom(3.5, 800);
            }
        }

        function fitToScreen() {
            Graph.zoomToFit(1000, 80);
        }

        function setupGraphProperties() {
            if (!Graph) return;

            const escapeHtml = function(unsafe) { 
                return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); 
            };

            Graph
                .backgroundColor('rgba(5, 5, 8, 0.7)') 
                .nodeId('id')
                .nodeLabel(function(node) {
                    const preview = node.preview ? escapeHtml(node.preview) : '';
                    return '<div class="scene-tooltip"><div class="tooltip-header"><span>' + node.name + '</span><span style="font-size: 10px; color: #888;">' + (node.size / 1024).toFixed(1) + ' KB</span></div><div class="tooltip-path">' + node.id + '</div><pre>' + preview + '</pre></div>';
                })
                .nodeVal(function(node) { return Math.sqrt(node.size || 1000) / 3; })
                .onNodeClick(function(node) {
                    vscode.postMessage({ command: 'openFile', path: node.id });
                })
                .onNodeHover(function(node) {
                    if (node === hoverNode) return;
                    document.body.style.cursor = node ? 'pointer' : null;
                    hoverNode = node;
                    neighbors.clear();
                    neighborLinks.clear();
                    if (node) {
                        const links = Graph.graphData().links;
                        links.forEach(function(link) {
                            const sId = typeof link.source === 'object' ? link.source.id : link.source;
                            const tId = typeof link.target === 'object' ? link.target.id : link.target;
                            if (sId === node.id) { neighbors.add(tId); neighborLinks.add(link); }
                            else if (tId === node.id) { neighbors.add(sId); neighborLinks.add(link); }
                        });
                    }
                })
                .linkCanvasObject(function(link, ctx, globalScale) {
                    const isHovered = hoverNode && neighborLinks.has(link);
                    const isDimmed = hoverNode && !isHovered;
                    
                    ctx.beginPath();
                    ctx.moveTo(link.source.x, link.source.y);
                    ctx.lineTo(link.target.x, link.target.y);
                    
                    ctx.strokeStyle = isHovered ? '#ffffff' : (isDimmed ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.15)');
                    ctx.lineWidth = isHovered ? 2 / globalScale : 0.6 / globalScale;
                    ctx.stroke();

                    if (isHovered) {
                        ctx.shadowBlur = 10;
                        ctx.shadowColor = '#58a6ff';
                        ctx.stroke();
                        ctx.shadowBlur = 0;
                    }
                })
                .nodeCanvasObject(function(node, ctx, globalScale) {
                    // CRITICAL: Ensure coordinates are finite before drawing
                    if (!isFinite(node.x) || !isFinite(node.y)) return;

                    const isHovered = hoverNode && (node === hoverNode || neighbors.has(node.id));
                    const isSearching = searchNode && node === searchNode;
                    const isDimmed = (hoverNode || searchNode) && !isHovered && !isSearching;
                    
                    const size = Math.sqrt(node.size || 1000) / 3;
                    const color = getTypeColor(node.type);

                    const twinkle = (Math.sin(Date.now() / 500 + (node.x || 0)) + 1) / 2;

                    if (!isDimmed) {
                        const r1 = size * 0.8;
                        const r2 = size * (1.5 + twinkle * 0.5);
                        // Ensure radii are valid positive numbers
                        if (r1 > 0 && r2 > r1) {
                            const gradient = ctx.createRadialGradient(node.x, node.y, r1, node.x, node.y, r2);
                            gradient.addColorStop(0, color);
                            gradient.addColorStop(1, 'rgba(0,0,0,0)');
                            ctx.fillStyle = gradient;
                            ctx.beginPath();
                            ctx.arc(node.x, node.y, size * 3, 0, 2 * Math.PI);
                            ctx.fill();
                        }
                    }

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
                    ctx.fillStyle = isDimmed ? 'rgba(255, 255, 255, 0.05)' : color;
                    ctx.fill();
                    
                    if (node === hoverNode || isSearching) {
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, size + 3/globalScale, 0, 2 * Math.PI, false);
                        ctx.strokeStyle = isSearching ? '#ff0055' : '#ffffff';
                        ctx.lineWidth = 2 / globalScale;
                        ctx.stroke();
                        
                        if (isSearching) {
                            const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
                            ctx.beginPath();
                            ctx.arc(node.x, node.y, size + (10 + pulse * 10) / globalScale, 0, 2 * Math.PI, false);
                            ctx.strokeStyle = 'rgba(255, 0, 85, ' + (0.3 - pulse * 0.3) + ')';
                            ctx.stroke();
                        }
                    }

                    if (globalScale > 1.2 || isHovered || isSearching) {
                        const alpha = globalScale > 1.2 ? Math.min(1, (globalScale - 1.2) * 2) : 1;
                        const fontSize = (isHovered || isSearching ? 15 : 12) / globalScale;
                        ctx.font = (isHovered || isSearching ? '800' : '500') + ' ' + fontSize + 'px var(--vscode-font-family)';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = isDimmed ? 'rgba(255, 255, 255, ' + (alpha * 0.05) + ')' : 'rgba(255, 255, 255, ' + (isHovered || isSearching ? 1 : alpha * 0.9) + ')';
                        ctx.fillText(node.name.toUpperCase(), node.x, node.y + size + fontSize + 4/globalScale);
                    }
                })
                .nodeCanvasObjectMode(function() { return 'replace'; });
        }

        initGraph();

        window.addEventListener('message', function(event) {
            const message = event.data;
            switch (message.command) {
                case 'updateData':
                    if (!Graph) return;
                    graphData = message.data;
                    const nodes = graphData.nodes;
                    const links = graphData.links;
                    document.getElementById('stats').innerText = nodes.length + ' files detected • ' + links.length + ' links established';
                    
                    const nodeIds = new Set(nodes.map(function(n) { return n.id; }));
                    const cleanLinks = links.filter(function(link, index, self) {
                        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                        const firstIdx = self.findIndex(function(l) {
                            return (typeof l.source === 'object' ? l.source.id : l.source) === sourceId && 
                                   (typeof l.target === 'object' ? l.target.id : l.target) === targetId;
                        });
                        return index === firstIdx && nodeIds.has(sourceId) && nodeIds.has(targetId);
                    });

                    Graph.graphData({ nodes: nodes, links: cleanLinks });
                    renderLegend();
                    setTimeout(function() { Graph.zoomToFit(800, 50); }, 500);
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
