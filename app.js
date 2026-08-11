
        // Global variables exposed for onclick handlers
        let currentMode = 'multi'; 
        let activeTab = 'html';    

        let isInspectActive = false;
        let globalSourceMap = {};

        let currentBlobUrl = null;
        let activeAiLayer = 'html'; // Current Selected Layer in AI Panel: 'html' | 'css' | 'js'

        let selectedElementState = {
            devId: null,
            tagName: '',
            id: '',
            classes: [],
            inlineEvents: [],
            htmlRange: null,
            cssMatches: [],
            jsMatches: []
        };

        let selectedSourceState = null;
        let pendingAiReplacement = null;

        // ===== Incremental Generic Project File System =====
        let activeProjectFile = null;
        let projectFiles = {};
        let projectName = 'Dev Edtr Project';
        const CORE_PROJECT_FILES = ['index.html', 'style.css', 'script.js'];
        const PROJECT_EXTENSIONS = new Set(['html','css','js','mjs','json','env','md','txt','csv','xml','svg','yaml','yml']);
        const BINARY_EXTENSIONS = new Set(['png','jpg','jpeg','gif','webp','ico','woff','woff2','ttf','otf','mp3','mp4','webm','pdf','zip']);

        function normalizeProjectFileValue(value) {
            if (typeof value === 'string') return { content: value, encoding: 'utf8' };
            if (value && typeof value === 'object' && typeof value.content === 'string') {
                return { content: value.content, encoding: value.encoding || 'utf8' };
            }
            return { content: '', encoding: 'utf8' };
        }

        function sanitizeProjectPath(input) {
            let path = String(input || '').trim().replace(/\\/g, '/');
            path = path.split('/').filter(part => part && part !== '.' && part !== '..').join('/');
            path = path.replace(/[<>:"|?*\x00-\x1F]/g, '_');
            return path.slice(0, 240);
        }

        function getFileExtension(filename) {
            const base = String(filename).split('/').pop().toLowerCase();
            if (base === '.env' || base.startsWith('.env.')) return 'env';
            const dot = base.lastIndexOf('.');
            return dot > 0 ? base.slice(dot + 1) : '';
        }

        function getFileType(filename) {
            const ext = getFileExtension(filename);
            const map = {
                html:['fa-brands fa-html5','text-orange-500'], css:['fa-brands fa-css3-alt','text-blue-400'],
                js:['fa-brands fa-js','text-yellow-400'], mjs:['fa-brands fa-js','text-yellow-400'],
                json:['fa-solid fa-brackets-curly','text-amber-500'], env:['fa-solid fa-key','text-emerald-500'],
                md:['fa-brands fa-markdown','text-gray-500'], txt:['fa-solid fa-file-lines','text-gray-500'],
                csv:['fa-solid fa-table','text-green-500'], xml:['fa-solid fa-code','text-orange-400'],
                svg:['fa-solid fa-vector-square','text-purple-500'], yaml:['fa-solid fa-file-code','text-red-400'],
                yml:['fa-solid fa-file-code','text-red-400']
            };
            return map[ext] || ['fa-solid fa-file','text-gray-400'];
        }

        function isValidProjectFilename(filename) {
            const safe = sanitizeProjectPath(filename);
            if (!safe || safe.endsWith('/') || safe.includes('..')) return false;
            return safe.split('/').every(part => part.length <= 120);
        }

        function projectFileContent(name) {
            return normalizeProjectFileValue(projectFiles[name]).content;
        }

        function syncCoreProjectFiles() {
            projectFiles['index.html'] = { content: codeStore.html || '', encoding: 'utf8' };
            projectFiles['style.css'] = { content: codeStore.css || '', encoding: 'utf8' };
            projectFiles['script.js'] = { content: codeStore.js || '', encoding: 'utf8' };
        }

        function saveProjectFiles() {
            syncCoreProjectFiles();
            try {
                localStorage.setItem('liveEditor_pro_store', JSON.stringify({
                    mode: currentMode, activeTab, store: codeStore,
                    projectFiles, projectName
                }));
            } catch (e) { console.warn('Project storage error:', e); }
            renderProjectFiles();
        }
            backupProjectToIndexedDB();
        

        function loadProjectFilesFromStore(parsed) {
            if (parsed && parsed.projectFiles && typeof parsed.projectFiles === 'object') {
                projectFiles = {};
                Object.keys(parsed.projectFiles).forEach(name => {
                    const safe = sanitizeProjectPath(name);
                    if (safe) projectFiles[safe] = normalizeProjectFileValue(parsed.projectFiles[name]);
                });
            } else {
                projectFiles = {};
            }
            projectName = (parsed && typeof parsed.projectName === 'string' && parsed.projectName.trim()) ? parsed.projectName.trim() : 'Dev Edtr Project';
            syncCoreProjectFiles();
            renderProjectFiles();
        }

        function uniqueProjectFilename(filename) {
            const safe = sanitizeProjectPath(filename);
            if (!projectFiles[safe]) return safe;
            const slash = safe.lastIndexOf('/');
            const dir = slash >= 0 ? safe.slice(0, slash + 1) : '';
            const base = slash >= 0 ? safe.slice(slash + 1) : safe;
            const dot = base.lastIndexOf('.');
            const stem = dot > 0 ? base.slice(0, dot) : base;
            const ext = dot > 0 ? base.slice(dot) : '';
            let i = 1, candidate = `${dir}${stem}-copy${ext}`;
            while (projectFiles[candidate]) candidate = `${dir}${stem}-copy-${++i}${ext}`;
            return candidate;
        }

        function validateJsonFile(filename, content) {
            if (getFileExtension(filename) !== 'json') return true;
            try { JSON.parse(content); return true; }
            catch (e) { return false; }
        }

        function showProjectFileActionMenu(filename, anchor) {
            closeProjectFileActionMenu();
            const menu = document.createElement('div');
            menu.className = 'project-file-action-menu';
            menu.id = 'project-file-action-menu';
            ['Open','Download','Rename','Duplicate','Delete'].forEach(action => {
                const b = document.createElement('button');
                b.textContent = action;
                b.onclick = () => {
                    closeProjectFileActionMenu();
                    if (action === 'Open') openProjectFile(filename);
                    if (action === 'Download') downloadProjectFile(filename);
                    if (action === 'Rename') renameProjectFile(filename);
                    if (action === 'Duplicate') duplicateProjectFile(filename);
                    if (action === 'Delete') deleteProjectFile(filename);
                };
                menu.appendChild(b);
            });
            document.body.appendChild(menu);
            const r = anchor.getBoundingClientRect();
            menu.style.left = `${Math.min(r.right - 180, window.innerWidth - 190)}px`;
            menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 250)}px`;
        }

        function closeProjectFileActionMenu() {
            const old = document.getElementById('project-file-action-menu');
            if (old) old.remove();
        }

        function renderProjectFiles() {
            const list = document.getElementById('project-files-list');
            if (!list) return;
            const query = (document.getElementById('project-files-search')?.value || '').toLowerCase().trim();
            const names = Object.keys(projectFiles).sort((a,b) => a.localeCompare(b));
            const filtered = query ? names.filter(n => n.toLowerCase().includes(query)) : names;
            list.innerHTML = '';
            if (!filtered.length) {
                list.innerHTML = '<div class="text-center text-xs text-gray-500 py-8">No files found</div>';
            }
            filtered.forEach(filename => {
                const row = document.createElement('div');
                row.className = `project-file-row ${activeProjectFile === filename ? 'active' : ''}`;
                row.title = filename;
                const [icon, color] = getFileType(filename);
                row.innerHTML = `<i class="${icon} ${color} project-file-type"></i><span class="project-file-name"></span>`;
                row.querySelector('.project-file-name').textContent = filename;
                const menuBtn = document.createElement('button');
                menuBtn.className = 'project-file-menu-btn';
                menuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
                menuBtn.setAttribute('aria-label', `Actions for ${filename}`);
                menuBtn.onclick = e => { e.stopPropagation(); showProjectFileActionMenu(filename, menuBtn); };
                row.appendChild(menuBtn);
                row.onclick = () => openProjectFile(filename);
                list.appendChild(row);
            });
            const count = names.length;
            const countEl = document.getElementById('project-file-count');
            const mobileCount = document.getElementById('mobile-file-count');
            if (countEl) countEl.textContent = `${count} file${count === 1 ? '' : 's'}`;
            if (mobileCount) mobileCount.textContent = count;
        }

        function syncActiveProjectFileFromEditor() {
            const filename = htmlCode?.dataset?.projectFile || null;
            if (!filename || CORE_PROJECT_FILES.includes(filename) || !projectFiles[filename]) return false;
            projectFiles[filename] = { content: htmlCode.value, encoding: 'utf8' };
            localStorage.setItem('dev_edtr_pro_active_file', filename);
            saveProjectFiles();
            return true;
        }

        function getEditorTabForExtension(filename) {
            const ext = getFileExtension(filename);
            if (ext === 'html') return 'html';
            if (ext === 'css') return 'css';
            if (ext === 'js' || ext === 'mjs') return 'js';
            return 'file';
        }

        function openProjectFile(filename) {
            if (!projectFiles[filename]) return;

            // Save the file currently visible in the editor before switching.
            if (htmlCode?.dataset?.projectFile && !CORE_PROJECT_FILES.includes(htmlCode.dataset.projectFile)) {
                syncActiveProjectFileFromEditor();
            } else if (htmlCode && CORE_PROJECT_FILES.includes(activeProjectFile)) {
                codeStore[activeTab] = htmlCode.value;
            }

            const contentRecord = normalizeProjectFileValue(projectFiles[filename]);
            const ext = getFileExtension(filename);

            activeProjectFile = filename;

            if (CORE_PROJECT_FILES.includes(filename)) {
                const coreTab = filename === 'index.html' ? 'html'
                    : filename === 'style.css' ? 'css'
                    : 'js';

                activeTab = coreTab;
                delete htmlCode.dataset.projectFile;
                htmlCode.value = codeStore[coreTab] || '';
                window.switchTab(coreTab);
            } else {
                // IMPORTANT: imported files are loaded directly into the editor.
                // Do not route them through the HTML/CSS/JS mode switch.
                const inferredTab = getEditorTabForExtension(filename);
                if (inferredTab !== 'file') activeTab = inferredTab;

                htmlCode.value = contentRecord.encoding === 'base64'
                    ? contentRecord.content
                    : contentRecord.content;

                htmlCode.dataset.projectFile = filename;
                updateLineNumbers();
                charCount.textContent = `${htmlCode.value.length} chars`;

                if (ext === 'env') {
                    showToast('.env files are editable, but browser storage is not secure secret storage.');
                } else if (ext === 'json' && !validateJsonFile(filename, htmlCode.value)) {
                    showToast('JSON syntax பிழை உள்ளது. Format செய்ய முயற்சிக்கவும்.', true);
                } else {
                    showToast(`${filename} opened`);
                }
            }

            renderProjectFiles();
            closeProjectFiles();
        }

        function newProjectFile() {
            const raw = prompt('New file name (example: config.json, README.md):');
            if (raw === null) return;
            const filename = sanitizeProjectPath(raw);
            if (!isValidProjectFilename(filename)) return showToast('Invalid file name.', true);
            if (projectFiles[filename]) return showToast('File already exists.', true);
            projectFiles[filename] = { content: '', encoding: 'utf8' };
            saveProjectFiles();
            openProjectFile(filename);
        }

        function renameProjectFile(oldName) {
            const raw = prompt(`Rename ${oldName} to:`, oldName);
            if (raw === null) return;
            const newName = sanitizeProjectPath(raw);
            if (!isValidProjectFilename(newName)) return showToast('Invalid file name.', true);
            if (newName === oldName) return;
            if (projectFiles[newName]) return showToast('A file with that name already exists.', true);
            if (CORE_PROJECT_FILES.includes(oldName)) {
                if (!confirm(`${oldName} is a core file. Rename it anyway?`)) return;
            }
            projectFiles[newName] = projectFiles[oldName];
            delete projectFiles[oldName];
            if (oldName === 'index.html') codeStore.html = projectFileContent(newName);
            if (oldName === 'style.css') codeStore.css = projectFileContent(newName);
            if (oldName === 'script.js') codeStore.js = projectFileContent(newName);
            if (activeProjectFile === oldName) activeProjectFile = newName;
            saveProjectFiles();
            renderProjectFiles();
        }

        function duplicateProjectFile(filename) {
            const copy = uniqueProjectFilename(filename);
            projectFiles[copy] = normalizeProjectFileValue(projectFiles[filename]);
            saveProjectFiles();
            showToast(`${copy} created`);
        }

        function deleteProjectFile(filename) {
            const core = CORE_PROJECT_FILES.includes(filename);
            const message = core ? `Delete ${filename}? This is a core project file.` : `Delete ${filename}?`;
            if (!confirm(message)) return;
            delete projectFiles[filename];
            if (filename === 'index.html') codeStore.html = '';
            if (filename === 'style.css') codeStore.css = '';
            if (filename === 'script.js') codeStore.js = '';
            if (activeProjectFile === filename) {
                activeProjectFile = null;
                window.switchTab('html');
            }
            saveProjectFiles();
            updateOutput();
            showToast(`${filename} deleted`);
        }

        function downloadProjectFile(filename) {
            const file = normalizeProjectFileValue(projectFiles[filename]);
            if (!file) return;
            const blob = file.encoding === 'base64'
                ? dataUrlToBlob(file.content)
                : new Blob([file.content], {type:'text/plain;charset=utf-8'});
            triggerBrowserDownload(blob, filename.split('/').pop() || filename);
        }

        function dataUrlToBlob(dataUrl) {
            const [meta, data] = String(dataUrl).split(',');
            const mime = (meta.match(/data:([^;]+)/) || [,'application/octet-stream'])[1];
            const bytes = atob(data || '');
            const arr = new Uint8Array(bytes.length);
            for (let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
            return new Blob([arr], {type:mime});
        }

        function triggerBrowserDownload(blob, filename) {
            const a = document.createElement('a');
            const url = URL.createObjectURL(blob);
            a.href = url; a.download = sanitizeProjectPath(filename).split('/').pop() || 'download';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        function closeProjectFiles() {
            const panel = document.getElementById('project-files-sidebar');
            const backdrop = document.getElementById('project-files-backdrop');
            if (!panel) return;
            panel.classList.remove('mobile-open');
            panel.classList.add('mobile-closed');
            backdrop?.classList.remove('open');
            document.body.classList.remove('project-files-open');
            closeProjectFileActionMenu();
        }

        function openProjectFiles() {
            const panel = document.getElementById('project-files-sidebar');
            const backdrop = document.getElementById('project-files-backdrop');
            if (!panel) return;
            panel.classList.add('mobile-open');
            panel.classList.remove('mobile-closed');
            backdrop?.classList.add('open');
            document.body.classList.add('project-files-open');
            renderProjectFiles();
        }

        function getProjectZipName() {
            const safe = sanitizeProjectPath(projectName).replace(/\//g,'-').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
            return `${safe || 'dev-edtr-project'}.zip`;
        }

        async function downloadProjectZip() {
            try {
                if (typeof JSZip === 'undefined') throw new Error('ZIP library unavailable');
                syncCoreProjectFiles();
                const zip = new JSZip();
                Object.keys(projectFiles).forEach(filename => {
                    const safe = sanitizeProjectPath(filename);
                    if (!safe) return;
                    const file = normalizeProjectFileValue(projectFiles[filename]);
                    if (file.encoding === 'base64') zip.file(safe, file.content.split(',').pop() || '', {base64:true});
                    else zip.file(safe, file.content);
                });
                const blob = await zip.generateAsync({type:'blob', compression:'DEFLATE', compressionOptions:{level:6}});
                triggerBrowserDownload(blob, getProjectZipName());
                showToast('Project ZIP உருவாக்கப்பட்டது!');
            } catch (e) {
                console.error('Project ZIP error:', e);
                showToast('Project ZIP உருவாக்க முடியவில்லை.', true);
            }
        }

        function toggleDownloadMenu(event) {
            event?.stopPropagation();
            document.getElementById('download-menu')?.classList.toggle('hidden');
        }
        function closeDownloadMenu() { document.getElementById('download-menu')?.classList.add('hidden'); }

        window.newProjectFile = newProjectFile;
        window.openProjectFiles = openProjectFiles;
        window.closeProjectFiles = closeProjectFiles;
        window.downloadProjectZip = downloadProjectZip;
        window.toggleDownloadMenu = toggleDownloadMenu;
        window.closeDownloadMenu = closeDownloadMenu;
        window.downloadProjectFile = downloadProjectFile;
        window.renameProjectFile = renameProjectFile;
        window.duplicateProjectFile = duplicateProjectFile;
        window.deleteProjectFile = deleteProjectFile;
        const codeStore = {
            html: '',
            css: '',
            js: '',
            single: ''
        };

        // இயல்புநிலை மாடல்
        let GEMINI_MODEL_NAME = "gemini-2.5-flash"; 
        
        let isAiProcessing = false;
        let debounceTimer;
        const DEBOUNCE_DELAY = 10;

        // DOM Elements
        const htmlCode = document.getElementById('html-code');
        const lineNumbers = document.getElementById('line-numbers');
        const outputFrame = document.getElementById('output-frame');
        const consoleOutput = document.getElementById('console-output');
        const consoleOutputWrapper = document.getElementById('console-output-wrapper');
        const consoleToggleIcon = document.getElementById('console-toggle-icon');
        const editorPanel = document.querySelector('.html-editor-panel');
        const outputPanel = document.querySelector('.output-panel-container');
        const panelResizer = document.getElementById('panel-resizer');
        const fullscreenButton = document.getElementById('fullscreen-btn');
        const charCount = document.getElementById('char-count');
        const toast = document.getElementById('toast');
        const deviceBtns = document.querySelectorAll('.device-btn');
        const body = document.body;
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        const dbStatus = document.getElementById('db-status');

        // --- FEATURE 1: AUTO FORMAT CODE (PRETTIER INTEGRATION) ---
        window.formatCurrentCode = function() {
            try {
                const unformatted = htmlCode.value;
                if (!unformatted.trim()) return;

                let formatted = unformatted;
                if (activeTab === 'html' || activeTab === 'single') {
                    formatted = prettier.format(unformatted, {
                        parser: "html",
                        plugins: prettierPlugins,
                        tabWidth: 4,
                        useTabs: false
                    });
                } else if (activeTab === 'css') {
                    formatted = prettier.format(unformatted, {
                        parser: "css",
                        plugins: prettierPlugins,
                        tabWidth: 4
                    });
                } else if (activeTab === 'js') {
                    formatted = prettier.format(unformatted, {
                        parser: "babel",
                        plugins: prettierPlugins,
                        tabWidth: 4
                    });
                }

                htmlCode.value = formatted;
                if (activeProjectFile && !CORE_PROJECT_FILES.includes(activeProjectFile)) {
                    projectFiles[activeProjectFile] = { content: formatted, encoding: 'utf8' };
                } else {
                    codeStore[activeTab] = formatted;
                }
                updateOutput();
                saveCodeLocal();
                showToast("கோடு வெற்றிகரமாக Format செய்யப்பட்டது!");
            } catch (err) {
                console.warn("Formatting failed:", err);
                showToast("Format செய்வதில் பிழை! Syntax-ஐ சரிபார்க்கவும்.", true);
            }
        };

        // --- PANEL RESIZER (Editor ↔ Preview drag to resize) ---
        let isResizingPanels = false;

        function initPanelResizer() {
            if (!panelResizer || !editorPanel || !outputPanel) return;

            const savedRatio = localStorage.getItem('devEdtr_splitRatio');
            if (savedRatio) {
                const ratio = parseFloat(savedRatio);
                if (ratio > 0.15 && ratio < 0.85) {
                    applySplitRatio(ratio);
                }
            }

            panelResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isResizingPanels = true;
                panelResizer.classList.add('dragging');
                body.classList.add('resizing-panels');
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizingPanels) return;
                const mainSplit = document.querySelector('.main-split');
                if (!mainSplit) return;

                const rect = mainSplit.getBoundingClientRect();
                const aiPanel = document.getElementById('ai-assistant-panel');
                const aiWidth = (aiPanel && !aiPanel.classList.contains('hidden')) ? aiPanel.offsetWidth + 8 : 0;
                const resizerWidth = 10;

                let availableWidth = rect.width - aiWidth - resizerWidth;
                let editorWidth = e.clientX - rect.left;

                const minEditor = 220;
                const minOutput = 280;
                editorWidth = Math.max(minEditor, Math.min(editorWidth, availableWidth - minOutput));

                const ratio = editorWidth / availableWidth;
                applySplitRatio(ratio);
            });

            document.addEventListener('mouseup', () => {
                if (!isResizingPanels) return;
                isResizingPanels = false;
                panelResizer.classList.remove('dragging');
                body.classList.remove('resizing-panels');

                const mainSplit = document.querySelector('.main-split');
                if (mainSplit && editorPanel) {
                    const aiPanel = document.getElementById('ai-assistant-panel');
                    const aiWidth = (aiPanel && !aiPanel.classList.contains('hidden')) ? aiPanel.offsetWidth + 8 : 0;
                    const available = mainSplit.getBoundingClientRect().width - aiWidth - 10;
                    const ratio = editorPanel.getBoundingClientRect().width / available;
                    if (ratio > 0.1 && ratio < 0.9) {
                        localStorage.setItem('devEdtr_splitRatio', ratio.toFixed(4));
                    }
                }
            });

            // Touch support
            panelResizer.addEventListener('touchstart', (e) => {
                e.preventDefault();
                isResizingPanels = true;
                panelResizer.classList.add('dragging');
                body.classList.add('resizing-panels');
            }, { passive: false });

            document.addEventListener('touchmove', (e) => {
                if (!isResizingPanels || !e.touches[0]) return;
                const mainSplit = document.querySelector('.main-split');
                if (!mainSplit) return;
                const rect = mainSplit.getBoundingClientRect();
                const aiPanel = document.getElementById('ai-assistant-panel');
                const aiWidth = (aiPanel && !aiPanel.classList.contains('hidden')) ? aiPanel.offsetWidth + 8 : 0;
                let availableWidth = rect.width - aiWidth - 10;
                let editorWidth = e.touches[0].clientX - rect.left;
                editorWidth = Math.max(220, Math.min(editorWidth, availableWidth - 280));
                applySplitRatio(editorWidth / availableWidth);
            }, { passive: false });

            document.addEventListener('touchend', () => {
                if (isResizingPanels) {
                    isResizingPanels = false;
                    panelResizer.classList.remove('dragging');
                    body.classList.remove('resizing-panels');
                }
            });
        }

        function applySplitRatio(ratio) {
            const editorPct = Math.round(ratio * 100);
            const outputPct = 100 - editorPct;
            editorPanel.style.flex = `1 1 ${editorPct}%`;
            outputPanel.style.flex = `1 1 ${outputPct}%`;
        }

        // Dynamically imported Firebase references
        let initializeApp, getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, getFirestore;

        async function initFirebase() {
            try {
                const firebaseApp = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
                const firebaseAuth = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
                const firebaseFs = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");

                initializeApp = firebaseApp.initializeApp;
                getAuth = firebaseAuth.getAuth;
                signInAnonymously = firebaseAuth.signInAnonymously;
                signInWithCustomToken = firebaseAuth.signInWithCustomToken;
                onAuthStateChanged = firebaseAuth.onAuthStateChanged;
                getFirestore = firebaseFs.getFirestore;

                const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';
                const firebaseConfig = typeof window.__firebase_config !== 'undefined' ? JSON.parse(window.__firebase_config) : null;
                const initialAuthToken = typeof window.__initial_auth_token !== 'undefined' ? window.__initial_auth_token : null;

                if (!firebaseConfig) {
                    dbStatus.textContent = 'Database Disabled';
                    dbStatus.classList.replace('bg-red-100', 'bg-gray-100');
                    dbStatus.classList.replace('text-red-600', 'text-gray-600');
                    loadCode();
                    updateOutput();
                    setDevice('desktop');
                    return;
                }

                const app = initializeApp(firebaseConfig);
                const db = getFirestore(app);
                const auth = getAuth(app);

                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }

                onAuthStateChanged(auth, (user) => {
                    if (user) {
                        dbStatus.textContent = 'Database Connected';
                        dbStatus.classList.replace('bg-red-100', 'bg-green-100');
                        dbStatus.classList.replace('text-red-600', 'text-green-600');
                    } else {
                        dbStatus.textContent = 'Database Disconnected';
                    }
                    loadCode();
                    updateOutput();
                    setDevice('desktop');
                });
            } catch (error) {
                dbStatus.textContent = 'Offline Mode';
                dbStatus.classList.replace('bg-red-100', 'bg-gray-100');
                dbStatus.classList.replace('text-red-600', 'text-gray-600');
                loadCode();
                updateOutput();
                setDevice('desktop');
            }
        }

        // --- GEMINI API KEY MANAGEMENT ---
        
        async function getAvailableGeminiModels(apiKey) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                if (!response.ok) throw new Error("Models list-ஐ பெற முடியவில்லை.");
                
                const data = await response.json();
                
                return data.models
                    .filter(m => m.name.includes('gemini') && m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''));
            } catch (error) {
                console.error("Auto fetch models error:", error);
                return [
                    "gemini-2.5-flash",
                    "gemini-3.1-flash-lite",
                    "gemini-3.5-flash",
                    "gemini-3-flash-preview"
                ];
            }
        }

        window.toggleAiPanel = function() {
            const panel = document.getElementById('ai-assistant-panel');
            panel.classList.toggle('hidden');
            loadApiKeyUI();
        };

        window.saveApiKey = function() {
            const input = document.getElementById('ai-api-key-input');
            const key = input.value.trim();
            if (!key) {
                showToast("செல்லுபடியாகும் API Key-ஐ உள்ளிடவும்!", true);
                return;
            }
            localStorage.setItem('gemini_api_key_dev_edtr', key);
            updateApiStatus(true);
            showToast("Gemini API Key சேமிக்கப்பட்டது!");
        };

        window.clearApiKey = function() {
            localStorage.removeItem('gemini_api_key_dev_edtr');
            document.getElementById('ai-api-key-input').value = '';
            updateApiStatus(false);
            showToast("Gemini API Key நீக்கப்பட்டது");
        };

        function getSavedApiKey() {
            const savedKey = localStorage.getItem('gemini_api_key_dev_edtr');
            if (savedKey && savedKey.trim()) return savedKey.trim();
            const inputEl = document.getElementById('ai-api-key-input');
            return inputEl ? inputEl.value.trim() : '';
        }

        function updateApiStatus(isSet) {
            const statusEl = document.getElementById('ai-api-status');
            if (isSet) {
                statusEl.textContent = 'Saved';
                statusEl.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/60 text-green-300';
            } else {
                statusEl.textContent = 'Not Set';
                statusEl.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/60 text-red-300';
            }
        }

        function loadApiKeyUI() {
            const key = getSavedApiKey();
            const input = document.getElementById('ai-api-key-input');
            if (key) {
                input.value = key;
                updateApiStatus(true);
            } else {
                input.value = '';
                updateApiStatus(false);
            }
        }

        window.testApiKey = async function() {
            const apiKey = getSavedApiKey() || document.getElementById('ai-api-key-input').value.trim();
            if (!apiKey) {
                showToast("முதலில் API Key-ஐ உள்ளிடவும்!", true);
                return;
            }

            const testBtn = document.getElementById('ai-test-btn');
            testBtn.disabled = true;
            testBtn.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin"></i> Checking Models...`;

            try {
                const availableModels = await getAvailableGeminiModels(apiKey);

                const customModelsToTry = [
                    "gemini-3.5-flash",        
                    "gemini-3.1-flash-lite",   
                    "gemini-2.5-flash",
                    "gemini-3-flash-preview"
                ];

                const modelsToTry = Array.from(new Set([...customModelsToTry, ...availableModels]));

                let workingModel = null;

                for (const model of modelsToTry) {
                    try {
                        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] })
                        });

                        if (response.ok) {
                            workingModel = model;
                            break;
                        }
                    } catch (e) {
                        console.warn(`Model ${model} failed, testing next...`);
                    }
                }

                if (workingModel) {
                    GEMINI_MODEL_NAME = workingModel;
                    showToast(`வெற்றி! ${workingModel} மாடல் இணைக்கப்பட்டது.`);
                    updateApiStatus(true);
                } else {
                    showToast("எந்த Gemini மாடலும் வேலை செய்யவில்லை. API Key-ஐ சரிபார்க்கவும்.", true);
                }
            } catch (err) {
                console.error("API Test Error:", err);
                showToast(`பிழை: ${err.message}`, true);
            } finally {
                testBtn.disabled = false;
                testBtn.innerHTML = `<i class="fa-solid fa-plug"></i> Test Connection`;
            }
        };

        // --- AI LAYER CONTEXT SWITCHER & DISPLAY ENGINE ---
        
        function getLayerCodeSnippet(layerType) {
            if (!selectedSourceState) return "No element selected";

            if (layerType === 'html') {
                return selectedSourceState.originalCode || "No HTML Snippet found";
            } else if (layerType === 'css') {
                if (selectedElementState.cssMatches && selectedElementState.cssMatches.length > 0) {
                    const cssSrc = currentMode === 'multi' ? codeStore.css : (codeStore.single || htmlCode.value);
                    let cssText = "";
                    selectedElementState.cssMatches.forEach((m) => {
                        cssText += cssSrc.substring(m.start, m.end) + "\n\n";
                    });
                    return cssText.trim();
                }
                return "/* No matching CSS rules found for this element */";
            } else if (layerType === 'js') {
                if (selectedElementState.jsMatches && selectedElementState.jsMatches.length > 0) {
                    const jsSrc = currentMode === 'multi' ? codeStore.js : (codeStore.single || htmlCode.value);
                    let jsText = "";
                    selectedElementState.jsMatches.forEach((m) => {
                        const lines = jsSrc.split('\n');
                        const lineIdx = lines.findIndex(l => l.includes(m.label.split(' ')[0]));
                        const blockRange = lineIdx !== -1 ? findJsBlockRange(jsSrc, lineIdx) : { start: m.start, end: m.end };
                        jsText += jsSrc.substring(blockRange.start, blockRange.end) + "\n\n";
                    });
                    return jsText.trim();
                }
                return "// No matching JS code found for this element";
            }
            return "";
        }

        function updateAiLayerDisplay() {
            const titleEl = document.getElementById('ai-layer-code-title');
            const codeEl = document.getElementById('ai-layer-code-display');
            if (!titleEl || !codeEl) return;

            ['html', 'css', 'js'].forEach(l => {
                const btn = document.getElementById(`ai-layer-tab-${l}`);
                if (btn) {
                    if (l === activeAiLayer) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            });

            titleEl.textContent = `CURRENT ${activeAiLayer.toUpperCase()}`;
            const snippet = getLayerCodeSnippet(activeAiLayer);
            codeEl.textContent = snippet;

            if (activeAiLayer === 'html') codeEl.className = "bg-gray-900 p-2 rounded text-[10px] font-mono text-orange-300 max-h-32 overflow-auto whitespace-pre-wrap border border-gray-800";
            else if (activeAiLayer === 'css') codeEl.className = "bg-gray-900 p-2 rounded text-[10px] font-mono text-blue-300 max-h-32 overflow-auto whitespace-pre-wrap border border-gray-800";
            else if (activeAiLayer === 'js') codeEl.className = "bg-gray-900 p-2 rounded text-[10px] font-mono text-yellow-300 max-h-32 overflow-auto whitespace-pre-wrap border border-gray-800";
        }

        window.switchAiLayer = function(layer) {
            activeAiLayer = layer;
            updateAiLayerDisplay();
        };

        // --- AI INSTRUCTION & DIRECT LAYER REPLACEMENT ENGINE ---
        function sanitizeAiResponse(responseText) {
            if (!responseText) return '';
            let clean = responseText.trim();
            clean = clean.replace(/^```[a-zA-Z]*\n?/i, '');
            clean = clean.replace(/\n?```$/i, '');
            return clean.trim();
        }

        window.requestAiFix = async function() {
            if (isAiProcessing) return;

            let apiKey = getSavedApiKey();
            if (!apiKey) {
                const inputKey = document.getElementById('ai-api-key-input')?.value.trim();
                if (inputKey) {
                    apiKey = inputKey;
                    localStorage.setItem('gemini_api_key_dev_edtr', apiKey);
                    updateApiStatus(true);
                }
            }

            if (!apiKey) {
                showToast("Gemini API Key இல்லை! AI Assistant panel-ல் API Key உள்ளிடவும்.", true);
                document.getElementById('ai-assistant-panel').classList.remove('hidden');
                return;
            }

            if (!selectedSourceState || !selectedSourceState.devId) {
                showToast("முதலில் Preview-ல் மாற்ற வேண்டிய element-ஐ Inspect மூலம் தேர்வு செய்யவும்.", true);
                return;
            }

            const instruction = document.getElementById('ai-instruction-input').value.trim();
            if (!instruction) {
                showToast("AI-க்கு என்ன மாற்ற வேண்டும் என்பதை டைப் செய்யவும்!", true);
                return;
            }

            const elementSelectorTag = selectedElementState.tagName ?
                (selectedElementState.tagName + (selectedElementState.id ? '#' + selectedElementState.id : '') + (selectedElementState.classes.length ? '.' + selectedElementState.classes.join('.') : '')) :
                "selected element";

            // Let normal-language requests choose the most likely layer unless the user explicitly
            // selected a layer. This makes "make this button red" / "when I click this..." work.
            const lowerInstruction = instruction.toLowerCase();
            const cssWords = /color|background|font|size|margin|padding|border|radius|shadow|width|height|display|position|align|center|flex|grid|opacity|animation|hover|red|blue|green|rounded|large|small/.test(lowerInstruction);
            const jsWords = /click|clicked|alert|hide|show|toggle|open|close|submit|fetch|api|function|event|when|after|before|console|localstorage/.test(lowerInstruction);
            const htmlWords = /text|title|heading|paragraph|content|class|id|attribute|image|link|button label|change this element/.test(lowerInstruction);
            if (cssWords && !jsWords) activeAiLayer = 'css';
            else if (jsWords && !cssWords) activeAiLayer = 'js';
            else if (htmlWords && !cssWords && !jsWords) activeAiLayer = 'html';

            updateAiLayerDisplay();
            const currentLayerCode = getLayerCodeSnippet(activeAiLayer);
            const htmlContext = getLayerCodeSnippet('html');
            const cssContext = getLayerCodeSnippet('css');
            const jsContext = getLayerCodeSnippet('js');
            const projectContext = Object.keys(projectFiles).slice(0, 40).join(', ');

            const promptText = `You are Dev Edtr Pro's senior code editor. The user talks to you like a normal assistant.
You must understand natural-language requests and make the smallest safe code change to the INSPECTED ELEMENT.

PROJECT FILES:
${projectContext || 'index.html, style.css, script.js'}

SELECTED ELEMENT:
${elementSelectorTag}
tag=${selectedElementState.tagName || 'unknown'}
id=${selectedElementState.id || 'none'}
classes=${(selectedElementState.classes || []).join(', ') || 'none'}

HTML CONTEXT:
${htmlContext}

CSS CONTEXT:
${cssContext}

JS CONTEXT:
${jsContext}

REQUEST:
${instruction}

TARGET LAYER:
${activeAiLayer.toUpperCase()}

DECISION RULES:
- "make it red/bigger/centered/rounded/beautiful/responsive" => CSS.
- "when I click/show/hide/toggle/submit/fetch/alert" => JS.
- "change text/title/image/class/id/attribute" => HTML.
- If the request mixes layers, choose the primary layer and make the smallest coordinated change only if necessary.
- Never change unrelated elements.
- Never delete existing functionality.
- Preserve IDs/classes and existing event handlers unless the request explicitly changes them.
- For CSS, keep the existing selector and return its complete rule when a matching rule exists.
- For JS, preserve existing listeners/functions and return the complete smallest relevant block.
- For HTML, return only the selected element's complete replacement.
- Do not invent libraries or dependencies.
- Keep the output syntactically valid.

OUTPUT:
Return ONLY the complete replacement code for the TARGET LAYER. No markdown fences. No explanation.`;



            

            isAiProcessing = true;
            const fixBtn = document.getElementById('ai-fix-btn');
            const fixIcon = document.getElementById('ai-fix-icon');
            const fixBtnText = document.getElementById('ai-fix-btn-text');

            fixBtn.disabled = true;
            fixIcon.className = "fa-solid fa-circle-notch animate-spin";
            fixBtnText.textContent = `AI is modifying ${activeAiLayer.toUpperCase()}...`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }]
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `HTTP ${response.status}`);
                }

                const data = await response.json();
                const rawResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                const cleanGeneratedCode = sanitizeAiResponse(rawResponseText);

                if (!cleanGeneratedCode) {
                    throw new Error("Gemini-யிடமிருந்து வெற்று குறியீடு வந்தது.");
                }
                if (cleanGeneratedCode.trim() === currentLayerCode.trim()) {
                    throw new Error("AI found no safe change for this request. Try describing the desired result a little more specifically.");
                }

                pendingAiReplacement = {
                    layer: activeAiLayer,
                    snapshot: { ...selectedSourceState },
                    elementState: { ...selectedElementState },
                    generatedCode: cleanGeneratedCode
                };

                document.getElementById('ai-preview-original').textContent = currentLayerCode;
                document.getElementById('ai-preview-modified').textContent = cleanGeneratedCode;
                
                const previewContainer = document.getElementById('ai-preview-container');
                if (previewContainer) {
                    previewContainer.classList.remove('hidden');
                    previewContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }

                showToast(`${activeAiLayer.toUpperCase()} மாற்றம் தயாராக உள்ளது! Review செய்து Apply Change அழுத்தவும்.`);
                saveAiHistoryEntry({ layer: activeAiLayer, instruction, element: elementSelectorTag });
                

            } catch (err) {
                console.error("AI Request Failed:", err);
                showToast(`AI பிழை: ${err.message}`, true);
            } finally {
                isAiProcessing = false;
                fixBtn.disabled = false;
                fixIcon.className = "fa-solid fa-wand-magic-sparkles";
                fixBtnText.textContent = "✨ Fix with AI";
            }
        };

        window.applyAiChange = function() {
            if (!pendingAiReplacement) return;

            const { layer, snapshot, elementState, generatedCode } = pendingAiReplacement;
            window.__devEdtrAiUndo = {
                html: codeStore.html, css: codeStore.css, js: codeStore.js, single: codeStore.single
            };

            if (layer === 'html') {
                if (currentMode === 'multi') {
                    const currentHtml = codeStore.html;
                    const before = currentHtml.slice(0, snapshot.range.start);
                    const after = currentHtml.slice(snapshot.range.end);
                    codeStore.html = before + generatedCode + after;
                } else {
                    const currentSingle = codeStore.single || htmlCode.value;
                    const before = currentSingle.slice(0, snapshot.range.start);
                    const after = currentSingle.slice(snapshot.range.end);
                    codeStore.single = before + generatedCode + after;
                }
            } else if (layer === 'css') {
                if (currentMode === 'multi') {
                    if (elementState.cssMatches && elementState.cssMatches.length > 0) {
                        const targetRange = elementState.cssMatches[0];
                        const currentCss = codeStore.css;
                        const before = currentCss.slice(0, targetRange.start);
                        const after = currentCss.slice(targetRange.end);
                        codeStore.css = before + generatedCode + after;
                    } else {
                        codeStore.css += `\n\n${generatedCode}`;
                    }
                } else {
                    const currentSingle = codeStore.single || htmlCode.value;
                    if (elementState.cssMatches && elementState.cssMatches.length > 0) {
                        const targetRange = elementState.cssMatches[0];
                        const before = currentSingle.slice(0, targetRange.start);
                        const after = currentSingle.slice(targetRange.end);
                        codeStore.single = before + generatedCode + after;
                    } else {
                        if (currentSingle.includes('</style>')) {
                            codeStore.single = currentSingle.replace('</style>', `${generatedCode}\n</style>`);
                        } else if (currentSingle.includes('</head>')) {
                            codeStore.single = currentSingle.replace('</head>', `<style>\n${generatedCode}\n</style>\n</head>`);
                        } else {
                            codeStore.single += `\n<style>\n${generatedCode}\n</style>`;
                        }
                    }
                }
            } else if (layer === 'js') {
                if (currentMode === 'multi') {
                    if (elementState.jsMatches && elementState.jsMatches.length > 0) {
                        const targetRange = elementState.jsMatches[0];
                        const jsSrc = codeStore.js;
                        const lines = jsSrc.split('\n');
                        const lineIdx = lines.findIndex(l => l.includes(targetRange.label.split(' ')[0]));
                        const blockRange = lineIdx !== -1 ? findJsBlockRange(jsSrc, lineIdx) : { start: targetRange.start, end: targetRange.end };
                        
                        const before = jsSrc.slice(0, blockRange.start);
                        const after = jsSrc.slice(blockRange.end);
                        codeStore.js = before + generatedCode + after;
                    } else {
                        codeStore.js += `\n\n${generatedCode}`;
                    }
                } else {
                    const currentSingle = codeStore.single || htmlCode.value;
                    if (elementState.jsMatches && elementState.jsMatches.length > 0) {
                        const targetRange = elementState.jsMatches[0];
                        const lines = currentSingle.split('\n');
                        const lineIdx = lines.findIndex(l => l.includes(targetRange.label.split(' ')[0]));
                        const blockRange = lineIdx !== -1 ? findJsBlockRange(currentSingle, lineIdx) : { start: targetRange.start, end: targetRange.end };

                        const before = currentSingle.slice(0, blockRange.start);
                        const after = currentSingle.slice(blockRange.end);
                        codeStore.single = before + generatedCode + after;
                    } else {
                        if (currentSingle.includes('</body>')) {
                            codeStore.single = currentSingle.replace('</body>', `<script>\n${generatedCode}\n<\/script>\n</body>`);
                        } else {
                            codeStore.single += `\n<script>\n${generatedCode}\n<\/script>`;
                        }
                    }
                }
            }

            htmlCode.value = codeStore[activeTab] || '';

            updateOutput();
            saveCodeLocal();

            cancelAiChange();
            showToast(`${layer.toUpperCase()} மாற்றம் வெற்றிகரமாக அப்ளை செய்யப்பட்டது!`);
        };

        window.cancelAiChange = function() {
            pendingAiReplacement = null;
            const previewContainer = document.getElementById('ai-preview-container');
            if (previewContainer) {
                previewContainer.classList.add('hidden');
            }
        };

        // --- FEATURE 4: CONSOLE AI ERROR AUTO-FIXER ENGINE ---
        window.fixConsoleErrorWithAi = async function(errorMessage) {
            let apiKey = getSavedApiKey();
            if (!apiKey) {
                showToast("Gemini API Key இல்லை! AI Assistant panel-ல் API Key உள்ளிடவும்.", true);
                document.getElementById('ai-assistant-panel').classList.remove('hidden');
                return;
            }

            const activeSource = htmlCode.value;
            const promptText = `Fix the JavaScript runtime error in this code.

RUNTIME ERROR:
${errorMessage}

CURRENT CODE (${activeTab.toUpperCase()}):
${activeSource}

Return ONLY the complete fixed code for this layer. No conversational text, no explanations, no markdown fences.`;

            showToast("AI மூலம் பிழை சரிசெய்யப்படுகிறது...");

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                const cleanCode = sanitizeAiResponse(rawText);

                if (cleanCode) {
                    htmlCode.value = cleanCode;
                    codeStore[activeTab] = cleanCode;
                    updateOutput();
                    saveCodeLocal();
                    showToast("Console பிழை AI மூலம் சரிசெய்யப்பட்டு கோடு அப்டேட் செய்யப்பட்டது!");
                }
            } catch (err) {
                console.error("Console Fix Failed:", err);
                showToast(`AI Fix பிழை: ${err.message}`, true);
            }
        };

        // --- MODE AND TAB SWITCHING ---
        window.switchMode = function(mode) {
            currentMode = mode;
            const multiBtn = document.getElementById('mode-btn-multi');
            const singleBtn = document.getElementById('mode-btn-single');
            const multiTabs = document.getElementById('multi-tabs');
            const singleTabs = document.getElementById('single-tabs');

            if (mode === 'multi') {
                if (multiBtn) multiBtn.className = "px-2.5 py-1 text-xs font-bold rounded-md transition bg-blue-600 text-white shadow-sm";
                if (singleBtn) singleBtn.className = "px-2.5 py-1 text-xs font-bold rounded-md transition text-gray-600 dark:text-gray-300 hover:text-blue-600";
                multiTabs?.classList.remove('hidden');
                singleTabs?.classList.add('hidden');
                switchTab('html');
            } else {
                if (singleBtn) singleBtn.className = "px-2.5 py-1 text-xs font-bold rounded-md transition bg-blue-600 text-white shadow-sm";
                if (multiBtn) multiBtn.className = "px-2.5 py-1 text-xs font-bold rounded-md transition text-gray-600 dark:text-gray-300 hover:text-blue-600";
                singleTabs?.classList.remove('hidden');
                multiTabs?.classList.add('hidden');
                switchTab('single');
            }
        };

        window.switchTab = function(tab) {
            if (activeProjectFile && !CORE_PROJECT_FILES.includes(activeProjectFile)) {
                projectFiles[activeProjectFile] = { content: htmlCode.value, encoding: 'utf8' };
            } else {
                codeStore[activeTab] = htmlCode.value;
            }
            activeProjectFile = tab === 'html' ? 'index.html' : tab === 'css' ? 'style.css' : tab === 'js' ? 'script.js' : null;
            activeTab = tab;

            ['html', 'css', 'js', 'single'].forEach(t => {
                const btn = document.getElementById(`tab-${t}`);
                if (btn) {
                    if (t === activeTab) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                }
            });

            if (activeTab === 'html') htmlCode.placeholder = "";
            else if (activeTab === 'css') htmlCode.placeholder = "";
            else if (activeTab === 'js') htmlCode.placeholder = "";
            else if (activeTab === 'single') htmlCode.placeholder = "";

            htmlCode.value = codeStore[activeTab] || '';
            updateOutput();
        };

        // --- RESPONSIVE EDITOR / PREVIEW DRAG RESIZER ---
        function initSplitResizer() {
            const resizer = document.getElementById('split-resizer');
            const mainSplit = document.querySelector('.main-split');
            if (!resizer || !mainSplit || !editorPanel || !outputPanel) return;

            // Mobile browsers otherwise treat the drag as page scrolling.
            resizer.style.touchAction = 'none';
            resizer.style.webkitUserSelect = 'none';
            resizer.style.userSelect = 'none';

            const DESKTOP_KEY = 'dev_edtr_split_ratio';
            const MOBILE_KEY = 'dev_edtr_mobile_split_ratio';
            const MIN_EDITOR_W = 220;
            const MIN_OUTPUT_W = 280;
            const MIN_EDITOR_H = 160;
            const MIN_OUTPUT_H = 180;
            let dragging = false;

            function isDesktop() {
                return window.innerWidth >= 1024;
            }

            function getSavedRatio(key, fallback = 0.5) {
                const value = parseFloat(localStorage.getItem(key));
                return Number.isFinite(value) ? value : fallback;
            }

            function resetResponsiveStyles() {
                editorPanel.style.flex = '';
                outputPanel.style.flex = '';
                editorPanel.style.minWidth = '';
                outputPanel.style.minWidth = '';
                editorPanel.style.minHeight = '';
                outputPanel.style.minHeight = '';
                editorPanel.style.height = '';
                outputPanel.style.height = '';
            }

            function applyDesktopRatio(ratio) {
                resetResponsiveStyles();

                const aiPanel = document.getElementById('ai-assistant-panel');
                const aiWidth = aiPanel && !aiPanel.classList.contains('hidden')
                    ? aiPanel.getBoundingClientRect().width
                    : 0;

                const gap = parseFloat(getComputedStyle(mainSplit).gap) || 0;
                const available = Math.max(
                    MIN_EDITOR_W + MIN_OUTPUT_W,
                    mainSplit.clientWidth - aiWidth - resizer.offsetWidth - (aiWidth ? gap * 2 : gap)
                );

                const minRatio = MIN_EDITOR_W / available;
                const maxRatio = 1 - (MIN_OUTPUT_W / available);
                ratio = Math.max(minRatio, Math.min(maxRatio, ratio));

                editorPanel.style.flex = `0 0 ${ratio * 100}%`;
                outputPanel.style.flex = '1 1 0';
                editorPanel.style.minWidth = MIN_EDITOR_W + 'px';
                outputPanel.style.minWidth = MIN_OUTPUT_W + 'px';
            }

            function applyMobileRatio(ratio) {
                resetResponsiveStyles();

                const gap = parseFloat(getComputedStyle(mainSplit).gap) || 0;
                const available = Math.max(
                    MIN_EDITOR_H + MIN_OUTPUT_H,
                    mainSplit.clientHeight - resizer.offsetHeight - gap * 2
                );

                const minRatio = MIN_EDITOR_H / available;
                const maxRatio = 1 - (MIN_OUTPUT_H / available);
                ratio = Math.max(minRatio, Math.min(maxRatio, ratio));

                editorPanel.style.flex = `0 0 ${ratio * 100}%`;
                outputPanel.style.flex = '1 1 0';
                editorPanel.style.minHeight = MIN_EDITOR_H + 'px';
                outputPanel.style.minHeight = MIN_OUTPUT_H + 'px';
            }

            function applySavedRatio() {
                if (isDesktop()) {
                    applyDesktopRatio(getSavedRatio(DESKTOP_KEY));
                } else {
                    applyMobileRatio(getSavedRatio(MOBILE_KEY));
                }
            }

            function move(clientX, clientY) {
                const rect = mainSplit.getBoundingClientRect();
                const gap = parseFloat(getComputedStyle(mainSplit).gap) || 0;

                if (isDesktop()) {
                    const aiPanel = document.getElementById('ai-assistant-panel');
                    const aiWidth = aiPanel && !aiPanel.classList.contains('hidden')
                        ? aiPanel.getBoundingClientRect().width
                        : 0;

                    const available = Math.max(
                        MIN_EDITOR_W + MIN_OUTPUT_W,
                        mainSplit.clientWidth - aiWidth - resizer.offsetWidth - (aiWidth ? gap * 2 : gap)
                    );

                    let editorPx = clientX - rect.left;
                    editorPx = Math.max(MIN_EDITOR_W, Math.min(available - MIN_OUTPUT_W, editorPx));
                    const ratio = editorPx / available;

                    applyDesktopRatio(ratio);
                    localStorage.setItem(DESKTOP_KEY, String(ratio));
                } else {
                    const available = Math.max(
                        MIN_EDITOR_H + MIN_OUTPUT_H,
                        mainSplit.clientHeight - resizer.offsetHeight - gap * 2
                    );

                    let editorPx = clientY - rect.top - (resizer.offsetHeight / 2);
                    editorPx = Math.max(MIN_EDITOR_H, Math.min(available - MIN_OUTPUT_H, editorPx));
                    const ratio = editorPx / available;

                    applyMobileRatio(ratio);
                    localStorage.setItem(MOBILE_KEY, String(ratio));
                }
            }

            resizer.addEventListener('pointerdown', (e) => {
                dragging = true;
                resizer.classList.add('dragging');
                document.body.classList.add('split-resizing');
                try { resizer.setPointerCapture?.(e.pointerId); } catch (_) {}
                e.preventDefault();
                e.stopPropagation();
            }, { passive: false });

            const handlePointerMove = (e) => {
                if (!dragging) return;
                e.preventDefault();
                move(e.clientX, e.clientY);
            };

            const handlePointerUp = (e) => {
                if (!dragging) return;
                dragging = false;
                resizer.classList.remove('dragging');
                document.body.classList.remove('split-resizing');
                try { resizer.releasePointerCapture?.(e.pointerId); } catch (_) {}
            };

            // Window fallback is important on mobile WebViews where pointermove
            // may leave the small resize handle while dragging.
            window.addEventListener('pointermove', handlePointerMove, { passive: false });
            window.addEventListener('pointerup', handlePointerUp, { passive: false });
            window.addEventListener('pointercancel', handlePointerUp, { passive: false });

            window.addEventListener('resize', () => {
                requestAnimationFrame(applySavedRatio);
            });

            const observer = new MutationObserver(() => {
                requestAnimationFrame(applySavedRatio);
            });

            const aiPanel = document.getElementById('ai-assistant-panel');
            if (aiPanel) {
                observer.observe(aiPanel, {
                    attributes: true,
                    attributeFilter: ['class']
                });
            }

            applySavedRatio();
        }

        // --- THEME TOGGLE LOGIC ---
        window.toggleTheme = function() {
            body.classList.toggle('dark-mode');
            const isDark = body.classList.contains('dark-mode');
            localStorage.setItem('editorTheme', isDark ? 'dark' : 'light');
            themeToggleBtn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
        };

        function loadTheme() {
            const savedTheme = localStorage.getItem('editorTheme');
            if (savedTheme === 'dark') {
                body.classList.add('dark-mode');
                themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
            } else {
                themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
            }
        }

        window.toggleInfoTooltip = function() {
            const tooltip = document.getElementById('info-tooltip');
            tooltip.classList.toggle('hidden');
        };

        // --- CONSOLE LOGIC & AI ERROR FIX BUTTON INTEGRATION ---
        window.clearConsole = function() {
            consoleOutput.innerHTML = '';
            showToast("Console Clear ஆனது.");
        };

        // Explicit mobile-safe binding; keep inline onclick as backward compatibility.
        function initConsoleToggle() {
            if (!consoleToggleBtn || consoleToggleBtn.dataset.bound === '1') return;
            consoleToggleBtn.dataset.bound = '1';
            consoleToggleBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                window.toggleConsolePanel();
            }, { passive: false });
        }

        window.toggleConsolePanel = function() {
            if (!consoleOutputWrapper) return;

            const isHidden = consoleOutputWrapper.classList.contains('console-hidden');
            if (isHidden) {
                consoleOutputWrapper.classList.remove('console-hidden');
                consoleOutputWrapper.style.height = window.innerWidth <= 767 ? '110px' : '150px';
                consoleOutputWrapper.style.minHeight = window.innerWidth <= 767 ? '110px' : '150px';
                if (consoleToggleIcon) consoleToggleIcon.className = 'fa-solid fa-angle-down';
                if (consoleToggleBtn) consoleToggleBtn.setAttribute('aria-expanded', 'true');
            } else {
                consoleOutputWrapper.classList.add('console-hidden');
                consoleOutputWrapper.style.height = '0px';
                consoleOutputWrapper.style.minHeight = '0px';
                if (consoleToggleIcon) consoleToggleIcon.className = 'fa-solid fa-angle-up';
                if (consoleToggleBtn) consoleToggleBtn.setAttribute('aria-expanded', 'false');
            }
        };

        function hijackConsole(iframe) {
            if (!iframe || !iframe.contentWindow) return;
            const consoleMethods = ['log', 'warn', 'error'];

            consoleMethods.forEach(method => {
                try {
                    iframe.contentWindow.console[method] = (...args) => {
                        const message = args.map(arg => {
                            if (typeof arg === 'object' && arg !== null) {
                                try { return JSON.stringify(arg); } catch (e) { return String(arg); }
                            }
                            return String(arg);
                        }).join(' ');

                        const line = document.createElement('div');
                        line.className = `console-${method}`;

                        if (method === 'error') {
                            const msgSpan = document.createElement('span');
                            msgSpan.textContent = `[ERROR] ${message}`;
                            
                            const aiFixBtn = document.createElement('button');
                            aiFixBtn.className = "px-1.5 py-0.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded text-[10px] font-bold transition shadow shrink-0";
                            aiFixBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Fix with AI`;
                            aiFixBtn.onclick = () => fixConsoleErrorWithAi(message);

                            line.appendChild(msgSpan);
                            line.appendChild(aiFixBtn);
                        } else {
                            line.textContent = `[${method.toUpperCase()}] ${message}`;
                        }

                        consoleOutput.appendChild(line);
                        consoleOutput.scrollTop = consoleOutput.scrollHeight;
                        console[method](...args);
                    };
                } catch (err) {
                    console.warn("Console hijacking error:", err);
                }
            });
            
            try {
                iframe.contentWindow.onerror = (message, source, lineno) => {
                    const fullErr = `${message} (Line: ${lineno})`;
                    const line = document.createElement('div');
                    line.className = 'console-error';

                    const msgSpan = document.createElement('span');
                    msgSpan.textContent = `[RUNTIME ERROR] ${fullErr}`;

                    const aiFixBtn = document.createElement('button');
                    aiFixBtn.className = "px-1.5 py-0.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded text-[10px] font-bold transition shadow shrink-0";
                    aiFixBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Fix with AI`;
                    aiFixBtn.onclick = () => fixConsoleErrorWithAi(fullErr);

                    line.appendChild(msgSpan);
                    line.appendChild(aiFixBtn);

                    consoleOutput.appendChild(line);
                    consoleOutput.scrollTop = consoleOutput.scrollHeight;
                    return true; 
                };
            } catch (err) {
                console.warn("Console onerror bind error:", err);
            }
        }

        // --- Line Number Logic ---
        function updateLineNumbers() {
            const lines = htmlCode.value.split('\n').length;
            lineNumbers.innerHTML = Array(lines).fill(0).map((_, i) => i + 1).join('<br>');
            updateRangeLimits(lines);
        }

        function syncScroll() {
            lineNumbers.scrollTop = htmlCode.scrollTop;
        }

        // --- EDITOR FUNCTIONS ---
        window.setDevice = function(mode) {
            deviceBtns.forEach(btn => btn.classList.remove('active'));

            if (mode === 'mobile') {
                outputFrame.style.width = '375px';
                outputFrame.style.height = '667px';
                outputFrame.style.marginTop = '20px';
                outputFrame.style.borderRadius = '20px';
                outputFrame.style.border = '8px solid #333';
                deviceBtns[0].classList.add('active');
            } else if (mode === 'desktop') {
                outputFrame.style.width = '100%';
                outputFrame.style.height = '100%';
                outputFrame.style.marginTop = '0';
                outputFrame.style.borderRadius = '0';
                outputFrame.style.border = 'none';
                deviceBtns[1].classList.add('active'); 
            }
        };

        window.openNewTab = function() {
            const compiledHtml = getCompiledHTML(false);
            const blob = new Blob([compiledHtml], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        };

        window.toggleFullscreen = function() {
            const isFullscreen = outputPanel.classList.toggle('fullscreen-mode');
            editorPanel.classList.toggle('hidden-editor');
            fullscreenButton.innerHTML = isFullscreen ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
        };

        // --- RAW HTML TOKENIZER & EXACT CHARACTER OFFSET PARSER ---
        function createHtmlSourceMapAndInjectedHtml(rawHtml) {
            const sourceMap = {};
            if (!rawHtml || typeof rawHtml !== 'string') {
                return { injectedHtml: rawHtml || '', sourceMap };
            }

            const VOID_TAGS = new Set([
                'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
                'link', 'meta', 'param', 'source', 'track', 'wbr'
            ]);

            let idCounter = 1;
            let pos = 0;
            const len = rawHtml.length;
            const stack = [];
            const tagInjections = [];

            while (pos < len) {
                const openAngle = rawHtml.indexOf('<', pos);
                if (openAngle === -1) break;

                if (rawHtml.startsWith('<!--', openAngle)) {
                    const commentEnd = rawHtml.indexOf('-->', openAngle + 4);
                    if (commentEnd !== -1) pos = commentEnd + 3;
                    else pos = len;
                    continue;
                }

                if (rawHtml.startsWith('<!', openAngle)) {
                    const docEnd = rawHtml.indexOf('>', openAngle + 2);
                    if (docEnd !== -1) pos = docEnd + 1;
                    else pos = len;
                    continue;
                }

                if (rawHtml.startsWith('</', openAngle)) {
                    let endAngle = openAngle + 2;
                    while (endAngle < len && rawHtml[endAngle] !== '>') endAngle++;
                    
                    if (endAngle < len) {
                        const endTagFull = rawHtml.substring(openAngle, endAngle + 1);
                        const tagNameMatch = endTagFull.match(/^<\/([a-zA-Z0-9-]+)/);
                        if (tagNameMatch) {
                            const tagName = tagNameMatch[1].toLowerCase();
                            for (let i = stack.length - 1; i >= 0; i--) {
                                if (stack[i].tagName === tagName) {
                                    const matchedNode = stack[i];
                                    matchedNode.end = endAngle + 1;
                                    sourceMap[matchedNode.id] = { start: matchedNode.start, end: matchedNode.end };
                                    stack.splice(i);
                                    break;
                                }
                            }
                        }
                        pos = endAngle + 1;
                    } else {
                        pos = len;
                    }
                    continue;
                }

                const startTagMatch = rawHtml.substring(openAngle).match(/^<([a-zA-Z0-9-]+)/);
                if (startTagMatch) {
                    const tagName = startTagMatch[1].toLowerCase();
                    const tagStartPos = openAngle;

                    let currentIdx = openAngle + 1 + tagName.length;
                    let inQuote = null;
                    let isSelfClosing = false;
                    let tagEndPos = -1;

                    while (currentIdx < len) {
                        const char = rawHtml[currentIdx];
                        if (inQuote) {
                            if (char === inQuote) inQuote = null;
                        } else {
                            if (char === '"' || char === "'") {
                                inQuote = char;
                            } else if (char === '>') {
                                tagEndPos = currentIdx;
                                if (currentIdx > 0 && rawHtml[currentIdx - 1] === '/') {
                                    isSelfClosing = true;
                                }
                                break;
                            }
                        }
                        currentIdx++;
                    }

                    if (tagEndPos !== -1) {
                        const devId = `dev-${idCounter++}`;
                        let insertIndex = tagEndPos;
                        if (isSelfClosing && rawHtml[insertIndex - 1] === '/') {
                            insertIndex = insertIndex - 1;
                        }
                        tagInjections.push({
                            insertIndex: insertIndex,
                            attrText: ` data-dev-edtr-id="${devId}"`
                        });

                        const isVoid = VOID_TAGS.has(tagName) || isSelfClosing;

                        if (isVoid) {
                            sourceMap[devId] = { start: tagStartPos, end: tagEndPos + 1 };
                        } else {
                            const node = {
                                id: devId,
                                tagName: tagName,
                                start: tagStartPos,
                                end: tagEndPos + 1
                            };
                            stack.push(node);

                            if (tagName === 'script' || tagName === 'style') {
                                const closeTagSearch = `</${tagName}>`;
                                const closeIdx = rawHtml.toLowerCase().indexOf(closeTagSearch, tagEndPos + 1);
                                if (closeIdx !== -1) {
                                    const closeTagEnd = closeIdx + closeTagSearch.length;
                                    node.end = closeTagEnd;
                                    sourceMap[devId] = { start: node.start, end: node.end };
                                    stack.pop();
                                    pos = closeTagEnd;
                                    continue;
                                } else {
                                    sourceMap[devId] = { start: node.start, end: len };
                                    stack.pop();
                                    pos = len;
                                    continue;
                                }
                            }
                        }

                        pos = tagEndPos + 1;
                        continue;
                    }
                }

                pos = openAngle + 1;
            }

            while (stack.length > 0) {
                const node = stack.pop();
                sourceMap[node.id] = { start: node.start, end: node.end };
            }

            tagInjections.sort((a, b) => b.insertIndex - a.insertIndex);
            let injectedHtml = rawHtml;
            for (const inj of tagInjections) {
                injectedHtml = injectedHtml.slice(0, inj.insertIndex) + inj.attrText + injectedHtml.slice(inj.insertIndex);
            }

            return { injectedHtml, sourceMap };
        }

        // --- CSS AND JS MATCHING & PARSING ENGINES ---
        function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function matchesCssSelector(selectorText, elementInfo) {
            const { tagName, id, classes } = elementInfo;
            if (!selectorText) return false;

            const subSelectors = selectorText.split(',');
            for (let sub of subSelectors) {
                sub = sub.trim();
                if (!sub) continue;

                const cleanSub = sub.replace(/::?[a-zA-Z0-9_-]+(\([^\)]*\))?/g, '').trim();

                if (id && cleanSub.includes('#' + id)) return true;

                for (const cls of classes) {
                    if (cls) {
                        const classRegex = new RegExp('\\.' + escapeRegExp(cls) + '($|[\\s>+~.:#\\[])');
                        if (classRegex.test(cleanSub)) return true;
                    }
                }

                if (tagName) {
                    const tagRegex = new RegExp('(^|[\\s>+~,])' + escapeRegExp(tagName) + '($|[\\s>+~.:#\\[])', 'i');
                    if (tagRegex.test(cleanSub)) return true;
                }
            }
            return false;
        }

        function findRelatedCssRules(cssText, elementInfo, baseOffset = 0) {
            const matches = [];
            if (!cssText || typeof cssText !== 'string') return matches;

            let idx = 0;
            const len = cssText.length;
            let selectorStart = 0;

            while (idx < len) {
                if (cssText.startsWith('/*', idx)) {
                    const commentEnd = cssText.indexOf('*/', idx + 2);
                    idx = commentEnd !== -1 ? commentEnd + 2 : len;
                    selectorStart = idx;
                    continue;
                }

                if (cssText[idx] === '{') {
                    const rawSelector = cssText.substring(selectorStart, idx).trim();
                    let braceCount = 1;
                    let bodyIdx = idx + 1;

                    while (bodyIdx < len && braceCount > 0) {
                        if (cssText.startsWith('/*', bodyIdx)) {
                            const cEnd = cssText.indexOf('*/', bodyIdx + 2);
                            bodyIdx = cEnd !== -1 ? cEnd + 2 : len;
                            continue;
                        }
                        if (cssText[bodyIdx] === '{') braceCount++;
                        else if (cssText[bodyIdx] === '}') braceCount--;
                        bodyIdx++;
                    }

                    const ruleEnd = bodyIdx;

                    if (rawSelector && !rawSelector.startsWith('@')) {
                        if (matchesCssSelector(rawSelector, elementInfo)) {
                            const displayLabel = rawSelector.replace(/\s+/g, ' ').slice(0, 35);
                            let startPos = selectorStart;
                            while (startPos < idx && /\s/.test(cssText[startPos])) startPos++;

                            matches.push({
                                label: displayLabel,
                                start: baseOffset + startPos,
                                end: baseOffset + ruleEnd
                            });
                        }
                    }

                    idx = bodyIdx;
                    selectorStart = idx;
                } else {
                    if (cssText[idx] === '}' || cssText[idx] === ';') {
                        selectorStart = idx + 1;
                    }
                    idx++;
                }
            }

            return matches;
        }

        function findJsBlockRange(jsText, startLineIndex) {
            if (!jsText) return null;
            const lines = jsText.split('\n');
            let startPos = 0;
            for (let i = 0; i < startLineIndex; i++) {
                startPos += lines[i].length + 1;
            }

            let braceCount = 0;
            let foundOpen = false;
            let endPos = startPos;

            for (let i = startLineIndex; i < lines.length; i++) {
                const line = lines[i];
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '{') {
                        braceCount++;
                        foundOpen = true;
                    } else if (char === '}') {
                        braceCount--;
                    }
                }
                endPos += line.length + 1;
                if (foundOpen && braceCount <= 0) break;
            }

            return {
                start: startPos,
                end: Math.min(endPos, jsText.length)
            };
        }

        function findRelatedJsRanges(jsText, elementInfo, baseOffset = 0) {
            const matches = [];
            if (!jsText || typeof jsText !== 'string') return matches;

            const { id, classes, inlineEvents } = elementInfo;
            const searchTerms = [];

            if (id) {
                searchTerms.push({ term: `'${id}'`, label: `'${id}'` });
                searchTerms.push({ term: `"${id}"`, label: `"${id}"` });
                searchTerms.push({ term: '`' + id + '`', label: `\`${id}\`` });
                searchTerms.push({ term: `#${id}`, label: `#${id}` });
                searchTerms.push({ term: id, label: id, isPlainId: true });
            }
            for (const cls of classes) {
                if (cls) {
                    searchTerms.push({ term: `'${cls}'`, label: `'${cls}'` });
                    searchTerms.push({ term: `"${cls}"`, label: `"${cls}"` });
                    searchTerms.push({ term: `.${cls}`, label: `.${cls}` });
                }
            }
            for (const fn of inlineEvents) {
                if (fn) {
                    searchTerms.push({ term: fn, label: `function ${fn}()`, isFn: true });
                }
            }

            if (searchTerms.length === 0) return matches;

            const lines = jsText.split('\n');
            let currentPos = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineStart = currentPos;
                const lineEnd = currentPos + line.length;
                currentPos += line.length + 1;

                if (!line.trim() || line.trim().startsWith('//')) continue;

                for (const st of searchTerms) {
                    if (st.isFn) {
                        const fnRegex = new RegExp('(function\\s+' + escapeRegExp(st.term) + '|' + escapeRegExp(st.term) + '\\s*=\\s*|' + escapeRegExp(st.term) + '\\s*\\()');
                        if (fnRegex.test(line)) {
                            matches.push({
                                label: `${st.label} (Line ${i + 1})`,
                                start: baseOffset + lineStart,
                                end: baseOffset + lineEnd
                            });
                            break;
                        }
                    } else if (st.isPlainId) {
                        const idRegex = new RegExp('\\b' + escapeRegExp(st.term) + '\\b');
                        if (idRegex.test(line)) {
                            matches.push({
                                label: `${st.term} (Line ${i + 1})`,
                                start: baseOffset + lineStart,
                                end: baseOffset + lineEnd
                            });
                            break;
                        }
                    } else {
                        if (line.includes(st.term)) {
                            matches.push({
                                label: `${st.label} (Line ${i + 1})`,
                                start: baseOffset + lineStart,
                                end: baseOffset + lineEnd
                            });
                            break;
                        }
                    }
                }
            }

            return matches;
        }

        function extractBlocksFromSingleHtml(singleHtml, tagName) {
            const blocks = [];
            if (!singleHtml) return blocks;

            const lower = singleHtml.toLowerCase();
            const openTag = `<${tagName}`;
            const closeTag = `</${tagName}>`;
            let pos = 0;

            while (pos < singleHtml.length) {
                const openIdx = lower.indexOf(openTag, pos);
                if (openIdx === -1) break;

                const contentStart = lower.indexOf('>', openIdx);
                if (contentStart === -1) break;

                const closeIdx = lower.indexOf(closeTag, contentStart);
                if (closeIdx === -1) break;

                const content = singleHtml.substring(contentStart + 1, closeIdx);
                blocks.push({
                    content: content,
                    startOffset: contentStart + 1
                });

                pos = closeIdx + closeTag.length;
            }

            return blocks;
        }

        function getCompiledHTML(includeInspectScript = true) {
            if (activeProjectFile && !CORE_PROJECT_FILES.includes(activeProjectFile)) {
                projectFiles[activeProjectFile] = { content: htmlCode.value, encoding: 'utf8' };
            } else {
                codeStore[activeTab] = htmlCode.value;
            }

            const inspectInjectionScript = includeInspectScript ? `
    <script>
    (function() {
        let inspectActive = false;
        let hoveredEl = null;
        let selectedEl = null;

        const hoverBox = document.createElement('div');
        hoverBox.style.position = 'absolute';
        hoverBox.style.pointerEvents = 'none';
        hoverBox.style.outline = '2px dashed #2563eb';
        hoverBox.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
        hoverBox.style.zIndex = '999999';
        hoverBox.style.transition = 'all 0.05s ease';
        hoverBox.style.display = 'none';
        document.documentElement.appendChild(hoverBox);

        const selectBox = document.createElement('div');
        selectBox.style.position = 'absolute';
        selectBox.style.pointerEvents = 'none';
        selectBox.style.outline = '3px solid #f59e0b';
        selectBox.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
        selectBox.style.zIndex = '999998';
        selectBox.style.display = 'none';
        document.documentElement.appendChild(selectBox);

        const tempHoverBox = document.createElement('div');
        tempHoverBox.style.position = 'absolute';
        tempHoverBox.style.pointerEvents = 'none';
        tempHoverBox.style.outline = '2px solid #10b981';
        tempHoverBox.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
        tempHoverBox.style.zIndex = '999999';
        tempHoverBox.style.display = 'none';
        document.documentElement.appendChild(tempHoverBox);

        function updateOverlay(el, overlayBox) {
            if (!el) { overlayBox.style.display = 'none'; return; }
            const rect = el.getBoundingClientRect();
            overlayBox.style.top = (rect.top + window.scrollY) + 'px';
            overlayBox.style.left = (rect.left + window.scrollX) + 'px';
            overlayBox.style.width = rect.width + 'px';
            overlayBox.style.height = rect.height + 'px';
            overlayBox.style.display = 'block';
        }

        function formatElementLabel(el) {
            let label = el.tagName.toLowerCase();
            if (el.id) label += '#' + el.id;
            if (el.classList && el.classList.length > 0) {
                const classes = Array.from(el.classList).slice(0, 2).join('.');
                if (classes) label += '.' + classes;
            }
            return label;
        }

        function extractElementDetails(el) {
            const inlineEvents = [];
            if (el.attributes) {
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('on')) {
                        const fnMatch = attr.value.match(/([a-zA-Z0-9_$]+)\\s*\\(/);
                        if (fnMatch) {
                            inlineEvents.push(fnMatch[1]);
                        } else if (attr.value.trim()) {
                            inlineEvents.push(attr.value.trim());
                        }
                    }
                }
            }
            return {
                tagName: el.tagName.toLowerCase(),
                id: el.id || '',
                classes: Array.from(el.classList || []),
                inlineEvents: inlineEvents
            };
        }

        function getBreadcrumbHierarchy(el) {
            const hierarchy = [];
            let curr = el;
            while (curr && curr !== document.documentElement) {
                const tag = curr.tagName ? curr.tagName.toLowerCase() : '';
                if (tag && tag !== 'html' && tag !== 'head') {
                    const devId = curr.getAttribute('data-dev-edtr-id') || curr.closest('[data-dev-edtr-id]')?.getAttribute('data-dev-edtr-id');
                    hierarchy.unshift({
                        devId: devId,
                        label: formatElementLabel(curr)
                    });
                }
                if (tag === 'body') break;
                curr = curr.parentElement;
            }
            return hierarchy;
        }

        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'DEV_EDTR_INSPECT_TOGGLE') {
                inspectActive = e.data.active;
                if (!inspectActive) {
                    hoverBox.style.display = 'none';
                    selectBox.style.display = 'none';
                    tempHoverBox.style.display = 'none';
                    hoveredEl = null;
                    selectedEl = null;
                }
            } else if (e.data && e.data.type === 'DEV_EDTR_HIGHLIGHT_BY_DEVID') {
                const devId = e.data.devId;
                const target = document.querySelector(\`[data-dev-edtr-id="\${devId}"]\`);
                if (target) {
                    selectedEl = target;
                    updateOverlay(selectedEl, selectBox);
                    tempHoverBox.style.display = 'none';
                    const hierarchy = getBreadcrumbHierarchy(selectedEl);
                    const details = extractElementDetails(selectedEl);
                    window.parent.postMessage({
                        type: 'DEV_EDTR_ELEMENT_SELECTED',
                        devId: devId,
                        tagInfo: formatElementLabel(selectedEl),
                        hierarchy: hierarchy,
                        elementDetails: details
                    }, '*');
                }
            } else if (e.data && e.data.type === 'DEV_EDTR_TEMP_HOVER_DEVID') {
                const devId = e.data.devId;
                if (devId) {
                    const target = document.querySelector(\`[data-dev-edtr-id="\${devId}"]\`);
                    if (target) updateOverlay(target, tempHoverBox);
                } else {
                    tempHoverBox.style.display = 'none';
                }
            }
        });

        document.addEventListener('mouseover', (e) => {
            if (!inspectActive) return;
            e.stopPropagation();
            if (e.target === hoverBox || e.target === selectBox || e.target === tempHoverBox || e.target === document.documentElement || e.target === document.body) return;
            hoveredEl = e.target;
            updateOverlay(hoveredEl, hoverBox);
        }, true);

        document.addEventListener('mouseout', (e) => {
            if (!inspectActive) return;
            hoverBox.style.display = 'none';
        }, true);

        document.addEventListener('click', (e) => {
            if (!inspectActive) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.target === hoverBox || e.target === selectBox || e.target === tempHoverBox) return;

            selectedEl = e.target;
            updateOverlay(selectedEl, selectBox);

            const devId = selectedEl.getAttribute('data-dev-edtr-id') || selectedEl.closest('[data-dev-edtr-id]')?.getAttribute('data-dev-edtr-id');
            const hierarchy = getBreadcrumbHierarchy(selectedEl);
            const details = extractElementDetails(selectedEl);

            window.parent.postMessage({
                type: 'DEV_EDTR_ELEMENT_SELECTED',
                devId: devId,
                tagInfo: formatElementLabel(selectedEl),
                hierarchy: hierarchy,
                elementDetails: details
            }, '*');
        }, true);

        window.addEventListener('scroll', () => {
            if (hoveredEl) updateOverlay(hoveredEl, hoverBox);
            if (selectedEl) updateOverlay(selectedEl, selectBox);
        }, true);
    })();
    <\/script>` : '';

            if (currentMode === 'single') {
                let singleSource = codeStore.single;
                if (includeInspectScript) {
                    const { injectedHtml, sourceMap } = createHtmlSourceMapAndInjectedHtml(singleSource);
                    globalSourceMap = sourceMap;

                    const lower = injectedHtml.toLowerCase();
                    if (lower.includes('</body>')) {
                        const idx = lower.lastIndexOf('</body>');
                        return injectedHtml.slice(0, idx) + inspectInjectionScript + '\n' + injectedHtml.slice(idx);
                    } else if (lower.includes('</html>')) {
                        const idx = lower.lastIndexOf('</html>');
                        return injectedHtml.slice(0, idx) + inspectInjectionScript + '\n' + injectedHtml.slice(idx);
                    } else {
                        return injectedHtml + '\n' + inspectInjectionScript;
                    }
                }
                return singleSource;
            } else {
                let htmlContent = codeStore.html;
                if (includeInspectScript) {
                    const { injectedHtml, sourceMap } = createHtmlSourceMapAndInjectedHtml(htmlContent);
                    globalSourceMap = sourceMap;
                    htmlContent = injectedHtml;
                }
                return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"><\/script>
    <style>
${codeStore.css}
    </style>
</head>
<body>
${htmlContent}
    <script>
${codeStore.js}
    <\/script>
    ${inspectInjectionScript}
</body>
</html>`;
            }
        }

        function updateOutput() {
            if (activeProjectFile && !CORE_PROJECT_FILES.includes(activeProjectFile)) {
                projectFiles[activeProjectFile] = { content: htmlCode.value, encoding: 'utf8' };
            } else {
                codeStore[activeTab] = htmlCode.value;
            }
            charCount.textContent = `${htmlCode.value.length} chars`;
            updateLineNumbers(); 

            const finalOutput = getCompiledHTML(true);
            
            if (currentBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
                currentBlobUrl = null;
            }

            const blob = new Blob([finalOutput], { type: 'text/html;charset=utf-8' });
            currentBlobUrl = URL.createObjectURL(blob);

            outputFrame.onload = () => {
                hijackConsole(outputFrame);
                if (isInspectActive && outputFrame.contentWindow) {
                    outputFrame.contentWindow.postMessage({
                        type: 'DEV_EDTR_INSPECT_TOGGLE',
                        active: true
                    }, '*');
                }
            };

            outputFrame.src = currentBlobUrl;
        }

        // --- VISUAL ELEMENT PICKER TOGGLE ---
        window.toggleInspectMode = function() {
            isInspectActive = !isInspectActive;
            const btn = document.getElementById('inspect-btn');
            const infoBar = document.getElementById('inspect-info-bar');
            
            if (isInspectActive) {
                btn.classList.add('active');
                infoBar.classList.remove('hidden');
                showToast("Inspect Mode Active! Select an element in output.");
            } else {
                btn.classList.remove('active');
                infoBar.classList.add('hidden');
                showToast("Inspect Mode Deactivated.");
            }

            if (outputFrame.contentWindow) {
                outputFrame.contentWindow.postMessage({
                    type: 'DEV_EDTR_INSPECT_TOGGLE',
                    active: isInspectActive
                }, '*');
            }
        };

        // --- RELATED CODE UI RENDERER & TAB HANDLERS ---
        function scrollEditorToOffset(offset) {
            const currentSourceCode = htmlCode.value;
            const linesBefore = currentSourceCode.substring(0, offset).split('\n').length;
            const totalLines = currentSourceCode.split('\n').length;
            if (totalLines > 0) {
                const scrollRatio = Math.max(0, (linesBefore - 1) / totalLines);
                htmlCode.scrollTop = htmlCode.scrollHeight * scrollRatio;
            }
        }

        window.clickRelatedTab = function(type) {
            const cssDropdown = document.getElementById('related-dropdown-css');
            const jsDropdown = document.getElementById('related-dropdown-js');

            if (type === 'html') {
                if (cssDropdown) cssDropdown.classList.add('hidden');
                if (jsDropdown) jsDropdown.classList.add('hidden');

                if (currentMode === 'multi' && activeTab !== 'html') {
                    switchTab('html');
                } else if (currentMode === 'single' && activeTab !== 'single') {
                    switchTab('single');
                }

                if (selectedElementState.htmlRange) {
                    const range = selectedElementState.htmlRange;
                    htmlCode.focus();
                    htmlCode.setSelectionRange(range.start, range.end);
                    scrollEditorToOffset(range.start);
                } else {
                    showToast("HTML source range கிடைக்கவில்லை", true);
                }
            } else if (type === 'css') {
                if (jsDropdown) jsDropdown.classList.add('hidden');

                const matches = selectedElementState.cssMatches || [];
                if (matches.length === 0) {
                    showToast("தொடர்புடைய CSS விதிகள் எதுவும் காணப்படவில்லை");
                    if (cssDropdown) cssDropdown.classList.add('hidden');
                    return;
                }

                if (matches.length === 1) {
                    if (cssDropdown) cssDropdown.classList.add('hidden');
                    selectCssMatch(matches[0]);
                } else {
                    if (cssDropdown) {
                        cssDropdown.classList.toggle('hidden');
                    }
                }
            } else if (type === 'js') {
                if (cssDropdown) cssDropdown.classList.add('hidden');

                const matches = selectedElementState.jsMatches || [];
                if (matches.length === 0) {
                    showToast("தொடர்புடைய JS குறிப்புகள் எதுவும் காணப்படவில்லை");
                    if (jsDropdown) jsDropdown.classList.add('hidden');
                    return;
                }

                if (matches.length === 1) {
                    if (jsDropdown) jsDropdown.classList.add('hidden');
                    selectJsMatch(matches[0]);
                } else {
                    if (jsDropdown) {
                        jsDropdown.classList.toggle('hidden');
                    }
                }
            }
        };

        window.selectCssMatch = function(match) {
            const cssDropdown = document.getElementById('related-dropdown-css');
            if (cssDropdown) cssDropdown.classList.add('hidden');

            if (currentMode === 'multi' && activeTab !== 'css') {
                switchTab('css');
            } else if (currentMode === 'single' && activeTab !== 'single') {
                switchTab('single');
            }

            htmlCode.focus();
            htmlCode.setSelectionRange(match.start, match.end);
            scrollEditorToOffset(match.start);
        };

        window.selectJsMatch = function(match) {
            const jsDropdown = document.getElementById('related-dropdown-js');
            if (jsDropdown) jsDropdown.classList.add('hidden');

            if (currentMode === 'multi' && activeTab !== 'js') {
                switchTab('js');
            } else if (currentMode === 'single' && activeTab !== 'single') {
                switchTab('single');
            }

            htmlCode.focus();
            htmlCode.setSelectionRange(match.start, match.end);
            scrollEditorToOffset(match.start);
        };

        function updateRelatedCodePanel() {
            const countCss = document.getElementById('related-count-css');
            const countJs = document.getElementById('related-count-js');
            const dropdownCss = document.getElementById('related-dropdown-css');
            const dropdownJs = document.getElementById('related-dropdown-js');

            const cssMatches = selectedElementState.cssMatches || [];
            const jsMatches = selectedElementState.jsMatches || [];

            if (countCss) countCss.textContent = cssMatches.length;
            if (countJs) countJs.textContent = jsMatches.length;

            if (dropdownCss) {
                dropdownCss.innerHTML = '';
                if (cssMatches.length > 0) {
                    cssMatches.forEach((m) => {
                        const item = document.createElement('div');
                        item.className = 'px-3 py-1.5 hover:bg-gray-700 text-blue-300 font-mono text-[11px] cursor-pointer truncate border-b border-gray-700/50 last:border-none';
                        item.textContent = m.label;
                        item.onclick = (e) => {
                            e.stopPropagation();
                            selectCssMatch(m);
                        };
                        dropdownCss.appendChild(item);
                    });
                }
            }

            if (dropdownJs) {
                dropdownJs.innerHTML = '';
                if (jsMatches.length > 0) {
                    jsMatches.forEach((m) => {
                        const item = document.createElement('div');
                        item.className = 'px-3 py-1.5 hover:bg-gray-700 text-yellow-300 font-mono text-[11px] cursor-pointer truncate border-b border-gray-700/50 last:border-none';
                        item.textContent = m.label;
                        item.onclick = (e) => {
                            e.stopPropagation();
                            selectJsMatch(m);
                        };
                        dropdownJs.appendChild(item);
                    });
                }
            }
        }

        // --- BREADCRUMB UI RENDERER & INTERACTION HANDLER ---
        function renderBreadcrumbs(hierarchy, currentDevId) {
            const container = document.getElementById('breadcrumb-container');
            if (!container) return;

            container.innerHTML = '';

            if (!hierarchy || hierarchy.length === 0) {
                container.innerHTML = `<span id="inspect-element-tag" class="text-amber-400 font-bold">none</span>`;
                return;
            }

            hierarchy.forEach((item, index) => {
                const isLast = index === hierarchy.length - 1;
                
                const btn = document.createElement('button');
                btn.className = `hover:underline cursor-pointer px-1 py-0.5 rounded text-xs font-semibold transition ${
                    isLast 
                        ? 'text-amber-400 font-bold bg-amber-400/10' 
                        : 'text-blue-300 hover:text-white hover:bg-gray-800'
                }`;
                btn.textContent = item.label;

                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (item.devId) {
                        selectElementByDevId(item.devId);
                    }
                };

                btn.onmouseenter = () => {
                    if (item.devId && outputFrame.contentWindow) {
                        outputFrame.contentWindow.postMessage({
                            type: 'DEV_EDTR_TEMP_HOVER_DEVID',
                            devId: item.devId
                        }, '*');
                    }
                };

                btn.onmouseleave = () => {
                    if (outputFrame.contentWindow) {
                        outputFrame.contentWindow.postMessage({
                            type: 'DEV_EDTR_TEMP_HOVER_DEVID',
                            devId: null
                        }, '*');
                    }
                };

                container.appendChild(btn);

                if (!isLast) {
                    const separator = document.createElement('span');
                    separator.className = 'text-gray-600 mx-0.5 select-none font-bold text-[10px]';
                    separator.textContent = '>';
                    container.appendChild(separator);
                }
            });

            container.scrollLeft = container.scrollWidth;
        }

        function selectElementByDevId(devId) {
            if (outputFrame.contentWindow) {
                outputFrame.contentWindow.postMessage({
                    type: 'DEV_EDTR_HIGHLIGHT_BY_DEVID',
                    devId: devId
                }, '*');
            }
        }

        function parseTagInfoFallback(tagInfo) {
            if (!tagInfo) return { tagName: '', id: '', classes: [], inlineEvents: [] };
            let tagName = tagInfo;
            let id = '';
            const classes = [];

            if (tagInfo.includes('#')) {
                const parts = tagInfo.split('#');
                tagName = parts[0];
                const rest = parts[1];
                if (rest.includes('.')) {
                    const subParts = rest.split('.');
                    id = subParts[0];
                    classes.push(...subParts.slice(1));
                } else {
                    id = rest;
                }
            } else if (tagInfo.includes('.')) {
                const parts = tagInfo.split('.');
                tagName = parts[0];
                classes.push(...parts.slice(1));
            }

            return { tagName, id, classes, inlineEvents: [] };
        }

        // Handle Messages Posted from Output Iframe
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'DEV_EDTR_ELEMENT_SELECTED') {
                const { devId, tagInfo, hierarchy, elementDetails } = event.data;
                
                const details = elementDetails || parseTagInfoFallback(tagInfo);

                let htmlRange = null;
                if (devId && globalSourceMap[devId]) {
                    htmlRange = globalSourceMap[devId];
                }

                let cssMatches = [];
                let jsMatches = [];

                if (currentMode === 'multi') {
                    cssMatches = findRelatedCssRules(codeStore.css, details, 0);
                    jsMatches = findRelatedJsRanges(codeStore.js, details, 0);
                } else {
                    const singleCode = codeStore.single || htmlCode.value;
                    const styleBlocks = extractBlocksFromSingleHtml(singleCode, 'style');
                    styleBlocks.forEach(sb => {
                        cssMatches.push(...findRelatedCssRules(sb.content, details, sb.startOffset));
                    });
                    const scriptBlocks = extractBlocksFromSingleHtml(singleCode, 'script');
                    scriptBlocks.forEach(scb => {
                        jsMatches.push(...findRelatedJsRanges(scb.content, details, scb.startOffset));
                    });
                }

                selectedElementState = {
                    devId: devId,
                    tagName: details.tagName,
                    id: details.id,
                    classes: details.classes,
                    inlineEvents: details.inlineEvents,
                    htmlRange: htmlRange,
                    cssMatches: cssMatches,
                    jsMatches: jsMatches
                };

                const currentSourceCode = htmlCode.value;
                if (htmlRange) {
                    selectedSourceState = {
                        devId: devId,
                        range: { ...htmlRange },
                        originalCode: currentSourceCode.substring(htmlRange.start, htmlRange.end),
                        tab: activeTab,
                        mode: currentMode
                    };

                    const displayEl = document.getElementById('ai-selected-element-display');
                    if (displayEl) {
                        displayEl.textContent = tagInfo || details.tagName;
                    }
                } else {
                    selectedSourceState = null;
                    const displayEl = document.getElementById('ai-selected-element-display');
                    if (displayEl) {
                        displayEl.textContent = "None (Inspect & Select)";
                    }
                }

                renderBreadcrumbs(hierarchy, devId);
                updateRelatedCodePanel();
                updateAiLayerDisplay();

                if (currentMode === 'multi' && activeTab !== 'html') {
                    switchTab('html');
                } else if (currentMode === 'single' && activeTab !== 'single') {
                    switchTab('single');
                }

                const statusMsg = document.getElementById('inspect-status-msg');

                if (htmlRange) {
                    if (statusMsg) statusMsg.textContent = "Exact HTML Source mapped!";
                    htmlCode.focus();
                    htmlCode.setSelectionRange(htmlRange.start, htmlRange.end);
                    scrollEditorToOffset(htmlRange.start);
                } else {
                    if (statusMsg) statusMsg.textContent = "Runtime Generated Element — direct HTML source not found";
                    showToast("Runtime Element — direct HTML source not found", true);
                }
            }
        });

        function saveCodeLocal() {
            try {
                if (activeProjectFile && !CORE_PROJECT_FILES.includes(activeProjectFile)) {
                    projectFiles[activeProjectFile] = { content: htmlCode.value, encoding: 'utf8' };
                }
                syncCoreProjectFiles();
                localStorage.setItem('liveEditor_pro_store', JSON.stringify({
                    mode: currentMode,
                    activeTab: activeTab,
                    store: codeStore,
                    projectFiles,
                    projectName
                }));
                renderProjectFiles();
            } catch (e) { console.warn("Local storage error:", e); }
        }

        function debouncedUpdate() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                updateOutput();
                saveCodeLocal();
            }, DEBOUNCE_DELAY);
        }

        window.downloadCode = function() {
            const compiledHtml = getCompiledHTML(false);
            const blob = new Blob([compiledHtml], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'index.html';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast("பதிவிறக்கம் ஆகிறது...");
        };

        window.clearCode = function() {
            if (outputPanel.classList.contains('fullscreen-mode')) {
                toggleFullscreen();
            }
            htmlCode.value = '';
            codeStore[activeTab] = '';
            if (activeProjectFile && !CORE_PROJECT_FILES.includes(activeProjectFile)) {
                projectFiles[activeProjectFile] = { content: '', encoding: 'utf8' };
            }
            localStorage.removeItem('liveEditor_pro_store');
            updateOutput(); 
            clearConsole();
            showToast("எடிட்டர் அழிக்கப்பட்டது");
        };

        function showToast(message, isError = false) {
            toast.textContent = message;
            if (isError) {
                toast.classList.add('bg-red-600');
                toast.classList.remove('bg-blue-900');
            } else {
                toast.classList.add('bg-blue-900');
                toast.classList.remove('bg-red-600');
            }
            toast.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => {
                toast.classList.add('translate-y-20', 'opacity-0');
            }, 3000);
        }


        function removeBuiltInStarterContent(parsed) {
            if (!parsed || !parsed.store) return parsed;

            const starterHints = [
                'Dev Edtr Pro',
                'HTML, CSS மற்றும் JavaScript தனித்தனியாக இயங்கும் வசதி',
                'Single HTML Mode',
                'Dev Edtr Single File',
                'buyBtn'
            ];

            const looksLikeStarter = value => {
                const text = String(value || '');
                return starterHints.some(hint => text.includes(hint));
            };

            ['html', 'css', 'js', 'single'].forEach(key => {
                if (looksLikeStarter(parsed.store[key])) parsed.store[key] = '';
            });

            if (parsed.projectFiles && typeof parsed.projectFiles === 'object') {
                Object.keys(parsed.projectFiles).forEach(name => {
                    const value = normalizeProjectFileValue(parsed.projectFiles[name]);
                    if (value.encoding === 'utf8' && looksLikeStarter(value.content)) {
                        // Remove only known starter files/content; never touch arbitrary user code.
                        if (['index.html', 'style.css', 'script.js'].includes(name)) {
                            parsed.projectFiles[name] = { content: '', encoding: 'utf8' };
                        }
                    }
                });
            }

            return parsed;
        }

        function loadCode() {
            try {
                const saved = localStorage.getItem('liveEditor_pro_store');
                if (saved) {
                    let parsed = JSON.parse(saved);
                    parsed = removeBuiltInStarterContent(parsed);
                    if (parsed.store) {
                        Object.assign(codeStore, parsed.store);
                    }
                    loadProjectFilesFromStore(parsed);
                    switchMode('multi');
                } else {
                    loadProjectFilesFromStore(null);
                    switchMode('multi');
                }
            } catch (e) {
                console.warn("Load error", e);
                switchMode('multi');
            }
        }

        // --- CODE RANGE SELECTOR LOGIC ---
        function getCharIndicesForLineRange(text, startLine, endLine) {
            const lines = text.split('\n');
            let startCharIndex = 0;
            let endCharIndex = 0;
            
            for (let i = 0; i < startLine - 1; i++) {
                if (i < lines.length) {
                    startCharIndex += lines[i].length + 1;
                }
            }
            
            endCharIndex = startCharIndex;
            for (let i = startLine - 1; i < endLine; i++) {
                if (i < lines.length) {
                    endCharIndex += lines[i].length + (i === lines.length - 1 ? 0 : 1);
                }
            }
            return { start: startCharIndex, end: endCharIndex };
        }

        function updateRangeLimits(totalLines) {
            const rStartSlider = document.getElementById('range-start-slider');
            const rEndSlider = document.getElementById('range-end-slider');
            const rStartVal = document.getElementById('range-start-val');
            const rEndVal = document.getElementById('range-end-val');
            
            if (!rStartSlider) return;
            
            const prevStart = parseInt(rStartSlider.value) || 1;
            const prevEnd = parseInt(rEndSlider.value) || 1;
            
            rStartSlider.max = totalLines;
            rEndSlider.max = totalLines;
            rStartVal.max = totalLines;
            rEndVal.max = totalLines;
            
            const nextStart = Math.min(prevStart, totalLines);
            const nextEnd = Math.min(prevEnd, totalLines);
            
            rStartSlider.value = nextStart;
            rStartVal.value = nextStart;
            rEndSlider.value = nextEnd;
            rEndVal.value = nextEnd;
            
            updateRangeStats();
        }

        function updateRangeStats() {
            const start = parseInt(document.getElementById('range-start-slider').value) || 1;
            const end = parseInt(document.getElementById('range-end-slider').value) || 1;
            
            const badge = document.getElementById('range-badge');
            if (badge) badge.textContent = `Lines: ${start} - ${end}`;
            
            const linesCount = document.getElementById('range-lines-count');
            if (linesCount) linesCount.textContent = (end - start + 1);
            
            const text = htmlCode.value;
            const { start: startIdx, end: endIdx } = getCharIndicesForLineRange(text, start, end);
            const selectedText = text.substring(startIdx, endIdx);
            
            const charsCount = document.getElementById('range-chars-count');
            if (charsCount) charsCount.textContent = selectedText.length;
        }

        window.toggleRangeSelector = function() {
            const content = document.getElementById('range-selector-content');
            const icon = document.getElementById('range-collapse-icon');
            const isHidden = content.classList.contains('hidden');
            
            if (isHidden) {
                content.classList.remove('hidden');
                icon.classList.remove('rotate-180');
            } else {
                content.classList.add('hidden');
                icon.classList.add('rotate-180');
            }
        };

        window.rangeActionSelect = function() {
            const text = htmlCode.value;
            const start = parseInt(document.getElementById('range-start-slider').value) || 1;
            const end = parseInt(document.getElementById('range-end-slider').value) || 1;
            const { start: startIdx, end: endIdx } = getCharIndicesForLineRange(text, start, end);
            
            htmlCode.focus();
            htmlCode.setSelectionRange(startIdx, endIdx);
            
            const lines = text.split('\n');
            if (lines.length > 0) {
                const scrollRatio = (start - 1) / lines.length;
                htmlCode.scrollTop = htmlCode.scrollHeight * scrollRatio;
            }
            showToast("வரிசை வரம்பு தேர்ந்தெடுக்கப்பட்டது!");
        };

        window.rangeActionCopy = function() {
            const text = htmlCode.value;
            const start = parseInt(document.getElementById('range-start-slider').value) || 1;
            const end = parseInt(document.getElementById('range-end-slider').value) || 1;
            const lines = text.split('\n');
            const targetLines = lines.slice(start - 1, end);
            const rangeText = targetLines.join('\n');
            
            if (!rangeText.trim()) {
                showToast("வரம்பு காலியாக உள்ளது!", true);
                return;
            }

            const tempTextArea = document.createElement("textarea");
            tempTextArea.value = rangeText;
            document.body.appendChild(tempTextArea);
            tempTextArea.select();
            document.execCommand("copy");
            document.body.removeChild(tempTextArea);
            
            showToast("வரிசை வரம்பு வெற்றிகரமாக நகலெடுக்கப்பட்டது!");
        };

        window.rangeActionCut = function() {
            const text = htmlCode.value;
            const start = parseInt(document.getElementById('range-start-slider').value) || 1;
            const end = parseInt(document.getElementById('range-end-slider').value) || 1;
            const lines = text.split('\n');
            const targetLines = lines.slice(start - 1, end);
            const rangeText = targetLines.join('\n');
            
            if (!rangeText.trim()) {
                showToast("வரம்பு காலியாக உள்ளது!", true);
                return;
            }

            const tempTextArea = document.createElement("textarea");
            tempTextArea.value = rangeText;
            document.body.appendChild(tempTextArea);
            tempTextArea.select();
            document.execCommand("copy");
            document.body.removeChild(tempTextArea);

            lines.splice(start - 1, end - start + 1);
            htmlCode.value = lines.join('\n');
            
            updateOutput();
            saveCodeLocal();
            showToast("வரிசை வரம்பு வெற்றிகரமாக வெட்டப்பட்டது (Cut)!");
        };

        window.rangeActionComment = function() {
            const text = htmlCode.value;
            const start = parseInt(document.getElementById('range-start-slider').value) || 1;
            const end = parseInt(document.getElementById('range-end-slider').value) || 1;
            const lines = text.split('\n');
            const targetLines = lines.slice(start - 1, end);
            const joinedTarget = targetLines.join('\n');
            
            let resultText;
            const isCommented = joinedTarget.trim().startsWith('<!--') && joinedTarget.trim().endsWith('-->');
            
            if (isCommented) {
                let unwrapped = joinedTarget.trim();
                unwrapped = unwrapped.substring(4, unwrapped.length - 3).trim();
                lines.splice(start - 1, end - start + 1, unwrapped);
                resultText = lines.join('\n');
                showToast("கமெண்ட் நீக்கப்பட்டது!");
            } else {
                const wrapped = `<!-- \n${joinedTarget}\n -->`;
                lines.splice(start - 1, end - start + 1, wrapped);
                resultText = lines.join('\n');
                showToast("கமெண்ட் சேர்க்கப்பட்டது!");
            }
            
            htmlCode.value = resultText;
            updateOutput();
            saveCodeLocal();
        };

        window.rangeActionExtract = function() {
            const text = htmlCode.value;
            const start = parseInt(document.getElementById('range-start-slider').value) || 1;
            const end = parseInt(document.getElementById('range-end-slider').value) || 1;
            const lines = text.split('\n');
            const targetLines = lines.slice(start - 1, end);
            const rangeText = targetLines.join('\n');
            
            if (!rangeText.trim()) {
                showToast("தேர்ந்தெடுக்க வரம்பு காலியாக உள்ளது!", true);
                return;
            }
            
            htmlCode.value = rangeText;
            updateOutput();
            saveCodeLocal();
            showToast("தேர்ந்தெடுக்கப்பட்ட பகுதி மட்டும் வைக்கப்பட்டது!");
        };


        // ===== AI HISTORY / PWA / INDEXEDDB BACKUP =====
        function saveAiHistoryEntry(entry) {
            try {
                const key = 'dev_edtr_ai_history';
                const items = JSON.parse(localStorage.getItem(key) || '[]');
                items.unshift({ ...entry, time: new Date().toLocaleString() });
                localStorage.setItem(key, JSON.stringify(items.slice(0, 20)));
                renderAiHistory();
            } catch (e) { console.warn('AI history save failed', e); }
        }

        function renderAiHistory() {
            const el = document.getElementById('ai-history-list');
            if (!el) return;
            try {
                const items = JSON.parse(localStorage.getItem('dev_edtr_ai_history') || '[]');
                if (!items.length) { el.textContent = 'No AI changes yet'; return; }
                el.innerHTML = '';
                items.slice(0, 8).forEach(item => {
                    const row = document.createElement('div');
                    row.className = 'px-2 py-1 rounded bg-gray-900 border border-gray-800';
                    row.textContent = `${item.layer?.toUpperCase() || 'AI'} · ${item.instruction || ''}`;
                    row.title = item.time || '';
                    el.appendChild(row);
                });
            } catch (e) { el.textContent = 'History unavailable'; }
        }

        window.clearAiHistory = function() {
            localStorage.removeItem('dev_edtr_ai_history');
            renderAiHistory();
        };
        window.undoLastAiChange = function() {
            const s = window.__devEdtrAiUndo;
            if (!s) return showToast('No AI change to undo.', true);
            codeStore.html = s.html; codeStore.css = s.css; codeStore.js = s.js; codeStore.single = s.single;
            delete window.__devEdtrAiUndo;
            saveCode();
            updateOutput();
            showToast('Last AI change undone');
        };


        let deferredInstallPrompt = null;
        window.installPWA = async function() {
            if (!deferredInstallPrompt) {
                showToast('Browser installation prompt is not available yet. Use the browser menu → Install app.', true);
                return;
            }
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice.catch(() => {});
            deferredInstallPrompt = null;
            document.getElementById('pwa-install-btn')?.classList.add('hidden');
        };

        function initPWA() {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./sw.js').catch(err => console.warn('PWA service worker:', err));
            }
            window.addEventListener('beforeinstallprompt', event => {
                event.preventDefault();
                deferredInstallPrompt = event;
                document.getElementById('pwa-install-btn')?.classList.remove('hidden');
            });
        }

        // IndexedDB project backup so large projects are not limited to localStorage.
        const PROJECT_DB_NAME = 'dev_edtr_project_backup';
        function openProjectBackupDB() {
            return new Promise((resolve, reject) => {
                if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
                const req = indexedDB.open(PROJECT_DB_NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore('projects');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        async function backupProjectToIndexedDB() {
            try {
                const db = await openProjectBackupDB();
                const tx = db.transaction('projects', 'readwrite');
                tx.objectStore('projects').put({
                    projectFiles, projectName, codeStore: { ...codeStore }, savedAt: Date.now()
                }, 'current');
            } catch (e) { console.warn('IndexedDB backup failed', e); }
        }

        // Generic HTTPS database/API adapter.
        let databaseConfig = JSON.parse(localStorage.getItem('dev_edtr_database_config') || 'null');

        function setDatabaseStatus(text, connected = false) {
            if (!dbStatus) return;
            dbStatus.textContent = text;
            dbStatus.classList.remove('bg-red-100','text-red-600','bg-green-100','text-green-600','bg-gray-100','text-gray-600');
            if (connected) dbStatus.classList.add('bg-green-100','text-green-600');
            else dbStatus.classList.add('bg-gray-100','text-gray-600');
        }

        window.openDatabaseSettings = function() {
            const modal = document.getElementById('database-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            if (databaseConfig) {
                document.getElementById('db-provider').value = databaseConfig.provider || 'rest';
                document.getElementById('db-url').value = databaseConfig.url || '';
                document.getElementById('db-method').value = databaseConfig.method || 'GET';
                document.getElementById('db-token').value = databaseConfig.token || '';
                document.getElementById('db-headers').value = JSON.stringify(databaseConfig.headers || {}, null, 2);
                document.getElementById('db-body').value = databaseConfig.body ? JSON.stringify(databaseConfig.body, null, 2) : '';
            }
        };
        window.closeDatabaseSettings = function() {
            const modal = document.getElementById('database-modal');
            modal?.classList.add('hidden');
            modal?.classList.remove('flex');
        };

        function readDatabaseForm() {
            let headers = {};
            const rawHeaders = document.getElementById('db-headers')?.value.trim() || '{}';
            try { headers = JSON.parse(rawHeaders); } catch { throw new Error('Headers JSON is invalid.'); }
            const token = document.getElementById('db-token')?.value.trim();
            if (token) headers.Authorization = /^Bearer\s/i.test(token) ? token : `Bearer ${token}`;
            const rawBody = document.getElementById('db-body')?.value.trim();
            let body = undefined;
            if (rawBody) {
                try { body = JSON.parse(rawBody); }
                catch { throw new Error('Request body must be valid JSON.'); }
            }
            let url = document.getElementById('db-url')?.value.trim();
            if (!/^https?:\/\//i.test(url)) throw new Error('Use a valid HTTPS/HTTP API URL.');
            const provider = document.getElementById('db-provider')?.value || 'rest';
            // Firebase Realtime Database uses its HTTPS REST endpoint. If the user gives
            // the database root, append .json automatically.
            if (provider === 'firebase-rest' && !/\.json(?:[?#]|$)/i.test(url)) {
                url = url.replace(/\/$/, '') + '/.json';
            }
            return {
                provider,
                url,
                method: document.getElementById('db-method')?.value || 'GET',
                token,
                headers,
                body
            };
        }

        async function databaseRequest(config = databaseConfig) {
            if (!config?.url) throw new Error('Database/API URL is not configured.');
            const options = {
                method: config.method || 'GET',
                headers: { Accept: 'application/json', ...(config.headers || {}) }
            };
            if (config.body !== undefined && !['GET','HEAD'].includes(options.method)) {
                options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
                options.body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
            }
            const response = await fetch(config.url, options);
            const text = await response.text();
            let data = text;
            try { data = JSON.parse(text); } catch {}
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof data === 'string' ? data.slice(0, 180) : 'request failed'}`);
            return data;
        }

        window.testDatabaseConnection = async function() {
            try {
                const cfg = readDatabaseForm();
                setDatabaseStatus('Connecting...');
                await databaseRequest(cfg);
                setDatabaseStatus('Database Connected', true);
                showToast(`${cfg.provider.toUpperCase()} connection successful`);
            } catch (e) {
                console.error('Database test failed:', e);
                setDatabaseStatus('Connection Failed');
                showToast(`Database connection failed: ${e.message}`, true);
            }
        };

        window.saveDatabaseSettings = async function() {
            try {
                const cfg = readDatabaseForm();
                localStorage.setItem('dev_edtr_database_config', JSON.stringify(cfg));
                databaseConfig = cfg;
                await databaseRequest(cfg);
                setDatabaseStatus('Database Connected', true);
                closeDatabaseSettings();
                showToast('Database/API connected and settings saved');
            } catch (e) {
                console.error('Database save/connect failed:', e);
                setDatabaseStatus('Connection Failed');
                showToast(`Could not connect: ${e.message}`, true);
            }
        };

        window.databaseRequest = databaseRequest;
        window.firebaseDatabaseRequest = async function(path = '', method = 'GET', body = undefined) {
            if (!databaseConfig || databaseConfig.provider !== 'firebase-rest') {
                throw new Error('Configure Firebase Realtime Database first.');
            }
            let base = databaseConfig.url.replace(/\/$/, '');
            base = base.replace(/\/.json$/i, '');
            const cleanPath = String(path || '').replace(/^\/+/, '');
            const url = `${base}/${cleanPath.replace(/\/$/, '')}.json`;
            return databaseRequest({ ...databaseConfig, url, method, body });
        };



        // Initialize UI & Events on DOM Load
        window.addEventListener('DOMContentLoaded', () => {
            loadTheme();
            renderProjectFiles();
            renderAiHistory();
            initPWA();
            initConsoleToggle();
            if (databaseConfig?.url) {
                databaseRequest(databaseConfig)
                    .then(() => setDatabaseStatus('Database Connected', true))
                    .catch(() => setDatabaseStatus('Database Disconnected'));
            } else if (typeof window.__firebase_config === 'undefined') {
                setDatabaseStatus('Database Not Configured');
            }

            if (!window.devEdtrDragDropInstalled) {
                window.devEdtrDragDropInstalled = true;
                const dropTargets = [document.getElementById('project-files-panel'), document.querySelector('.html-editor-panel')].filter(Boolean);
                dropTargets.forEach(target => {
                    target.addEventListener('dragover', e => { e.preventDefault(); target.classList.add('drop-target-active'); });
                    target.addEventListener('dragleave', () => target.classList.remove('drop-target-active'));
                    target.addEventListener('drop', async e => {
                        e.preventDefault();
                        target.classList.remove('drop-target-active');
                        const files = Array.from(e.dataTransfer?.files || []);
                        if (!files.length) return;
                        for (const file of files) {
                            const requested = sanitizeProjectPath(file.webkitRelativePath || file.name);
                            if (!isValidProjectFilename(requested)) { showToast(`Invalid filename: ${file.name}`, true); continue; }
                            const safe = uniqueProjectFilename(requested);
                            if (safe !== requested) showToast(`${requested} already exists → imported as ${safe}`);
                            try {
                                const ext = getFileExtension(safe);
                                if (BINARY_EXTENSIONS.has(ext)) {
                                    const dataUrl = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
                                    projectFiles[safe] = {content:dataUrl, encoding:'base64'};
                                } else {
                                    const content = await file.text();
                                    projectFiles[safe] = {content, encoding:'utf8'};
                                    if (safe === 'index.html') codeStore.html = content;
                                    if (safe === 'style.css') codeStore.css = content;
                                    if (safe === 'script.js') codeStore.js = content;
                                }
                            } catch (err) { console.error(err); }
                        }
                        saveProjectFiles(); renderProjectFiles(); updateOutput();
                        showToast(`${files.length} file(s) imported`);
                    });
                });
            }

            const projectSearch = document.getElementById('project-files-search');
            if (projectSearch) projectSearch.addEventListener('input', renderProjectFiles);
            const upload = document.getElementById('project-file-upload');
            if (upload) upload.addEventListener('change', async (event) => {
                const importedNames = [];

                for (const file of Array.from(event.target.files || [])) {
                    const rawPath = file.webkitRelativePath || file.name;
                    const requested = sanitizeProjectPath(rawPath);

                    if (!isValidProjectFilename(requested)) {
                        showToast(`Invalid filename: ${file.name}`, true);
                        continue;
                    }

                    // Never overwrite an existing file. Make a unique copy name.
                    const safe = uniqueProjectFilename(requested);
                    const ext = getFileExtension(safe);

                    try {
                        let record;

                        if (BINARY_EXTENSIONS.has(ext)) {
                            const dataUrl = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () => resolve(reader.result);
                                reader.onerror = () => reject(reader.error);
                                reader.readAsDataURL(file);
                            });
                            record = { content: dataUrl, encoding: 'base64' };
                        } else {
                            // Read the REAL uploaded text content for every supported text extension.
                            const content = await file.text();
                            record = { content, encoding: 'utf8' };

                            // Core files also update the live editor stores.
                            if (safe === 'index.html') codeStore.html = content;
                            if (safe === 'style.css') codeStore.css = content;
                            if (safe === 'script.js') codeStore.js = content;
                        }

                        projectFiles[safe] = record;
                        importedNames.push(safe);

                        if (safe !== requested) {
                            showToast(`${requested} already exists → imported as ${safe}`);
                        }
                    } catch (error) {
                        console.error('File import failed:', file.name, error);
                        showToast(`Could not read ${file.name}`, true);
                    }
                }

                upload.value = '';

                // Keep project storage in sync, but don't overwrite imported files.
                if (importedNames.some(name => name === 'index.html' || name === 'style.css' || name === 'script.js')) {
                    syncCoreProjectFiles();
                }
                saveProjectFiles();
                renderProjectFiles();

                // Open the actual file that was just imported.
                const lastImported = importedNames[importedNames.length - 1];
                if (lastImported && projectFiles[lastImported]) {
                    openProjectFile(lastImported);
                }

                // Only the three runnable core files affect the live preview.
                updateOutput();
            });

            initFirebase();
            loadApiKeyUI();
            initSplitResizer();
            initPanelResizer();
            
            document.addEventListener('click', (event) => {
                const tooltipBtn = document.querySelector('[onclick="toggleInfoTooltip()"]');
                const tooltip = document.getElementById('info-tooltip');
                if (tooltip && tooltipBtn && !tooltipBtn.contains(event.target) && !tooltip.contains(event.target)) {
                    tooltip.classList.add('hidden');
                }

                const cssDropdown = document.getElementById('related-dropdown-css');
                const jsDropdown = document.getElementById('related-dropdown-js');
                const cssBtn = document.getElementById('related-btn-css');
                const jsBtn = document.getElementById('related-btn-js');

                if (cssDropdown && cssBtn && !cssBtn.contains(event.target) && !cssDropdown.contains(event.target)) {
                    cssDropdown.classList.add('hidden');
                }
                if (jsDropdown && jsBtn && !jsBtn.contains(event.target) && !jsDropdown.contains(event.target)) {
                    jsDropdown.classList.add('hidden');
                }
            });

            htmlCode.addEventListener('input', () => {
                if (htmlCode.dataset.projectFile && projectFiles[htmlCode.dataset.projectFile] && !CORE_PROJECT_FILES.includes(htmlCode.dataset.projectFile)) {
                    syncActiveProjectFileFromEditor();
                    updateLineNumbers();
                    charCount.textContent = `${htmlCode.value.length} chars`;
                    return; // Editing a support file must never replace the live HTML preview.
                }
                debouncedUpdate();
            });
            htmlCode.addEventListener('scroll', syncScroll);

            const rStartSlider = document.getElementById('range-start-slider');
            const rEndSlider = document.getElementById('range-end-slider');
            const rStartVal = document.getElementById('range-start-val');
            const rEndVal = document.getElementById('range-end-val');
            
            function syncRangeInputs(changedId) {
                const totalLines = htmlCode.value.split('\n').length;
                let start = parseInt(rStartSlider.value) || 1;
                let end = parseInt(rEndSlider.value) || 1;
                
                if (changedId === 'start-slider') {
                    rStartVal.value = rStartSlider.value;
                    start = parseInt(rStartSlider.value);
                    if (start > end) {
                        rEndSlider.value = start;
                        rEndVal.value = start;
                    }
                } else if (changedId === 'start-val') {
                    let val = parseInt(rStartVal.value) || 1;
                    val = Math.max(1, Math.min(val, totalLines));
                    rStartVal.value = val;
                    rStartSlider.value = val;
                    start = val;
                    if (start > end) {
                        rEndSlider.value = start;
                        rEndVal.value = start;
                    }
                } else if (changedId === 'end-slider') {
                    rEndVal.value = rEndSlider.value;
                    end = parseInt(rEndSlider.value);
                    if (end < start) {
                        rStartSlider.value = end;
                        rStartVal.value = end;
                    }
                } else if (changedId === 'end-val') {
                    let val = parseInt(rEndVal.value) || 1;
                    val = Math.max(1, Math.min(val, totalLines));
                    rEndVal.value = val;
                    rEndSlider.value = val;
                    end = val;
                    if (end < start) {
                        rStartSlider.value = end;
                        rStartVal.value = end;
                    }
                }
                updateRangeStats();
            }
            
            if (rStartSlider) {
                rStartSlider.addEventListener('input', () => syncRangeInputs('start-slider'));
                rStartVal.addEventListener('input', () => syncRangeInputs('start-val'));
                rEndSlider.addEventListener('input', () => syncRangeInputs('end-slider'));
                rEndVal.addEventListener('input', () => syncRangeInputs('end-val'));
            }

            document.addEventListener('click', (event) => {
                const menu = document.getElementById('download-menu');
                const wrap = document.querySelector('.download-wrap');
                if (menu && wrap && !wrap.contains(event.target)) closeDownloadMenu();
                const pf = document.getElementById('project-files-sidebar');
                if (pf && window.innerWidth < 1024 && pf.classList.contains('mobile-open') &&
                    !pf.contains(event.target) && !event.target.closest('.project-files-mobile-trigger')) closeProjectFiles();
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    closeProjectFiles();
                    closeProjectFileActionMenu();
                    closeDownloadMenu();
                }
            });
            window.addEventListener('resize', () => {
                if (window.innerWidth >= 1024) closeProjectFiles();
            });
            renderProjectFiles();
        });
    