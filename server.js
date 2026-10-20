import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const DB_PATH = resolve(
  process.env.OPENCODE_DB || join(homedir(), '.local/share/opencode/opencode.db'),
);

if (!existsSync(DB_PATH)) {
  console.error(`OpenCode database not found: ${DB_PATH}`);
  console.error('Set OPENCODE_DB to point at a different opencode.db file.');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA query_only = ON;');

const SESSION_COLUMNS = `
  id, project_id, parent_id, slug, directory, title, path, version,
  share_url, summary_additions, summary_deletions, summary_files,
  time_created, time_updated, time_archived, agent, model, cost,
  tokens_input, tokens_output, tokens_reasoning,
  tokens_cache_read, tokens_cache_write
`;

const PART_MATCH_SQL = `(
  instr(lower(coalesce(json_extract(p.data, '$.text'), '')), ?) > 0
  OR (
    json_extract(p.data, '$.type') = 'tool'
    AND (
      instr(lower(coalesce(json_extract(p.data, '$.tool'), '')), ?) > 0
      OR instr(lower(coalesce(json_extract(p.data, '$.state.title'), '')), ?) > 0
      OR instr(lower(coalesce(json_extract(p.data, '$.state.input'), '')), ?) > 0
      OR instr(lower(coalesce(json_extract(p.data, '$.state.output'), '')), ?) > 0
      OR instr(lower(coalesce(json_extract(p.data, '$.state.error'), '')), ?) > 0
    )
  )
)`;

const statements = {
  sessions: db.prepare(
    `SELECT ${SESSION_COLUMNS} FROM session ORDER BY time_updated DESC, id ASC`,
  ),
  session: db.prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE id = ?`),
  messages: db.prepare(
    `SELECT id, session_id, time_created, time_updated, data
     FROM message WHERE session_id = ?
     ORDER BY time_created ASC, id ASC`,
  ),
  parts: db.prepare(
    `SELECT id, message_id, session_id, time_created, time_updated, data
     FROM part WHERE session_id = ?
     ORDER BY time_created ASC, id ASC`,
  ),
  searchMeta: db.prepare(
    `SELECT ${SESSION_COLUMNS} FROM session
     WHERE instr(lower(title), ?) > 0
        OR instr(lower(directory), ?) > 0
        OR instr(lower(slug), ?) > 0
        OR instr(lower(id), ?) > 0
        OR instr(lower(coalesce(agent, '')), ?) > 0
        OR instr(lower(coalesce(model, '')), ?) > 0
     ORDER BY time_updated DESC
     LIMIT 20`,
  ),
  searchGroups: db.prepare(
    `SELECT p.session_id AS session_id, COUNT(*) AS matches, MAX(p.time_created) AS last_time
     FROM part p
     WHERE ${PART_MATCH_SQL}
     GROUP BY p.session_id
     ORDER BY last_time DESC
     LIMIT ?`,
  ),
  searchParts: db.prepare(
    `SELECT p.id AS part_id, p.message_id AS message_id,
            p.data AS part_data, m.data AS message_data
     FROM part p
     JOIN message m ON m.id = p.message_id
     WHERE p.session_id = ?
       AND ${PART_MATCH_SQL}
     ORDER BY CASE json_extract(p.data, '$.type')
                WHEN 'text' THEN 0
                WHEN 'reasoning' THEN 1
                ELSE 2
              END,
              p.time_created ASC, p.id ASC
     LIMIT ?`,
  ),
};

const SEARCH_SESSION_LIMIT = 60;
const SEARCH_META_LIMIT = 20;
const SEARCH_SNIPPET_LIMIT = 4;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function text(res, status, message) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(message);
}

function sessionRow(row) {
  return {
    ...row,
    model: parseJson(row.model, null),
    share_url: row.share_url || null,
  };
}

function getTree() {
  const sessions = statements.sessions.all().map(sessionRow);
  return { database: DB_PATH, sessions };
}

function modelLabel(model) {
  if (!model) return '';
  if (typeof model === 'string') {
    try {
      return modelLabel(JSON.parse(model));
    } catch {
      return model;
    }
  }
  if (typeof model === 'object') {
    const id = model.id || model.modelID || '';
    const provider = model.providerID || model.provider || '';
    if (id && provider) return `${provider}/${id}`;
    return id || provider || '';
  }
  return '';
}

function partTextChunks(data) {
  if (!data || typeof data !== 'object') return [];
  const chunks = [];

  if (data.type === 'text' || data.type === 'reasoning') {
    if (data.text) chunks.push(String(data.text));
    return chunks;
  }

  if (data.type === 'tool') {
    if (data.tool) chunks.push(String(data.tool));
    const toolState = data.state;
    if (!toolState || typeof toolState !== 'object') return chunks;
    if (toolState.title) chunks.push(String(toolState.title));

    const add = (value) => {
      if (value === null || value === undefined) return;
      if (typeof value === 'string') {
        if (value) chunks.push(value);
      } else {
        try {
          chunks.push(JSON.stringify(value));
        } catch {}
      }
    };

    add(toolState.input);
    add(toolState.output);
    add(toolState.error);
  }

  return chunks;
}

function makeSnippetAt(text, queryLower, index) {
  const radius = 82;
  let start = Math.max(0, index - radius);
  let end = Math.min(text.length, index + queryLower.length + radius);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (!snippet) return null;
  return `${start > 0 ? '…' : ''}${snippet}${end < text.length ? '…' : ''}`;
}

function partSnippet(data, queryLower) {
  for (const chunk of partTextChunks(data)) {
    if (!chunk) continue;
    const index = chunk.toLowerCase().indexOf(queryLower);
    if (index !== -1) return makeSnippetAt(chunk, queryLower, index);
  }
  return null;
}

function metaFieldMatches(session, queryLower) {
  const fields = [];
  const add = (name, value) => {
    if (value === null || value === undefined) return;
    const text = String(value);
    if (text && text.toLowerCase().includes(queryLower)) {
      fields.push({ name, value: text });
    }
  };

  add('标题', session.title);
  add('目录', session.directory);
  add('slug', session.slug);
  add('ID', session.id);
  add('Agent', session.agent);
  add('模型', modelLabel(session.model));
  return fields.slice(0, 4);
}

function searchAll(rawQuery) {
  const query = String(rawQuery || '').trim().slice(0, 200);
  const queryLower = query.toLowerCase();
  const empty = {
    query,
    sessions: [],
    truncated: false,
    totalMatches: 0,
    sessionLimit: SEARCH_SESSION_LIMIT,
  };
  if (!query) return empty;

  const results = new Map();
  const ensure = (session) => {
    let entry = results.get(session.id);
    if (!entry) {
      entry = {
        session: {
          id: session.id,
          parent_id: session.parent_id,
          title: session.title,
          directory: session.directory,
          slug: session.slug,
          time_created: session.time_created,
          time_updated: session.time_updated,
        },
        metaMatch: false,
        metaFields: [],
        matchCount: 0,
        snippets: [],
      };
      results.set(session.id, entry);
    }
    return entry;
  };

  const metaRows = statements.searchMeta.all(
    queryLower,
    queryLower,
    queryLower,
    queryLower,
    queryLower,
    queryLower,
  );
  for (const row of metaRows.slice(0, SEARCH_META_LIMIT)) {
    const session = sessionRow(row);
    const entry = ensure(session);
    entry.metaMatch = true;
    entry.metaFields = metaFieldMatches(session, queryLower);
  }

  const groups = statements.searchGroups.all(
    ...Array(6).fill(queryLower),
    SEARCH_SESSION_LIMIT + 1,
  );
  const truncated = groups.length > SEARCH_SESSION_LIMIT;
  let totalMatches = 0;

  for (const group of groups.slice(0, SEARCH_SESSION_LIMIT)) {
    totalMatches += Number(group.matches) || 0;
    const row = statements.session.get(group.session_id);
    if (!row) continue;
    const entry = ensure(sessionRow(row));
    entry.matchCount = Number(group.matches) || 0;

    const partRows = statements.searchParts.all(
      group.session_id,
      ...Array(6).fill(queryLower),
      SEARCH_SNIPPET_LIMIT,
    );
    for (const part of partRows) {
      const partData = parseJson(part.part_data, {});
      const messageData = parseJson(part.message_data, {});
      const text = partSnippet(partData, queryLower);
      if (!text) continue;
      entry.snippets.push({
        partId: part.part_id,
        messageId: part.message_id,
        role: messageData.role || '',
        partType: partData.type || '',
        tool: partData.tool || '',
        text,
      });
    }
  }

  const sessions = [...results.values()].sort(
    (a, b) => (Number(b.session.time_updated) || 0) - (Number(a.session.time_updated) || 0),
  );

  return {
    query,
    sessions,
    truncated,
    totalMatches,
    sessionLimit: SEARCH_SESSION_LIMIT,
  };
}

function getSession(id) {
  const row = statements.session.get(id);
  if (!row) return null;

  const partsByMessage = new Map();
  for (const part of statements.parts.all(id)) {
    const list = partsByMessage.get(part.message_id);
    const item = {
      id: part.id,
      time_created: part.time_created,
      time_updated: part.time_updated,
      data: parseJson(part.data, {}),
    };
    if (list) list.push(item);
    else partsByMessage.set(part.message_id, [item]);
  }

  const messages = statements.messages.all(id).map((message) => ({
    id: message.id,
    time_created: message.time_created,
    time_updated: message.time_updated,
    data: parseJson(message.data, {}),
    parts: partsByMessage.get(message.id) || [],
  }));

  return { session: sessionRow(row), messages };
}

async function serveStatic(req, res, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return text(res, 400, 'Bad request');
  }

  if (relative === '/') relative = '/index.html';
  const filePath = resolve(PUBLIC_DIR, `.${relative}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    return text(res, 403, 'Forbidden');
  }

  try {
    const data = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': data.length,
      'cache-control': relative.startsWith('/vendor/')
        ? 'public, max-age=86400'
        : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  } catch {
    text(res, 404, 'Not found');
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    return text(res, 405, 'Method not allowed');
  }

  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    return text(res, 400, 'Bad request');
  }

  try {
    if (url.pathname === '/api/tree') {
      return json(res, 200, getTree());
    }

    if (url.pathname === '/api/search') {
      return json(res, 200, searchAll(url.searchParams.get('q') || ''));
    }

    const match = /^\/api\/session\/([^/]+)$/.exec(url.pathname);
    if (match) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        return json(res, 400, { error: 'Invalid session id' });
      }
      const data = getSession(id);
      if (!data) return json(res, 404, { error: 'Session not found' });
      return json(res, 200, data);
    }

    if (url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: 'Not found' });
    }

    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('[opencode-reader]', error);
    return json(res, 500, { error: error instanceof Error ? error.message : 'Internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OpenCode Reader: http://${HOST}:${PORT}`);
  console.log(`Database:        ${DB_PATH}`);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  try {
    db.close();
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
