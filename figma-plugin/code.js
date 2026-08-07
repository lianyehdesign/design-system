/**
 * 主執行緒:讀 Figma 變數、存取設定。
 *
 * 網路請求「不能」寫在這裡 —— Figma 的 plugin 沙箱沒有 fetch。
 * 所有對 GitHub 的呼叫都在 ui.html 裡（那是真正的 iframe）。
 * 反過來 figma.clientStorage 只有主執行緒能用，所以設定的存取要繞回這裡。
 */

const STORAGE_KEY = 'settings';

/**
 * 哪些分組會被 repo 收下。必須跟 scripts/lib/tokens.js 的 GROUPS 一致。
 *
 * 沒登記的分組（例如 ColorSystem/）不該寫 Code syntax ——
 * 那會讓 Dev Mode 指向一個 platform/ 裡不存在的符號，工程師照著寫會編不過。
 */
const SUPPORTED_GROUPS = ['color', 'spacing', 'radius'];

/**
 * 各平台的符號名稱。
 *
 * 這是 scripts/lib/tokens.js 的 symbolNames() 的鏡像 ——
 * plugin 沙箱讀不到 repo 的檔案，只能複製一份。
 * 改動時兩邊都要改；platform/code-syntax.json 進版控，
 * 是兩邊的對照憑據，漂移會出現在 diff 裡。
 */
function symbolNames(path, dtcgType) {
  // 先拆字再組合 —— 段落本身可能含連字號（func-two），
  // 直接大寫化會留下 colorFunc-two030 這種編不過的名字。
  var words = [];
  path.forEach(function (seg) {
    seg.split(/[^a-zA-Z0-9]+/).forEach(function (w) {
      if (w) words.push(w);
    });
  });

  var camel = words
    .map(function (w, i) {
      return i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join('');

  return {
    iOS: 'DesignTokens.' + camel,
    WEB: 'var(--' + words.join('-') + ')',
    ANDROID:
      'R.' + (dtcgType === 'color' ? 'color' : 'dimen') + '.' + words.join('_'),
  };
}

/** "Color/Primary/060" → ['color','primary','060'] */
function toPath(name) {
  return String(name)
    .split('/')
    .map(function (s) {
      return s.trim().toLowerCase().replace(/\s+/g, '-');
    })
    .filter(Boolean);
}

const DEFAULT_SETTINGS = {
  owner: 'lianyehdesign',
  repo: 'design-system',
  workflow: 'sync-from-link.yml',
  ref: 'main',
  token: '',
};

figma.showUI(__html__, { width: 380, height: 660, themeColors: true });

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'ready') {
      const saved = (await figma.clientStorage.getAsync(STORAGE_KEY)) || {};
      figma.ui.postMessage({
        type: 'settings',
        settings: Object.assign({}, DEFAULT_SETTINGS, saved),
        fileName: figma.root.name,
      });
      return;
    }

    if (msg.type === 'save-settings') {
      await figma.clientStorage.setAsync(STORAGE_KEY, msg.settings);
      figma.ui.postMessage({ type: 'saved' });
      return;
    }

    if (msg.type === 'read-variables') {
      const result = await readVariables();
      figma.ui.postMessage({ type: 'variables', ...result });
      return;
    }

    if (msg.type === 'push-code-syntax') {
      const result = await pushCodeSyntax();
      figma.ui.postMessage({ type: 'code-syntax-done', ...result });
      return;
    }

    if (msg.type === 'notify') {
      figma.notify(msg.message, { error: !!msg.error });
      return;
    }

    if (msg.type === 'close') {
      figma.closePlugin();
    }
  } catch (err) {
    figma.ui.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};

/** {r,g,b,a} 都是 0–1 的浮點數 → #RRGGBB（a < 1 時補成 8 碼） */
function rgbaToHex(c) {
  const ch = (v) => {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return n.toString(16).padStart(2, '0');
  };
  const hex = '#' + ch(c.r) + ch(c.g) + ch(c.b);
  const a = c.a === undefined ? 1 : c.a;
  return a < 1 ? hex + ch(a) : hex;
}

/**
 * 展開別名變數（指向另一個變數的變數），並回傳可用的值。
 *
 * 這是 plugin 相對於其他讀取方式的優勢:REST API 那條與 MCP 讀取
 * 都只能把別名記下來然後跳過，這裡可以一路追到真正的值。
 * depth 上限是防呆 —— 理論上 Figma 不允許循環，但不值得為此當掉。
 *
 * COLOR 回傳 hex 字串，FLOAT 回傳數字，其餘回傳 null。
 */
async function resolveValue(variable, modeId, depth) {
  if (depth > 10) return null;

  const raw = variable.valuesByMode[modeId];
  if (raw === undefined || raw === null) return null;

  if (raw.type === 'VARIABLE_ALIAS') {
    const target = await figma.variables.getVariableByIdAsync(raw.id);
    if (!target) return null;
    const collection = await figma.variables.getVariableCollectionByIdAsync(
      target.variableCollectionId
    );
    if (!collection) return null;
    return resolveValue(target, collection.defaultModeId, depth + 1);
  }

  if (variable.resolvedType === 'COLOR') {
    return typeof raw.r === 'number' ? rgbaToHex(raw) : null;
  }
  if (variable.resolvedType === 'FLOAT') {
    return typeof raw === 'number' ? raw : null;
  }
  return null;
}

/**
 * 把 token 名稱寫進 Figma 變數的 Code syntax。
 *
 * 這是 pipeline 的反向:平常是 Figma → repo，這一步是 repo 的命名規則 → Figma。
 * 設定之後，Dev Mode 與 MCP 讀元件時回傳的是 DesignTokens.colorPrimary060
 * 這種字串，而不是 #003354 —— 也就是生成的程式碼會用 token 而不是 magic number。
 *
 * 前提仍然是元件有綁到變數。沒綁的話這裡做什麼都沒用。
 */
async function pushCodeSyntax() {
  const all = await figma.variables.getLocalVariablesAsync();

  const updated = [];
  const unchanged = [];
  const skipped = [];

  for (const variable of all) {
    const path = toPath(variable.name);
    const group = path[0];

    if (SUPPORTED_GROUPS.indexOf(group) === -1) {
      skipped.push(variable.name + '（分組「' + group + '」不在支援清單）');
      continue;
    }

    const dtcgType = variable.resolvedType === 'COLOR' ? 'color' : 'dimension';
    const want = symbolNames(path, dtcgType);
    const have = variable.codeSyntax || {};

    if (
      have.iOS === want.iOS &&
      have.WEB === want.WEB &&
      have.ANDROID === want.ANDROID
    ) {
      unchanged.push(variable.name);
      continue;
    }

    variable.setVariableCodeSyntax('WEB', want.WEB);
    variable.setVariableCodeSyntax('iOS', want.iOS);
    variable.setVariableCodeSyntax('ANDROID', want.ANDROID);
    updated.push(variable.name + ' → ' + want.iOS);
  }

  return {
    updated: updated.sort(),
    unchanged: unchanged.sort(),
    skipped: skipped.sort(),
  };
}

async function readVariables() {
  // 只讀「這個檔案的本地變數」。在引用 library 的檔案裡跑會讀不到東西 ——
  // 那些是 remote 變數，不屬於當前檔案。
  //
  // 不在這裡做名稱過濾:哪些分組要收，是 repo 的 GROUPS 說了算。
  // 政策放在一個地方，plugin 只負責把讀得到的東西送出去。
  const all = await figma.variables.getLocalVariablesAsync();

  const payload = {};
  const unsupported = [];
  const unresolved = [];

  for (const variable of all) {
    if (variable.resolvedType !== 'COLOR' && variable.resolvedType !== 'FLOAT') {
      unsupported.push(variable.name + '（' + variable.resolvedType + '）');
      continue;
    }

    const collection = await figma.variables.getVariableCollectionByIdAsync(
      variable.variableCollectionId
    );
    if (!collection) continue;

    // 只取預設 mode。目前沒有 light/dark 多主題，要支援再擴充。
    const value = await resolveValue(variable, collection.defaultModeId, 0);
    if (value === null) {
      unresolved.push(variable.name);
      continue;
    }

    const entry = { value: value };
    if (variable.description) entry.description = variable.description;
    payload[variable.name] = entry;
  }

  // 名稱排序，讓每次送出的 payload 順序穩定
  const sorted = {};
  Object.keys(payload)
    .sort()
    .forEach((k) => (sorted[k] = payload[k]));

  return {
    payload: sorted,
    count: Object.keys(sorted).length,
    skipped: unsupported.sort(),
    unresolved: unresolved.sort(),
    // 診斷用:讀到 0 個時，這幾個數字決定該給哪一種說明
    totalLocal: all.length,
    sampleNames: all.slice(0, 5).map((v) => v.name).sort(),
  };
}
