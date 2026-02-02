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
        const forceGraph3DPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', '3d-force-graph', 'dist', '3d-force-graph.min.js');
        const forceGraph3DUri = this._panel.webview.asWebviewUri(forceGraph3DPath);

        const d3Path = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'd3', 'dist', 'd3.min.js');
        const d3Uri = this._panel.webview.asWebviewUri(d3Path);

        const cspSource = this._panel.webview.cspSource;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${cspSource}; img-src ${cspSource} blob: data:; worker-src blob:;">
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
    <script src="${d3Uri}" onerror="console.error('Failed to load d3')"></script>
    <script src="${forceGraph3DUri}" onerror="console.error('Failed to load 3d-force-graph')"></script>
    <style>
        :root {
            --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            --bg-deep: #050508;
            --bg-nebula: #0a0a14;
            --panel-bg: rgba(20, 20, 25, 0.85);
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
            background: #000005;
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
            max-height: 300px;
            overflow-y: auto;
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
            max-width: 350px;
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
            max-height: 150px;
            overflow-y: auto;
        }
        #stats {
            position: absolute;
            bottom: 20px;
            left: 20px;
            z-index: 100;
            font-size: 11px;
            color: #888;
            background: rgba(0,0,0,0.5);
            padding: 6px 12px;
            border-radius: 10px;
            border: 1px solid var(--border-color);
        }
        
        #controls-hint {
            position: absolute;
            bottom: 60px;
            left: 20px;
            z-index: 100;
            font-size: 10px;
            color: #666;
            background: rgba(0,0,0,0.3);
            padding: 8px 12px;
            border-radius: 8px;
            line-height: 1.6;
        }
        
        #controls-hint kbd {
            background: rgba(255,255,255,0.1);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            font-size: 9px;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <div class="search-container">
            <input type="text" id="searchInput" placeholder="SCAN SECTOR..." oninput="handleSearch(this.value)">
        </div>
        <button onclick="refresh()">↺ Rescan</button>
        <button onclick="fitToScreen()">▢ Center</button>
        <button onclick="toggleOrbit()">◎ Orbit</button>
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
    <div id="controls-hint">
        <kbd>Left-click + drag</kbd> Rotate<br>
        <kbd>Right-click + drag</kbd> Pan<br>
        <kbd>Scroll</kbd> Zoom<br>
        <kbd>Click node</kbd> Open file
    </div>
    <div id="graph"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let Graph = null;
        let hoverNode = null;
        let searchNode = null;
        let graphData = { nodes: [], links: [] };
        let isOrbiting = false;
        let orbitAngle = 0;
        let orbitAnimationId = null;
        const neighbors = new Set();
        const neighborLinks = new Set();
        
        // Color palette for file types - vibrant space-themed colors
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
            '.md': '#ffffff',
            '.go': '#00add8',
            '.rs': '#dea584',
            '.java': '#b07219',
            '.c': '#555555',
            '.cpp': '#f34b7d',
            '.h': '#cccccc',
            '.vue': '#41b883',
            '.svelte': '#ff3e00',
            '.php': '#777bb4',
            '.rb': '#cc342d',
            '.swift': '#f05138',
            '.kt': '#a97bff',
            '.yaml': '#cb171e',
            '.yml': '#cb171e',
            '.xml': '#e44d26',
            '.sql': '#e38c00',
            '.sh': '#89e051',
            '.bash': '#89e051'
        };
        
        // Fallback colors for unknown types
        const fallbackColors = [
            '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7',
            '#dfe6e9', '#fd79a8', '#a29bfe', '#6c5ce7', '#81ecec'
        ];
        let colorIndex = 0;
        const dynamicColors = {};

        function getTypeColor(type) {
            if (typeColorsMap[type]) return typeColorsMap[type];
            if (!dynamicColors[type]) {
                dynamicColors[type] = fallbackColors[colorIndex % fallbackColors.length];
                colorIndex++;
            }
            return dynamicColors[type];
        }

        function initGraph() {
            if (typeof ForceGraph3D === 'undefined') {
                console.log('Waiting for ForceGraph3D...');
                setTimeout(initGraph, 100);
                return;
            }

            try {
                console.log('Initializing 3D Force Graph...');
                
                Graph = ForceGraph3D()(document.getElementById('graph'))
                    .backgroundColor('#000005')
                    .showNavInfo(false)
                    .nodeId('id')
                    .nodeLabel(node => {
                        const escapeHtml = (unsafe) => { 
                            if (!unsafe) return '';
                            return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); 
                        };
                        const preview = node.preview ? escapeHtml(node.preview) : '';
                        return '<div class="scene-tooltip"><div class="tooltip-header"><span>' + escapeHtml(node.name) + '</span><span style="font-size: 10px; color: #888;">' + (node.size / 1024).toFixed(1) + ' KB</span></div><div class="tooltip-path">' + escapeHtml(node.id) + '</div><pre>' + preview + '</pre></div>';
                    })
                    .nodeVal(node => Math.sqrt(node.size || 1000) / 10)
                    .nodeColor(node => {
                        if (hoverNode && node !== hoverNode && !neighbors.has(node.id)) {
                            return 'rgba(100, 100, 100, 0.3)';
                        }
                        if (searchNode && node === searchNode) {
                            return '#ff0055';
                        }
                        return getTypeColor(node.type);
                    })
                    .nodeOpacity(0.95)
                    .nodeResolution(16)
                    .linkWidth(link => {
                        if (hoverNode && neighborLinks.has(link)) return 2;
                        return 0.5;
                    })
                    .linkColor(link => {
                        if (hoverNode && neighborLinks.has(link)) return '#ffffff';
                        if (hoverNode) return 'rgba(255, 255, 255, 0.05)';
                        return 'rgba(255, 255, 255, 0.2)';
                    })
                    .linkOpacity(0.6)
                    .linkDirectionalParticles(link => {
                        if (hoverNode && neighborLinks.has(link)) return 4;
                        return 1;
                    })
                    .linkDirectionalParticleWidth(1.5)
                    .linkDirectionalParticleSpeed(0.005)
                    .linkDirectionalParticleColor(() => '#58a6ff')
                    .onNodeClick(node => {
                        vscode.postMessage({ command: 'openFile', path: node.id });
                    })
                    .onNodeHover(node => {
                        if (node === hoverNode) return;
                        document.body.style.cursor = node ? 'pointer' : 'default';
                        hoverNode = node;
                        neighbors.clear();
                        neighborLinks.clear();
                        if (node) {
                            const links = Graph.graphData().links;
                            links.forEach(link => {
                                const sId = typeof link.source === 'object' ? link.source.id : link.source;
                                const tId = typeof link.target === 'object' ? link.target.id : link.target;
                                if (sId === node.id) { neighbors.add(tId); neighborLinks.add(link); }
                                else if (tId === node.id) { neighbors.add(sId); neighborLinks.add(link); }
                            });
                        }
                        // Force re-render to update colors
                        Graph.nodeColor(Graph.nodeColor());
                        Graph.linkColor(Graph.linkColor());
                        Graph.linkWidth(Graph.linkWidth());
                        Graph.linkDirectionalParticles(Graph.linkDirectionalParticles());
                    })
                    .onBackgroundClick(() => {
                        hoverNode = null;
                        neighbors.clear();
                        neighborLinks.clear();
                        Graph.nodeColor(Graph.nodeColor());
                        Graph.linkColor(Graph.linkColor());
                    });

                // Configure the force simulation for a nice spread-out constellation
                Graph.d3Force('charge').strength(-200);
                Graph.d3Force('link').distance(80);
                Graph.d3Force('center').strength(0.05);
                
                // Add collision detection
                Graph.d3Force('collide', d3.forceCollide(node => Math.sqrt(node.size || 1000) / 5 + 5));
                
                // Set initial camera position
                Graph.cameraPosition({ x: 0, y: 0, z: 500 });
                
                console.log('3D Force Graph initialized successfully!');

            } catch (e) {
                console.error('Error initializing graph:', e);
                document.getElementById('graph').innerHTML = '<div style="color: red; padding: 20px;">Error initializing 3D graph: ' + e.message + '</div>';
            }
        }

        function renderLegend() {
            const container = document.getElementById('legend-items');
            if (!container) return;
            container.innerHTML = '';
            
            const types = [];
            graphData.nodes.forEach(n => {
                const t = n.type || 'other';
                if (types.indexOf(t) === -1) types.push(t);
            });
            types.sort();
            
            types.forEach(type => {
                const color = getTypeColor(type);
                const item = document.createElement('div');
                item.className = 'legend-item';
                item.innerHTML = '<div class="dot" style="background: ' + color + '; box-shadow: 0 0 8px ' + color + '"></div>' + type.toUpperCase();
                item.onclick = () => focusOnType(type);
                container.appendChild(item);
            });
        }

        function focusOnType(type) {
            const node = graphData.nodes.find(n => n.type === type || (type === 'other' && !n.type));
            if (node && node.x !== undefined) {
                // Animate camera to the node
                const distance = 150;
                const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
                Graph.cameraPosition(
                    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
                    node,
                    2000
                );
                
                // Highlight the node
                hoverNode = node;
                neighbors.clear();
                neighborLinks.clear();
                const links = Graph.graphData().links;
                links.forEach(link => {
                    const sId = typeof link.source === 'object' ? link.source.id : link.source;
                    const tId = typeof link.target === 'object' ? link.target.id : link.target;
                    if (sId === node.id) { neighbors.add(tId); neighborLinks.add(link); }
                    else if (tId === node.id) { neighbors.add(sId); neighborLinks.add(link); }
                });
                Graph.nodeColor(Graph.nodeColor());
                Graph.linkColor(Graph.linkColor());
            }
        }

        function handleSearch(query) {
            if (!query) {
                searchNode = null;
                Graph.nodeColor(Graph.nodeColor());
                return;
            }
            const node = graphData.nodes.find(n => n.name.toLowerCase().includes(query.toLowerCase()));
            if (node && node.x !== undefined) {
                searchNode = node;
                // Fly to the node
                const distance = 100;
                const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
                Graph.cameraPosition(
                    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
                    node,
                    1500
                );
                Graph.nodeColor(Graph.nodeColor());
            }
        }

        function fitToScreen() {
            if (!Graph) return;
            Graph.zoomToFit(1000, 100);
        }

        function toggleOrbit() {
            isOrbiting = !isOrbiting;
            if (isOrbiting) {
                startOrbit();
            } else {
                stopOrbit();
            }
        }

        function startOrbit() {
            if (!Graph) return;
            
            function animate() {
                if (!isOrbiting) return;
                
                orbitAngle += 0.002;
                const distance = 400;
                const x = distance * Math.sin(orbitAngle);
                const z = distance * Math.cos(orbitAngle);
                
                Graph.cameraPosition({ x: x, y: 100, z: z });
                orbitAnimationId = requestAnimationFrame(animate);
            }
            animate();
        }

        function stopOrbit() {
            if (orbitAnimationId) {
                cancelAnimationFrame(orbitAnimationId);
                orbitAnimationId = null;
            }
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        // Initialize the graph
        initGraph();

        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateData':
                    if (!Graph) return;
                    graphData = message.data;
                    const nodes = graphData.nodes;
                    const links = graphData.links;
                    document.getElementById('stats').innerText = nodes.length + ' files detected • ' + links.length + ' links established';
                    
                    // Clean up links to ensure they reference existing nodes
                    const nodeIds = new Set(nodes.map(n => n.id));
                    const cleanLinks = links.filter((link, index, self) => {
                        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                        const firstIdx = self.findIndex(l => {
                            return (typeof l.source === 'object' ? l.source.id : l.source) === sourceId && 
                                   (typeof l.target === 'object' ? l.target.id : l.target) === targetId;
                        });
                        return index === firstIdx && nodeIds.has(sourceId) && nodeIds.has(targetId);
                    });

                    Graph.graphData({ nodes: nodes, links: cleanLinks });
                    renderLegend();
                    
                    // Fit to screen after the simulation settles
                    setTimeout(() => { 
                        if (Graph) Graph.zoomToFit(800, 100); 
                    }, 1500);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
