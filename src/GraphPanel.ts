import * as vscode from 'vscode';
import { ProjectScanner } from './ProjectScanner';
import { GraphData } from './types';

function createNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

export class GraphPanel {
    public static currentPanel: GraphPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _disposables: vscode.Disposable[] = [];
    private _lastData: GraphData | undefined;
    private _disposed = false;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.webview.html = this._getWebviewContent();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'ready':
                        this._sendData(false);
                        return;
                    case 'refresh':
                        this._sendData(true);
                        return;
                    case 'openFile':
                        this._openFile(message.path);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (GraphPanel.currentPanel) {
            GraphPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'codeConstellation',
            'Code Constellation',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'node_modules', 'force-graph', 'dist'),
                    vscode.Uri.joinPath(extensionUri, 'node_modules', 'd3', 'dist')
                ]
            }
        );

        GraphPanel.currentPanel = new GraphPanel(panel, extensionUri);
    }

    /**
     * Posts graph data to the webview. The webview re-sends 'ready' whenever it is
     * recreated (e.g. after the tab is hidden), so cached data is reused unless a
     * rescan is requested.
     */
    private async _sendData(rescan: boolean) {
        try {
            if (rescan || !this._lastData) {
                const root = vscode.workspace.workspaceFolders?.[0];
                if (!root) {
                    vscode.window.showErrorMessage('Code Constellation: no workspace folder is open.');
                    return;
                }
                const scanner = new ProjectScanner(root.uri.fsPath);
                this._lastData = await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Scanning project...' },
                    () => scanner.scan()
                );
            }
            if (!this._disposed) {
                this._panel.webview.postMessage({ command: 'updateData', data: this._lastData });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Code Constellation: failed to scan project (${error}).`);
        }
    }

    private async _openFile(relativePath: string) {
        const root = vscode.workspace.workspaceFolders?.[0];
        if (!root) {
            return;
        }
        try {
            await vscode.window.showTextDocument(vscode.Uri.joinPath(root.uri, relativePath));
        } catch (error) {
            vscode.window.showErrorMessage(`Code Constellation: could not open ${relativePath}.`);
        }
    }

    public dispose() {
        this._disposed = true;
        GraphPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private _getWebviewContent() {
        const webview = this._panel.webview;
        const forceGraphUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'force-graph', 'dist', 'force-graph.min.js')
        );
        const d3Uri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'd3', 'dist', 'd3.min.js')
        );
        const nonce = createNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-` + nonce + `';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Constellation</title>
    <script nonce="` + nonce + `">
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
    <script nonce="` + nonce + `" src="` + d3Uri + `"></script>
    <script nonce="` + nonce + `" src="` + forceGraphUri + `"></script>
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
            <input type="text" id="searchInput" placeholder="SCAN SECTOR...">
        </div>
        <button id="rescanButton">↺ Rescan</button>
        <button id="centerButton">▢ Center</button>
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

    <script nonce="` + nonce + `">
        const starsContainer = document.getElementById('stars-container');
        const starsFragment = document.createDocumentFragment();
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
            starsFragment.appendChild(star);
        }
        starsContainer.appendChild(starsFragment);

        const vscode = acquireVsCodeApi();
        const EMPTY_SET = new Set();
        const fontFamily = getComputedStyle(document.body).fontFamily;
        let Graph;
        let hoverNode = null;
        let searchNode = null;
        let graphData = { nodes: [], links: [] };
        let neighbors = EMPTY_SET;
        let neighborLinks = EMPTY_SET;
        let frameTime = 0;
        const adjacency = new Map();

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

        function nodeRadius(node) {
            return Math.sqrt(node.size || 1000) / 3;
        }

        function escapeHtml(unsafe) {
            return String(unsafe).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        function buildAdjacency(links) {
            adjacency.clear();
            function add(from, to, link) {
                let entry = adjacency.get(from);
                if (!entry) {
                    entry = { neighbors: new Set(), links: new Set() };
                    adjacency.set(from, entry);
                }
                entry.neighbors.add(to);
                entry.links.add(link);
            }
            links.forEach(function(link) {
                add(link.source, link.target, link);
                add(link.target, link.source, link);
            });
        }

        function focusNode(node) {
            hoverNode = node;
            const entry = node && adjacency.get(node.id);
            neighbors = entry ? entry.neighbors : EMPTY_SET;
            neighborLinks = entry ? entry.links : EMPTY_SET;
        }

        function initGraph() {
            if (typeof ForceGraph === 'undefined' || typeof d3 === 'undefined') {
                document.getElementById('graph').innerText = 'Error: failed to load graph libraries.';
                return;
            }

            try {
                Graph = ForceGraph()(document.getElementById('graph'));

                Graph.d3Force('charge').strength(-600).distanceMax(1000);
                Graph.d3Force('link').distance(100);
                Graph.d3Force('center').strength(0.01);
                Graph.d3Force('collide', d3.forceCollide(function(node) { return node.radius + 15; }));
                Graph.d3VelocityDecay(0.15);
                // The twinkle/pulse effects need continuous redraws.
                Graph.autoPauseRedraw(false);

                setupGraphProperties();
            } catch (e) {
                console.error('Error initializing graph:', e);
                document.getElementById('graph').innerText = 'Error: ' + e.message;
            }
        }

        function renderLegend() {
            const container = document.getElementById('legend-items');
            container.replaceChildren();

            const types = Array.from(new Set(graphData.nodes.map(function(n) { return n.type || 'other'; }))).sort();
            types.forEach(function(type) {
                const color = getTypeColor(type);
                const item = document.createElement('div');
                item.className = 'legend-item';
                const dot = document.createElement('div');
                dot.className = 'dot';
                dot.style.background = color;
                dot.style.boxShadow = '0 0 8px ' + color;
                item.appendChild(dot);
                item.appendChild(document.createTextNode(type.toUpperCase()));
                item.addEventListener('click', function() { highlightType(type); });
                container.appendChild(item);
            });
        }

        function highlightType(type) {
            const node = graphData.nodes.find(function(n) { return n.type === type || (type === 'other' && !n.type); });
            if (node) {
                Graph.centerAt(node.x, node.y, 1000);
                Graph.zoom(3, 1000);
                focusNode(node);
            }
        }

        function handleSearch(query) {
            const q = query.trim().toLowerCase();
            searchNode = q ? (graphData.nodes.find(function(n) { return n.name.toLowerCase().indexOf(q) !== -1; }) || null) : null;
            if (searchNode) {
                Graph.centerAt(searchNode.x, searchNode.y, 800);
                Graph.zoom(3.5, 800);
            }
        }

        function setupGraphProperties() {
            Graph
                .backgroundColor('rgba(5, 5, 8, 0.7)')
                .nodeId('id')
                .nodeLabel(function(node) {
                    return '<div class="scene-tooltip"><div class="tooltip-header"><span>' + escapeHtml(node.name) + '</span><span style="font-size: 10px; color: #888;">' + (node.size / 1024).toFixed(1) + ' KB</span></div><div class="tooltip-path">' + escapeHtml(node.id) + '</div><pre>' + escapeHtml(node.preview || '') + '</pre></div>';
                })
                .nodeVal(function(node) { return node.radius; })
                .onNodeClick(function(node) {
                    vscode.postMessage({ command: 'openFile', path: node.id });
                })
                .onNodeHover(function(node) {
                    if (node === hoverNode) return;
                    document.body.style.cursor = node ? 'pointer' : null;
                    focusNode(node);
                })
                .onRenderFramePre(function() { frameTime = Date.now(); })
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
                    if (!isFinite(node.x) || !isFinite(node.y)) return;

                    const isHovered = hoverNode && (node === hoverNode || neighbors.has(node.id));
                    const isSearching = searchNode && node === searchNode;
                    const isDimmed = (hoverNode || searchNode) && !isHovered && !isSearching;
                    const size = node.radius;
                    const color = node.color;

                    if (!isDimmed) {
                        const twinkle = (Math.sin(frameTime / 500 + node.x) + 1) / 2;
                        const r1 = size * 0.8;
                        const r2 = size * (1.5 + twinkle * 0.5);
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
                        ctx.arc(node.x, node.y, size + 3 / globalScale, 0, 2 * Math.PI, false);
                        ctx.strokeStyle = isSearching ? '#ff0055' : '#ffffff';
                        ctx.lineWidth = 2 / globalScale;
                        ctx.stroke();

                        if (isSearching) {
                            const pulse = (Math.sin(frameTime / 200) + 1) / 2;
                            ctx.beginPath();
                            ctx.arc(node.x, node.y, size + (10 + pulse * 10) / globalScale, 0, 2 * Math.PI, false);
                            ctx.strokeStyle = 'rgba(255, 0, 85, ' + (0.3 - pulse * 0.3) + ')';
                            ctx.stroke();
                        }
                    }

                    if (globalScale > 1.2 || isHovered || isSearching) {
                        const emphasized = isHovered || isSearching;
                        const alpha = globalScale > 1.2 ? Math.min(1, (globalScale - 1.2) * 2) : 1;
                        const fontSize = (emphasized ? 15 : 12) / globalScale;
                        ctx.font = (emphasized ? '800 ' : '500 ') + fontSize + 'px ' + fontFamily;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = isDimmed ? 'rgba(255, 255, 255, ' + (alpha * 0.05) + ')' : 'rgba(255, 255, 255, ' + (emphasized ? 1 : alpha * 0.9) + ')';
                        ctx.fillText(node.label, node.x, node.y + size + fontSize + 4 / globalScale);
                    }
                })
                .nodeCanvasObjectMode(function() { return 'replace'; });
        }

        document.getElementById('searchInput').addEventListener('input', function(e) { handleSearch(e.target.value); });
        document.getElementById('rescanButton').addEventListener('click', function() { vscode.postMessage({ command: 'refresh' }); });
        document.getElementById('centerButton').addEventListener('click', function() { Graph.zoomToFit(1000, 80); });

        window.addEventListener('message', function(event) {
            const message = event.data;
            if (message.command !== 'updateData' || !Graph) return;

            graphData = message.data;
            graphData.nodes.forEach(function(node) {
                node.radius = nodeRadius(node);
                node.color = getTypeColor(node.type);
                node.label = node.name.toUpperCase();
            });
            focusNode(null);
            searchNode = null;
            buildAdjacency(graphData.links);

            document.getElementById('stats').innerText = graphData.nodes.length + ' files detected • ' + graphData.links.length + ' links established';
            Graph.graphData(graphData);
            renderLegend();
            setTimeout(function() { Graph.zoomToFit(800, 50); }, 500);
        });

        initGraph();
        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
    }
}
