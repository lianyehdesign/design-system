/**
 * 主執行緒:讀 Figma 變數、存取設定。
 *
 * 網路請求「不能」寫在這裡 —— Figma 的 plugin 沙箱沒有 fetch。
 * 所有對 GitHub 的呼叫都在 ui.html 裡（那是真正的 iframe）。
 * 反過來 figma.clientStorage 只有主執行緒能用，所以設定的存取要繞回這裡。
 */

const STORAGE_KEY = 'settings';

const DEFAULT_SETTINGS = {
  owner: 'lianyehdesign',
  repo: 'design-system',
  workflow: 'sync-from-link.yml',
  ref: 'main',
  token: '',
};

figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

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
