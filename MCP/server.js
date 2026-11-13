#!/usr/bin/env node

/**
 * MCP File Server - Soulstash
 * Serves: C:\Users\rakes\Documents\Soulstash
 *
 * Claude Desktop config (%APPDATA%\Claude\claude_desktop_config.json):
 * C:\Users\rakes\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\AppData
 * C:\Users\rakes\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude
 * {
 *   "mcpServers": {
 *     "soulstash": {
 *       "command": "node",
 *       "args": ["C:\\Users\\rakes\\Documents\\Soulstash\\MCP\\server.js"]
 *     }
 *   }
 * }M0nk3yDK!ngLuffy56@DON
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve('C:\\Users\\rakes\\Documents\\Soulstash');
const MCP_DIR = path.join(ROOT_DIR, 'MCP');
const MEMORY_PATH = path.join(MCP_DIR, 'memory.md');
const HISTORY_PATH = path.join(MCP_DIR, 'history.json');
const INDEX_REFRESH_MS = 2000;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 250;
const MAX_MATCHES_PER_FILE = 50;
const MAX_DIFF_BYTES = 300 * 1024;

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage'
]);

const SKIP_FILE_PREFIXES = ['.env'];
const TEXT_FILE_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.jsx',
  '.ts', '.tsx',
  '.json', '.jsonc',
  '.md', '.txt',
  '.html', '.htm',
  '.css', '.scss', '.sass', '.less',
  '.xml', '.yml', '.yaml',
  '.toml', '.ini',
  '.py', '.rb', '.php', '.java', '.go', '.rs', '.cs',
  '.sh', '.ps1', '.bat', '.cmd',
  '.sql',
  '.svg'
]);

const state = {
  indexBuiltAt: 0,
  files: [],
  filesByPath: new Map()
};

if (!fs.existsSync(ROOT_DIR)) {
  process.stderr.write(`[mcp-file-server] ERROR: Root directory not found: ${ROOT_DIR}\n`);
  process.stderr.write('[mcp-file-server] Please update ROOT_DIR in MCP/server.js\n');
  process.exit(1);
}

fs.mkdirSync(MCP_DIR, { recursive: true });
if (!fs.existsSync(MEMORY_PATH)) {
  fs.writeFileSync(
    MEMORY_PATH,
    [
      '# Soulstash MCP Memory',
      '',
      'Use this file to store durable project context for external AI tools.',
      '',
      '## Notes',
      '- Add architecture notes, conventions, TODOs, known bugs, and decisions here.',
      ''
    ].join('\n'),
    'utf8'
  );
}
if (!fs.existsSync(HISTORY_PATH)) {
  fs.writeFileSync(HISTORY_PATH, '', 'utf8');
}

process.stderr.write(`[mcp-file-server] Started. Serving: ${ROOT_DIR}\n`);

function normalizeRelative(inputPath) {
  return String(inputPath || '').replace(/[\\/]/g, path.sep);
}

function safePath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  const resolved = path.resolve(ROOT_DIR, normalized);

  if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + path.sep)) {
    throw new Error(`Access denied: "${relativePath}" is outside the allowed directory.`);
  }

  return resolved;
}

function toRelative(fullPath) {
  return path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
}

function shouldSkipName(name) {
  return SKIP_FILE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function ensureReadableFile(fullPath, relativePath) {
  const basename = path.basename(fullPath);
  if (shouldSkipName(basename)) {
    throw new Error(`Access denied: reading "${relativePath}" is not allowed.`);
  }
}

function readTextFile(fullPath, relativePath) {
  ensureReadableFile(fullPath, relativePath);
  const stat = fs.statSync(fullPath);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File too large to read safely: "${relativePath}" (${stat.size} bytes).`);
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function buildFileIndex(force = false) {
  const now = Date.now();
  if (!force && state.files.length && now - state.indexBuiltAt < INDEX_REFRESH_MS) {
    return state.files;
  }

  const files = [];
  const filesByPath = new Map();

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (shouldSkipName(entry.name)) continue;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      const relativePath = toRelative(fullPath);
      const item = {
        path: relativePath,
        fullPath,
        ext: path.extname(entry.name).toLowerCase(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        isText: isTextFile(fullPath)
      };
      files.push(item);
      filesByPath.set(relativePath, item);
    }
  }

  walk(ROOT_DIR);
  files.sort((a, b) => a.path.localeCompare(b.path));

  state.files = files;
  state.filesByPath = filesByPath;
  state.indexBuiltAt = now;
  return files;
}

function findIndexedFile(relativePath) {
  buildFileIndex();
  return state.filesByPath.get(relativePath.replace(/\\/g, '/')) || null;
}

function filterIndexedFiles({ subdir, extension, textOnly = false }) {
  const normalizedSubdir = subdir ? normalizeRelative(subdir).replace(/\\/g, '/').replace(/\/+$/, '') : '';
  const ext = extension ? (extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`) : '';

  return buildFileIndex().filter((file) => {
    if (normalizedSubdir) {
      if (file.path !== normalizedSubdir && !file.path.startsWith(`${normalizedSubdir}/`)) {
        return false;
      }
    }
    if (ext && file.ext !== ext) return false;
    if (textOnly && !file.isText) return false;
    return true;
  });
}

function searchInFiles({ pattern, files, isRegex = false, caseSensitive = false }) {
  const results = [];
  const flags = caseSensitive ? 'g' : 'gi';
  let regex;

  if (isRegex) {
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      throw new Error(`Invalid regex pattern: "${pattern}"`);
    }
  } else {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, flags);
  }

  for (const file of files) {
    if (!file.isText) continue;

    let content;
    try {
      content = readTextFile(file.fullPath, file.path);
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const matches = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      regex.lastIndex = 0;
      if (!regex.test(line)) continue;

      matches.push({
        line: index + 1,
        text: line.trimEnd()
      });

      if (matches.length >= MAX_MATCHES_PER_FILE) break;
    }

    if (!matches.length) continue;

    results.push({
      file: file.path,
      matches
    });

    if (results.length >= MAX_SEARCH_RESULTS) break;
  }

  return results;
}

function getGitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    if (stderr) throw new Error(stderr);
    throw new Error(`git ${args.join(' ')} failed`);
  }
}

function tryGitOutput(args) {
  try {
    return getGitOutput(args);
  } catch {
    return '';
  }
}

function getChangesSummary() {
  const insideRepo = getGitOutput(['rev-parse', '--is-inside-work-tree']);
  if (insideRepo !== 'true') {
    return { tracked: false, message: 'Not a git repository.' };
  }

  const statusPorcelain = getGitOutput(['status', '--short']);
  const statusLines = statusPorcelain ? statusPorcelain.split(/\r?\n/).filter(Boolean) : [];
  const diffStats = getGitOutput(['diff', '--stat', '--', '.']);
  const cachedDiffStats = getGitOutput(['diff', '--cached', '--stat', '--', '.']);
  const recentCommits = getGitOutput(['log', '--oneline', '-n', '10']);

  return {
    tracked: true,
    changed_files: statusLines.length,
    status: statusLines,
    unstaged_diff_stat: diffStats ? diffStats.split(/\r?\n/) : [],
    staged_diff_stat: cachedDiffStats ? cachedDiffStats.split(/\r?\n/) : [],
    recent_commits: recentCommits ? recentCommits.split(/\r?\n/) : []
  };
}

function getTrackedFiles() {
  const output = tryGitOutput(['ls-files']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function getWorkspaceSnapshot() {
  const indexedFiles = buildFileIndex();
  const trackedFiles = getTrackedFiles();
  const changed = getChangesSummary();
  const topRecent = [...indexedFiles]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 25)
    .map((file) => ({
      path: file.path,
      size: file.size,
      last_modified_ms: Math.round(file.mtimeMs)
    }));

  return {
    root: ROOT_DIR,
    indexed_files: indexedFiles.length,
    tracked_files: trackedFiles.length,
    recent_files: topRecent,
    changes: changed
  };
}

function readDiff({ filePath = '', cached = false, commit = '', contextLines = 3 }) {
  let args;
  const safeContext = Math.max(0, Number(contextLines) || 3);

  if (commit) {
    args = ['show', `--unified=${safeContext}`, '--stat', '--patch', commit];
  } else {
    args = cached
      ? ['diff', '--cached', `--unified=${safeContext}`, '--', filePath || '.']
      : ['diff', `--unified=${safeContext}`, '--', filePath || '.'];
  }

  const output = tryGitOutput(args);
  if (!output) {
    return {
      target: filePath || '.',
      cached,
      commit: commit || null,
      diff: '',
      message: 'No diff output.'
    };
  }

  return {
    target: filePath || '.',
    cached,
    commit: commit || null,
    truncated: Buffer.byteLength(output, 'utf8') > MAX_DIFF_BYTES,
    diff: Buffer.byteLength(output, 'utf8') > MAX_DIFF_BYTES
      ? `${output.slice(0, MAX_DIFF_BYTES)}\n\n[diff truncated]`
      : output
  };
}

function searchSymbols({ query = '', subdir = '', extension = '' }) {
  const files = filterIndexedFiles({ subdir, extension, textOnly: true });
  const queryLower = String(query || '').toLowerCase();
  const symbolPatterns = [
    { kind: 'function', regex: /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/ },
    { kind: 'class', regex: /^\s*class\s+([A-Za-z0-9_$]+)/ },
    { kind: 'const-function', regex: /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/ },
    { kind: 'route', regex: /\b(router|app)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/ },
    { kind: 'react-component', regex: /^\s*function\s+([A-Z][A-Za-z0-9_$]+)/ }
  ];

  const results = [];

  for (const file of files) {
    let content;
    try {
      content = readTextFile(file.fullPath, file.path);
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const pattern of symbolPatterns) {
        const match = line.match(pattern.regex);
        if (!match) continue;

        let name;
        if (pattern.kind === 'route') {
          name = `${match[2].toUpperCase()} ${match[3]}`;
        } else {
          name = match[1];
        }

        if (queryLower && !name.toLowerCase().includes(queryLower)) continue;

        results.push({
          file: file.path,
          line: index + 1,
          kind: pattern.kind,
          name,
          text: line.trim()
        });
        if (results.length >= MAX_SEARCH_RESULTS) {
          return {
            results,
            total: results.length,
            truncated: true
          };
        }
      }
    }
  }

  return {
    results,
    total: results.length,
    truncated: false
  };
}

function recentFiles({ limit = 20, subdir = '', extension = '' }) {
  const files = filterIndexedFiles({ subdir, extension, textOnly: false })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 20)));

  return {
    count: files.length,
    files: files.map((file) => ({
      path: file.path,
      size_bytes: file.size,
      last_modified: new Date(file.mtimeMs).toISOString()
    }))
  };
}

function readMemory() {
  return fs.readFileSync(MEMORY_PATH, 'utf8');
}

function writeMemory(content) {
  fs.writeFileSync(MEMORY_PATH, content, 'utf8');
  return {
    success: true,
    path: toRelative(MEMORY_PATH),
    bytes_written: Buffer.byteLength(content, 'utf8')
  };
}

function appendMemory(content, heading = '') {
  const current = readMemory().replace(/\s*$/, '');
  const next = [
    current,
    '',
    heading ? `## ${heading}` : '',
    content
  ].filter(Boolean).join('\n');
  fs.writeFileSync(MEMORY_PATH, `${next}\n`, 'utf8');
  return {
    success: true,
    path: toRelative(MEMORY_PATH),
    bytes_written: Buffer.byteLength(content, 'utf8')
  };
}

function readHistory({ limit = 50 } = {}) {
  const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-Math.max(1, Math.min(500, Number(limit) || 50)));
  return {
    path: toRelative(HISTORY_PATH),
    entries: slice.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { malformed: true, raw: line };
      }
    })
  };
}

function appendHistory(entry) {
  fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

function clearHistory() {
  fs.writeFileSync(HISTORY_PATH, '', 'utf8');
  return { success: true, path: toRelative(HISTORY_PATH) };
}

function withLineNumbers(lines, startIndex) {
  return lines.map((line, idx) => `${startIndex + idx + 1}\t${line}`).join('\n');
}

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a text file from Soulstash with line numbers. Supports optional line ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from Soulstash/' },
        start_line: { type: 'number', description: 'Optional first line to return (1-based)' },
        end_line: { type: 'number', description: 'Optional last line to return (inclusive)' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file completely.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Replace exact text in a file. Replaces all occurrences.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' }
      },
      required: ['path', 'old_text', 'new_text']
    }
  },
  {
    name: 'insert_lines',
    description: 'Insert text after a given line. Use after_line=0 to insert at the top.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        after_line: { type: 'number' },
        content: { type: 'string' }
      },
      required: ['path', 'after_line', 'content']
    }
  },
  {
    name: 'delete_lines',
    description: 'Delete a range of lines from a text file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start_line: { type: 'number' },
        end_line: { type: 'number' }
      },
      required: ['path', 'start_line', 'end_line']
    }
  },
  {
    name: 'list_files',
    description: 'List indexed files quickly, optionally filtered by subdir or extension.',
    inputSchema: {
      type: 'object',
      properties: {
        subdir: { type: 'string' },
        extension: { type: 'string' },
        text_only: { type: 'boolean' }
      }
    }
  },
  {
    name: 'search_files',
    description: 'Fast indexed search across text files. Supports plain text or regex.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        subdir: { type: 'string' },
        extension: { type: 'string' },
        is_regex: { type: 'boolean' },
        case_sensitive: { type: 'boolean' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file inside Soulstash.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  {
    name: 'move_file',
    description: 'Move or rename a file.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'file_info',
    description: 'Get metadata for a file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  {
    name: 'create_directory',
    description: 'Create a directory and missing parents.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  {
    name: 'get_root',
    description: 'Return the absolute root path served by this MCP server.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_changes',
    description: 'Show current git status, diff stats, and recent commits so AI can see code changes.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_memory',
    description: 'Read the durable MCP memory file stored in Soulstash/MCP/memory.md.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'write_memory',
    description: 'Replace the durable MCP memory file completely.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' }
      },
      required: ['content']
    }
  },
  {
    name: 'append_memory',
    description: 'Append a note to the durable MCP memory file.',
    inputSchema: {
      type: 'object',
      properties: {
        heading: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['content']
    }
  },
  {
    name: 'rebuild_index',
    description: 'Force a refresh of the indexed file list.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_diff',
    description: 'Read git diff output for the workspace or a specific file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        cached: { type: 'boolean' },
        commit: { type: 'string' },
        context_lines: { type: 'number' }
      }
    }
  },
  {
    name: 'search_symbols',
    description: 'Find functions, classes, components, and route handlers across the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        subdir: { type: 'string' },
        extension: { type: 'string' }
      }
    }
  },
  {
    name: 'recent_files',
    description: 'List most recently modified files to help AI focus on recent changes.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        subdir: { type: 'string' },
        extension: { type: 'string' }
      }
    }
  },
  {
    name: 'workspace_snapshot',
    description: 'Return a compact snapshot of indexed files, git changes, and recently modified files.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_history',
    description: 'Read the MCP tool usage history log.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'clear_history',
    description: 'Clear the MCP tool usage history log.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function handleTool(name, input = {}) {
  switch (name) {
    case 'read_file': {
      const fullPath = safePath(input.path);
      const raw = readTextFile(fullPath, input.path);
      const lines = raw.split('\n');
      const start = input.start_line ? Math.max(1, Number(input.start_line)) - 1 : 0;
      const end = input.end_line ? Math.min(lines.length, Number(input.end_line)) : lines.length;
      const slice = lines.slice(start, end);
      return {
        path: input.path,
        total_lines: lines.length,
        shown: `lines ${start + 1}-${start + slice.length}`,
        content: withLineNumbers(slice, start)
      };
    }

    case 'write_file': {
      const fullPath = safePath(input.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, input.content, 'utf8');
      buildFileIndex(true);
      return {
        success: true,
        path: input.path,
        lines_written: input.content.split('\n').length
      };
    }

    case 'edit_file': {
      const fullPath = safePath(input.path);
      const original = readTextFile(fullPath, input.path);
      if (!original.includes(input.old_text)) {
        throw new Error(
          `Text not found in "${input.path}".\n` +
          `Searched for: ${input.old_text.slice(0, 120)}\n` +
          'Tip: use read_file first to confirm the exact text.'
        );
      }
      const replacements = original.split(input.old_text).length - 1;
      const updated = original.split(input.old_text).join(input.new_text);
      fs.writeFileSync(fullPath, updated, 'utf8');
      buildFileIndex(true);
      return { success: true, replacements, path: input.path };
    }

    case 'insert_lines': {
      const fullPath = safePath(input.path);
      const lines = readTextFile(fullPath, input.path).split('\n');
      const afterLine = Math.max(0, Math.min(Number(input.after_line), lines.length));
      const inserted = input.content.split('\n');
      lines.splice(afterLine, 0, ...inserted);
      fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
      buildFileIndex(true);
      return { success: true, inserted_lines: inserted.length, after_line: afterLine };
    }

    case 'delete_lines': {
      const fullPath = safePath(input.path);
      const lines = readTextFile(fullPath, input.path).split('\n');
      const start = Number(input.start_line) - 1;
      const end = Number(input.end_line) - 1;
      if (start < 0 || end < start || end >= lines.length) {
        throw new Error('Invalid line range.');
      }
      lines.splice(start, end - start + 1);
      fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
      buildFileIndex(true);
      return { success: true, deleted_lines: end - start + 1 };
    }

    case 'list_files': {
      const files = filterIndexedFiles({
        subdir: input.subdir,
        extension: input.extension,
        textOnly: !!input.text_only
      }).map((file) => file.path);

      return {
        root: ROOT_DIR,
        count: files.length,
        files
      };
    }

    case 'search_files': {
      const files = filterIndexedFiles({
        subdir: input.subdir,
        extension: input.extension,
        textOnly: true
      });

      const results = searchInFiles({
        pattern: input.pattern,
        files,
        isRegex: !!input.is_regex,
        caseSensitive: !!input.case_sensitive
      });

      return {
        files_searched: files.length,
        result_files: results.length,
        total_matches: results.reduce((sum, item) => sum + item.matches.length, 0),
        truncated: results.length >= MAX_SEARCH_RESULTS,
        results
      };
    }

    case 'delete_file': {
      const fullPath = safePath(input.path);
      fs.unlinkSync(fullPath);
      buildFileIndex(true);
      return { success: true, deleted: input.path };
    }

    case 'move_file': {
      const fromPath = safePath(input.from);
      const toPath = safePath(input.to);
      fs.mkdirSync(path.dirname(toPath), { recursive: true });
      fs.renameSync(fromPath, toPath);
      buildFileIndex(true);
      return { success: true, from: input.from, to: input.to };
    }

    case 'file_info': {
      const fullPath = safePath(input.path);
      const stat = fs.statSync(fullPath);
      const lineCount = isTextFile(fullPath) ? readTextFile(fullPath, input.path).split('\n').length : null;
      return {
        path: input.path,
        size_bytes: stat.size,
        last_modified: stat.mtime.toISOString(),
        line_count: lineCount
      };
    }

    case 'create_directory': {
      const fullPath = safePath(input.path);
      fs.mkdirSync(fullPath, { recursive: true });
      buildFileIndex(true);
      return { success: true, created: input.path };
    }

    case 'get_root':
      return { root: ROOT_DIR, memory_path: toRelative(MEMORY_PATH) };

    case 'list_changes':
      return getChangesSummary();

    case 'read_memory':
      return {
        path: toRelative(MEMORY_PATH),
        content: readMemory()
      };

    case 'write_memory':
      return writeMemory(input.content);

    case 'append_memory':
      return appendMemory(input.content, input.heading || '');

    case 'rebuild_index': {
      const files = buildFileIndex(true);
      return {
        success: true,
        indexed_files: files.length,
        indexed_at: new Date(state.indexBuiltAt).toISOString()
      };
    }

    case 'read_diff':
      return readDiff({
        filePath: input.path || '',
        cached: !!input.cached,
        commit: input.commit || '',
        contextLines: input.context_lines
      });

    case 'search_symbols':
      return searchSymbols({
        query: input.query || '',
        subdir: input.subdir || '',
        extension: input.extension || ''
      });

    case 'recent_files':
      return recentFiles({
        limit: input.limit,
        subdir: input.subdir || '',
        extension: input.extension || ''
      });

    case 'workspace_snapshot':
      return getWorkspaceSnapshot();

    case 'read_history':
      return readHistory({ limit: input.limit });

    case 'clear_history':
      return clearHistory();

    default:
      throw new Error(`Unknown tool: "${name}"`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'soulstash-server', version: '2.0.0' }
      }
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    try {
      const result = handleTool(toolName, toolArgs);
      appendHistory({
        at: new Date().toISOString(),
        tool: toolName,
        args: (() => {
          const copy = { ...toolArgs };
          if (typeof copy.content === 'string') copy.content = `[string:${copy.content.length}]`;
          if (typeof copy.old_text === 'string') copy.old_text = `[string:${copy.old_text.length}]`;
          if (typeof copy.new_text === 'string') copy.new_text = `[string:${copy.new_text.length}]`;
          return copy;
        })()
      });
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      });
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `ERROR: ${error.message}` }],
          isError: true
        }
      });
    }
    return;
  }

  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  });
});

buildFileIndex(true);
process.stderr.write(`[mcp-file-server] Tools ready: ${TOOLS.map((tool) => tool.name).join(', ')}\n`);
