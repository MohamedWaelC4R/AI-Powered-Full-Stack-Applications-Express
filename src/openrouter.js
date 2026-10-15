async function* streamCompletion(prompt, signal) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey) throw new Error('OpenRouter is not configured. Add OPENROUTER_API_KEY to your .env file.');
  if (!model) throw new Error('OpenRouter is not configured. Add OPENROUTER_MODEL to your .env file.');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:8000',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'AI Customer Support Assistant',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
    signal,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`OpenRouter returned ${response.status}: ${detail}`);
  }
  if (!response.body) throw new Error('OpenRouter returned an empty response stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() || '';
      for (const frame of frames) {
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          let payload;
          try { payload = JSON.parse(data); } catch { continue; }
          const token = payload.choices?.[0]?.delta?.content;
          if (typeof token === 'string' && token) yield token;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

module.exports = { streamCompletion };
