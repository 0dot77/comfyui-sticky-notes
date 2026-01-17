// ComfyUI Sticky Notes Extension
// Registers with the ComfyUI extension system

const { app } = window.comfyAPI.app;

// Store all sticky notes
const stickyNotes = [];
let noteIdCounter = 0;

// Extension identifier for workflow metadata
const EXTENSION_KEY = 'stickyNotes';

// Overlay element reference
let overlay = null;

// Canvas reference for coordinate conversion
let canvasEl = null;

// Currently selected note
let selectedNoteId = null;

// Global event handlers (stored for cleanup)
let globalKeyDownHandler = null;
let globalKeyUpHandler = null;

// Available colors for sticky notes
const NOTE_COLORS = {
    yellow: { bg: '#fef3c7', text: '#92400e', name: 'Yellow' },
    pink:   { bg: '#fce7f3', text: '#9d174d', name: 'Pink' },
    blue:   { bg: '#dbeafe', text: '#1e40af', name: 'Blue' },
    green:  { bg: '#dcfce7', text: '#166534', name: 'Green' },
    gray:   { bg: '#f3f4f6', text: '#374151', name: 'Gray' }
};

const DEFAULT_COLOR = 'yellow';

// Default and minimum dimensions for notes
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 120;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;

/**
 * Simple Markdown parser for sticky notes
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, [links](url), headers, lists, blockquotes
 */
function parseMarkdown(text) {
    if (!text) return '';

    let html = text
        // Escape HTML first
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

        // Headers (must be at start of line)
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')

        // Blockquotes
        .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

        // Code blocks (triple backticks)
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')

        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')

        // Bold (** or __)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')

        // Italic (* or _)
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')

        // Strikethrough
        .replace(/~~(.+?)~~/g, '<del>$1</del>')

        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

        // Unordered lists
        .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')

        // Ordered lists
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

        // Horizontal rule
        .replace(/^---$/gm, '<hr>')

        // Line breaks (preserve newlines)
        .replace(/\n/g, '<br>');

    // Wrap consecutive <li> elements in <ul>
    html = html.replace(/(<li>.*?<\/li>)(<br>)?/g, '$1');
    html = html.replace(/((?:<li>.*?<\/li>)+)/g, '<ul>$1</ul>');

    // Clean up extra <br> around block elements
    html = html.replace(/<br>(<h[1-3]>)/g, '$1');
    html = html.replace(/(<\/h[1-3]>)<br>/g, '$1');
    html = html.replace(/<br>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<br>/g, '$1');
    html = html.replace(/<br>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<br>/g, '$1');
    html = html.replace(/<br>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<br>/g, '$1');
    html = html.replace(/<br>(<hr>)/g, '$1');
    html = html.replace(/(<hr>)<br>/g, '$1');

    return html;
}

/**
 * Render markdown content in a note
 */
function renderNoteContent(noteData) {
    const content = noteData.element.querySelector('.sticky-note-content');
    if (!content) return;

    content.innerHTML = parseMarkdown(noteData.text);
    content.classList.add('markdown-rendered');
}

/**
 * Switch note to edit mode (show raw text)
 */
function showRawContent(noteData) {
    const content = noteData.element.querySelector('.sticky-note-content');
    if (!content) return;

    content.textContent = noteData.text;
    content.classList.remove('markdown-rendered');
}

/**
 * Serialize all sticky notes to a saveable format
 * @returns {Array} Array of note data objects
 */
function serializeNotes() {
    return stickyNotes.map(note => ({
        id: note.id,
        x: note.canvasX,
        y: note.canvasY,
        width: note.width || DEFAULT_WIDTH,
        height: note.height || DEFAULT_HEIGHT,
        text: note.text,
        color: note.color,
        createdAt: note.createdAt || Date.now()
    }));
}

/**
 * Deserialize and restore notes from saved data
 * @param {Array} notesData - Array of saved note data
 */
function deserializeNotes(notesData) {
    if (!Array.isArray(notesData) || notesData.length === 0) {
        return;
    }

    for (const data of notesData) {
        // Validate required fields
        if (typeof data.x !== 'number' || typeof data.y !== 'number') {
            continue;
        }

        // Convert canvas coordinates to screen for initial placement
        const screenPos = canvasToScreen(data.x, data.y);

        // Create the note element
        createStickyNoteFromData({
            canvasX: data.x,
            canvasY: data.y,
            width: data.width || DEFAULT_WIDTH,
            height: data.height || DEFAULT_HEIGHT,
            text: data.text || 'New note...',
            color: data.color || DEFAULT_COLOR,
            createdAt: data.createdAt || Date.now()
        }, screenPos.x, screenPos.y);
    }
}

/**
 * Create a sticky note from saved data (used during deserialization)
 */
function createStickyNoteFromData(data, screenX, screenY) {
    const noteId = ++noteIdCounter;

    const note = document.createElement('div');
    note.className = 'sticky-note';
    note.dataset.noteId = noteId;

    // Header bar with drag handle, color picker, and close button
    const header = document.createElement('div');
    header.className = 'sticky-note-header';

    const dragHandle = document.createElement('div');
    dragHandle.className = 'sticky-note-drag-handle';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sticky-note-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeNote(noteId);
    });

    header.appendChild(dragHandle);
    header.appendChild(closeBtn);

    // Content area - start as non-editable
    const content = document.createElement('div');
    content.className = 'sticky-note-content';
    content.contentEditable = 'false';
    content.textContent = data.text;

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sticky-note-resize';

    note.appendChild(header);
    note.appendChild(content);
    note.appendChild(resizeHandle);

    // Position and size the note (apply current zoom scale via transform)
    const scale = app.canvas.ds.scale;
    const noteWidth = data.width || DEFAULT_WIDTH;
    const noteHeight = data.height || DEFAULT_HEIGHT;
    note.style.left = `${screenX}px`;
    note.style.top = `${screenY}px`;
    note.style.width = `${noteWidth}px`;
    note.style.minHeight = `${noteHeight}px`;
    note.style.transform = `scale(${scale})`;
    note.style.transformOrigin = 'top left';

    // Store note data with canvas coordinates
    const noteData = {
        id: noteId,
        element: note,
        canvasX: data.canvasX,
        canvasY: data.canvasY,
        width: noteWidth,
        height: noteHeight,
        text: data.text,
        color: data.color,
        createdAt: data.createdAt,
        isEditing: false
    };
    stickyNotes.push(noteData);

    // Create and add color picker
    const colorPicker = createColorPicker(noteData);
    header.insertBefore(colorPicker, closeBtn);

    // Apply the saved color
    applyNoteColor(note, data.color);

    // Set up note-specific event handlers
    setupNoteEventHandlers(noteData, header, content);

    // Set up resize handlers
    setupResizeHandlers(noteData, resizeHandle);

    overlay.appendChild(note);

    // Render markdown content
    renderNoteContent(noteData);

    return note;
}

/**
 * Clear all sticky notes (used before loading a new workflow)
 */
function clearAllNotes() {
    // Clean up handlers and remove elements
    for (const note of stickyNotes) {
        if (note.cleanupHandlers) {
            note.cleanupHandlers();
        }
        note.element.remove();
    }
    stickyNotes.length = 0;
    selectedNoteId = null;
}

/**
 * Hook into LiteGraph serialization to save notes with workflow
 */
function hookGraphSerialization() {
    const originalSerialize = LGraph.prototype.serialize;
    LGraph.prototype.serialize = function() {
        const data = originalSerialize.apply(this, arguments);

        // Add sticky notes to the workflow's extra data
        if (!data.extra) {
            data.extra = {};
        }
        data.extra[EXTENSION_KEY] = serializeNotes();

        return data;
    };
}

/**
 * Hook into ComfyUI's loadGraphData to restore notes
 */
function hookGraphLoading() {
    const originalLoadGraphData = app.loadGraphData;
    app.loadGraphData = function(graphData) {
        // Clear existing notes before loading new workflow
        clearAllNotes();

        // Call original load function
        const result = originalLoadGraphData.apply(this, arguments);

        // Restore notes from workflow data (with small delay to ensure canvas is ready)
        setTimeout(() => {
            if (graphData?.extra?.[EXTENSION_KEY]) {
                deserializeNotes(graphData.extra[EXTENSION_KEY]);
            }
        }, 100);

        return result;
    };
}

/**
 * Create the overlay layer that sits above the canvas
 */
function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'sticky-notes-overlay';
    overlay.className = 'sticky-notes-overlay';

    // Click on overlay (empty space) deselects notes
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) {
            deselectAllNotes();
        }
    });

    return overlay;
}

/**
 * Convert screen position to canvas coordinates
 * LiteGraph uses: screenPos = (canvasPos + offset) * scale
 * So: canvasPos = screenPos / scale - offset
 */
function screenToCanvas(screenX, screenY) {
    const ds = app.canvas.ds;
    const canvasX = screenX / ds.scale - ds.offset[0];
    const canvasY = screenY / ds.scale - ds.offset[1];
    return { x: canvasX, y: canvasY };
}

/**
 * Convert canvas coordinates to screen position
 * LiteGraph uses: screenPos = (canvasPos + offset) * scale
 */
function canvasToScreen(canvasX, canvasY) {
    const ds = app.canvas.ds;
    const screenX = (canvasX + ds.offset[0]) * ds.scale;
    const screenY = (canvasY + ds.offset[1]) * ds.scale;
    return { x: screenX, y: screenY };
}

/**
 * Update all sticky note positions based on current canvas transform
 */
function updateAllNotePositions() {
    const ds = app.canvas.ds;
    const scale = ds.scale;
    const offsetX = ds.offset[0];
    const offsetY = ds.offset[1];

    for (let i = 0, len = stickyNotes.length; i < len; i++) {
        const note = stickyNotes[i];
        const screenX = (note.canvasX + offsetX) * scale;
        const screenY = (note.canvasY + offsetY) * scale;
        const el = note.element;
        el.style.left = screenX + 'px';
        el.style.top = screenY + 'px';
        // Use CSS transform for uniform scaling (like ComfyUI nodes)
        el.style.transform = `scale(${scale})`;
        el.style.transformOrigin = 'top left';
    }
}

/**
 * Select a note by ID
 */
function selectNote(noteId) {
    // Deselect previous
    deselectAllNotes();

    selectedNoteId = noteId;
    const note = stickyNotes.find(n => n.id === noteId);
    if (note) {
        note.element.classList.add('selected');
    }
}

/**
 * Deselect all notes
 */
function deselectAllNotes() {
    if (selectedNoteId !== null) {
        const note = stickyNotes.find(n => n.id === selectedNoteId);
        if (note) {
            note.element.classList.remove('selected');
        }
        selectedNoteId = null;
    }
}

/**
 * Get the currently selected note
 */
function getSelectedNote() {
    if (selectedNoteId === null) return null;
    return stickyNotes.find(n => n.id === selectedNoteId) || null;
}

/**
 * Start editing a note's content
 */
function startEditing(noteData) {
    const content = noteData.element.querySelector('.sticky-note-content');
    if (!content) return;

    noteData.isEditing = true;

    // Show raw markdown text for editing
    showRawContent(noteData);

    content.contentEditable = 'true';
    content.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(content);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

/**
 * Stop editing a note's content
 */
function stopEditing(noteData) {
    if (!noteData || !noteData.isEditing) return;

    const content = noteData.element.querySelector('.sticky-note-content');
    if (!content) return;

    noteData.isEditing = false;
    content.contentEditable = 'false';

    // Remove focus
    content.blur();

    // Store the raw text
    noteData.text = content.textContent;

    // Render markdown
    renderNoteContent(noteData);
}

/**
 * Apply color to a note element
 */
function applyNoteColor(noteElement, colorKey) {
    const color = NOTE_COLORS[colorKey] || NOTE_COLORS[DEFAULT_COLOR];
    noteElement.style.setProperty('--note-bg', color.bg);
    noteElement.style.setProperty('--note-text', color.text);

    // Update active state in color picker
    const dots = noteElement.querySelectorAll('.color-dot');
    dots.forEach(dot => {
        dot.classList.toggle('active', dot.dataset.color === colorKey);
    });
}

/**
 * Change a note's color
 */
function changeNoteColor(noteData, colorKey) {
    if (!NOTE_COLORS[colorKey]) return;

    noteData.color = colorKey;
    applyNoteColor(noteData.element, colorKey);
}

/**
 * Create color picker UI
 */
function createColorPicker(noteData) {
    const picker = document.createElement('div');
    picker.className = 'sticky-note-colors';

    for (const [key, color] of Object.entries(NOTE_COLORS)) {
        const dot = document.createElement('button');
        dot.className = 'color-dot';
        dot.dataset.color = key;
        dot.style.backgroundColor = color.bg;
        dot.title = color.name;

        if (key === noteData.color) {
            dot.classList.add('active');
        }

        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            changeNoteColor(noteData, key);
        });

        picker.appendChild(dot);
    }

    return picker;
}

/**
 * Create a new sticky note at the given screen position
 */
function createStickyNote(screenX, screenY) {
    const noteId = ++noteIdCounter;

    // Convert screen position to canvas coordinates for storage
    const canvasPos = screenToCanvas(screenX, screenY);

    const note = document.createElement('div');
    note.className = 'sticky-note';
    note.dataset.noteId = noteId;

    // Header bar with drag handle, color picker, and close button
    const header = document.createElement('div');
    header.className = 'sticky-note-header';

    const dragHandle = document.createElement('div');
    dragHandle.className = 'sticky-note-drag-handle';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sticky-note-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeNote(noteId);
    });

    header.appendChild(dragHandle);
    header.appendChild(closeBtn);

    // Content area - start as non-editable
    const content = document.createElement('div');
    content.className = 'sticky-note-content';
    content.contentEditable = 'false';
    content.textContent = 'New note...';

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sticky-note-resize';

    note.appendChild(header);
    note.appendChild(content);
    note.appendChild(resizeHandle);

    // Position and size the note (apply current zoom scale via transform)
    const scale = app.canvas.ds.scale;
    note.style.left = `${screenX}px`;
    note.style.top = `${screenY}px`;
    note.style.width = `${DEFAULT_WIDTH}px`;
    note.style.minHeight = `${DEFAULT_HEIGHT}px`;
    note.style.transform = `scale(${scale})`;
    note.style.transformOrigin = 'top left';

    // Store note data with canvas coordinates
    const noteData = {
        id: noteId,
        element: note,
        canvasX: canvasPos.x,
        canvasY: canvasPos.y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        text: 'New note...',
        color: DEFAULT_COLOR,
        createdAt: Date.now(),
        isEditing: false
    };
    stickyNotes.push(noteData);

    // Create and add color picker
    const colorPicker = createColorPicker(noteData);
    header.insertBefore(colorPicker, closeBtn);

    // Apply default color
    applyNoteColor(note, DEFAULT_COLOR);

    // Set up note-specific event handlers
    setupNoteEventHandlers(noteData, header, content);

    // Set up resize handlers
    setupResizeHandlers(noteData, resizeHandle);

    overlay.appendChild(note);

    // Render markdown content (for new notes, just shows "New note...")
    renderNoteContent(noteData);

    // Select the new note but don't start editing
    selectNote(noteId);

    return note;
}

/**
 * Set up resize handlers for a note
 */
function setupResizeHandlers(noteData, resizeHandle) {
    const note = noteData.element;
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    const onMouseDown = (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = noteData.width;
        startHeight = noteData.height;

        note.classList.add('resizing');
        e.preventDefault();
        e.stopPropagation();
    };

    const onMouseMove = (e) => {
        if (!isResizing) return;

        const scale = app.canvas.ds.scale;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // Convert screen delta to canvas delta (since transform scale is applied)
        const canvasDx = dx / scale;
        const canvasDy = dy / scale;

        // Calculate new canvas dimensions with minimum limits
        const newWidth = Math.max(MIN_WIDTH, startWidth + canvasDx);
        const newHeight = Math.max(MIN_HEIGHT, startHeight + canvasDy);

        // Apply dimensions (transform handles the visual scaling)
        note.style.width = `${newWidth}px`;
        note.style.minHeight = `${newHeight}px`;

        // Store canvas dimensions
        noteData.width = newWidth;
        noteData.height = newHeight;
    };

    const onMouseUp = () => {
        if (!isResizing) return;

        isResizing = false;
        note.classList.remove('resizing');
    };

    resizeHandle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Store cleanup function
    const existingCleanup = noteData.cleanupHandlers;
    noteData.cleanupHandlers = () => {
        if (existingCleanup) existingCleanup();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };
}

/**
 * Set up event handlers for a specific note
 */
function setupNoteEventHandlers(noteData, header, content) {
    const note = noteData.element;
    const noteId = noteData.id;

    // Click to select
    note.addEventListener('mousedown', (e) => {
        // Don't interfere with close button or color dots
        if (e.target.classList.contains('sticky-note-close')) return;
        if (e.target.classList.contains('color-dot')) return;

        selectNote(noteId);
        e.stopPropagation();
    });

    // Double-click on content to edit
    content.addEventListener('dblclick', (e) => {
        startEditing(noteData);
        e.stopPropagation();
    });

    // Handle Enter key to save (Shift+Enter for newline)
    content.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            stopEditing(noteData);
        }
        // Escape to cancel editing
        if (e.key === 'Escape') {
            stopEditing(noteData);
        }
    });

    // Click outside content while editing stops editing
    content.addEventListener('blur', () => {
        // Small delay to allow for other interactions
        setTimeout(() => {
            if (noteData.isEditing) {
                stopEditing(noteData);
            }
        }, 100);
    });

    // Drag handling - only on header (excluding buttons and color picker)
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.addEventListener('mousedown', (e) => {
        // Don't start drag on interactive elements
        if (e.target.classList.contains('sticky-note-close')) return;
        if (e.target.classList.contains('color-dot')) return;
        if (e.target.classList.contains('sticky-note-colors')) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = note.offsetLeft;
        initialTop = note.offsetTop;
        note.classList.add('dragging');

        // Select the note being dragged
        selectNote(noteId);

        e.preventDefault();
        e.stopPropagation();
    });

    // Use document-level handlers that reference this note's drag state
    const onMouseMove = (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        note.style.left = `${initialLeft + dx}px`;
        note.style.top = `${initialTop + dy}px`;
    };

    const onMouseUp = () => {
        if (!isDragging) return;

        isDragging = false;
        note.classList.remove('dragging');

        // Update stored canvas position
        const newCanvasPos = screenToCanvas(note.offsetLeft, note.offsetTop);
        noteData.canvasX = newCanvasPos.x;
        noteData.canvasY = newCanvasPos.y;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Store handlers for cleanup
    noteData.cleanupHandlers = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };
}

/**
 * Remove a sticky note by ID
 */
function removeNote(noteId) {
    const index = stickyNotes.findIndex(n => n.id === noteId);
    if (index !== -1) {
        const note = stickyNotes[index];

        // Clean up event handlers
        if (note.cleanupHandlers) {
            note.cleanupHandlers();
        }

        note.element.remove();
        stickyNotes.splice(index, 1);

        // Clear selection if this was selected
        if (selectedNoteId === noteId) {
            selectedNoteId = null;
        }
    }
}

// Track if 'T' key is held down
let isTKeyHeld = false;

// Clipboard for copy/paste
let clipboardNote = null;

/**
 * Copy the selected note to clipboard
 */
function copySelectedNote() {
    const note = getSelectedNote();
    if (!note) return;

    clipboardNote = {
        width: note.width,
        height: note.height,
        text: note.text,
        color: note.color
    };
}

/**
 * Paste note from clipboard
 */
function pasteNote() {
    if (!clipboardNote) return;

    // Get current canvas center for paste position
    const ds = app.canvas.ds;
    const canvasRect = canvasEl.getBoundingClientRect();
    const centerScreenX = canvasRect.width / 2;
    const centerScreenY = canvasRect.height / 2;

    // Convert to canvas coordinates
    const canvasX = centerScreenX / ds.scale - ds.offset[0];
    const canvasY = centerScreenY / ds.scale - ds.offset[1];

    // Convert back to screen for placement
    const screenPos = canvasToScreen(canvasX, canvasY);

    // Create new note from clipboard data
    const noteId = ++noteIdCounter;

    const note = document.createElement('div');
    note.className = 'sticky-note';
    note.dataset.noteId = noteId;

    const header = document.createElement('div');
    header.className = 'sticky-note-header';

    const dragHandle = document.createElement('div');
    dragHandle.className = 'sticky-note-drag-handle';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sticky-note-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeNote(noteId);
    });

    header.appendChild(dragHandle);
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'sticky-note-content';
    content.contentEditable = 'false';
    content.textContent = clipboardNote.text;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sticky-note-resize';

    note.appendChild(header);
    note.appendChild(content);
    note.appendChild(resizeHandle);

    // Position and size
    const scale = ds.scale;
    note.style.left = `${screenPos.x}px`;
    note.style.top = `${screenPos.y}px`;
    note.style.width = `${clipboardNote.width}px`;
    note.style.minHeight = `${clipboardNote.height}px`;
    note.style.transform = `scale(${scale})`;
    note.style.transformOrigin = 'top left';

    const noteData = {
        id: noteId,
        element: note,
        canvasX: canvasX,
        canvasY: canvasY,
        width: clipboardNote.width,
        height: clipboardNote.height,
        text: clipboardNote.text,
        color: clipboardNote.color,
        createdAt: Date.now(),
        isEditing: false
    };
    stickyNotes.push(noteData);

    const colorPicker = createColorPicker(noteData);
    header.insertBefore(colorPicker, closeBtn);

    applyNoteColor(note, clipboardNote.color);
    setupNoteEventHandlers(noteData, header, content);
    setupResizeHandlers(noteData, resizeHandle);

    overlay.appendChild(note);
    renderNoteContent(noteData);
    selectNote(noteId);
}

/**
 * Duplicate the selected note (copy + paste at offset)
 */
function duplicateSelectedNote() {
    const note = getSelectedNote();
    if (!note) return;

    // Create new note with offset
    const offset = 20; // pixels offset in canvas coordinates
    const ds = app.canvas.ds;

    const canvasX = note.canvasX + offset;
    const canvasY = note.canvasY + offset;
    const screenPos = canvasToScreen(canvasX, canvasY);

    const noteId = ++noteIdCounter;

    const newNote = document.createElement('div');
    newNote.className = 'sticky-note';
    newNote.dataset.noteId = noteId;

    const header = document.createElement('div');
    header.className = 'sticky-note-header';

    const dragHandle = document.createElement('div');
    dragHandle.className = 'sticky-note-drag-handle';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sticky-note-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeNote(noteId);
    });

    header.appendChild(dragHandle);
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'sticky-note-content';
    content.contentEditable = 'false';
    content.textContent = note.text;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sticky-note-resize';

    newNote.appendChild(header);
    newNote.appendChild(content);
    newNote.appendChild(resizeHandle);

    const scale = ds.scale;
    newNote.style.left = `${screenPos.x}px`;
    newNote.style.top = `${screenPos.y}px`;
    newNote.style.width = `${note.width}px`;
    newNote.style.minHeight = `${note.height}px`;
    newNote.style.transform = `scale(${scale})`;
    newNote.style.transformOrigin = 'top left';

    const noteData = {
        id: noteId,
        element: newNote,
        canvasX: canvasX,
        canvasY: canvasY,
        width: note.width,
        height: note.height,
        text: note.text,
        color: note.color,
        createdAt: Date.now(),
        isEditing: false
    };
    stickyNotes.push(noteData);

    const colorPicker = createColorPicker(noteData);
    header.insertBefore(colorPicker, closeBtn);

    applyNoteColor(newNote, note.color);
    setupNoteEventHandlers(noteData, header, content);
    setupResizeHandlers(noteData, resizeHandle);

    overlay.appendChild(newNote);
    renderNoteContent(noteData);
    selectNote(noteId);
}

/**
 * Set up keyboard listeners
 */
function setupKeyboardListeners() {
    globalKeyDownHandler = (e) => {
        // Check if user is typing
        const activeEl = document.activeElement;
        const isTyping = activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.contentEditable === 'true'
        );

        // T key for creating notes
        if ((e.key === 't' || e.key === 'T') && !isTyping) {
            isTKeyHeld = true;
        }

        // Copy: Ctrl/Cmd + C
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isTyping && selectedNoteId !== null) {
            copySelectedNote();
            e.preventDefault();
            e.stopPropagation();
        }

        // Paste: Ctrl/Cmd + V
        if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isTyping && clipboardNote !== null) {
            pasteNote();
            e.preventDefault();
            e.stopPropagation();
        }

        // Duplicate: Ctrl/Cmd + D
        if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !isTyping && selectedNoteId !== null) {
            duplicateSelectedNote();
            e.preventDefault();
            e.stopPropagation();
        }

        // Delete or Backspace key to delete selected note
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && selectedNoteId !== null) {
            removeNote(selectedNoteId);
            e.preventDefault();
            e.stopPropagation();
        }

        // Escape to deselect
        if (e.key === 'Escape') {
            const selectedNote = getSelectedNote();
            if (selectedNote && selectedNote.isEditing) {
                stopEditing(selectedNote);
            } else {
                deselectAllNotes();
            }
        }
    };

    globalKeyUpHandler = (e) => {
        if (e.key === 't' || e.key === 'T') {
            isTKeyHeld = false;
        }
    };

    // Use capture phase to intercept events before ComfyUI handles them
    document.addEventListener('keydown', globalKeyDownHandler, true);
    document.addEventListener('keyup', globalKeyUpHandler, true);

    // Reset on window blur
    window.addEventListener('blur', () => {
        isTKeyHeld = false;
    });
}

/**
 * Set up click listener on the canvas
 * T + Click creates a new sticky note
 */
function setupClickListener(canvas) {
    canvas.addEventListener('click', (e) => {
        // Check if T key is held
        if (isTKeyHeld) {
            // Create note at click position relative to overlay
            const rect = overlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            createStickyNote(x, y);
            e.preventDefault();
            e.stopPropagation();
        }
    });
}

// Canvas tracking state
let lastOffset = [0, 0];
let lastScale = 1;
let rafId = null;

/**
 * Set up canvas pan/zoom tracking to update note positions
 */
function setupCanvasTracking() {
    function checkTransform() {
        // Only track if there are notes to update
        if (stickyNotes.length > 0 && app.canvas && app.canvas.ds) {
            const ds = app.canvas.ds;
            const offsetChanged = ds.offset[0] !== lastOffset[0] || ds.offset[1] !== lastOffset[1];
            const scaleChanged = ds.scale !== lastScale;

            if (offsetChanged || scaleChanged) {
                lastOffset[0] = ds.offset[0];
                lastOffset[1] = ds.offset[1];
                lastScale = ds.scale;
                updateAllNotePositions();
            }
        }
        rafId = requestAnimationFrame(checkTransform);
    }

    checkTransform();
}

/**
 * Wait for canvas to be ready and attach overlay
 */
function waitForCanvasAndAttach() {
    // Prevent duplicate initialization
    if (document.getElementById('sticky-notes-overlay')) {
        return;
    }

    const checkCanvas = () => {
        try {
            const canvas = document.querySelector('canvas');
            if (canvas && canvas.parentElement && app.canvas && app.canvas.ds) {
                canvasEl = canvas;

                // Create and attach overlay
                const overlayEl = createOverlay();

                // Attach to canvas parent with proper positioning
                const parent = canvas.parentElement;
                parent.style.position = 'relative';
                parent.appendChild(overlayEl);

                // Set up event listeners
                setupKeyboardListeners();
                setupClickListener(canvas);
                setupCanvasTracking();

                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    };

    // Try immediately
    if (checkCanvas()) return;

    // Otherwise poll until canvas is ready
    let attempts = 0;
    const maxAttempts = 300; // 30 seconds at 100ms intervals

    const interval = setInterval(() => {
        attempts++;
        if (checkCanvas()) {
            clearInterval(interval);
        } else if (attempts >= maxAttempts) {
            clearInterval(interval);
        }
    }, 100);
}

/**
 * Load the CSS stylesheet
 */
function loadStyles() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';

    // Get the extension's base path from the current script
    const currentScript = document.currentScript;
    let basePath = '/extensions/comfyui-sticky-notes';

    if (currentScript && currentScript.src) {
        basePath = currentScript.src.substring(0, currentScript.src.lastIndexOf('/'));
    }

    link.href = `${basePath}/style.css`;
    document.head.appendChild(link);
}

// Register the extension
app.registerExtension({
    name: "comfyui.stickyNotes",

    async setup() {
        loadStyles();

        // Hook into graph serialization/loading for persistence
        hookGraphSerialization();
        hookGraphLoading();

        waitForCanvasAndAttach();
    }
});
