// MindFlow v2 - Infinite Canvas Logic with Zoom & Colors

// Default Data
const defaultNodes = [
    { id: 'start', x: 0, y: 0, content: 'Idea 1: Start here', color: 'white', type: 'text' },
    { id: 'n2', x: 300, y: 100, content: 'Idea 2: Connect this', color: 'blue', type: 'text' }
];

const defaultConnections = [
    { from: 'start', to: 'n2' }
];

// Load Safe State
function loadState() {
    let nodes = defaultNodes;
    let connections = defaultConnections;
    let tasks = [];

    try {
        const storedNodes = localStorage.getItem('mindflow_nodes');
        if (storedNodes) {
            const parsed = JSON.parse(storedNodes);
            if (Array.isArray(parsed)) nodes = parsed;
        }

        const storedConn = localStorage.getItem('mindflow_conn');
        if (storedConn) {
            const parsed = JSON.parse(storedConn);
            if (Array.isArray(parsed)) connections = parsed;
        }

        const storedTasks = localStorage.getItem('mindflow_tasks');
        if (storedTasks) {
            const parsed = JSON.parse(storedTasks);
            if (Array.isArray(parsed)) tasks = parsed;
        }
    } catch (e) {
        console.warn('MindFlow: Failed to load state, using defaults.', e);
        // Clear bad data to prevent future crashes
        localStorage.removeItem('mindflow_nodes');
        localStorage.removeItem('mindflow_connections');
        localStorage.removeItem('mindflow_tasks');
    }

    // Ensure targets exist on nodes
    nodes = nodes.map(n => ({ ...n, targetX: n.x, targetY: n.y }));

    return { nodes, connections, tasks };
}

const loaded = loadState();

// State
const state = {
    nodes: loaded.nodes,
    connections: loaded.connections,
    view: {
        x: window.innerWidth / 2 - 150,
        y: window.innerHeight / 2 - 100,
        scale: 1,
        // Smooth Drag/Zoom Targets
        targetX: window.innerWidth / 2 - 150,
        targetY: window.innerHeight / 2 - 100,
        targetScale: 1
    },
    drag: {
        active: false,
        type: null, // 'node', 'canvas', 'socket', 'box-select'
        startX: 0, startY: 0,
        item: null // or items?
    },
    // Undo/Redo History
    history: [],
    historyIndex: -1,
    selection: new Set(), // Set of IDs
    keys: { Space: false }, // Track keyboard state
    hoveredNode: null, // Track hovered node for UI logic
    hoverTimer: null, // Grace period timer
    clipboard: null, // For copy/paste nodes
    currentView: 'canvas', // 'canvas' or 'tasks'
    globalTasks: loaded.tasks
};

// DOM
let container;
let canvas;
let nodeContainer;
let svgLayer;
let tempLayer;
let controlsLayer;

// initialization
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('MindFlow: Initializing...');

        // Initialize DOM references
        container = document.getElementById('mindflow-container');
        canvas = document.getElementById('mindflow-canvas');
        nodeContainer = document.getElementById('nodes-container');
        svgLayer = document.getElementById('connections-layer');
        tempLayer = document.getElementById('temp-layer');
        controlsLayer = document.getElementById('controls-layer');

        if (!container || !canvas) {
            throw new Error('Critical DOM elements missing');
        }

        updateTransform();
        renderNodes();
        renderConnections();
        setupEvents();

        // Force View State
        if (window.switchView) {
            window.switchView('canvas');
        }

        animate(); // Start the loop

        // Initial history state
        pushHistory();
        renderGlobalTasks();

        console.log('MindFlow: Initialization Complete');
    } catch (e) {
        console.error('MindFlow: CRITICAL INIT ERROR', e);
        alert('MindFlow Error: ' + e.message);
    }
});

// ---------------------------
// Animation Loop (Smooth Drag & Zoom)
// ---------------------------
function animate() {
    // Lerp factor (0.1 = smooth, 1.0 = instant)
    const factor = 0.15; // Slightly tighter for nodes to feel responsive but smooth

    // 1. View Physics
    const dx = state.view.targetX - state.view.x;
    const dy = state.view.targetY - state.view.y;
    const dScale = state.view.targetScale - state.view.scale;

    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1 || Math.abs(dScale) > 0.001) {
        state.view.x += dx * factor;
        state.view.y += dy * factor;
        state.view.scale += dScale * factor;
        updateTransform();
    }

    // 2. Node Physics
    let nodesMoved = false;
    state.nodes.forEach(node => {
        // Init target if missing (legacy data)
        if (node.targetX === undefined) node.targetX = node.x;
        if (node.targetY === undefined) node.targetY = node.y;

        const ndx = node.targetX - node.x;
        const ndy = node.targetY - node.y;

        if (Math.abs(ndx) > 0.1 || Math.abs(ndy) > 0.1) {
            node.x += ndx * factor;
            node.y += ndy * factor;
            nodesMoved = true;

            // Update DOM directly for performance
            const el = document.getElementById(node.id);
            if (el) {
                el.style.left = `${node.x}px`;
                el.style.top = `${node.y}px`;
            }
        }
    });

    if (nodesMoved) {
        renderConnections();
    }

    requestAnimationFrame(animate);
}


// ---------------------------
// Render
// ---------------------------
function renderNodes() {
    nodeContainer.innerHTML = '';
    state.nodes.forEach(node => {
        // Sync targets if rendering from fresh state (e.g. undo)
        if (node.targetX === undefined) node.targetX = node.x;
        if (node.targetY === undefined) node.targetY = node.y;

        const el = createNodeElement(node);
        nodeContainer.appendChild(el);
    });
}

function createNodeElement(nodeData) {
    const div = document.createElement('div');
    const isImage = nodeData.type === 'image';

    // Set Saved Dimensions
    // Default sizes: Text=200x120, Image=300x(auto/200)
    // Actually we set defaults in state or here.
    const width = nodeData.width || (isImage ? 300 : 200);
    const height = nodeData.height || (isImage ? 200 : 120);

    div.className = `node color-${nodeData.color || 'white'} ${isImage ? 'image-node' : ''}`;
    if (state.selection.has(nodeData.id)) div.classList.add('selected');
    div.id = nodeData.id;
    // Use current physics position
    div.style.left = `${nodeData.x}px`;
    div.style.top = `${nodeData.y}px`;
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;

    let contentHTML = '';
    if (isImage) {
        contentHTML = `<img src="${nodeData.src}" draggable="false" />`;
    } else {
        contentHTML = `<textarea class="node-content" spellcheck="false">${nodeData.content || ''}</textarea>`;
    }

    const toolbarHTML = state.isReadOnly ? '' : `
    <div class="node-toolbar">
        <div class="toolbar-group">
            <div class="btn-color-dot dot-white" onmousedown="event.stopPropagation()" onclick="setNodeColor('${nodeData.id}', 'white')"></div>
            <div class="btn-color-dot dot-red" onmousedown="event.stopPropagation()" onclick="setNodeColor('${nodeData.id}', 'red')"></div>
            <div class="btn-color-dot dot-orange" onmousedown="event.stopPropagation()" onclick="setNodeColor('${nodeData.id}', 'orange')"></div>
            <div class="btn-color-dot dot-yellow" onmousedown="event.stopPropagation()" onclick="setNodeColor('${nodeData.id}', 'yellow')"></div>
            <div class="btn-color-dot dot-green" onmousedown="event.stopPropagation()" onclick="setNodeColor('${nodeData.id}', 'green')"></div>
            <div class="btn-color-dot dot-blue" onmousedown="event.stopPropagation()" onclick="setNodeColor('${nodeData.id}', 'blue')"></div>
            <div class="btn-color-dot dot-purple" onmousedown="event.stopPropagation()" onclick="setNodeColor('${nodeData.id}', 'purple')"></div>
        </div>
        <div class="toolbar-group">
            <div class="btn-delete-node" onmousedown="event.stopPropagation()" onclick="deleteNode('${nodeData.id}')">✕</div>
        </div>
    </div>`;

    const resizeHTML = state.isReadOnly ? '' : `<div class="resize-handle" data-id="${nodeData.id}"></div>`;

    div.innerHTML = `
    <div class="node-header-handle"></div>
    ${toolbarHTML}
    ${contentHTML}
    ${resizeHTML}
    `;

    // Socket (Link Creator)
    if (!state.isReadOnly) {
        const socket = document.createElement('div');
        socket.className = 'node-socket';
        socket.dataset.id = nodeData.id;
        div.appendChild(socket);
    }

    // Add the four directional sockets
    if (!state.isReadOnly) {
        const socketTop = document.createElement('div');
        socketTop.className = 'node-socket socket-top';
        socketTop.dataset.id = nodeData.id;
        div.appendChild(socketTop);

        const socketRight = document.createElement('div');
        socketRight.className = 'node-socket socket-right';
        socketRight.dataset.id = nodeData.id;
        div.appendChild(socketRight);

        const socketBottom = document.createElement('div');
        socketBottom.className = 'node-socket socket-bottom';
        socketBottom.dataset.id = nodeData.id;
        div.appendChild(socketBottom);

        const socketLeft = document.createElement('div');
        socketLeft.className = 'node-socket socket-left';
        socketLeft.dataset.id = nodeData.id;
        div.appendChild(socketLeft);
    }

    if (!isImage) {
        // TextArea interactions
        const textarea = div.querySelector('textarea');

        // Auto-Resize Function
        const autoResize = () => {
            // Unlock height to allow shrinking
            div.style.height = 'auto';
            textarea.style.height = 'auto';

            // Calculate new height based on content
            // Textarea scrollHeight + Buffer (14px) to ensure bottom padding isn't cut off
            const newHeight = textarea.scrollHeight + 14;

            // Apply new height
            div.style.height = `${newHeight}px`; // Fix space in px
            textarea.style.height = ''; // Revert to CSS (100% height)

            // Update State (so lines follow)
            const n = state.nodes.find(n => n.id === nodeData.id);
            if (n) {
                n.height = newHeight;
                // Update targetY if needed? Physics handles x/y which are top-left.
            }
            // Request render for lines
            requestAnimationFrame(renderConnections);
        };

        // Init size
        setTimeout(autoResize, 0); // tick to allow render

        textarea.addEventListener('focus', () => { /* no-op */ });

        textarea.addEventListener('change', (e) => {
            const n = state.nodes.find(n => n.id === nodeData.id);
            if (n) {
                n.content = e.target.value;
                saveData();
                pushHistory();
            }
        });

        textarea.addEventListener('input', (e) => {
            const n = state.nodes.find(n => n.id === nodeData.id);
            if (n) {
                n.content = e.target.value;
                autoResize();
                saveData(); // Save content and size
            }
        });
    }

    // Hover State for Unlink Buttons
    div.addEventListener('mouseenter', () => {
        if (state.hoverTimer) clearTimeout(state.hoverTimer);
        state.hoveredNode = nodeData.id;
        renderConnections();
    });

    div.addEventListener('mouseleave', () => {
        // Grace period to allow moving to the button
        state.hoverTimer = setTimeout(() => {
            if (state.hoveredNode === nodeData.id) {
                state.hoveredNode = null;
                renderConnections();
            }
        }, 170); // 150ms delay
    });

    nodeContainer.appendChild(div);
    return div;
}

function renderConnections() {
    svgLayer.innerHTML = '';
    controlsLayer.innerHTML = '';

    state.connections.forEach(conn => {
        const n1 = state.nodes.find(n => n.id === conn.from);
        const n2 = state.nodes.find(n => n.id === conn.to);
        if (!n1 || !n2) return;

        // Dynamic Center Calculation
        // Read actual DOM size if available for smoothness, else state
        const el1 = document.getElementById(n1.id);
        const el2 = document.getElementById(n2.id);

        const w1 = n1.width || (n1.type === 'image' ? 300 : 200);
        // Height might be dynamic for text, use state.height or default
        const h1 = n1.height || (n1.type === 'image' ? 200 : 120);

        const w2 = n2.width || (n2.type === 'image' ? 300 : 200);
        const h2 = n2.height || (n2.type === 'image' ? 200 : 120);

        // Use current physics position for lines
        const p1 = { x: n1.x + (w1 / 2), y: n1.y + (h1 / 2) };
        const p2 = { x: n2.x + (w2 / 2), y: n2.y + (h2 / 2) };

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', getBezierPath(p1, p2));
        path.setAttribute('class', 'connection-line');

        // Right Click to Delete
        const deleteHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteConnection(conn.from, conn.to);
            pushHistory();
        };

        path.oncontextmenu = deleteHandler;

        // Shift+Click (Legacy/Backup)
        path.onclick = (e) => {
            if (e.shiftKey) {
                deleteConnection(conn.from, conn.to);
                pushHistory();
            }
        };
        svgLayer.appendChild(path);

        // Control Points for Calculation
        const cx = (p1.x + p2.x) / 2;
        const cp1 = { x: cx, y: p1.y };
        const cp2 = { x: cx, y: p2.y };

        // Helper to check if point is inside node box (with padding)
        const isInside = (pt, node, w, h) => {
            // Add padding to push button slightly out
            const pad = 2; // Closer! (was 10)
            return (pt.x >= node.x - pad && pt.x <= node.x + w + pad &&
                pt.y >= node.y - pad && pt.y <= node.y + h + pad);
        };

        // Helper to create button
        const createBtn = (pos, nodeId) => {
            if (state.isReadOnly) return;
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', pos.x);
            circle.setAttribute('cy', pos.y);
            circle.setAttribute('r', '7');

            circle.setAttribute('data-node-id', nodeId);

            // Initial class (hidden)
            let classes = 'disconnect-btn';
            if (state.hoveredNode === nodeId) {
                classes += ' visible';
            }
            circle.setAttribute('class', classes);

            // Use Mousedown for immediate action and to avoid drag conflicts
            circle.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation(); // Critical to stop canvas drag
                deleteConnection(conn.from, conn.to);
                pushHistory();
            };

            circle.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                deleteConnection(conn.from, conn.to);
                pushHistory();
            };

            // Keep alive on button hover
            circle.onmouseenter = () => {
                if (state.hoverTimer) clearTimeout(state.hoverTimer);
                // Do NOT re-render here, it destroys the button under the mouse!
                // state.hoveredNode is already set if we are seeing this button.
            };

            circle.onmouseleave = () => {
                state.hoverTimer = setTimeout(() => {
                    // Only clear if still matching (user didn't move back to node)
                    if (state.hoveredNode === nodeId) {
                        state.hoveredNode = null;
                        renderConnections();
                    }
                }, 170);
            };

            controlsLayer.appendChild(circle);
        };

        // Find T for Start Node (Search 0 -> 0.5)
        let t1 = 0.05;
        for (; t1 < 0.5; t1 += 0.02) {
            const pt = getCubicBezierPoint(t1, p1, cp1, cp2, p2);
            if (!isInside(pt, n1, w1, h1)) break;
        }
        createBtn(getCubicBezierPoint(t1, p1, cp1, cp2, p2), conn.from);

        // Find T for End Node (Search 1 -> 0.5)
        let t2 = 0.95;
        for (; t2 > 0.5; t2 -= 0.02) {
            const pt = getCubicBezierPoint(t2, p1, cp1, cp2, p2);
            if (!isInside(pt, n2, w2, h2)) break;
        }
        createBtn(getCubicBezierPoint(t2, p1, cp1, cp2, p2), conn.to);
    });
}

function getBezierPath(p1, p2) {
    const cx = (p1.x + p2.x) / 2;
    return `M ${p1.x} ${p1.y} C ${cx} ${p1.y}, ${cx} ${p2.y}, ${p2.x} ${p2.y} `;
}

function getCubicBezierPoint(t, p0, p1, p2, p3) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;

    return { x, y };
}

// ---------------------------
// Interaction / Events
// ---------------------------
// ---------------------------
// Interaction / Events
// ---------------------------
function setupEvents() {
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    // View Switching
    window.switchView = (viewName) => {
        state.currentView = viewName;

        // Toggle Containers
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewName}`).classList.add('active');

        // Toggle Buttons
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        if (viewName === 'canvas') document.querySelector('.nav-btn:nth-child(1)').classList.add('active');
        if (viewName === 'tasks') document.querySelector('.nav-btn:nth-child(2)').classList.add('active');
    };

    // Global Task Listeners
    const btnAddTask = document.getElementById('btn-add-task');
    const inputTask = document.getElementById('global-task-input');

    if (btnAddTask && inputTask) {
        const confirmAdd = () => {
            if (inputTask.value.trim()) {
                addGlobalTask(inputTask.value.trim());
                inputTask.value = '';
            }
        };
        btnAddTask.onclick = confirmAdd;
        inputTask.onkeydown = (e) => {
            if (e.key === 'Enter') confirmAdd();
        };
    }

    // Canvas Events
    // Note: 'container' is global, initialized in DOMContentLoaded
    if (container) {
        container.addEventListener('mousedown', handleMouseDown);
        container.addEventListener('wheel', handleWheel, { passive: false });
    }

    // Window Events
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('paste', handlePaste);

    // Context Menu disable
    // Context Menu
    window.addEventListener('contextmenu', e => {
        console.log('Context Menu Event detected', e.clientX, e.clientY);
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY);
    });

    // Zoom Controls
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnCenter = document.getElementById('btn-center');

    if (btnZoomIn) {
        btnZoomIn.onclick = () => zoomToPoint(0.2, window.innerWidth / 2, window.innerHeight / 2);
    }
    if (btnZoomOut) {
        btnZoomOut.onclick = () => zoomToPoint(-0.2, window.innerWidth / 2, window.innerHeight / 2);
    }
    if (btnCenter) {
        btnCenter.onclick = centerView;
    }

    // Toggle Help Overlay
    const helpOverlay = document.querySelector('.help-overlay');
    const btnInfo = document.getElementById('btn-info');
    const btnCloseHelp = document.querySelector('.btn-close-help');

    if (btnInfo && helpOverlay) {
        btnInfo.onclick = () => {
            helpOverlay.classList.toggle('visible');
        };
    }

    if (btnCloseHelp && helpOverlay) {
        btnCloseHelp.onclick = () => {
            helpOverlay.classList.remove('visible');
        };
    }

    // Mode Toggle
    const btnView = document.getElementById('btn-mode-view');
    const btnEdit = document.getElementById('btn-mode-edit');
    if (btnView && btnEdit) {
        console.log('Binding Mode Toggle Buttons');
        btnView.onclick = () => { console.log('Clicked View'); setMode('view'); };
        btnEdit.onclick = () => { console.log('Clicked Edit'); setMode('edit'); };
    } else {
        console.error('Mode Toggle Buttons NOT FOUND');
    }

    // Theme Toggle
    const btnTheme = document.getElementById('btn-theme');
    // Load saved theme
    const savedTheme = localStorage.getItem('mindflow_theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (btnTheme) btnTheme.textContent = '☀️';
    }

    if (btnTheme) {
        btnTheme.onclick = () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('mindflow_theme', isDark ? 'dark' : 'light');
            btnTheme.textContent = isDark ? '☀️' : '🌙';
        };
    }
}

// ---------------------------
// Global Task Management
// ---------------------------
function addGlobalTask(text) {
    const newTask = {
        id: `task-${Date.now()}`,
        text: text,
        done: false
    };
    state.globalTasks.push(newTask);
    saveData();
    renderGlobalTasks();
    pushHistory();
}

function toggleGlobalTask(id) {
    const task = state.globalTasks.find(t => t.id === id);
    if (task) {
        task.done = !task.done;
        saveData();
        renderGlobalTasks();
        pushHistory();
    }
}

function deleteGlobalTask(id) {
    state.globalTasks = state.globalTasks.filter(t => t.id !== id);
    saveData();
    renderGlobalTasks();
    pushHistory();
}

function renderGlobalTasks() {
    const taskList = document.getElementById('global-task-list');
    if (!taskList) return;

    taskList.innerHTML = '';
    state.globalTasks.forEach(task => {
        const li = document.createElement('li');
        li.className = `global-task-item ${task.done ? 'done' : ''}`;
        li.innerHTML = `
            <input type="checkbox" ${task.done ? 'checked' : ''} onchange="toggleGlobalTask('${task.id}')">
            <span>${task.text}</span>
            <button onclick="deleteGlobalTask('${task.id}')">✕</button>
        `;
        taskList.appendChild(li);
    });
}

function handleKeyUp(e) {
    if (e.code === 'Space') {
        state.keys.Space = false;
        container.style.cursor = 'default'; // Reset cursor
    }
}

function handleKeyDown(e) {
    // State Tracking
    if (e.code === 'Space') {
        if (e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
            state.keys.Space = true;
            e.preventDefault();
        }
    }

    // Ignore input events
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    // Undo: Ctrl+Z
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
    }
    // Redo: Ctrl+Shift+Z or Ctrl+Y
    else if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') ||
        ((e.metaKey || e.ctrlKey) && e.key === 'y')) {
        e.preventDefault();
        redo();
    }
    // Delete
    else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection.size > 0) {
            e.preventDefault();
            deleteSelectedNodes();
        }
    }
}

function handlePaste(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
                const imgData = event.target.result;
                // Center of screen
                const x = (window.innerWidth / 2 - state.view.x) / state.view.scale;
                const y = (window.innerHeight / 2 - state.view.y) / state.view.scale;
                createImageNode(imgData, x, y);
                pushHistory();
            };
            reader.readAsDataURL(blob);
        }
    }
}

function zoomToPoint(delta, screenX, screenY) {
    // Current visual state
    const currentScale = state.view.scale;
    const currentX = state.view.x;
    const currentY = state.view.y;

    // Calculate World position under mouse from CURRENT visual state
    const worldX = (screenX - currentX) / currentScale;
    const worldY = (screenY - currentY) / currentScale;

    // Update Target Scale
    const oldTargetScale = state.view.targetScale;
    const newTargetScale = Math.min(Math.max(0.1, oldTargetScale + delta), 3);

    const newTargetX = screenX - (worldX * newTargetScale);
    const newTargetY = screenY - (worldY * newTargetScale);

    state.view.targetX = newTargetX;
    state.view.targetY = newTargetY;
    state.view.targetScale = newTargetScale;
}

function updateTransform() {
    canvas.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;

    const gridSize = 40 * state.view.scale;
    container.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    container.style.backgroundPosition = `${state.view.x}px ${state.view.y}px`;
}

function handleWheel(e) {
    if (state.currentView !== 'canvas') return;

    e.preventDefault();

    // Always Zoom on Wheel (Google Maps style)
    const zoomIntensity = 0.0005; // Reduced from 0.002 for smoother zoom
    const delta = -e.deltaY * zoomIntensity;

    zoomToPoint(delta, e.clientX, e.clientY);
}

// ---------------------------
// Mouse Handler: Selection / Drag / Box / Resize
// ---------------------------
function handleMouseDown(e) {
    if (state.currentView !== 'canvas') return;

    // 0. Resize Interaction
    if (!state.isReadOnly && e.target.classList.contains('resize-handle') && e.button === 0) {
        const nodeEl = e.target.closest('.node');
        const node = state.nodes.find(n => n.id === nodeEl.id);
        if (node) {
            state.drag.active = true;
            state.drag.type = 'resize';
            state.drag.item = node.id;
            state.drag.startX = e.clientX;
            state.drag.startY = e.clientY;
            state.drag.startWidth = node.width || (node.type === 'image' ? 300 : 200);
            state.drag.startHeight = node.height || (node.type === 'image' ? 200 : 120);
            e.stopPropagation();
            return;
        }
    }

    // 1. Socket Interaction (Left Click) - Start Link
    if (!state.isReadOnly && e.target.classList.contains('node-socket') && e.button === 0) {
        state.drag.active = true;
        state.drag.type = 'socket';
        state.drag.item = e.target.dataset.id;
        createTempLine();
        e.stopPropagation();
        return;
    }

    // 2. Node Interaction (Left Click) - Move / Select
    const nodeEl = e.target.closest('.node');
    if (nodeEl && e.button === 0) {
        // Ignore clicks on specific interactive controls
        if (e.target.closest('button') ||
            e.target.closest('.color-dot') ||
            e.target.closest('.btn-delete-node') ||
            e.target.closest('.btn-task') ||
            e.target.closest('.resize-handle') ||
            e.target.tagName === 'INPUT') { // Keep TEXTAREA draggable? No, editing.
            return;
        }

        // Focus textarea if clicking text
        if (e.target.tagName === 'TEXTAREA') {
            if (state.isReadOnly) {
                e.preventDefault(); // Block focus in read-only? Or allow copy? Allow copy.
                // But don't start drag.
            }
            // If editing, let default behavior happen (focus)
            // But we might want to drag via header?
        }

        const id = nodeEl.id;

        // Shift Click = Toggle Selection
        if (e.shiftKey) {
            if (state.selection.has(id)) {
                state.selection.delete(id);
            } else {
                state.selection.add(id);
            }
            renderNodes();
            return;
        }

        // Click outside selection? Clear and select this one
        if (!state.selection.has(id)) {
            state.selection.clear();
            state.selection.add(id);
            renderNodes();
        }

        // Start Dragging (ONLY IF NOT READ ONLY)
        if (!state.isReadOnly) {
            state.drag.active = true;
            state.drag.type = 'node';
            state.drag.startX = e.clientX;
            state.drag.startY = e.clientY;
            state.drag.initialPositions = new Map();
            state.selection.forEach(selId => {
                const n = state.nodes.find(node => node.id === selId);
                if (n) {
                    state.drag.initialPositions.set(selId, { x: n.x, y: n.y });
                }
            });
        }

        // If ReadOnly, we just selected it (above) but didn't set drag.active.
        // We stop propagation so we don't trigger background pan? 
        // No, if we want to pan while dragging a node in view mode... user expects dragging a node to pan the canvas?
        // Like a map? Google Maps: clicking a pin doesn't drag the pin, it pans the map.
        // So I should let it fall through to Pan Logic.
        if (state.isReadOnly) {
            // Initiate Pan instead
            state.drag.active = true;
            state.drag.type = 'canvas'; // Changed from 'pan' to 'canvas' to match existing type
            state.drag.startX = e.clientX - state.view.targetX; // Adjusted to match existing canvas drag startX
            state.drag.startY = e.clientY - state.view.targetY; // Adjusted to match existing canvas drag startY
            container.classList.add('panning'); // Add panning class
        } else {
            e.stopPropagation(); // Standard drag behavior
        }
        return;
    }

    // 3. Background Interaction (Pan)
    // If not on a node, socket, or control -> Pan
    if (e.button === 0 || state.keys.Space) {
        state.drag.active = true;
        state.drag.type = 'canvas';
        state.drag.startX = e.clientX - state.view.targetX;
        state.drag.startY = e.clientY - state.view.targetY;
        container.classList.add('panning');

        // Deselect if clicking empty space
        if (state.selection.size > 0) {
            state.selection.clear();
            renderNodes();
        }
    }


}





function handleMouseMove(e) {
    if (!state.drag.active) return;

    // Safety check: if button released outside window
    if (e.buttons === 0) {
        state.drag.active = false;
        return;
    }

    if (state.drag.type === 'resize') {
        const dx = (e.clientX - state.drag.startX) / state.view.scale;
        const dy = (e.clientY - state.drag.startY) / state.view.scale;

        const node = state.nodes.find(n => n.id === state.drag.item);
        if (node) {
            const newW = Math.max(150, state.drag.startWidth + dx); // min width
            let newH = Math.max(100, state.drag.startHeight + dy); // min height

            // If Text Node: Only resize width, let auto-grow handle height?
            // User might want to shrink it? But text will spill.
            // Let's force height calc for text nodes.
            if (node.type === 'text') {
                const el = document.getElementById(node.id);
                if (el) {
                    // We apply width
                    el.style.width = `${newW} px`;
                    // Recalc height based on new width
                    const textarea = el.querySelector('textarea');
                    textarea.style.height = 'auto';
                    newH = textarea.scrollHeight + 28; // recalc
                    el.style.height = `${newH} px`;
                }
            } else {
                // Image Node: standard resize
                const el = document.getElementById(node.id);
                if (el) {
                    el.style.width = `${newW} px`;
                    el.style.height = `${newH} px`;
                }
            }

            node.width = newW;
            node.height = newH;

            renderConnections();
        }

    } else if (state.drag.type === 'node') {
        const dx = (e.clientX - state.drag.startX) / state.view.scale;
        const dy = (e.clientY - state.drag.startY) / state.view.scale;

        // Move TARGETS of all selected nodes
        state.selection.forEach(id => {
            const node = state.nodes.find(n => n.id === id);
            if (node) {
                if (node.targetX === undefined) node.targetX = node.x;
                if (node.targetY === undefined) node.targetY = node.y;

                node.targetX += dx;
                node.targetY += dy;
                // We do NOT update node.x/y here; animate() loop does that for smoothness.
            }
        });

        state.drag.startX = e.clientX;
        state.drag.startY = e.clientY;
        // Don't need requestAnimationFrame(renderConnections) here; loop handles it.

    } else if (state.drag.type === 'canvas') {
        state.view.targetX = e.clientX - state.drag.startX;
        state.view.targetY = e.clientY - state.drag.startY;

    } else if (state.drag.type === 'socket') {
        const n1 = state.nodes.find(n => n.id === state.drag.item);
        if (n1) {
            // Recalc source point
            // Need actual dimensions now for center
            const w1 = n1.width || (n1.type === 'image' ? 300 : 200);
            const h1 = n1.height || (n1.type === 'image' ? 200 : 120);
            const p1 = { x: n1.x + (w1 / 2), y: n1.y + (h1 / 2) };

            const mX = (e.clientX - state.view.x) / state.view.scale;
            const mY = (e.clientY - state.view.y) / state.view.scale;

            const line = document.getElementById('temp-drag-line');
            if (line) line.setAttribute('d', getBezierPath(p1, { x: mX, y: mY }));
        }

    }
}

function handleMouseUp(e) {
    if (!state.drag.active) return;



    if (state.drag.type === 'resize') {
        saveData();
        pushHistory();
    } else if (state.drag.type === 'node') {
        // Upon finish, we should probably snap? 
        // Or just save data. The nodes might still be moving to targets.
        // We should save the TARGETS as the new positions? 
        // Or wait?
        // Simple: Save targets. When reloading, x=targetX.
        state.nodes.forEach(n => {
            // For saving, we want the final destination.
            // If we save current x,y it might be mid-slide.
            // Better to save targetX, targetY.
            // Or update x/y to targetX/targetY immediately? No, jump.
            // Let's rely on animate() finishing.
            // Issue: if we reload page while animating?
            // It's fine.
        });
        saveData();
        pushHistory();
    } else if (state.drag.type === 'socket') {
        let target = e.target.closest('.node');
        if (e.target.classList.contains('node-socket')) target = e.target.closest('.node');

        document.getElementById('temp-drag-line')?.remove();

        if (target) {
            const toId = target.id;
            if (toId && toId !== state.drag.item) {
                const exists = state.connections.find(c =>
                    (c.from === state.drag.item && c.to === toId) ||
                    (c.from === toId && c.to === state.drag.item)
                );

                if (!exists) {
                    state.connections.push({ from: state.drag.item, to: toId });
                    saveData();
                    renderConnections();
                    pushHistory();
                }
            }
        }

        // 4. Box Select (Right Click) logic continues...
        state.drag.active = false;
        state.drag.type = null;
        container.classList.remove('panning');
    }
}

// ---------------------------
// Context Menu System
// ---------------------------
let contextMenuTarget = null; // { type: 'bg' | 'node', id: string, x: number, y: number }

function openContextMenu(x, y) {
    console.log('openContextMenu called', x, y);
    // Determine target
    // We already know it was a right click. Check what's under cursor?
    // Actually handleMouseDown didn't check target for box select?
    // We can check document.elementFromPoint(x, y)

    // Close existing
    closeContextMenu();

    const el = document.elementFromPoint(x, y);
    const nodeEl = el?.closest('.node');

    const menu = nodeEl ? document.getElementById('node-context-menu') : document.getElementById('context-menu');

    if (!menu) return;

    // Set Context State
    contextMenuTarget = {
        type: nodeEl ? 'node' : 'bg',
        id: nodeEl ? nodeEl.id : null,
        x: (x - state.view.x) / state.view.scale, // World Coords
        y: (y - state.view.y) / state.view.scale
    };

    // Position Menu
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'flex';
}

function closeContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
    document.getElementById('node-context-menu').style.display = 'none';
    contextMenuTarget = null;
}

// ---------------------------
// Global Color Picker Logic
// ---------------------------
let activeColorNodeId = null;

window.openColorPicker = function (e, nodeId) {
    if (!nodeId) return;

    // Close other menus
    closeContextMenu();

    activeColorNodeId = nodeId;
    const picker = document.getElementById('color-picker');
    if (!picker) return;

    // Position near mouse
    picker.style.left = `${e.clientX}px`;
    picker.style.top = `${e.clientY + 10}px`;
    picker.style.display = 'grid'; // It uses grid layout

    // Auto-close on outside click (handled by context menu global listener? No, add one)
};

window.handleColorPick = function (color) {
    if (activeColorNodeId) {
        setNodeColor(activeColorNodeId, color);
    }
    document.getElementById('color-picker').style.display = 'none';
    activeColorNodeId = null;
};

// Update global click to also close color picker
window.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#color-picker') && !e.target.closest('.btn-tool')) {
        const picker = document.getElementById('color-picker');
        if (picker) picker.style.display = 'none';
    }
    if (!e.target.closest('.context-menu')) {
        closeContextMenu();
    }
});

window.handleMenuAction = (action) => {
    if (!contextMenuTarget) return;

    const { x, y, id } = contextMenuTarget;

    switch (action) {
        case 'create-note':
            createNode(x, y);
            break;
        case 'create-image':
            // Trigger file input? Or create placeholder?
            // Let's create placeholder instructions
            const note = createNode(x, y); // reuse createNode but... 
            // Ideally we want separate image logic. 
            // For now, let's just alert or create text node saying "Paste Image"
            // state.nodes[state.nodes.length-1].content = "Paste an image here..."; 
            // Better: Prompt for URL? Or just create empty text node.
            break;
        case 'centralize':
            centerView();
            break;
        case 'delete-node':
            if (id) {
                // If selection has multiple, delete all selected?
                if (state.selection.has(id) && state.selection.size > 1) {
                    deleteSelectedNodes();
                } else {
                    deleteNode(id);
                }
            }
            break;
        case 'duplicate-node':
            if (id) {
                // Implement duplicate logic?
                // Copy node data, offset x/y, push, select.
                const original = state.nodes.find(n => n.id === id);
                if (original) {
                    const clone = JSON.parse(JSON.stringify(original));
                    clone.id = 'node_' + Date.now();
                    clone.x += 20;
                    clone.y += 20;
                    state.nodes.push(clone);
                    saveData();
                    selectNode(clone.id);
                    renderNodes();
                    pushHistory();
                }
            }
            break;
    }
    closeContextMenu();
};

// ---------------------------
// Actions
// ---------------------------
function selectNode(id) {
    // If null, clear
    if (!id) {
        state.selection.clear();
    } else {
        state.selection.clear();
        state.selection.add(id);
    }
    renderNodes();
}

function setMode(mode) {
    console.log('setMode called:', mode);
    const isView = mode === 'view';
    state.isReadOnly = isView;

    // UI Updates
    const btnView = document.getElementById('btn-mode-view');
    const btnEdit = document.getElementById('btn-mode-edit');
    if (btnView && btnEdit) {
        btnView.classList.toggle('active', isView);
        btnEdit.classList.toggle('active', !isView);
    }

    // Re-render to hide/show tools
    renderNodes();
    renderConnections();

    // Canvas cursor
    if (container) {
        container.style.cursor = isView ? 'grab' : 'default';
        if (isView) container.classList.add('panning');
        else container.classList.remove('panning');
    }
}

function createNode(x, y) {
    const newNode = {
        id: 'node_' + Date.now(),
        x: x - 110,
        y: y - 60,
        content: '',
        color: 'white',
        type: 'text'
    };

    state.nodes.push(newNode);
    saveData();
    selectNode(newNode.id);
    // renderNodes called inside selectNode
    pushHistory();

    // Auto focus
    setTimeout(() => {
        const el = document.getElementById(newNode.id);
        const area = el.querySelector('textarea');
        if (area) area.focus();
    }, 50);
}

function createImageNode(src, x, y) {
    const newNode = {
        id: 'image_' + Date.now(),
        x: x - 100,
        y: y - 100,
        content: '',
        src: src,
        color: 'white',
        type: 'image'
    };
    state.nodes.push(newNode);
    saveData();
    selectNode(newNode.id);
    pushHistory();
}

// Helper to delete ALL selected
function deleteSelectedNodes() {
    if (state.selection.size === 0) return;

    if (confirm(`Delete ${state.selection.size} items ? `)) {
        state.nodes = state.nodes.filter(n => !state.selection.has(n.id));
        state.connections = state.connections.filter(c => !state.selection.has(c.from) && !state.selection.has(c.to));
        state.selection.clear();
        saveData();
        renderNodes();
        renderConnections();
        pushHistory();
    }
}

// Legacy single delete wrapper
window.deleteNode = function (id) {
    if (confirm('Delete this note?')) {
        state.nodes = state.nodes.filter(n => n.id !== id);
        state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
        state.selection.delete(id);
        saveData();
        renderNodes();
        renderConnections();
        pushHistory();
    }
}

window.setNodeColor = function (id, color) {
    const node = state.nodes.find(n => n.id === id);
    // If node is in selection, apply to all selected?
    // Good UX: apply to all selected.
    if (state.selection.has(id)) {
        state.selection.forEach(selId => {
            const n = state.nodes.find(k => k.id === selId);
            if (n) n.color = color;
        });
    } else {
        if (node) node.color = color;
    }

    saveData();
    renderNodes();
    renderConnections();
    pushHistory();
}

function deleteConnection(fromId, toId) {
    state.connections = state.connections.filter(c =>
        !(c.from === fromId && c.to === toId) &&
        !(c.from === toId && c.to === fromId)
    );
    saveData();
    renderConnections();
}

function clearBoard() {
    if (confirm('Clear entire board?')) {
        state.nodes = [];
        state.connections = [];
        state.selection.clear();
        saveData();
        renderNodes();
        renderConnections();
    }
}

function centerView() {
    const cx = window.innerWidth / 2 - 100;
    const cy = window.innerHeight / 2 - 100;
    state.view.targetX = cx;
    state.view.targetY = cy;
    state.view.targetScale = 1;
}

function createTempLine() {
    const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempLine.id = 'temp-drag-line';
    tempLine.setAttribute('class', 'connection-line');
    tempLine.setAttribute('stroke-dasharray', '10 10'); // Explicit attribute for dashes
    tempLayer.appendChild(tempLine);
}

// Assuming loadData exists elsewhere or needs to be added here.
// Adding a placeholder loadData function based on the instruction's context.
function loadData() {
    const dataNodes = localStorage.getItem('mindflow_nodes');
    if (dataNodes) {
        state.nodes = JSON.parse(dataNodes);
    }

    const dataConn = localStorage.getItem('mindflow_conn');
    if (dataConn) {
        state.connections = JSON.parse(dataConn);
    }

    // Load Tasks
    const dataTasks = localStorage.getItem('mindflow_tasks');
    if (dataTasks) {
        state.globalTasks = JSON.parse(dataTasks);
        renderGlobalTasks();
    }
}


function saveData() {
    // Save TARGET positions as the persistent X/Y to avoid saving mid-animation frame
    const dataNodes = state.nodes.map(n => ({
        ...n,
        x: n.targetX !== undefined ? n.targetX : n.x,
        y: n.targetY !== undefined ? n.targetY : n.y
    }));
    // Remove temporary runtime props if needed, but for now simple map is fine.

    localStorage.setItem('mindflow_nodes', JSON.stringify(dataNodes));
    localStorage.setItem('mindflow_conn', JSON.stringify(state.connections));
    localStorage.setItem('mindflow_tasks', JSON.stringify(state.globalTasks));
}

// ---------------------------
// Global Tasks System
// ---------------------------
function addGlobalTask(text) {
    const task = {
        id: 'gt_' + Date.now(),
        text: text,
        done: false
    };
    state.globalTasks.push(task);
    saveData();
    renderGlobalTasks();
}

function toggleGlobalTask(id) {
    const task = state.globalTasks.find(t => t.id === id);
    if (task) {
        task.done = !task.done;
        saveData();
        renderGlobalTasks();
    }
}

function deleteGlobalTask(id) {
    state.globalTasks = state.globalTasks.filter(t => t.id !== id);
    saveData();
    renderGlobalTasks();
}

function renderGlobalTasks() {
    const list = document.getElementById('global-task-list');
    if (!list) return;

    list.innerHTML = state.globalTasks.map(task => `
        <div class="global-task-item ${task.done ? 'completed' : ''}">
            <div class="g-task-checkbox ${task.done ? 'checked' : ''}" 
                 onclick="toggleGlobalTask('${task.id}')">
                 ${task.done ? '✓' : ''}
            </div>
            <div class="g-task-text">${task.text}</div>
            <div class="g-task-delete" onclick="deleteGlobalTask('${task.id}')">✕</div>
        </div>
    `).join('');
}

// ---------------------------
// Context Menu
// ---------------------------


function handleMenuAction(action, nodeId, x, y) {
    switch (action) {
        case 'delete':
            window.deleteNode(nodeId);
            break;
        case 'duplicate':
            // Logic to duplicate node
            const originalNode = state.nodes.find(n => n.id === nodeId);
            if (originalNode) {
                const duplicatedNode = { ...originalNode, id: 'node_' + Date.now(), x: originalNode.x + 20, y: originalNode.y + 20 };
                state.nodes.push(duplicatedNode);
                saveData();
                selectNode(duplicatedNode.id);
                pushHistory();
            }
            break;
        case 'create':
            createNode(x, y);
            break;
        case 'centralize':
            centerView();
            break;
    }
    closeContextMenu();
}

// ---------------------------
// History (Undo/Redo)
// ---------------------------
function pushHistory() {
    // If we are in the middle of the stack, truncate future
    if (state.historyIndex < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyIndex + 1);
    }

    const snapshot = {
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        connections: JSON.parse(JSON.stringify(state.connections))
    };

    // Prevent duplicate push if identical to last (optimization)
    const last = state.history[state.historyIndex];
    if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;

    state.history.push(snapshot);
    state.historyIndex++;

    // Limit history size?
    if (state.history.length > 50) {
        state.history.shift();
        state.historyIndex--;
    }
}

function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        restoreState(state.history[state.historyIndex]);
    }
}

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        restoreState(state.history[state.historyIndex]);
    }
}

function restoreState(snapshot) {
    state.nodes = JSON.parse(JSON.stringify(snapshot.nodes));
    state.connections = JSON.parse(JSON.stringify(snapshot.connections));
    state.selection.clear();
    saveData();
    renderNodes();
    renderConnections();
}
