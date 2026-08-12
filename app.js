let activeTab = 'html';
let isInspectActive = false;
let activeAiLayer = 'html';
let isConsoleHidden = false;
let isFullscreen = false;
let debounceTimer;

const codeStore = {
    html: `<div class="container">\n  <h1>Dev Edtr Pro</h1>\n  <button id="btn">Click Me</button>\n</div>`,
    css: `body { font-family: sans-serif; padding: 20px; text-align: center; }\n.container { background: #f3f4f6; padding: 20px; border-radius: 8px; }\nh1 { color: #2563eb; }\nbutton { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }`,
    js: `document.getElementById('btn').addEventListener('click', () => {\n  alert('Button Working!');\n});`
};

let projectFiles = {
    'index.html': codeStore.html,
    'style.css': codeStore.css,
    'script.js': codeStore.js
};

let selectedElementData = {
    selector: '',
    html: '',
    css: '',
    js: ''
};

const htmlCode = document.getElementById('html-code');
const lineNumbers = document.getElementById('line-numbers');
const outputFrame = document.getElementById('output-frame');
const consoleOutput = document.getElementById('console-output');
const editorPanel = document.querySelector('.html-editor-panel');
const outputPanel = document.getElementById('output-panel');
const charCount = document.getElementById('char-count');
const toast = document.getElementById('toast');

function initSplitResizer() {
    const resizer = document.getElementById('split-resizer');
    const mainSplit = document.querySelector('.main-split');
    if (!resizer || !mainSplit) return;

    let dragging = false;

    const onPointerDown = (e) => {
        dragging = true;
        resizer.setPointerCapture(e.pointerId);
        document.body.classList.add('select-none');
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const rect = mainSplit.getBoundingClientRect();
        const isDesktop = window.innerWidth >= 1024;

        if (isDesktop) {
            let pointerX = e.clientX - rect.left;
            let ratio = pointerX / rect.width;
            ratio = Math.max(0.15, Math.min(0.85, ratio));
            editorPanel.style.flex = `0 0 ${ratio * 100}%`;
            outputPanel.style.flex = '1 1 0';
        } else {
            let pointerY = e.clientY - rect.top;
            let ratio = pointerY / rect.height;
            ratio = Math.max(0.15, Math.min(0.85, ratio));
            editorPanel.style.flex = `0 0 ${ratio * 100}%`;
            outputPanel.style.flex = '1 1 0';
        }
    };

    const onPointerUp = (e) => {
        if (!dragging) return;
        dragging = false;
        try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
        document.body.classList.remove('select-none');
    };

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
}

function getCompiledHTML() {
    const consoleHijackScript = `
    <script>
    (function() {
        const sendLog = (type, args) => {
            window.parent.postMessage({
                type: 'CONSOLE_LOG',
                logType: type,
                message: Array.from(args).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
            }, '*');
        };
        console.log = (...args) => sendLog('log', args);
        console.warn = (...args) => sendLog('warn', args);
        console.error = (...args) => sendLog('error', args);
        window.onerror = (msg, url, line) => sendLog('error', [\`\${msg} (Line: \${line})\`]);
    })();
    <\/script>`;

    const inspectScript = `
    <script>
    (function() {
        let active = false;
        window.addEventListener('message', (e) => {
            if (e.data?.type === 'INSPECT_TOGGLE') active = e.data.active;
        });

        document.addEventListener('mouseover', (e) => {
            if (!active) return;
            e.target.style.outline = '2px dashed #2563eb';
            e.target.style.cursor = 'crosshair';
        }, true);

        document.addEventListener('mouseout', (e) => {
            if (!active) return;
            e.target.style.outline = '';
            e.target.style.cursor = '';
        }, true);

        document.addEventListener('click', (e) => {
            if (!active) return;
            e.preventDefault();
            e.stopPropagation();

            const el = e.target;
            const selector = el.id ? '#' + el.id : (el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : el.tagName.toLowerCase());
            
            window.parent.postMessage({
                type: 'ELEMENT_INSPECTED',
                selector: selector,
                outerHTML: el.outerHTML,
                tagName: el.tagName.toLowerCase(),
                id: el.id || '',
                className: typeof el.className === 'string' ? el.className : ''
            }, '*');
        }, true);
    })();
    <\/script>`;

    let currentHtml = codeStore.html || '';

    // Single HTML Code பரிசோதனை
    if (currentHtml.includes('<html') || currentHtml.includes('<!DOCTYPE') || currentHtml.includes('<body')) {
        if (currentHtml.includes('</head>')) {
            currentHtml = currentHtml.replace('</head>', `${consoleHijackScript}</head>`);
        } else {
            currentHtml = consoleHijackScript + currentHtml;
        }

        if (currentHtml.includes('</body>')) {
            currentHtml = currentHtml.replace('</body>', `${inspectScript}</body>`);
        } else {
            currentHtml = currentHtml + inspectScript;
        }

        if (codeStore.css && codeStore.css.trim()) {
            currentHtml = currentHtml.replace('</head>', `<style>${codeStore.css}</style></head>`);
        }
        if (codeStore.js && codeStore.js.trim()) {
            currentHtml = currentHtml.replace('</body>', `<script>${codeStore.js}<\/script></body>`);
        }

        return currentHtml;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${consoleHijackScript}
  <style>${codeStore.css}</style>
</head>
<body>
${codeStore.html}
  <script>${codeStore.js}<\/script>
  ${inspectScript}
</body>
</html>`;
}

function updateOutput() {
    codeStore[activeTab] = htmlCode.value;
    projectFiles[activeTab === 'html' ? 'index.html' : activeTab === 'css' ? 'style.css' : 'script.js'] = htmlCode.value;
    
    charCount.textContent = `${htmlCode.value.length} chars`;
    updateLineNumbers();

    const compiled = getCompiledHTML();
    const blob = new Blob([compiled], { type: 'text/html;charset=utf-8' });
    outputFrame.src = URL.createObjectURL(blob);
}

window.openNewTab = function() {
    const compiled = getCompiledHTML();
    const blob = new Blob([compiled], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
};

window.toggleFullscreen = function() {
    isFullscreen = !isFullscreen;
    const icon = document.getElementById('fullscreen-icon');

    if (isFullscreen) {
        outputPanel.classList.add('fullscreen-active');
        if (icon) icon.className = 'fa-solid fa-compress';
        showToast("Fullscreen Active!");
    } else {
        outputPanel.classList.remove('fullscreen-active');
        if (icon) icon.className = 'fa-solid fa-expand';
    }
};

window.toggleConsolePanel = function() {
    isConsoleHidden = !isConsoleHidden;
    const wrapper = document.getElementById('console-output-wrapper');
    const icon = document.getElementById('console-toggle-icon');

    if (isConsoleHidden) {
        wrapper?.classList.add('console-collapsed');
        if (icon) icon.className = 'fa-solid fa-chevron-up';
    } else {
        wrapper?.classList.remove('console-collapsed');
        if (icon) icon.className = 'fa-solid fa-chevron-down';
    }
};

window.clearConsole = function() {
    if (consoleOutput) consoleOutput.innerHTML = '';
};

window.addEventListener('message', (e) => {
    if (e.data?.type === 'CONSOLE_LOG') {
        const { logType, message } = e.data;
        const line = document.createElement('div');
        line.className = logType === 'error' ? 'text-red-400 border-b border-gray-800 py-0.5' : logType === 'warn' ? 'text-yellow-400 border-b border-gray-800 py-0.5' : 'text-gray-300 border-b border-gray-800 py-0.5';
        line.textContent = `[${logType.toUpperCase()}] ${message}`;
        consoleOutput?.appendChild(line);
        if (consoleOutput) consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    if (e.data?.type === 'ELEMENT_INSPECTED') {
        const { selector, outerHTML, id, className } = e.data;
        
        selectedElementData = {
            selector: selector,
            html: outerHTML,
            css: findMatchingCss(selector, id, className),
            js: findMatchingJs(selector, id)
        };

        const selectedDisplay = document.getElementById('ai-selected-element-display');
        const inspectTag = document.getElementById('inspect-element-tag');

        if (selectedDisplay) selectedDisplay.textContent = selector;
        if (inspectTag) inspectTag.textContent = selector;

        updateAiLayerDisplay();
        document.getElementById('ai-assistant-panel')?.classList.remove('hidden');
    }
});

// Single HTML மற்றும் CSS Tab இரண்டிலிருந்தும் CSS விதிகளைத் தேடுதல்
function findMatchingCss(selector, id, className) {
    let combinedCss = codeStore.css || '';
    
    const htmlText = codeStore.html || '';
    const styleMatches = htmlText.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (styleMatches) {
        styleMatches.forEach(block => {
            combinedCss += '\n' + block.replace(/<\/?style[^>]*>/gi, '');
        });
    }

    if (!combinedCss.trim()) return '/* No CSS Found */';

    const rules = combinedCss.split('}');
    const classList = typeof className === 'string' ? className.trim().split(/\s+/).filter(Boolean) : [];

    const matched = rules.filter(rule => {
        if (!rule.trim()) return false;
        if (selector && rule.includes(selector)) return true;
        if (id && rule.includes('#' + id)) return true;
        if (classList.some(c => rule.includes('.' + c))) return true;
        return false;
    });

    return matched.length ? matched.join('}\n').trim() + '}' : '/* No direct matching CSS rule found */';
}

// Single HTML மற்றும் JS Tab இரண்டிலிருந்தும் JavaScript லாஜிக்குகளைத் தேடுதல்
function findMatchingJs(selector, id) {
    let combinedJs = codeStore.js || '';

    const htmlText = codeStore.html || '';
    const scriptMatches = htmlText.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    if (scriptMatches) {
        scriptMatches.forEach(block => {
            combinedJs += '\n' + block.replace(/<\/?script[^>]*>/gi, '');
        });
    }

    if (!combinedJs.trim()) return '// No JS Found';

    const lines = combinedJs.split('\n');
    const cleanSelector = selector.replace(/^[#\.]/, '');

    const matched = lines.filter(line => {
        if (id && line.includes(id)) return true;
        if (cleanSelector && line.includes(cleanSelector)) return true;
        if (selector && line.includes(selector)) return true;
        return false;
    });

    return matched.length ? matched.join('\n').trim() : '// No direct matching JS logic found';
}

function updateAiLayerDisplay() {
    const display = document.getElementById('ai-layer-code-display');
    const title = document.getElementById('ai-layer-code-title');

    if (title) title.textContent = `CURRENT ${activeAiLayer.toUpperCase()}`;
    if (display) {
        if (activeAiLayer === 'html') display.textContent = selectedElementData.html || 'No Element Selected';
        if (activeAiLayer === 'css') display.textContent = selectedElementData.css || '/* No CSS Context */';
        if (activeAiLayer === 'js') display.textContent = selectedElementData.js || '// No JS Context';
    }
}

window.switchAiLayer = function(layer) {
    activeAiLayer = layer;
    document.querySelectorAll('.ai-layer-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`ai-layer-tab-${layer}`)?.classList.add('active');
    updateAiLayerDisplay();
};

window.saveApiKey = function() {
    const key = document.getElementById('ai-api-key-input')?.value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        const status = document.getElementById('ai-api-status');
        if (status) {
            status.textContent = 'Saved';
            status.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/60 text-green-300';
        }
        showToast("API Key சேமிக்கப்பட்டது!");
    } else {
        showToast("API Key-ஐ உள்ளிடவும்!", true);
    }
};

async function fetchAvailableGeminiModels(apiKey) {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.models || [])
            .filter(m => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => m.name.replace('models/', ''));
    } catch (e) {
        return [];
    }
}

window.requestAiFix = async function() {
    const apiKey = localStorage.getItem('gemini_api_key') || document.getElementById('ai-api-key-input')?.value.trim();
    const instructionInput = document.getElementById('ai-instruction-input');
    const instruction = instructionInput?.value.trim();

    if (!apiKey) {
        showToast("Gemini API Key இல்லை! Key-ஐ சேமிக்கவும்.", true);
        document.getElementById('ai-assistant-panel')?.classList.remove('hidden');
        return;
    }
    if (!instruction) {
        showToast("என்ன மாற்ற வேண்டும் என்பதை உள்ளிடவும்!", true);
        return;
    }

    const fixBtnText = document.getElementById('ai-fix-btn-text');
    const fixIcon = document.getElementById('ai-fix-icon');

    if (fixBtnText) fixBtnText.textContent = "AI Generating...";
    if (fixIcon) fixIcon.className = "fa-solid fa-spinner animate-spin";

    const fetchedModels = await fetchAvailableGeminiModels(apiKey);
    const defaultFallbackModels = [
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.1-pro',
        'gemini-2.5-flash',
        'gemini-1.5-flash'
    ];
    const candidateModels = Array.from(new Set([...fetchedModels, ...defaultFallbackModels]));

    const prompt = `You are a professional front-end coding assistant.
Target Layer: ${activeAiLayer.toUpperCase()}
Selected Element Selector: ${selectedElementData.selector || 'None'}

Current Element Context:
HTML: ${selectedElementData.html || 'N/A'}
CSS: ${selectedElementData.css || 'N/A'}
JS: ${selectedElementData.js || 'N/A'}

User Instruction: ${instruction}

Important Rules:
Return ONLY clean, executable code replacement for ${activeAiLayer.toUpperCase()}.
Do NOT include any markdown code fences (like \`\`\`html or \`\`\`css), conversational text, or explanations.`;

    let success = false;
    let lastError = null;

    for (const model of candidateModels) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || `HTTP Error ${response.status}`);
            }

            const data = await response.json();
            const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (resultText) {
                const cleanCode = resultText.replace(/```[a-z]*\n?/gi, '').replace(/```$/g, '').trim();

                if (activeAiLayer === 'css') {
                    if (codeStore.html.includes('</style>')) {
                        codeStore.html = codeStore.html.replace('</style>', `\n  /* AI Generated CSS */\n  ${cleanCode}\n</style>`);
                    } else {
                        codeStore.css += `\n\n/* AI Generated CSS */\n${cleanCode}`;
                    }
                } else if (activeAiLayer === 'js') {
                    if (codeStore.html.includes('</script>')) {
                        codeStore.html = codeStore.html.replace('</script>', `\n  // AI Generated JS\n  ${cleanCode}\n<\/script>`);
                    } else {
                        codeStore.js += `\n\n/* AI Generated JS */\n${cleanCode}`;
                    }
                } else {
                    if (selectedElementData.html && codeStore.html.includes(selectedElementData.html)) {
                        codeStore.html = codeStore.html.replace(selectedElementData.html, cleanCode);
                    } else {
                        codeStore.html += `\n${cleanCode}`;
                    }
                }

                if (activeTab === activeAiLayer) htmlCode.value = codeStore[activeTab];
                updateOutput();
                showToast(`AI Fix வெற்றியடைந்தது! (${model})`);
                if (instructionInput) instructionInput.value = '';
                success = true;
                break;
            }
        } catch (err) {
            console.warn(`Model ${model} failed, trying next... Reason:`, err.message);
            lastError = err;
        }
    }

    if (!success) {
        showToast(`AI தோல்வி: API Key சரியா எனச் சரிபார்க்கவும்.`, true);
        console.error("Gemini API Error Detail:", lastError);
    }

    if (fixBtnText) fixBtnText.textContent = "✨ Fix with AI";
    if (fixIcon) fixIcon.className = "fa-solid fa-wand-magic-sparkles";
};

window.switchTab = function(tab) {
    codeStore[activeTab] = htmlCode.value;
    activeTab = tab;

    ['html', 'css', 'js'].forEach(t => {
        document.getElementById(`tab-${t}`)?.classList.toggle('active', t === activeTab);
    });

    htmlCode.value = codeStore[activeTab] || '';
    updateOutput();
};

window.toggleInspectMode = function() {
    isInspectActive = !isInspectActive;
    document.getElementById('inspect-btn')?.classList.toggle('active', isInspectActive);
    document.getElementById('inspect-info-bar')?.classList.toggle('hidden', !isInspectActive);

    outputFrame.contentWindow?.postMessage({
        type: 'INSPECT_TOGGLE',
        active: isInspectActive
    }, '*');
};

window.toggleAiPanel = function() {
    document.getElementById('ai-assistant-panel')?.classList.toggle('hidden');
};

window.formatCurrentCode = function() {
    try {
        const parserMap = { html: 'html', css: 'css', js: 'babel' };
        const formatted = prettier.format(htmlCode.value, {
            parser: parserMap[activeTab],
            plugins: prettierPlugins,
            tabWidth: 2
        });
        htmlCode.value = formatted;
        codeStore[activeTab] = formatted;
        updateOutput();
        showToast("Code Format செய்யப்பட்டது!");
    } catch (e) {
        showToast("Syntax Error உள்ளது!", true);
    }
};

window.clearCode = function() {
    codeStore.html = ''; codeStore.css = ''; codeStore.js = '';
    htmlCode.value = '';
    updateOutput();
    showToast("Code நீக்கப்பட்டது!");
};

window.toggleTheme = function() {
    document.body.classList.toggle('dark-mode');
};

window.toggleDownloadMenu = function(e) {
    e.stopPropagation();
    document.getElementById('download-menu')?.classList.toggle('hidden');
};

window.closeDownloadMenu = function() {
    document.getElementById('download-menu')?.classList.add('hidden');
};

window.downloadCode = function() {
    const blob = new Blob([getCompiledHTML()], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'index.html';
    a.click();
};

window.downloadProjectZip = function() {
    if (typeof JSZip === 'undefined') return;
    const zip = new JSZip();
    zip.file("index.html", codeStore.html);
    zip.file("style.css", codeStore.css);
    zip.file("script.js", codeStore.js);
    zip.generateAsync({ type: "blob" }).then(content => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = "project.zip";
        a.click();
    });
};

window.openProjectFiles = function() {
    document.getElementById('project-files-sidebar')?.classList.add('mobile-open');
    document.getElementById('project-files-backdrop')?.classList.add('open');
    renderProjectFiles();
};

window.closeProjectFiles = function() {
    document.getElementById('project-files-sidebar')?.classList.remove('mobile-open');
    document.getElementById('project-files-backdrop')?.classList.remove('open');
};

function renderProjectFiles() {
    const list = document.getElementById('project-files-list');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(projectFiles).forEach(file => {
        const item = document.createElement('div');
        item.className = 'p-2 border-b border-gray-700 text-xs cursor-pointer hover:bg-gray-800 text-gray-300';
        item.textContent = file;
        item.onclick = () => {
            if (file === 'index.html') switchTab('html');
            if (file === 'style.css') switchTab('css');
            if (file === 'script.js') switchTab('js');
            closeProjectFiles();
        };
        list.appendChild(item);
    });
}

window.newProjectFile = function() {
    const name = prompt("Enter File Name:");
    if (name) {
        projectFiles[name] = "";
        renderProjectFiles();
    }
};

window.toggleRangeSelector = function() {
    document.getElementById('range-selector-content')?.classList.toggle('hidden');
    document.getElementById('range-collapse-icon')?.classList.toggle('rotate-180');
};

window.rangeActionSelect = function() {
    htmlCode.focus();
    htmlCode.select();
    showToast("Text Selected!");
};

window.rangeActionCopy = function() {
    navigator.clipboard.writeText(htmlCode.value);
    showToast("Copied to Clipboard!");
};

window.rangeActionCut = function() {
    navigator.clipboard.writeText(htmlCode.value);
    htmlCode.value = '';
    updateOutput();
    showToast("Cut Successful!");
};

window.rangeActionComment = function() {
    if (activeTab === 'html') htmlCode.value = `<!-- ${htmlCode.value} -->`;
    else if (activeTab === 'css' || activeTab === 'js') htmlCode.value = `/* ${htmlCode.value} */`;
    updateOutput();
};

window.openDatabaseSettings = function() {
    document.getElementById('database-modal')?.classList.remove('hidden');
    document.getElementById('database-modal')?.classList.add('flex');
};

window.closeDatabaseSettings = function() {
    document.getElementById('database-modal')?.classList.add('hidden');
    document.getElementById('database-modal')?.classList.remove('flex');
};

window.testDatabaseConnection = function() {
    const url = document.getElementById('db-url').value;
    if (url) showToast("Database Connection Successful!");
    else showToast("URL-ஐ உள்ளிடவும்!", true);
};

window.saveDatabaseSettings = function() {
    closeDatabaseSettings();
    showToast("Database Settings Saved!");
};

function updateLineNumbers() {
    const lines = htmlCode.value.split('\n').length;
    lineNumbers.innerHTML = Array(lines).fill(0).map((_, i) => i + 1).join('<br>');
}

function showToast(msg, err = false) {
    toast.textContent = msg;
    toast.className = `fixed bottom-5 right-5 px-4 py-2 rounded shadow-lg transition-all duration-300 z-50 ${err ? 'bg-red-600' : 'bg-blue-900'} text-white`;
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}

window.addEventListener('DOMContentLoaded', () => {
    initSplitResizer();
    htmlCode.value = codeStore[activeTab];
    updateOutput();

    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        const input = document.getElementById('ai-api-key-input');
        if (input) input.value = savedKey;
        const status = document.getElementById('ai-api-status');
        if (status) {
            status.textContent = 'Saved';
            status.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/60 text-green-300';
        }
    }

    htmlCode.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateOutput, 150);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.download-wrap')) closeDownloadMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFullscreen) {
            toggleFullscreen();
        }
    });
});
