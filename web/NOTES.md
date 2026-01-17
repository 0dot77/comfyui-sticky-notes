# ComfyUI Sticky Notes Extension - Technical Notes

## Extension Loading Mechanism

### How Extensions Are Discovered

ComfyUI uses two methods for loading web extensions:

1. **Built-in Extensions**: JavaScript files in `ComfyUI/web/extensions/` are served via the `/extensions` endpoint
2. **Custom Node Extensions**: Custom nodes declare a `WEB_DIRECTORY` in their Python `__init__.py`, which registers the directory in `EXTENSION_WEB_DIRS`

### Loading Flow

1. Server endpoint `GET /extensions` returns JSON array of all `.js` file paths
2. Frontend dynamically imports these as ES modules
3. Extensions call `app.registerExtension()` to hook into the ComfyUI lifecycle

### Extension Registration Pattern

```javascript
const { app } = window.comfyAPI.app;

app.registerExtension({
    name: "unique.extension.name",
    async setup() {
        // Called once when ComfyUI initializes
    },
    async nodeCreated(node) {
        // Called when a node is created
    }
});
```

### Available APIs

- `window.comfyAPI.app.app` - Main app instance
- `window.comfyAPI.api.api` - HTTP API client
- `LiteGraph` / `LGraphCanvas` - Canvas and graph manipulation (global)

---

## DOM Structure Analysis

### Main HTML Structure

```html
<body class="litegraph grid">
  <div id="vue-app">
    <!-- Vue app mounts here -->
    <!-- Top menu bar -->
    <!-- Side panels -->
    <!-- Canvas container -->
  </div>
</body>
```

### Canvas Element

- The canvas is a `<canvas>` element added dynamically by LiteGraph
- Access via `app.canvas` (LGraphCanvas instance)
- The actual canvas element: `app.canvas.canvas` or query `document.querySelector('canvas')`

### Key DOM Locations for Overlays

1. **`document.body`** - Top level, always available
2. **Canvas parent container** - Access via `app.canvas.canvas.parentElement`
3. **Vue app root** - `document.getElementById('vue-app')`

---

## Coordinate Systems

### Decision: Use Canvas Coordinates Initially

**Recommendation**: Start with **canvas coordinates** for sticky notes.

### Rationale

1. **Sticky notes should move with the graph** - When users pan/zoom, notes should follow
2. **Position relative to nodes** - Notes are typically placed near specific nodes
3. **LiteGraph handles transformations** - Canvas coordinates automatically transform via `app.canvas.ds` (drag/scale)

### Coordinate Conversion

```javascript
// Screen to Canvas
const canvasPos = app.canvas.convertEventToCanvasOffset(event);

// Canvas to Screen
const screenX = (canvasX - app.canvas.ds.offset[0]) * app.canvas.ds.scale;
const screenY = (canvasY - app.canvas.ds.offset[1]) * app.canvas.ds.scale;
```

### When to Use Screen Coordinates

- Fixed UI elements (toolbars, dialogs)
- Popups that shouldn't move with pan/zoom
- Modal overlays

---

## UI Overlay Attachment Points

### Option A: HTML Overlay Layer (Recommended for Sticky Notes)

Create a div sibling to the canvas for HTML-based sticky notes:

```javascript
const overlay = document.createElement('div');
overlay.id = 'sticky-notes-overlay';
overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: hidden;
`;
app.canvas.canvas.parentElement.appendChild(overlay);
```

**Pros**:
- Rich text editing with contenteditable
- Easy styling with CSS
- Better text rendering than canvas

**Cons**:
- Need to sync with canvas transforms manually

### Option B: Canvas Drawing (Like rgthree Labels)

Draw directly on the LiteGraph canvas using `ctx` in draw callbacks:

```javascript
LGraphCanvas.prototype.drawNode = function(node, ctx) {
    // Custom drawing here
}
```

**Pros**:
- Automatic coordinate transforms
- Consistent with node rendering

**Cons**:
- No rich text editing
- Limited styling options

### Option C: Virtual Nodes

Create custom LiteGraph node types that render as sticky notes:

```javascript
class StickyNoteNode extends LGraphNode {
    draw(ctx) {
        // Custom render
    }
}
```

**Pros**:
- Full integration with graph system
- Serialization handled by LiteGraph

**Cons**:
- More complex implementation
- Requires Python node registration for persistence

---

## Recommended Approach for Sticky Notes

1. **Use HTML overlay layer** for the sticky note UI
2. **Store positions in canvas coordinates**
3. **Transform to screen coordinates** during render using `app.canvas.ds`
4. **Listen to canvas events** (`app.canvas.onZoom`, pan events) to update positions
5. **Use `pointer-events: auto`** on individual sticky notes for interaction

### Initial Implementation Priority

1. HTML overlay attached to canvas parent
2. Canvas coordinate storage
3. Transform sync on pan/zoom
4. Later: Consider virtual node approach for better persistence

---

## File Structure

```
custom_nodes/comfyui-sticky-notes/     # Custom node package (required for loading)
├── __init__.py                        # Declares WEB_DIRECTORY
└── web/                               # Web extension directory
    ├── main.js                        # Extension entry point
    ├── style.css                      # Styles for sticky notes
    ├── NOTES.md                       # This file
    └── README.md                      # Verification guide
```

---

## Important: Extension Loading Requirement

The extension must be installed as a **custom node** to be loaded by ComfyUI.
ComfyUI only loads web extensions from:

1. `ComfyUI/web/extensions/` (built-in, inside app bundle)
2. Custom nodes that declare `WEB_DIRECTORY` in `__init__.py`

The `__init__.py` must export:
```python
WEB_DIRECTORY = "./web"
```

Without this, the extension JavaScript will not be discovered or loaded.

---

## Implementation Details: Overlay Attachment

### Where the Overlay is Attached

The sticky notes overlay is attached as a **sibling element to the canvas**, inside the canvas's parent container:

```
Canvas Parent (position: relative)
├── <canvas>              # LiteGraph canvas
└── #sticky-notes-overlay # Our overlay div
```

**Attachment code:**
```javascript
const canvas = document.querySelector('canvas');
const parent = canvas.parentElement;
parent.style.position = 'relative';  // Ensure positioning context
parent.appendChild(overlay);
```

### Why This Location Was Chosen

1. **Same coordinate space**: By being a sibling to the canvas with the same parent, the overlay shares the same positioning context. This makes it easy to position notes relative to what the user sees.

2. **Proper z-index stacking**: The overlay naturally sits above the canvas in DOM order, and we reinforce this with `z-index: 100`.

3. **Pointer events passthrough**: The overlay uses `pointer-events: none` so clicks pass through to the canvas below, except for individual sticky notes which have `pointer-events: auto`.

4. **No interference with ComfyUI**: We don't modify the canvas itself or any core ComfyUI elements. The overlay is purely additive.

5. **Automatic sizing**: Using `position: absolute` with `top/left: 0` and `width/height: 100%` makes the overlay automatically match the canvas container size.

### Coordinate System: Canvas Coordinates

The implementation uses **canvas coordinates** for storage, converting to/from screen coordinates for display:

```javascript
// LiteGraph coordinate formula: screenPos = (canvasPos + offset) * scale
// Screen to Canvas: canvasPos = screenPos / scale - offset
function screenToCanvas(screenX, screenY) {
    const ds = app.canvas.ds;
    return {
        x: screenX / ds.scale - ds.offset[0],
        y: screenY / ds.scale - ds.offset[1]
    };
}

// Canvas to Screen: screenPos = (canvasPos + offset) * scale
function canvasToScreen(canvasX, canvasY) {
    const ds = app.canvas.ds;
    return {
        x: (canvasX + ds.offset[0]) * ds.scale,
        y: (canvasY + ds.offset[1]) * ds.scale
    };
}
```

**Benefits**:
- Notes move with the graph when panning/zooming
- Notes stay at fixed positions relative to ComfyUI nodes
- Positions are consistent regardless of current view

### Event Handling

- **T + Click**: Creates a new sticky note at click position
- **Click on note**: Selects the note (blue outline)
- **Double-click on content**: Starts editing mode
- **Enter**: Saves text and exits editing (Shift+Enter for newline)
- **Escape**: Stops editing or deselects note
- **Delete/Backspace**: Removes selected note (when not editing)
- **Drag header**: Moves the note

---

## Interaction Implementation Details

### Selection System

- Single selection model (one note selected at a time)
- `selectedNoteId` tracks current selection
- `.selected` CSS class adds blue outline
- Clicking empty space deselects

### Text Editing (Tricky Parts)

1. **Double-click to edit**: Content starts as `contentEditable="false"`, changed to `"true"` on double-click
2. **Auto-select on edit start**: When editing begins, all text is selected for easy replacement
3. **Save on blur**: Uses 100ms delay to prevent conflicts with other interactions
4. **Enter key handling**: Regular Enter saves, Shift+Enter inserts newline

### Drag System (Memory Leak Prevention)

Each note has its own drag state and event handlers:

```javascript
// Per-note handlers are stored for cleanup
noteData.cleanupHandlers = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
};
```

**Why this approach**:
- Each note's drag state is isolated (no shared `isDragging` variable)
- Handlers are removed when note is deleted
- Prevents memory leaks from orphaned event listeners

### Canvas Transform Tracking

Uses `requestAnimationFrame` loop to detect pan/zoom changes:

```javascript
function checkTransform() {
    if (ds.offset changed || ds.scale changed) {
        updateAllNotePositions();
    }
    requestAnimationFrame(checkTransform);
}
```

**Why polling instead of events**:
- LiteGraph doesn't emit reliable pan/zoom events
- RAF is efficient (only runs when browser is ready to repaint)
- Only updates positions when transform actually changes

---

## Color Management

### Available Colors

Each note can have one of 5 colors, defined in `NOTE_COLORS`:

| Key    | Background | Text Color | Name   |
|--------|------------|------------|--------|
| yellow | `#fef3c7`  | `#92400e`  | Yellow |
| pink   | `#fce7f3`  | `#9d174d`  | Pink   |
| blue   | `#dbeafe`  | `#1e40af`  | Blue   |
| green  | `#dcfce7`  | `#166534`  | Green  |
| gray   | `#f3f4f6`  | `#374151`  | Gray   |

Colors are chosen for:
- WCAG AA contrast compliance (text readable on background)
- Soft pastel backgrounds (not distracting)
- Cohesive palette that works together

### Color Storage

Each note stores its color in `noteData.color`:

```javascript
const noteData = {
    id: noteId,
    element: note,
    canvasX: canvasPos.x,
    canvasY: canvasPos.y,
    text: 'New note...',
    color: 'yellow',  // Default color
    isEditing: false
};
```

### Color Application via CSS Custom Properties

Colors are applied using CSS custom properties for clean separation:

```javascript
function applyNoteColor(noteElement, colorKey) {
    const color = NOTE_COLORS[colorKey];
    noteElement.style.setProperty('--note-bg', color.bg);
    noteElement.style.setProperty('--note-text', color.text);
}
```

CSS uses these variables:
```css
.sticky-note {
    --note-bg: #fef3c7;
    --note-text: #92400e;
    background: var(--note-bg);
}

.sticky-note-content {
    color: var(--note-text);
}
```

**Benefits of CSS custom properties**:
- Single source of truth for colors
- Easy to add new color themes
- Smooth color transitions with CSS

### Color Picker UI

The color picker is a row of 5 circular dots in the header:
- Each dot shows its background color
- Active color has a dark border
- Hover scales the dot slightly
- Click changes the note color immediately

---

## Persistence / Workflow Integration

### Data Model

Each sticky note is serialized with the following structure:

```javascript
{
    id: number,       // Unique identifier (auto-incremented)
    x: number,        // Canvas X coordinate
    y: number,        // Canvas Y coordinate
    text: string,     // Note content
    color: string,    // Color key: 'yellow' | 'pink' | 'blue' | 'green' | 'gray'
    createdAt: number // Unix timestamp (milliseconds)
}
```

### Workflow JSON Storage

Notes are stored in the workflow's `extra` field under the `stickyNotes` key:

```json
{
    "last_node_id": 10,
    "last_link_id": 5,
    "nodes": [...],
    "links": [...],
    "groups": [...],
    "extra": {
        "stickyNotes": [
            {
                "id": 1,
                "x": 150.5,
                "y": -200.3,
                "text": "This is a note",
                "color": "yellow",
                "createdAt": 1705512345678
            },
            {
                "id": 2,
                "x": 400,
                "y": 100,
                "text": "Another note",
                "color": "blue",
                "createdAt": 1705512400000
            }
        ]
    }
}
```

### Serialization Hooks

**Save (Serialization)**:
- Hooks into `LGraph.prototype.serialize`
- Adds `extra.stickyNotes` array to the serialized workflow
- Called automatically when workflow is saved

**Load (Deserialization)**:
- Hooks into `app.loadGraphData`
- Clears existing notes before loading new workflow
- Reads `extra.stickyNotes` from workflow data
- Recreates note elements with saved positions, text, and colors

### Graceful Failure

- If `extra.stickyNotes` is missing or empty, silently logs and continues
- Invalid notes (missing x/y coordinates) are skipped with a warning
- Default values applied for missing optional fields:
  - `text`: "New note..."
  - `color`: "yellow"
  - `createdAt`: current timestamp

### Implementation Details

```javascript
// Serialization key
const EXTENSION_KEY = 'stickyNotes';

// Serialize all notes
function serializeNotes() {
    return stickyNotes.map(note => ({
        id: note.id,
        x: note.canvasX,
        y: note.canvasY,
        text: note.text,
        color: note.color,
        createdAt: note.createdAt
    }));
}

// Hook into LGraph.prototype.serialize
const originalSerialize = LGraph.prototype.serialize;
LGraph.prototype.serialize = function() {
    const data = originalSerialize.apply(this, arguments);
    if (!data.extra) data.extra = {};
    data.extra[EXTENSION_KEY] = serializeNotes();
    return data;
};

// Hook into app.loadGraphData
const originalLoadGraphData = app.loadGraphData;
app.loadGraphData = function(graphData) {
    clearAllNotes();
    const result = originalLoadGraphData.apply(this, arguments);
    if (graphData?.extra?.[EXTENSION_KEY]) {
        deserializeNotes(graphData.extra[EXTENSION_KEY]);
    }
    return result;
};
```

---

## Markdown Support

### Supported Syntax

The sticky notes support a subset of Markdown for rich text formatting:

| Syntax | Result |
|--------|--------|
| `**bold**` or `__bold__` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `` `inline code` `` | `inline code` |
| `[link text](url)` | clickable link |
| `# Header 1` | Large header |
| `## Header 2` | Medium header |
| `### Header 3` | Small header |
| `- item` or `* item` | Bullet list |
| `1. item` | Numbered list |
| `> quote` | Blockquote |
| `---` | Horizontal rule |
| ` ``` code ``` ` | Code block |

### How It Works

1. **Edit Mode**: Double-click to edit → shows raw Markdown text
2. **View Mode**: Press Enter or click outside → renders formatted Markdown

### Implementation

The markdown parser is a lightweight regex-based implementation:

```javascript
function parseMarkdown(text) {
    let html = text
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

        // Headers
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')

        // Code blocks
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')

        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')

        // Bold & Italic
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')

        // ... more patterns

    return html;
}
```

### Edit/View Toggle

```javascript
// Start editing - show raw text
function startEditing(noteData) {
    showRawContent(noteData);  // Display raw markdown
    content.contentEditable = 'true';
}

// Stop editing - render markdown
function stopEditing(noteData) {
    noteData.text = content.textContent;  // Save raw text
    renderNoteContent(noteData);  // Render to HTML
}
```

### CSS Styling

Markdown elements are styled with the `.markdown-rendered` class:

```css
.sticky-note-content.markdown-rendered h1 { font-size: 1.3em; }
.sticky-note-content.markdown-rendered code {
    background: rgba(0, 0, 0, 0.08);
    padding: 0.15em 0.4em;
}
.sticky-note-content.markdown-rendered a {
    color: #2563eb;
    text-decoration: underline;
}
```

---

## 배포 가이드 (Deployment Guide)

### 1. 사전 준비

#### 필수 파일 구조
```
comfyui-sticky-notes/
├── __init__.py          # ComfyUI 커스텀 노드 진입점
└── web/
    ├── main.js          # 확장 기능 메인 코드
    ├── style.css        # 스타일시트
    ├── README.md        # 사용자 가이드
    └── NOTES.md         # 기술 문서 (이 파일)
```

#### `__init__.py` 내용 확인
```python
# ComfyUI Sticky Notes Extension
WEB_DIRECTORY = "./web"
```

---

### 2. 배포 방법

#### 방법 A: GitHub 저장소로 배포 (권장)

1. **GitHub 저장소 생성**
   ```bash
   cd comfyui-sticky-notes
   git init
   git add .
   git commit -m "Initial release: ComfyUI Sticky Notes Extension"
   ```

2. **GitHub에 푸시**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/comfyui-sticky-notes.git
   git branch -M main
   git push -u origin main
   ```

3. **사용자 설치 방법**
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/YOUR_USERNAME/comfyui-sticky-notes.git
   ```

#### 방법 B: ComfyUI Manager 등록

1. **custom-node-list.json에 등록 요청**
   - ComfyUI-Manager 저장소에 PR 제출
   - https://github.com/ltdrdata/ComfyUI-Manager

2. **등록 정보 형식**
   ```json
   {
       "title": "ComfyUI Sticky Notes",
       "reference": "https://github.com/YOUR_USERNAME/comfyui-sticky-notes",
       "files": ["https://github.com/YOUR_USERNAME/comfyui-sticky-notes"],
       "install_type": "git-clone",
       "description": "Figma/Miro 스타일의 스티키 노트 확장. 마크다운 지원, 색상 변경, 워크플로우 저장 가능."
   }
   ```

#### 방법 C: ZIP 파일 배포

1. **폴더를 ZIP으로 압축**
   ```bash
   zip -r comfyui-sticky-notes.zip comfyui-sticky-notes/
   ```

2. **사용자 설치 방법**
   - ZIP 파일 다운로드
   - `ComfyUI/custom_nodes/` 폴더에 압축 해제
   - ComfyUI 재시작

---

### 3. 릴리즈 체크리스트

#### 코드 품질
- [ ] 콘솔에 불필요한 로그 제거 (또는 조건부 로깅)
- [ ] 에러 핸들링 확인
- [ ] 메모리 누수 방지 (이벤트 리스너 정리)

#### 문서화
- [ ] README.md 작성 (설치 방법, 사용법, 단축키)
- [ ] 스크린샷/GIF 추가
- [ ] 라이선스 파일 추가 (MIT 권장)

#### 테스트
- [ ] 새 워크플로우에서 노트 생성 테스트
- [ ] 워크플로우 저장/로드 테스트
- [ ] 브라우저 새로고침 후 정상 동작 확인
- [ ] 다른 확장과 충돌 여부 확인

---

### 4. 버전 관리

#### 시맨틱 버저닝 (Semantic Versioning)
- `1.0.0` - 첫 안정 릴리즈
- `1.1.0` - 새 기능 추가 (하위 호환)
- `1.0.1` - 버그 수정

#### CHANGELOG.md 예시
```markdown
## [1.0.0] - 2024-01-17
### 추가됨
- 스티키 노트 생성 (T + 클릭)
- 마크다운 지원 (굵게, 기울임, 코드, 링크 등)
- 5가지 색상 선택
- 크기 조절 기능
- 워크플로우 저장/로드 지원
```

---

### 5. 라이선스

#### MIT 라이선스 권장 (LICENSE 파일)
```
MIT License

Copyright (c) 2024 YOUR_NAME

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### 6. 문제 해결

#### 일반적인 문제

| 문제 | 원인 | 해결 방법 |
|------|------|----------|
| 노트가 안 보임 | CSS 로드 실패 | 브라우저 개발자 도구에서 네트워크 탭 확인 |
| T+클릭이 안 됨 | 다른 확장과 충돌 | 다른 확장 비활성화 후 테스트 |
| 저장이 안 됨 | `__init__.py` 누락 | `WEB_DIRECTORY = "./web"` 확인 |
| 로드 시 노트 없음 | 워크플로우에 `extra` 필드 없음 | 노트 생성 후 다시 저장 |

#### 디버깅
```javascript
// 브라우저 콘솔에서 확인
console.log(stickyNotes);  // 현재 노트 목록
console.log(app.canvas.ds);  // 캔버스 변환 상태
```
