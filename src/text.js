const INJECTION_PATTERNS = [
  /ignore\s+(previous|all)\s+instructions/gi,
  /system\s*:\s*/gi,
  /<\|.*?\|>/gi,
  /\[INST\]|\[\/INST\]/gi,
  /===\s*SYSTEM\s*(OVERRIDE|PROMPT)\s*===/gi,
];

function sanitize(query) {
  let clean = String(query).trim().slice(0, 2000);
  for (const pattern of INJECTION_PATTERNS) clean = clean.replace(pattern, '[FILTERED]');
  return clean;
}

function chunkText(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let start = 0; start < words.length; start += chunkSize - overlap) {
    chunks.push(words.slice(start, start + chunkSize).join(' '));
  }
  return chunks;
}

function extractPages(text) {
  return text.split('\f').map((page) => page.trim()).filter(Boolean);
}

module.exports = { sanitize, chunkText, extractPages };
