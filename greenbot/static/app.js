import {csvToText, repairPdfText, selectPassages} from './source-utils.mjs';

const $ = selector => document.querySelector(selector);
const form = $('#chat-form');
const question = $('#question');
const context = $('#context');
const messages = $('#messages');
const conversation = $('#conversation');
const welcome = $('#welcome');
const fileInput = $('#file-input');
const keyDialog = $('#key-dialog');
const SOURCE_KEY = 'greenbot.source.v2';
const CHAT_KEY = 'greenbot.chat.v2';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_CHARS = 750000;
let source = readStored(SOURCE_KEY, null);
let chat = readStored(CHAT_KEY, []);
let apiKey = sessionStorage.getItem('greenbot_api_key') || '';
let sending = false;
let controller = null;
let ocrScriptPromise;

function loadOcr() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!ocrScriptPromise) ocrScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR failed to load.'));
    script.onerror = () => reject(new Error('OCR could not load. Check your internet connection.'));
    document.head.append(script);
  });
  return ocrScriptPromise;
}

async function ocrPage(page, pageNo, worker) {
  $('#source-hint').textContent = `Reading scanned page ${pageNo} in your browser…`;
  const viewport = page.getViewport({scale: 2});
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context2d = canvas.getContext('2d');
  await page.render({canvasContext: context2d, viewport}).promise;
  try { return (await worker.recognize(canvas)).data.text.trim(); }
  finally { canvas.width = canvas.height = 0; }
}

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function openSources() {
  $('#sidebar').classList.add('open');
  $('#sidebar-backdrop').classList.add('show');
}
function closeSources() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-backdrop').classList.remove('show');
}
function updateSourceUI() {
  const available = Boolean(source?.text?.trim());
  const grounded = available;
  $('#source-count').textContent = available ? '1' : '0';
  $('#source-hint').textContent = available ? (source.kind === 'file' ? 'Extracted text saved locally' : `${source.text.length} characters saved locally`) : 'Nothing saved yet';
  $('#file-card').hidden = source?.kind !== 'file';
  if (source?.kind === 'file') {
    $('#file-name').textContent = source.name;
    $('#file-detail').textContent = `${source.text.length.toLocaleString()} characters extracted${source.warning ? ` · ${source.warning}` : ''}`;
  }
  $('#mode-label').textContent = grounded ? 'Grounded in your source' : 'General chat';
  $('#mode-pill').classList.toggle('grounded', grounded);
  $('#mode-pill span').textContent = grounded ? 'Source grounded' : 'General chat';
  $('#composer-mode').textContent = grounded ? 'Source grounded · answers use your material' : 'General chat · no source selected';
  question.placeholder = grounded ? 'Ask about your source…' : 'Ask GreenBot anything…';
}
function setSource(next) {
  source = next;
  let saved = true;
  if (next) {
    saved = saveStored(SOURCE_KEY, next);
  } else localStorage.removeItem(SOURCE_KEY);
  updateSourceUI();
  if (!saved) $('#source-hint').textContent = 'Browser storage is full. Use a smaller source.';
}
function addMessage(text, role, mode, persist = true) {
  welcome.hidden = true;
  const row = document.createElement('div');
  row.className = `message ${role}`;
  if (role === 'bot') {
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.innerHTML = '<svg class="icon"><use href="#icon-sprout"></use></svg>';
    row.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.append(bubble);
  messages.append(row);
  if (persist) {
    chat.push({role, text, mode});
    chat = chat.slice(-40);
    saveStored(CHAT_KEY, chat);
  }
  conversation.scrollTop = conversation.scrollHeight;
  return {row, bubble};
}
function clearChat() {
  controller?.abort();
  messages.replaceChildren();
  chat = [];
  localStorage.removeItem(CHAT_KEY);
  welcome.hidden = false;
  sending = false;
  $('#send').disabled = false;
  question.focus();
}
async function extractFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file smaller than 10 MB.');
  const extension = file.name.split('.').pop().toLowerCase();
  let text = '';
  let warning = '';
  if (extension === 'csv') text = csvToText(await file.text());
  else if (extension === 'txt') text = await file.text();
  else if (extension === 'pdf') {
    const pdfjs = await import('/static/vendor/pdf.mjs?v=3');
    pdfjs.GlobalWorkerOptions.workerSrc = '/static/vendor/pdf.worker.mjs?v=3';
    const task = pdfjs.getDocument({data: new Uint8Array(await file.arrayBuffer())});
    const pdf = await task.promise;
    let ocrPages = 0;
    let skippedScans = 0;
    let unreadablePages = 0;
    let pagesChecked = 0;
    let worker;
    try {
      for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 200) && text.length < MAX_STORED_CHARS; pageNo++) {
        pagesChecked = pageNo;
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        let pageText = repairPdfText(content.items.map(item => item.str || '').join(' ')).trim();
        if (pageText.length < 50 && ocrPages < 10) {
          if (!worker) worker = await (await loadOcr()).createWorker(['eng', 'urd']);
          pageText = await ocrPage(page, pageNo, worker);
          ocrPages++;
          if (!pageText) unreadablePages++;
        } else if (pageText.length < 50) skippedScans++;
        if (pageText) text += `\nPage ${pageNo}: ${pageText}`;
      }
      const notes = [];
      if (pagesChecked < pdf.numPages) notes.push(`${pagesChecked} of ${pdf.numPages} pages checked`);
      if (ocrPages) notes.push(`OCR used on ${ocrPages} pages; verify numbers`);
      if (skippedScans || unreadablePages) notes.push(`${skippedScans + unreadablePages} unreadable pages`);
      warning = notes.join('; ');
    } finally { if (worker) await worker.terminate(); await task.destroy(); }
  } else throw new Error('Only CSV, PDF, and TXT files are supported.');
  text = text.trim().slice(0, MAX_STORED_CHARS);
  if (!text) throw new Error('No readable text found in this PDF.');
  return {kind: 'file', name: file.name.slice(0, 100), text, warning};
}
function showKeyDialog() {
  $('#api-key').value = apiKey;
  keyDialog.showModal();
  $('#api-key').focus();
}

$('#open-sources').addEventListener('click', openSources);
$('#close-sources').addEventListener('click', closeSources);
$('#sidebar-backdrop').addEventListener('click', closeSources);
$('#welcome-source').addEventListener('click', () => { openSources(); context.focus(); });
$('#clear-context').addEventListener('click', () => { context.value = ''; fileInput.value = ''; setSource(null); });
$('#clear-chat').addEventListener('click', clearChat);
$('#edit-key').addEventListener('click', showKeyDialog);
$('#cancel-key').addEventListener('click', () => keyDialog.close());
$('#key-form').addEventListener('submit', () => {
  apiKey = $('#api-key').value.trim();
  sessionStorage.setItem('greenbot_api_key', apiKey);
});
context.addEventListener('input', () => {
  const text = context.value.trim();
  setSource(text ? {kind: 'manual', text} : null);
  fileInput.value = '';
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  $('#source-hint').textContent = 'Extracting in your browser…';
  try {
    const extracted = await extractFile(file);
    context.value = '';
    setSource(extracted);
    closeSources();
  } catch (error) { $('#source-hint').textContent = error.message; }
});
const dropZone = $('#upload-zone');
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', async event => {
  event.preventDefault(); dropZone.classList.remove('dragging');
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  $('#source-hint').textContent = 'Extracting in your browser…';
  try { context.value = ''; setSource(await extractFile(file)); closeSources(); }
  catch (error) { $('#source-hint').textContent = error.message; }
});
question.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
question.addEventListener('input', () => {
  question.style.height = 'auto';
  question.style.height = `${Math.min(question.scrollHeight, 145)}px`;
});
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  question.value = button.dataset.prompt;
  question.focus();
}));

form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text || sending) return;
  const mode = source?.text ? 'grounded' : 'raw';
  const history = mode === 'raw' ? chat.filter(item => item.mode === 'raw').slice(-6).map(item => ({role: item.role === 'bot' ? 'assistant' : 'user', content: item.text.slice(0, 1000)})) : [];
  const chunks = mode === 'grounded' ? (source.kind === 'manual' ? [{text: source.text}] : selectPassages(source.text, text).map(item => ({...item, source_id: source.name}))) : [];
  if (mode === 'grounded' && !chunks.length) {
    addMessage(text, 'user', mode);
    addMessage('I could not find a matching passage in this document. Try words that appear in the document or upload a more relevant source.', 'bot', mode);
    question.value = '';
    return;
  }
  addMessage(text, 'user', mode);
  question.value = '';
  question.style.height = 'auto';
  sending = true;
  $('#send').disabled = true;
  const pending = addMessage(mode === 'grounded' ? 'Reading your source…' : 'Connecting…', 'bot', mode, false);
  pending.row.classList.add('pending');
  const started = Date.now();
  let received = false;
  const ticker = setInterval(() => { if (!received) pending.bubble.textContent = `${mode === 'grounded' ? 'Reading your source' : 'Connecting'} · ${Math.floor((Date.now() - started) / 1000)}s`; }, 1000);
  controller = new AbortController();
  try {
    const response = await fetch('/v1/chat/stream', {
      method: 'POST', signal: controller.signal,
      headers: {'Content-Type': 'application/json', ...(apiKey ? {'Authorization': `Bearer ${apiKey}`} : {})},
      body: JSON.stringify({question: text, mode, context: chunks, history})
    });
    if (response.status === 401) {
      apiKey = ''; sessionStorage.removeItem('greenbot_api_key');
      pending.row.remove(); messages.lastElementChild?.remove();
      chat.pop(); saveStored(CHAT_KEY, chat);
      welcome.hidden = chat.length > 0;
      question.value = text;
      showKeyDialog();
      return;
    }
    if (!response.ok || !response.body) throw new Error('The chat service is unavailable.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let finished = false;
    while (!finished) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true}).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventName = block.match(/^event: (.+)$/m)?.[1];
        const dataLine = block.match(/^data: (.+)$/m)?.[1];
        if (!dataLine) continue;
        const data = JSON.parse(dataLine);
        if (eventName === 'delta') {
          if (!received) { received = true; pending.row.classList.remove('pending'); }
          answer += data.text;
          pending.bubble.textContent = answer;
          conversation.scrollTop = conversation.scrollHeight;
        } else if (eventName === 'error') {
          throw new Error(data.detail || 'The chat service is unavailable.');
        } else if (eventName === 'done') { finished = true; break; }
      }
    }
    if (!finished || !answer) throw new Error('The response ended unexpectedly.');
    pending.row.classList.remove('pending');
    chat.push({role: 'bot', text: answer, mode});
    chat = chat.slice(-40); saveStored(CHAT_KEY, chat);
  } catch (error) {
    if (error.name !== 'AbortError') pending.bubble.textContent = error.message || 'Connection failed. Please try again.';
  } finally {
    clearInterval(ticker);
    sending = false; controller = null;
    $('#send').disabled = false;
    question.focus();
  }
});

if (source?.kind === 'manual') context.value = source.text;
if (!Array.isArray(chat)) chat = [];
for (const item of chat) if (item?.text && (item.role === 'user' || item.role === 'bot')) addMessage(item.text, item.role, item.mode, false);
updateSourceUI();
