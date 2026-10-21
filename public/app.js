(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);

  const els = {
    app: $('#app'),
    dbInfo: $('#db-info'),
    dbPath: $('#db-path'),
    refreshBtn: $('#refresh-btn'),
    themeBtn: $('#theme-btn'),
    sidebar: $('#sidebar'),
    splitter: $('#splitter'),
    modeTree: $('#mode-tree'),
    modeGlobal: $('#mode-global'),
    tree: $('#tree'),
    searchResults: $('#search-results'),
    treeSearch: $('#tree-search'),
    treeClear: $('#tree-clear'),
    treeStats: $('#tree-stats'),
    sidebarHint: $('#sidebar-hint'),
    sessionHead: $('#session-head'),
    findbar: $('#findbar'),
    conversation: $('#conversation'),
    contentSearch: $('#content-search'),
    findCount: $('#find-count'),
    findPrev: $('#find-prev'),
    findNext: $('#find-next'),
    findClose: $('#find-close'),
    questionsPanel: $('#questions-panel'),
    questionsBackdrop: $('#questions-backdrop'),
    questionsClose: $('#questions-close'),
    questionsFilter: $('#questions-filter'),
    questionsList: $('#questions-list'),
    questionsCount: $('#questions-count'),
  };

  const WELCOME_HTML = els.conversation.innerHTML;
  const HEAD_EMPTY_HTML = els.sessionHead.innerHTML;

  const state = {
    sessions: [],
    tree: null,
    dirCount: 0,
    expanded: new Set(),
    selectedId: null,
    session: null,
    query: '',
    searchMode: 'tree',
    treeSearchText: '',
    globalSearchText: '',
    global: {
      query: '',
      sessions: [],
      truncated: false,
      totalMatches: 0,
      loading: false,
      error: '',
      controller: null,
    },
    searchSeq: 0,
    turns: [],
    turnFilter: '',
    questionsOpen: false,
    abortController: null,
    find: {
      query: '',
      hits: [],
      index: -1,
      capped: false,
    },
  };

  const THEME_KEY = 'opencode-reader:theme';
  const SIDEBAR_KEY = 'opencode-reader:sidebar-width';
  const MAX_FIND_HITS = 3000;

  const ICONS = {
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    chat:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.4 9.4 0 0 1-3.8-.8L3 21l1.9-4.6A8.2 8.2 0 0 1 3.5 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.5 8.4z"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    cpu:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></svg>',
    coin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.7-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8 0 2.8 5 1.1 5 3.9 0 1.1-1.1 1.8-2.5 1.8-1.1 0-2-.5-2.5-1.2M12 6.5v11"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2z"/></svg>',
    list:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.2" cy="6" r="1.2"/><circle cx="4.2" cy="12" r="1.2"/><circle cx="4.2" cy="18" r="1.2"/></svg>',
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function highlightHtml(text, query, markClass = 'tree-hit') {
    const source = String(text);
    if (!query) return escapeHtml(source);
    const lower = source.toLowerCase();
    const q = query.toLowerCase();
    let index = lower.indexOf(q);
    if (index === -1) return escapeHtml(source);

    let out = '';
    let position = 0;
    while (index !== -1) {
      out += escapeHtml(source.slice(position, index));
      out += `<mark class="${escapeAttr(markClass)}">${escapeHtml(source.slice(index, index + q.length))}</mark>`;
      position = index + q.length;
      index = lower.indexOf(q, position);
    }
    out += escapeHtml(source.slice(position));
    return out;
  }

  function truncate(value, length) {
    const text = String(value);
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function oneLine(value) {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function previewText(value, length) {
    return truncate(oneLine(value), length);
  }

  function pretty(value) {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function formatDate(ms) {
    if (!ms) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  }

  function formatClock(ms) {
    if (!ms) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  }

  function formatShortDate(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatListTime(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
  }

  function formatTokens(value) {
    const number = Number(value) || 0;
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1)}k`;
    return String(number);
  }

  function formatCost(value) {
    const number = Number(value) || 0;
    if (!number) return '$0';
    if (number < 0.01) return `$${number.toFixed(4)}`;
    return `$${number.toFixed(2)}`;
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

  function mdRender(text) {
    if (!text) return '';
    const html = marked.parse(String(text), { gfm: true, breaks: true });
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'style',
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'option',
        'iframe',
        'object',
        'embed',
        'video',
        'audio',
      ],
      FORBID_ATTR: ['style'],
    });
  }

  function prepareRenderedContent(root) {
    root.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (/^(?:javascript|vbscript|data):/i.test(href)) {
        anchor.removeAttribute('href');
        return;
      }
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    });
    root.querySelectorAll('img').forEach((image) => {
      image.loading = 'lazy';
      image.decoding = 'async';
    });
  }

  /* ---------------- tree data ---------------- */

  function buildTree(sessions) {
    const root = {
      name: '',
      path: '/',
      children: new Map(),
      sessions: [],
      count: 0,
    };

    for (const session of sessions) {
      const segments = String(session.directory || '/')
        .split('/')
        .filter(Boolean);
      let node = root;
      let path = '';
      for (const segment of segments) {
        path += `/${segment}`;
        let child = node.children.get(segment);
        if (!child) {
          child = {
            name: segment,
            path,
            children: new Map(),
            sessions: [],
            count: 0,
          };
          node.children.set(segment, child);
        }
        node = child;
      }
      node.sessions.push(session);
    }

    const finish = (node) => {
      let count = node.sessions.length;
      for (const child of node.children.values()) {
        count += finish(child);
      }
      node.count = count;
      return count;
    };
    finish(root);
    return root;
  }

  function filterTree(root, query) {
    const matches = (session) =>
      (session._search || '').includes(query);

    const filterNode = (node) => {
      const children = new Map();
      for (const [name, child] of node.children) {
        const filtered = filterNode(child);
        if (filtered) children.set(name, filtered);
      }
      const sessions = node.sessions.filter(matches);
      if (!children.size && !sessions.length) return null;
      let count = sessions.length;
      for (const child of children.values()) count += child.count;
      return {
        name: node.name,
        path: node.path,
        children,
        sessions,
        count,
      };
    };

    const children = new Map();
    for (const [name, child] of root.children) {
      const filtered = filterNode(child);
      if (filtered) children.set(name, filtered);
    }
    const sessions = root.sessions.filter(matches);
    let count = sessions.length;
    for (const child of children.values()) count += child.count;
    return {
      name: '',
      path: '/',
      children,
      sessions,
      count,
    };
  }

  function countDirectoryNodes(node) {
    let count = 0;
    for (const child of node.children.values()) {
      count += 1 + countDirectoryNodes(child);
    }
    return count;
  }

  function compareDirectories(a, b) {
    return a.name.localeCompare(b.name, 'zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  function sortedSessions(sessions) {
    return [...sessions].sort(
      (a, b) => (Number(b.time_updated) || 0) - (Number(a.time_updated) || 0),
    );
  }

  function autoExpandDefault() {
    if (!state.tree) return;
    const expand = (node, depth) => {
      if (depth > 2) return;
      state.expanded.add(node.path);
      for (const child of node.children.values()) {
        expand(child, depth + 1);
      }
    };
    for (const child of state.tree.children.values()) {
      expand(child, 1);
    }
  }

  function expandAncestors(directory) {
    const segments = String(directory || '')
      .split('/')
      .filter(Boolean);
    let path = '';
    let changed = false;
    for (const segment of segments) {
      path += `/${segment}`;
      if (!state.expanded.has(path)) {
        state.expanded.add(path);
        changed = true;
      }
    }
    return changed;
  }

  function findSession(id) {
    return state.sessions.find((session) => session.id === id) || null;
  }

  /* ---------------- tree rendering ---------------- */

  function buildDirectoryElement(node, depth, query) {
    const expanded = query ? true : state.expanded.has(node.path);
    const item = document.createElement('div');
    item.className = `tree-item${expanded ? ' expanded' : ''}`;
    item.dataset.path = node.path;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tree-row dir';
    row.dataset.action = 'toggle';
    row.dataset.path = node.path;
    row.style.setProperty('--depth', String(depth));
    row.title = node.path;
    row.setAttribute('aria-expanded', String(expanded));
    row.innerHTML =
      `<span class="twisty">${ICONS.chevron}</span>` +
      `<span class="tree-icon">${ICONS.folder}</span>` +
      `<span class="tree-label">${highlightHtml(node.name, query)}</span>` +
      `<span class="tree-count">${node.count}</span>`;

    item.appendChild(row);

    if (expanded) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      children.setAttribute('role', 'group');

      const directories = [...node.children.values()].sort(compareDirectories);
      for (const child of directories) {
        children.appendChild(buildDirectoryElement(child, depth + 1, query));
      }
      for (const session of sortedSessions(node.sessions)) {
        children.appendChild(buildSessionElement(session, depth + 1, query));
      }
      item.appendChild(children);
    }

    return item;
  }

  function buildSessionElement(session, depth, query) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.id = session.id;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `tree-row session${state.selectedId === session.id ? ' active' : ''}`;
    row.dataset.action = 'open';
    row.dataset.id = session.id;
    row.dataset.path = `${session.directory}/${session.id}`;
    row.style.setProperty('--depth', String(depth));
    row.title = `${session.title || '(无标题)'}\n${session.directory}\n${session.slug || ''}\n${session.id}`;
    if (state.selectedId === session.id) row.setAttribute('aria-current', 'true');

    const subBadge = session.parent_id
      ? '<span class="sub-badge" title="子代理会话">子</span>'
      : '';
    row.innerHTML =
      '<span class="twisty placeholder"></span>' +
      `<span class="tree-icon">${ICONS.chat}</span>` +
      `<span class="tree-label">${highlightHtml(session.title || '(无标题)', query)}</span>` +
      subBadge +
      `<span class="tree-date">${formatShortDate(session.time_updated)}</span>`;

    item.appendChild(row);
    return item;
  }

  function renderTree() {
    if (!state.tree) return;

    const scrollTop = els.tree.scrollTop;
    const source = state.query ? filterTree(state.tree, state.query) : state.tree;
    const fragment = document.createDocumentFragment();

    const directories = [...source.children.values()].sort(compareDirectories);
    for (const child of directories) {
      fragment.appendChild(buildDirectoryElement(child, 0, state.query));
    }
    for (const session of sortedSessions(source.sessions)) {
      fragment.appendChild(buildSessionElement(session, 0, state.query));
    }

    els.tree.replaceChildren(fragment);
    els.tree.scrollTop = scrollTop;

    if (source.count === 0 && state.sessions.length) {
      els.tree.innerHTML = `<div class="tree-empty">没有匹配 “${escapeHtml(els.treeSearch.value.trim())}” 的会话</div>`;
    } else if (!state.sessions.length) {
      els.tree.innerHTML = '<div class="tree-empty">数据库中没有会话</div>';
    }

    updateTreeStats(source);
  }

  function updateTreeStats(source) {
    if (state.searchMode !== 'tree') return;
    const total = state.sessions.length;
    if (state.query) {
      els.treeStats.textContent = `匹配 ${source.count} / ${total} 个会话`;
    } else {
      els.treeStats.textContent = `${total} 个会话 · ${state.dirCount} 个目录`;
    }
  }

  function setModeUI(mode) {
    const treeMode = mode === 'tree';
    els.modeTree.classList.toggle('active', treeMode);
    els.modeGlobal.classList.toggle('active', !treeMode);
    els.modeTree.setAttribute('aria-selected', String(treeMode));
    els.modeGlobal.setAttribute('aria-selected', String(!treeMode));
    els.tree.hidden = !treeMode;
    els.searchResults.hidden = treeMode;
    els.treeSearch.placeholder = treeMode
      ? '搜索会话、目录、ID…'
      : '搜索所有会话内容…';
    els.sidebarHint.textContent = treeMode ? 'Ctrl+K 搜对话' : 'Enter 打开首个结果';
  }

  function resultTypeLabel(snippet) {
    if (snippet.partType === 'tool') return snippet.tool || '工具';
    if (snippet.partType === 'reasoning') return '思考';
    if (snippet.partType === 'text') {
      return snippet.role === 'user' ? '你' : '助手';
    }
    if (snippet.partType === 'compaction') return '压缩';
    return snippet.partType || '内容';
  }

  function updateGlobalStats() {
    if (state.searchMode !== 'global') return;
    const global = state.global;
    if (global.loading) {
      els.treeStats.textContent = '正在搜索…';
    } else if (global.error) {
      els.treeStats.textContent = '搜索失败';
    } else if (!global.query) {
      els.treeStats.textContent = '全局搜索';
    } else if (!global.sessions.length) {
      els.treeStats.textContent = '没有匹配结果';
    } else {
      els.treeStats.textContent =
        `找到 ${global.sessions.length} 个会话 · ${global.totalMatches} 处匹配` +
        (global.truncated ? '+' : '');
    }
  }

  function renderGlobalResults() {
    const global = state.global;

    if (global.loading) {
      els.searchResults.innerHTML =
        '<div class="search-loading"><div class="spinner"></div>正在搜索整个数据库…</div>';
      return;
    }

    if (global.error) {
      els.searchResults.innerHTML =
        `<div class="search-error">搜索失败<br>${escapeHtml(global.error)}</div>`;
      return;
    }

    if (!global.query) {
      els.searchResults.innerHTML =
        '<div class="search-hint">' +
        '<div class="hint-title">全局内容搜索</div>' +
        '搜索所有会话的消息、思考过程与工具输出。<br>' +
        '点击结果可直接定位到对应片段。' +
        '</div>';
      return;
    }

    if (!global.sessions.length) {
      els.searchResults.innerHTML =
        `<div class="search-empty">没有找到 “${escapeHtml(global.query)}” 的相关内容</div>`;
      return;
    }

    const query = global.query;
    const html = [];

    html.push(
      `<div class="search-summary"><span>找到 ${global.sessions.length} 个会话 · ${global.totalMatches} 处匹配` +
        (global.truncated ? `（仅显示前 ${global.sessions.length} 个）` : '') +
        '</span></div>',
    );

    for (const result of global.sessions) {
      const session = result.session;
      const snippets = result.snippets || [];
      const countLabel = result.matchCount ? `${result.matchCount} 处` : '元数据';
      const sessionId = escapeAttr(session.id);
      const title = highlightHtml(session.title || '(无标题)', query, 'result-hit');
      const path = highlightHtml(session.directory || '', query, 'result-hit');

      const extraMeta = (result.metaFields || [])
        .filter((field) => field.name !== '标题' && field.name !== '目录')
        .map(
          (field) =>
            `<div class="result-meta-field"><b>${escapeHtml(field.name)}</b>${highlightHtml(field.value, query, 'result-hit')}</div>`,
        )
        .join('');

      const snippetHtml = snippets
        .map(
          (snippet) =>
            `<button class="result-snippet" type="button" data-session-id="${sessionId}" data-message-id="${escapeAttr(snippet.messageId || '')}" data-part-id="${escapeAttr(snippet.partId || '')}">` +
            `<span class="result-type">${escapeHtml(resultTypeLabel(snippet))}</span>` +
            `<span class="result-text">${highlightHtml(snippet.text, query, 'result-hit')}</span>` +
            '</button>',
        )
        .join('');

      const more =
        result.matchCount > snippets.length
          ? `<div class="result-more">还有 ${result.matchCount - snippets.length} 个匹配片段未显示</div>`
          : '';

      html.push(
        `<section class="result-session" data-session-id="${sessionId}">` +
          `<button class="result-head" type="button" data-action="open-session" data-session-id="${sessionId}">` +
          `<span class="result-title-row"><span class="result-title">${title}</span><span class="result-count">${escapeHtml(countLabel)}</span></span>` +
          `<span class="result-path">${path}</span>` +
          extraMeta +
          '</button>' +
          (snippets.length
            ? `<div class="result-snippets">${snippetHtml}${more}</div>`
            : '') +
          '</section>',
      );
    }

    els.searchResults.innerHTML = html.join('');
  }

  function resetGlobalSearch() {
    if (state.global.controller) state.global.controller.abort();
    state.searchSeq += 1;
    state.global = {
      query: '',
      sessions: [],
      truncated: false,
      totalMatches: 0,
      loading: false,
      error: '',
      controller: null,
    };
    renderGlobalResults();
  }

  async function runGlobalSearch(rawQuery) {
    const query = String(rawQuery || '').trim();
    state.globalSearchText = els.treeSearch.value;

    if (state.global.controller) state.global.controller.abort();
    const seq = ++state.searchSeq;

    if (!query) {
      state.global = {
        query: '',
        sessions: [],
        truncated: false,
        totalMatches: 0,
        loading: false,
        error: '',
        controller: null,
      };
      renderGlobalResults();
      updateGlobalStats();
      return;
    }

    const controller = new AbortController();
    state.global = {
      query,
      sessions: [],
      truncated: false,
      totalMatches: 0,
      loading: true,
      error: '',
      controller,
    };
    renderGlobalResults();
    updateGlobalStats();

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (seq !== state.searchSeq) return;

      state.global = {
        query: payload.query || query,
        sessions: payload.sessions || [],
        truncated: Boolean(payload.truncated),
        totalMatches: Number(payload.totalMatches) || 0,
        loading: false,
        error: '',
        controller: null,
      };
      renderGlobalResults();
      updateGlobalStats();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (seq !== state.searchSeq) return;
      state.global = {
        query,
        sessions: [],
        truncated: false,
        totalMatches: 0,
        loading: false,
        error: error?.message || '未知错误',
        controller: null,
      };
      renderGlobalResults();
      updateGlobalStats();
    }
  }

  function setSearchMode(mode, options = {}) {
    if (mode !== 'tree' && mode !== 'global') return;

    if (state.searchMode === mode) {
      if (options.focus !== false) {
        els.treeSearch.focus();
        if (els.treeSearch.value) els.treeSearch.select();
      }
      return;
    }

    if (state.searchMode === 'tree') state.treeSearchText = els.treeSearch.value;
    else state.globalSearchText = els.treeSearch.value;

    state.searchMode = mode;
    setModeUI(mode);

    els.treeSearch.value =
      mode === 'tree' ? state.treeSearchText : state.globalSearchText;
    els.treeClear.hidden = !els.treeSearch.value;

    if (mode === 'tree') {
      if (state.global.controller) {
        state.global.controller.abort();
        state.global.controller = null;
        state.searchSeq += 1;
      }
      applyTreeSearch();
    } else if (els.treeSearch.value.trim()) {
      runGlobalSearch(els.treeSearch.value);
    } else {
      resetGlobalSearch();
      updateGlobalStats();
    }

    if (options.focus !== false) {
      els.treeSearch.focus();
      if (els.treeSearch.value) els.treeSearch.select();
    }
  }

  function revealActive() {
    const row = els.tree.querySelector('.tree-row.session.active');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------- markdown parts ---------------- */

  function pre(text, className = '') {
    return `<pre${className ? ` class="${escapeAttr(className)}"` : ''}>${escapeHtml(text)}</pre>`;
  }

  function section(label, inner) {
    return `<div class="tool-section"><div class="tool-section-label">${escapeHtml(label)}</div>${inner}</div>`;
  }

  function renderTextPart(part) {
    const data = part.data || {};
    const text = data.text || '';
    if (!text.trim()) return '';
    const note = data.synthetic
      ? '<div class="synthetic-note">自动消息</div>'
      : '';
    return `<div class="text-part markdown" data-part-id="${escapeAttr(part.id || '')}">${note}${mdRender(text)}</div>`;
  }

  function renderReasoningPart(part) {
    const data = part.data || {};
    const text = data.text || '';
    if (!text.trim()) return '';
    const duration = formatDuration((data.time?.end || 0) - (data.time?.start || 0));
    return (
      `<details class="part reasoning" data-part-id="${escapeAttr(part.id || '')}">` +
      '<summary>' +
      `<span class="chev">${ICONS.chevron}</span>` +
      '<span class="part-label">思考过程</span>' +
      (duration ? `<span class="part-sub">${escapeHtml(duration)}</span>` : '') +
      '</summary>' +
      `<div class="reasoning-body markdown">${mdRender(text)}</div>` +
      '</details>'
    );
  }

  const STATUS_LABELS = {
    completed: '完成',
    error: '失败',
    running: '运行中',
    pending: '等待',
    unknown: '未知',
  };

  function pickToolDetail(input, title) {
    if (title && String(title).trim()) {
      return truncate(oneLine(title), 110);
    }
    if (!input || typeof input !== 'object') return '';
    for (const key of [
      'description',
      'command',
      'filePath',
      'path',
      'pattern',
      'query',
      'name',
      'prompt',
      'url',
    ]) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) {
        return truncate(oneLine(value), 110);
      }
    }
    for (const value of Object.values(input)) {
      if (typeof value === 'string' && value.trim()) {
        return truncate(oneLine(value), 110);
      }
    }
    return '';
  }

  function renderToolInput(tool, input) {
    if (input === null || input === undefined) return '';
    if (typeof input !== 'object') {
      return input === '' ? '' : section('参数', pre(input));
    }

    const chunks = [];

    if (tool === 'bash') {
      const meta = [input.description, input.workdir].filter(Boolean);
      if (meta.length) chunks.push(`<div class="tool-meta">${escapeHtml(meta.join(' · '))}</div>`);
      if (input.command) chunks.push(section('命令', pre(input.command)));
      if (input.timeout) {
        chunks.push(`<div class="tool-meta">超时：${escapeHtml(input.timeout)} ms</div>`);
      }
      return chunks.join('');
    }

    if (tool === 'edit') {
      if (input.filePath) chunks.push(section('文件', pre(input.filePath)));
      if (input.oldString !== undefined && input.oldString !== '') {
        chunks.push(section('原内容', pre(input.oldString, 'diff-old')));
      }
      if (input.newString !== undefined && input.newString !== '') {
        chunks.push(section('新内容', pre(input.newString, 'diff-new')));
      }
      const extra = { ...input };
      delete extra.filePath;
      delete extra.oldString;
      delete extra.newString;
      if (Object.keys(extra).length) {
        chunks.push(section('其它参数', pre(pretty(extra))));
      }
      return chunks.join('');
    }

    if (tool === 'write') {
      if (input.filePath) chunks.push(section('文件', pre(input.filePath)));
      if (input.content !== undefined && input.content !== '') {
        chunks.push(section('内容', pre(input.content, 'diff-new')));
      }
      const extra = { ...input };
      delete extra.filePath;
      delete extra.content;
      if (Object.keys(extra).length) {
        chunks.push(section('其它参数', pre(pretty(extra))));
      }
      return chunks.join('');
    }

    if (tool === 'read') {
      const meta = [];
      if (input.filePath) meta.push(input.filePath);
      if (input.offset !== undefined) meta.push(`offset ${input.offset}`);
      if (input.limit !== undefined) meta.push(`limit ${input.limit}`);
      if (meta.length) {
        return `<div class="tool-meta">${escapeHtml(meta.join(' · '))}</div>`;
      }
    }

    const keys = Object.keys(input);
    if (keys.length) {
      chunks.push(section('参数', pre(pretty(input))));
    }
    return chunks.join('');
  }

  function renderToolPart(part) {
    const data = part.data || {};
    const toolState = data.state || {};
    const status = STATUS_LABELS[toolState.status] ? toolState.status : 'unknown';
    const label = STATUS_LABELS[status];
    const detail = pickToolDetail(toolState.input, toolState.title);
    const inputHtml = renderToolInput(data.tool, toolState.input);

    const chunks = [];
    if (inputHtml) chunks.push(inputHtml);

    const output = toolState.output;
    if (output !== undefined && output !== null && String(output) !== '') {
      chunks.push(section('输出', pre(typeof output === 'string' ? output : pretty(output))));
    }

    if (toolState.error) {
      chunks.push(
        section(
          '错误',
          pre(typeof toolState.error === 'string' ? toolState.error : pretty(toolState.error), 'tool-error'),
        ),
      );
    }

    if (!chunks.length) {
      chunks.push('<div class="tool-meta">没有可显示的内容</div>');
    }

    return (
      `<details class="part tool status-${escapeAttr(status)}" data-part-id="${escapeAttr(part.id || '')}">` +
      '<summary>' +
      `<span class="chev">${ICONS.chevron}</span>` +
      '<span class="tool-dot"></span>' +
      `<span class="tool-name">${escapeHtml(data.tool || 'tool')}</span>` +
      `<span class="tool-detail" title="${escapeAttr(detail)}">${escapeHtml(detail)}</span>` +
      `<span class="tool-status">${escapeHtml(label)}</span>` +
      '</summary>' +
      `<div class="tool-body">${chunks.join('')}</div>` +
      '</details>'
    );
  }

  function renderUserMessage(message) {
    const parts = message.parts || [];
    const chunks = [];

    for (const part of parts) {
      const type = part.data?.type;
      if (type === 'text') {
        chunks.push(renderTextPart(part));
      } else if (type === 'compaction') {
        chunks.push('<div class="compaction">上下文已压缩</div>');
      }
    }

    const body = chunks.join('');
    if (!body.trim()) return '';

    const created = message.data?.time?.created || message.time_created;
    return (
      `<article class="msg msg-user" data-message-id="${escapeAttr(message.id || '')}">` +
      '<header class="msg-head">' +
      '<span class="avatar">你</span>' +
      '<span class="msg-role">你</span>' +
      `<span class="msg-time" title="${escapeAttr(formatDate(created))}">${escapeHtml(formatClock(created))}</span>` +
      '</header>' +
      `<div class="msg-body">${body}</div>` +
      '</article>'
    );
  }

  function renderAssistantMessage(message) {
    const data = message.data || {};
    const parts = message.parts || [];
    const chunks = [];

    for (const part of parts) {
      const type = part.data?.type;
      if (type === 'text') chunks.push(renderTextPart(part));
      else if (type === 'reasoning') chunks.push(renderReasoningPart(part));
      else if (type === 'tool') chunks.push(renderToolPart(part));
      else if (type === 'compaction') chunks.push('<div class="compaction">上下文已压缩</div>');
    }

    let errorHtml = '';
    if (data.error) {
      const name = data.error.name || '错误';
      const messageText = data.error.data?.message || data.error.message || '';
      errorHtml = `<div class="msg-error">${escapeHtml(name)}${messageText ? `: ${escapeHtml(messageText)}` : ''}</div>`;
    }

    const body = chunks.join('');
    if (!body.trim() && !errorHtml) return '';

    const created = data.time?.created || message.time_created;
    const completed = data.time?.completed;
    const duration = completed && created ? formatDuration(completed - created) : '';
    const model = data.modelID
      ? [data.providerID, data.modelID].filter(Boolean).join('/')
      : '';

    return (
      `<article class="msg msg-assistant" data-message-id="${escapeAttr(message.id || '')}">` +
      '<header class="msg-head">' +
      '<span class="avatar">AI</span>' +
      '<span class="msg-role">助手</span>' +
      (model
        ? `<span class="msg-model" title="${escapeAttr(model)}">${escapeHtml(model)}</span>`
        : '') +
      (duration ? `<span class="part-sub">${escapeHtml(duration)}</span>` : '') +
      `<span class="msg-time" title="${escapeAttr(formatDate(created))}">${escapeHtml(formatClock(created))}</span>` +
      '</header>' +
      errorHtml +
      (body.trim() ? `<div class="msg-body">${body}</div>` : '') +
      '</article>'
    );
  }

  function renderConversation(messages) {
    let html = '';
    for (const message of messages) {
      const role = message.data?.role;
      if (role === 'user') html += renderUserMessage(message);
      else if (role === 'assistant') html += renderAssistantMessage(message);
    }
    return html;
  }

  /* ---------------- question navigator ---------------- */

  function messageText(message) {
    return (message.parts || [])
      .filter(
        (part) =>
          part.data?.type === 'text' &&
          !part.data?.synthetic &&
          String(part.data.text || '').trim(),
      )
      .map((part) => String(part.data.text).trim())
      .join('\n\n');
  }

  function buildTurns(messages) {
    const turns = [];
    let current = null;

    for (const message of messages) {
      const role = message.data?.role;
      const created = message.data?.time?.created || message.time_created || 0;

      if (role === 'user') {
        const text = messageText(message);
        if (!text) continue;

        current = {
          index: turns.length + 1,
          userMessageId: message.id,
          time: created,
          question: text,
          answer: '',
          answerTexts: [],
          answerMessageId: null,
          answerTime: 0,
        };
        turns.push(current);
      } else if (role === 'assistant' && current) {
        const text = messageText(message);
        if (!text) continue;

        if (!current.answerMessageId) current.answerMessageId = message.id;
        current.answerTexts.push(text);
        current.answer = current.answer ? `${current.answer}\n\n${text}` : text;
        if (!current.answerTime) current.answerTime = created;
      }
    }

    for (const turn of turns) {
      turn.questionPreview = previewText(turn.question, 220);
      turn.answerPreview = turn.answer
        ? previewText(turn.answerTexts[turn.answerTexts.length - 1] || turn.answer, 260)
        : '';
      turn.searchText = `${turn.question}\n${turn.answer}`.toLowerCase();
    }

    return turns;
  }

  function renderQuestionList() {
    const total = state.turns.length;
    const filter = state.turnFilter;
    const filtered = filter
      ? state.turns.filter((turn) => turn.searchText.includes(filter))
      : state.turns;

    els.questionsCount.textContent = filter ? `${filtered.length}/${total}` : String(total);

    if (!total) {
      els.questionsList.innerHTML =
        '<div class="questions-empty">这个会话还没有你的提问</div>';
      return;
    }

    if (!filtered.length) {
      els.questionsList.innerHTML =
        `<div class="questions-empty">没有匹配 “${escapeHtml(els.questionsFilter.value.trim())}” 的提问</div>`;
      return;
    }

    els.questionsList.innerHTML = filtered
      .map((turn) => {
        const question = filter
          ? highlightHtml(turn.questionPreview, filter, 'turn-hit')
          : escapeHtml(turn.questionPreview);
        const answer = turn.answer
          ? filter
            ? highlightHtml(turn.answerPreview, filter, 'turn-hit')
            : escapeHtml(turn.answerPreview)
          : '<span class="turn-no-answer">（该轮回复暂无文本内容）</span>';
        const meta = `${formatListTime(turn.time)} · ${turn.answer ? '已回复' : '未回复'}`;

        return (
          `<button class="turn-item" type="button" data-user-id="${escapeAttr(turn.userMessageId)}" title="跳转到这条提问，回复紧随其后">` +
          `<span class="turn-index">${String(turn.index).padStart(2, '0')}</span>` +
          '<span class="turn-content">' +
          `<span class="turn-meta">${escapeHtml(meta)}</span>` +
          `<span class="turn-question">${question}</span>` +
          `<span class="turn-answer">${answer}</span>` +
          '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function openQuestionsPanel() {
    if (!state.turns.length) return;
    state.questionsOpen = true;
    els.questionsPanel.hidden = false;
    els.questionsBackdrop.hidden = false;
    renderQuestionList();
    window.requestAnimationFrame(() => {
      els.questionsFilter.focus();
      els.questionsFilter.select();
    });
  }

  function closeQuestionsPanel(options = {}) {
    if (!state.questionsOpen) return;
    state.questionsOpen = false;
    els.questionsPanel.hidden = true;
    els.questionsBackdrop.hidden = true;
    if (options.restoreFocus !== false) {
      els.sessionHead.querySelector('#questions-btn')?.focus();
    }
  }

  function toggleQuestionsPanel() {
    if (state.questionsOpen) closeQuestionsPanel();
    else openQuestionsPanel();
  }

  function scrollConversationTo(element) {
    const container = els.conversation;
    const top =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      14;
    container.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }

  function jumpToTurn(userMessageId) {
    const target = querySelectorForId('data-message-id', userMessageId);
    if (!target) return;

    closeQuestionsPanel({ restoreFocus: false });
    scrollConversationTo(target);
    flashElement(target);

    let sibling = target.nextElementSibling;
    while (sibling) {
      if (sibling.classList?.contains('msg-user')) break;
      if (sibling.classList?.contains('msg-assistant')) {
        flashElement(sibling);
        break;
      }
      sibling = sibling.nextElementSibling;
    }
  }

  /* ---------------- session rendering ---------------- */

  function sessionHeaderHtml(session, messageCount, turnCount) {
    const model = modelLabel(session.model);
    const tokenTotal =
      (Number(session.tokens_input) || 0) +
      (Number(session.tokens_output) || 0) +
      (Number(session.tokens_reasoning) || 0);
    const tokenTitle =
      `输入 ${session.tokens_input || 0} · 输出 ${session.tokens_output || 0} · ` +
      `推理 ${session.tokens_reasoning || 0} · 缓存读 ${session.tokens_cache_read || 0} · ` +
      `缓存写 ${session.tokens_cache_write || 0}`;

    const questionsButton = turnCount
      ? `<button class="session-action" id="questions-btn" type="button" aria-haspopup="dialog" title="跳转到我的提问 (Ctrl+Shift+Q)">` +
        `${ICONS.list}<span>我的提问</span><span class="action-count">${turnCount}</span>` +
        '</button>'
      : '';

    return (
      '<div class="session-title-row">' +
      `<h1 class="session-title">${escapeHtml(session.title || '(无标题会话)')}</h1>` +
      questionsButton +
      '</div>' +
      '<div class="session-meta">' +
      `<span class="meta-item" title="${escapeAttr(session.directory || '')}">${ICONS.folder}<span class="ellipsis">${escapeHtml(session.directory || '')}</span></span>` +
      '<span class="meta-sep"></span>' +
      `<span class="meta-item" title="创建时间">${ICONS.clock}<span>${escapeHtml(formatDate(session.time_created))}</span></span>` +
      `<span class="meta-item" title="最后更新时间">更新于 ${escapeHtml(formatDate(session.time_updated))}</span>` +
      (model
        ? `<span class="meta-item" title="模型">${ICONS.cpu}<span class="ellipsis">${escapeHtml(model)}</span></span>`
        : '') +
      `<span class="meta-badge">${messageCount} 条消息</span>` +
      (tokenTotal
        ? `<span class="meta-badge" title="${escapeAttr(tokenTitle)}">${escapeHtml(formatTokens(tokenTotal))} tokens</span>`
        : '') +
      (Number(session.cost)
        ? `<span class="meta-badge" title="会话费用">${ICONS.coin}${escapeHtml(formatCost(session.cost))}</span>`
        : '') +
      `<span class="meta-item code" title="会话 ID"><span class="ellipsis">${escapeHtml(session.id)}</span></span>` +
      (session.parent_id
        ? `<span class="meta-item"><a href="#session=${encodeURIComponent(session.parent_id)}">父会话</a></span>`
        : '') +
      '</div>'
    );
  }

  function renderSession(payload) {
    const { session, messages } = payload;
    const turns = buildTurns(messages);

    closeQuestionsPanel({ restoreFocus: false });
    state.turns = turns;
    state.turnFilter = '';
    els.questionsFilter.value = '';

    els.findbar.hidden = false;
    els.sessionHead.classList.remove('is-empty');
    els.sessionHead.innerHTML = sessionHeaderHtml(session, messages.length, turns.length);

    els.conversation.innerHTML =
      renderConversation(messages) ||
      '<div class="welcome"><h2>这个会话没有可显示的消息</h2></div>';

    prepareRenderedContent(els.conversation);
    els.conversation.scrollTop = 0;
    resetFindUI(true);
    document.title = `${session.title || '会话'} · OpenCode Reader`;
  }

  function setViewerLoading(summary) {
    closeQuestionsPanel({ restoreFocus: false });
    state.turns = [];
    state.turnFilter = '';
    els.questionsFilter.value = '';
    els.findbar.hidden = true;
    els.sessionHead.classList.remove('is-empty');
    if (summary) {
      els.sessionHead.innerHTML =
        `<div class="session-title-row"><h1 class="session-title">${escapeHtml(summary.title || '(无标题会话)')}</h1></div>` +
        '<div class="session-meta">' +
        `<span class="meta-item" title="${escapeAttr(summary.directory || '')}">${ICONS.folder}<span class="ellipsis">${escapeHtml(summary.directory || '')}</span></span>` +
        '</div>';
    } else {
      els.sessionHead.innerHTML =
        '<div class="head-empty"><div class="head-empty-title">正在加载会话…</div></div>';
    }
    els.conversation.innerHTML =
      '<div class="viewer-loading"><div class="spinner"></div><div>正在读取会话内容…</div></div>';
  }

  function showViewerError(error, summary) {
    closeQuestionsPanel({ restoreFocus: false });
    state.turns = [];
    state.turnFilter = '';
    els.questionsFilter.value = '';
    els.findbar.hidden = true;
    els.sessionHead.classList.remove('is-empty');
    els.sessionHead.innerHTML =
      `<div class="session-title-row"><h1 class="session-title">${escapeHtml(summary?.title || '加载失败')}</h1></div>` +
      '<div class="session-meta"><span class="meta-badge">无法读取会话</span></div>';
    els.conversation.innerHTML =
      '<div class="welcome">' +
      '<div class="welcome-icon" style="color:var(--red);background:var(--red-soft)">!</div>' +
      '<h2>加载会话失败</h2>' +
      `<p>${escapeHtml(error?.message || '未知错误')}</p>` +
      '</div>';
  }

  function showWelcome() {
    closeQuestionsPanel({ restoreFocus: false });
    state.turns = [];
    state.turnFilter = '';
    els.questionsFilter.value = '';
    state.session = null;
    els.sessionHead.classList.add('is-empty');
    els.sessionHead.innerHTML = HEAD_EMPTY_HTML;
    els.findbar.hidden = true;
    els.conversation.innerHTML = WELCOME_HTML;
    els.findCount.textContent = '';
    els.contentSearch.value = '';
    document.title = 'OpenCode 会话阅读器';
  }

  /* ---------------- loading sessions ---------------- */

  async function loadTree() {
    if (state.searchMode === 'tree') els.treeStats.textContent = '正在加载…';
    const response = await fetch('/api/tree', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    state.sessions = payload.sessions || [];
    for (const session of state.sessions) {
      session._search = [
        session.title,
        session.directory,
        session.slug,
        session.id,
        session.agent,
        modelLabel(session.model),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
    }

    state.tree = buildTree(state.sessions);
    state.dirCount = countDirectoryNodes(state.tree);

    els.dbPath.textContent = payload.database || '未知数据库';
    els.dbInfo.title = `数据库：${payload.database || '未知'}`;

    if (!state.expanded.size) autoExpandDefault();
    renderTree();
    if (state.searchMode === 'global') updateGlobalStats();
  }

  function getHashSession() {
    const match = /^#session=(.+)$/.exec(window.location.hash || '');
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }

  async function openSession(id, options = {}) {
    if (!id) return;
    const { force = false, historyMode = 'none', focus = null } = options;

    if (!force && state.selectedId === id && state.session) {
      if (focus) applyFocus(focus);
      return;
    }

    const summary = findSession(id);

    if (state.abortController) state.abortController.abort();
    const controller = new AbortController();
    state.abortController = controller;

    state.selectedId = id;
    state.session = null;

    if (historyMode === 'push') {
      window.history.pushState({ session: id }, '', `#session=${encodeURIComponent(id)}`);
    } else if (historyMode === 'replace') {
      window.history.replaceState({ session: id }, '', `#session=${encodeURIComponent(id)}`);
    }

    if (summary) {
      const changed = expandAncestors(summary.directory);
      if (changed) renderTree();
    }

    setViewerLoading(summary);
    renderTree();
    revealActive();
    resetFindUI(true);

    try {
      const response = await fetch(`/api/session/${encodeURIComponent(id)}`, {
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          if (body?.error) message = body.error;
        } catch {}
        throw new Error(message);
      }

      const payload = await response.json();
      if (controller.signal.aborted || state.selectedId !== id) return;

      state.session = payload;
      renderSession(payload);
      renderTree();
      revealActive();
      if (focus) applyFocus(focus);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (state.selectedId !== id) return;
      showViewerError(error, summary);
    }
  }

  function syncFromHash() {
    const id = getHashSession();
    if (id && id !== state.selectedId) {
      openSession(id, { historyMode: 'none' });
    }
  }

  async function refreshAll() {
    if (els.refreshBtn.disabled) return;
    els.refreshBtn.disabled = true;
    const selected = state.selectedId;

    try {
      await loadTree();

      if (state.searchMode === 'global' && state.globalSearchText.trim()) {
        runGlobalSearch(state.globalSearchText);
      }

      if (selected) {
        const summary = findSession(selected);
        if (summary) {
          expandAncestors(summary.directory);
          renderTree();
          await openSession(selected, { force: true, historyMode: 'none' });
        } else {
          state.selectedId = null;
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          showWelcome();
        }
      }
    } catch (error) {
      els.treeStats.textContent = `刷新失败：${error?.message || '未知错误'}`;
    } finally {
      els.refreshBtn.disabled = false;
    }
  }

  /* ---------------- find in conversation ---------------- */

  function unwrapFindMarks() {
    const marks = els.conversation.querySelectorAll('mark.find-hit');
    if (!marks.length) return;
    for (const mark of marks) {
      mark.replaceWith(document.createTextNode(mark.textContent || ''));
    }
    els.conversation.normalize();
  }

  function resetFindUI(clearInput = true) {
    state.find = { query: '', hits: [], index: -1, capped: false };
    unwrapFindMarks();
    els.findCount.textContent = '';
    if (clearInput) els.contentSearch.value = '';
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest('script, style')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function highlightNode(node, lowerQuery) {
    const text = node.nodeValue || '';
    const lower = text.toLowerCase();
    let index = lower.indexOf(lowerQuery);

    if (index === -1) return;

    const fragment = document.createDocumentFragment();
    let position = 0;

    while (index !== -1) {
      if (state.find.hits.length >= MAX_FIND_HITS) {
        state.find.capped = true;
        break;
      }

      if (index > position) {
        fragment.appendChild(document.createTextNode(text.slice(position, index)));
      }

      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      mark.textContent = text.slice(index, index + lowerQuery.length);
      fragment.appendChild(mark);
      state.find.hits.push(mark);

      position = index + lowerQuery.length;
      index = lower.indexOf(lowerQuery, position);
    }

    if (position === 0) return;
    fragment.appendChild(document.createTextNode(text.slice(position)));
    node.parentNode?.replaceChild(fragment, node);
  }

  function updateFindCount() {
    const { hits, index, capped, query } = state.find;
    if (!query) {
      els.findCount.textContent = '';
    } else if (!hits.length) {
      els.findCount.textContent = '0/0';
    } else {
      els.findCount.textContent = `${index + 1}/${hits.length}${capped ? '+' : ''}`;
    }
  }

  function activateHit(index, shouldScroll) {
    const hits = state.find.hits;
    if (!hits.length) return;

    const previous = hits[state.find.index];
    if (previous) previous.classList.remove('active');

    state.find.index = ((index % hits.length) + hits.length) % hits.length;
    const hit = hits[state.find.index];
    hit.classList.add('active');

    let ancestor = hit.parentElement;
    while (ancestor && ancestor !== els.conversation) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      ancestor = ancestor.parentElement;
    }

    updateFindCount();

    if (shouldScroll) {
      window.requestAnimationFrame(() => {
        hit.scrollIntoView({ block: 'center' });
      });
    }
  }

  function runFind(rawQuery, options = {}) {
    const { autoActivate = true } = options;
    const query = String(rawQuery || '').trim();

    unwrapFindMarks();
    state.find = { query, hits: [], index: -1, capped: false };

    if (!query) {
      updateFindCount();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const nodes = collectTextNodes(els.conversation);

    for (const node of nodes) {
      if (state.find.hits.length >= MAX_FIND_HITS) {
        state.find.capped = true;
        break;
      }
      highlightNode(node, lowerQuery);
    }

    if (state.find.hits.length && autoActivate) {
      activateHit(0, true);
    } else if (state.find.hits.length) {
      state.find.index = 0;
      updateFindCount();
    } else {
      updateFindCount();
    }
  }

  function moveFind(delta) {
    if (!state.find.hits.length) return;
    activateHit(state.find.index + delta, true);
  }

  function flashElement(element) {
    if (!element) return;
    element.classList.remove('flash-target');
    void element.offsetWidth;
    element.classList.add('flash-target');
    window.setTimeout(() => element.classList.remove('flash-target'), 1700);
  }

  function querySelectorForId(attribute, id) {
    if (!id) return null;
    const escaped = window.CSS?.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&');
    return els.conversation.querySelector(`[${attribute}="${escaped}"]`);
  }

  function applyFocus(focus) {
    if (!focus || !focus.query) return;

    const query = String(focus.query);
    els.contentSearch.value = query;
    runFind(query, { autoActivate: false });

    let target = querySelectorForId('data-part-id', focus.partId);
    if (!target) target = querySelectorForId('data-message-id', focus.messageId);

    if (target) {
      const hitIndex = state.find.hits.findIndex((hit) => target.contains(hit));
      if (hitIndex !== -1) {
        activateHit(hitIndex, true);
        flashElement(target);
        return;
      }

      if (target.tagName === 'DETAILS') target.open = true;
      target.scrollIntoView({ block: 'center' });
      flashElement(target);
      return;
    }

    if (state.find.hits.length) {
      activateHit(0, true);
      const container = state.find.hits[0].closest('.part, .msg');
      flashElement(container);
    }
  }

  /* ---------------- theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    els.themeBtn.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
    els.themeBtn.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {}
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  /* ---------------- splitter ---------------- */

  function clampSidebar(width) {
    return Math.min(640, Math.max(220, width));
  }

  function initSplitter() {
    let saved = null;
    try {
      saved = Number(localStorage.getItem(SIDEBAR_KEY));
    } catch {}
    if (Number.isFinite(saved) && saved > 0) {
      document.documentElement.style.setProperty('--sidebar-width', `${clampSidebar(saved)}px`);
    }

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let currentWidth = 0;

    const saveWidth = () => {
      if (!currentWidth) return;
      try {
        localStorage.setItem(SIDEBAR_KEY, String(Math.round(currentWidth)));
      } catch {}
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      currentWidth = clampSidebar(startWidth + event.clientX - startX);
      document.documentElement.style.setProperty('--sidebar-width', `${currentWidth}px`);
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      saveWidth();
    };

    els.splitter.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      startX = event.clientX;
      startWidth = els.sidebar.getBoundingClientRect().width;
      currentWidth = startWidth;
      document.body.classList.add('resizing');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      event.preventDefault();
    });

    els.splitter.addEventListener('dblclick', () => {
      currentWidth = 340;
      document.documentElement.style.setProperty('--sidebar-width', '340px');
      saveWidth();
    });

    els.splitter.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const current = els.sidebar.getBoundingClientRect().width;
      currentWidth = clampSidebar(current + (event.key === 'ArrowLeft' ? -16 : 16));
      document.documentElement.style.setProperty('--sidebar-width', `${currentWidth}px`);
      saveWidth();
    });
  }

  /* ---------------- events ---------------- */

  let treeSearchTimer = null;
  let globalSearchTimer = null;
  let findTimer = null;

  function applyTreeSearch() {
    const value = els.treeSearch.value;
    state.treeSearchText = value;
    state.query = value.trim().toLowerCase();
    els.treeClear.hidden = !value;
    renderTree();
  }

  function clearSidebarSearch() {
    els.treeSearch.value = '';
    els.treeClear.hidden = true;
    window.clearTimeout(treeSearchTimer);
    window.clearTimeout(globalSearchTimer);

    if (state.searchMode === 'tree') {
      applyTreeSearch();
    } else {
      state.globalSearchText = '';
      resetGlobalSearch();
      updateGlobalStats();
    }
  }

  function bindEvents() {
    els.refreshBtn.addEventListener('click', refreshAll);
    els.themeBtn.addEventListener('click', toggleTheme);
    els.modeTree.addEventListener('click', () => setSearchMode('tree'));
    els.modeGlobal.addEventListener('click', () => setSearchMode('global'));

    els.sessionHead.addEventListener('click', (event) => {
      if (event.target.closest('#questions-btn')) toggleQuestionsPanel();
    });

    els.questionsClose.addEventListener('click', () => closeQuestionsPanel());
    els.questionsBackdrop.addEventListener('click', () => closeQuestionsPanel());
    els.questionsFilter.addEventListener('input', () => {
      state.turnFilter = els.questionsFilter.value.trim().toLowerCase();
      renderQuestionList();
    });
    els.questionsFilter.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeQuestionsPanel();
      }
    });
    els.questionsList.addEventListener('click', (event) => {
      const item = event.target.closest('.turn-item');
      if (item) jumpToTurn(item.dataset.userId);
    });

    els.searchResults.addEventListener('click', (event) => {
      const snippet = event.target.closest('.result-snippet');
      if (snippet) {
        const query = state.global.query || state.globalSearchText.trim();
        openSession(snippet.dataset.sessionId, {
          historyMode: 'push',
          focus: {
            query,
            messageId: snippet.dataset.messageId,
            partId: snippet.dataset.partId,
          },
        });
        return;
      }

      const head = event.target.closest('.result-head');
      if (head) openSession(head.dataset.sessionId, { historyMode: 'push' });
    });

    els.tree.addEventListener('click', (event) => {
      const row = event.target.closest('.tree-row');
      if (!row) return;

      if (row.dataset.action === 'toggle') {
        const path = row.dataset.path;
        if (state.expanded.has(path)) state.expanded.delete(path);
        else state.expanded.add(path);
        renderTree();
      } else if (row.dataset.action === 'open') {
        const id = row.dataset.id;
        if (id) openSession(id, { historyMode: 'push' });
      }
    });

    els.tree.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('.tree-row');
      if (!row) return;
      event.preventDefault();
      row.click();
    });

    els.treeSearch.addEventListener('input', () => {
      const value = els.treeSearch.value;
      els.treeClear.hidden = !value;
      window.clearTimeout(treeSearchTimer);
      window.clearTimeout(globalSearchTimer);

      if (state.searchMode === 'tree') {
        state.treeSearchText = value;
        treeSearchTimer = window.setTimeout(applyTreeSearch, 120);
      } else {
        state.globalSearchText = value;
        globalSearchTimer = window.setTimeout(() => runGlobalSearch(value), 300);
      }
    });

    els.treeSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        window.clearTimeout(treeSearchTimer);
        window.clearTimeout(globalSearchTimer);

        if (state.searchMode === 'tree') {
          applyTreeSearch();
          const first = els.tree.querySelector('.tree-row.session');
          if (first) first.click();
          return;
        }

        const query = els.treeSearch.value.trim();
        if (!query) return;
        if (
          state.global.query === query &&
          !state.global.loading &&
          !state.global.error &&
          state.global.sessions.length
        ) {
          const first =
            els.searchResults.querySelector('.result-snippet') ||
            els.searchResults.querySelector('.result-head');
          if (first) first.click();
        } else {
          runGlobalSearch(query);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        clearSidebarSearch();
      }
    });

    els.treeClear.addEventListener('click', () => {
      clearSidebarSearch();
      els.treeSearch.focus();
    });

    els.contentSearch.addEventListener('input', () => {
      window.clearTimeout(findTimer);
      findTimer = window.setTimeout(() => runFind(els.contentSearch.value), 180);
    });

    els.contentSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        window.clearTimeout(findTimer);
        const query = els.contentSearch.value.trim();
        if (state.find.query !== query) {
          runFind(query);
        } else {
          moveFind(event.shiftKey ? -1 : 1);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        els.contentSearch.value = '';
        window.clearTimeout(findTimer);
        runFind('');
        els.contentSearch.blur();
      }
    });

    els.findPrev.addEventListener('click', () => moveFind(-1));
    els.findNext.addEventListener('click', () => moveFind(1));
    els.findClose.addEventListener('click', () => {
      els.contentSearch.value = '';
      runFind('');
      els.contentSearch.focus();
    });

    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('popstate', syncFromHash);

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (event.key === 'Escape' && state.questionsOpen) {
        event.preventDefault();
        closeQuestionsPanel();
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'q'
      ) {
        event.preventDefault();
        toggleQuestionsPanel();
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        setSearchMode('global');
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!els.findbar.hidden) {
          els.contentSearch.focus();
          els.contentSearch.select();
        } else {
          els.treeSearch.focus();
          els.treeSearch.select();
        }
        return;
      }

      if (event.key === '/' && !typing) {
        event.preventDefault();
        els.treeSearch.focus();
        els.treeSearch.select();
      }
    });
  }

  /* ---------------- boot ---------------- */

  async function init() {
    initTheme();
    initSplitter();
    bindEvents();
    setModeUI('tree');

    try {
      await loadTree();
      const hashId = getHashSession();
      if (hashId) {
        const summary = findSession(hashId);
        if (summary) {
          expandAncestors(summary.directory);
          renderTree();
        }
        await openSession(hashId, { historyMode: 'none' });
      }
    } catch (error) {
      els.treeStats.textContent = '加载失败';
      els.tree.innerHTML =
        `<div class="tree-error">无法读取 OpenCode 数据库<br>${escapeHtml(error?.message || '未知错误')}</div>`;
    }
  }

  init();
})();
