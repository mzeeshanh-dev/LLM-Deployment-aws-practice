const STOP_WORDS = new Set('a an and are at by for from how in is it of on or the to what when where which with ka ke ki ko kya hai hain main mein se aur ye yeh us'.split(' '));

// Some PDFs embed a font whose character codes are shifted by 29 without a ToUnicode map.
// Detect its distinctive encoded spaces before applying this document-specific repair.
export function repairPdfText(text) {
  const encodedSpaces = (text.match(/\u0003/g) || []).length;
  if (encodedSpaces < 3 || encodedSpaces < text.length / 150) return text;
  return [...text].map(char => {
    if (char === ' ') return char;
    const code = char.charCodeAt(0);
    return code >= 3 && code <= 97 ? String.fromCharCode(code + 29) : char;
  }).join('').replace(/¶/g, '’');
}

export function csvToText(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const data = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    if (char === '"') {
      if (quoted && data[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && data[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return '';
  const headers = rows[0];
  return rows.slice(1).map((values, index) => {
    const fields = values.map((value, column) => value ? `${headers[column] || `Column ${column + 1}`}: ${value}` : '').filter(Boolean);
    return fields.length ? `Row ${index + 1} — ${fields.join('; ')}` : '';
  }).filter(Boolean).join('\n');
}

function passagesFromText(text, width = 580) {
  const passages = [];
  let current = '';
  for (const line of text.split(/\n+/).map(item => item.trim()).filter(Boolean)) {
    if (current && current.length + line.length + 1 > width) {
      passages.push(current);
      current = '';
    }
    if (line.length > width) {
      if (current) { passages.push(current); current = ''; }
      for (let i = 0; i < line.length; i += width) passages.push(line.slice(i, i + width));
    } else current += `${current ? '\n' : ''}${line}`;
  }
  if (current) passages.push(current);
  return passages;
}

export function selectPassages(text, question, maxCharacters = 3000) {
  const passages = passagesFromText(text);
  if (!passages.length) return [];
  if (text.length <= maxCharacters) return [{text: text.trim()}];
  const words = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length > 2 && !STOP_WORDS.has(word)))];
  if (!words.length) return [];
  const ranked = passages.map((passage, index) => ({
    passage, index,
    score: words.reduce((score, word) => score + (passage.toLowerCase().includes(word) ? 1 : 0), 0)
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  let used = 0;
  for (const item of ranked) {
    if (chosen.length === 5) break;
    const room = maxCharacters - used;
    if (room < 80) break;
    const snippet = item.passage.slice(0, room);
    chosen.push({text: snippet});
    used += snippet.length;
  }
  return chosen;
}
