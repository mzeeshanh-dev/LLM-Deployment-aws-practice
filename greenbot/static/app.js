const form = document.querySelector('#chat-form');
const question = document.querySelector('#question');
const context = document.querySelector('#context');
const send = document.querySelector('#send');
const messages = document.querySelector('#messages');
const conversation = document.querySelector('#conversation');
const welcome = document.querySelector('#welcome');
const sourceState = document.querySelector('#source-state');
const keyDialog = document.querySelector('#key-dialog');
const keyForm = document.querySelector('#key-form');
let apiKey = sessionStorage.getItem('greenbot_api_key') || '';

function addMessage(text, role) {
  welcome.style.display = 'none';
  const row = document.createElement('div');
  row.className = `message ${role}`;
  if (role === 'bot') {
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = '✳';
    row.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.append(bubble);
  messages.append(row);
  conversation.scrollTop = conversation.scrollHeight;
  return bubble;
}

context.addEventListener('input', () => {
  sourceState.textContent = context.value.trim() ? 'Source ready' : 'No source added';
});
question.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
keyForm.addEventListener('submit', () => {
  apiKey = document.querySelector('#api-key').value.trim();
  sessionStorage.setItem('greenbot_api_key', apiKey);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  question.value = '';
  send.disabled = true;
  const pending = addMessage('Writing an answer from your source…', 'bot');
  try {
    const response = await fetch('/v1/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', ...(apiKey ? {'Authorization': `Bearer ${apiKey}`} : {})},
      body: JSON.stringify({question: text, context: context.value.trim() ? [{text: context.value.trim()}] : []})
    });
    if (response.status === 401) {
      pending.textContent = 'An API key is required to connect.';
      question.value = text;
      keyDialog.showModal();
      return;
    }
    const data = await response.json();
    pending.textContent = response.ok ? data.answer : (typeof data.detail === 'string' ? data.detail : 'Check the source material and try again.');
  } catch {
    pending.textContent = 'Unable to connect. Please try again.';
  } finally {
    send.disabled = false;
    question.focus();
  }
});
