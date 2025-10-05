// Permite: <% const mod = await import('./util.js'); %>
const Templar = (() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHTML = v => String(v).replace(/[&<>"']/g, c => ESC[c]);

  // Config opcional (globals, baseUrl, etc.)
  const cfg = { globals: Object.create(null) };
  function configure(opts = {}) {
    if (opts.globals) cfg.globals = opts.globals;
  }

  const _tplCache = new Map();   // url -> string
  const _fnCache  = new Map();   // key -> compiled

  async function fetchTemplate(url) {
    let tpl = _tplCache.get(url);
    if (!tpl) {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`[Templar] Can't load template: ${url}`);
      tpl = await res.text();
      _tplCache.set(url, tpl);
    }
    return tpl;
  }

  function hash(s){ let h=2166136261>>>0; for(let c of s) { h^=c.charCodeAt(0); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }

  function _countLines(str) {
    if (!str) return 0;
    let c = 0, i = -1;
    while ((i = str.indexOf('\n', i + 1)) !== -1) c++;
    return c;
  }

  // ====== compileAsync con anotación de línea + sourceURL + READY/$/$$ ======
  function compileAsync(tpl, url) {
    const re = /<%([=\-]?)([\s\S]+?)%>/g;
    let i = 0;
    let tplLine = 1; // línea actual en la plantilla

    // Emite literal HTML y soporta ${...} como <%= ... %> (ESCAPADO)
    function emitLiteral(chunk) {
      const base = tplLine;
      let last = 0;
      const dollarRe = /\$\{([\s\S]+?)\}/g;

      chunk.replace(dollarRe, (m, expr, idx) => {
        // Trozo previo
        const before = chunk.slice(last, idx);
        if (before.length) {
          const beforeLine = base + _countLines(chunk.slice(0, idx));
          src += `__line=${beforeLine}; out+=${JSON.stringify(before)};\n`;
        }
        // La expresión
        const exprLine = base + _countLines(chunk.slice(0, idx));
        src += `__line=${exprLine}; out+=h((${expr}));\n`;
        last = idx + m.length;
      });

      // Resto del literal
      const restLine = base + _countLines(chunk.slice(0, last));
      const rest = chunk.slice(last);
      src += `__line=${restLine}; out+=${JSON.stringify(rest)};\n`;

      tplLine += _countLines(chunk);
    }

    let src =
`return (async (data) => {
  let out=''; const print=(...a)=>out+=a.join('');
  const h=escapeHTML;
  let __line = 1;
  const __TPL_URL__ = ${JSON.stringify(url)};
  // NEW: helpers en scope (definidos vía __hooks)
  const ready = (cb) => { if (typeof cb === 'function') __hooks.r.push(cb); };
  const $  = (sel) => __hooks.q(sel);
  const $$ = (sel) => __hooks.qa(sel);
  try {
    with (Object.assign(Object.create(null), globals, data)) {
`;

    tpl.replace(re, (m, flag, code, off) => {
      // LITERAL previo
      emitLiteral(tpl.slice(i, off));

      // BLOQUE <% ... %>
      const blockStart = tplLine;
      if (flag === '=') {
        src += `__line=${blockStart}; out+=h((${code}));\n`;
      } else if (flag === '-') {
        src += `__line=${blockStart}; out+=(${code});\n`;
      } else {
        src += `__line=${blockStart}; ${code}\n`;
      }
      tplLine += _countLines(code);

      i = off + m.length;
    });

    // LITERAL final
    emitLiteral(tpl.slice(i));

    // Cierre + catch con línea y URL + sourceURL
    src +=
`    }
  } catch (e) {
    try { e.__tplLine = __line; } catch {}
    throw e;
  }
  return out;
})(data);
//# sourceURL=${JSON.stringify(url)}
`;

    try {
      // NEW: añadimos __hooks como 4º argumento
      const fn = new Function('data', 'escapeHTML', 'globals', '__hooks', src);
      // Runner: ahora necesitamos pasar __hooks desde renderInto
      return (data = {}, hooks) => fn(data, escapeHTML, cfg.globals, hooks);
    } catch (err) {
      console.error('[Templar] Error compiling template:', url, err);
      console.groupCollapsed('[Templar] Generated source for debug:', url);
      console.log(src);
      console.groupEnd();
      throw err;
    }
  }

  // ====== renderInto con contexto de error + ejecución de ready ======
  async function renderInto(url, data = {}, root) {
    const tpl = await fetchTemplate(url);
    const key = url + '::' + hash(tpl);

    let fn = _fnCache.get(key);
    if (!fn) {
      fn = compileAsync(tpl, url);
      _fnCache.set(key, fn);
    }

    // NEW: cola de ready + selectores $ y $$ ligados al root
    const hooks = {
      r: [],                                           // ready callbacks
      q: (sel) => root?.querySelector(sel) || null,    // $
      qa: (sel) => root ? Array.from(root.querySelectorAll(sel)) : [] // $$
    };

    try {
      const html = await fn(data, hooks); // NEW: pasamos hooks
      root.innerHTML = html;

      // NEW: ejecutar ready() después de pintar
      if (hooks.r.length) {
        for (const cb of hooks.r) {
          try { cb(); } catch (e) { console.error('[Templar] ready() callback error:', e); }
        }
      }
      return html;
    } catch (err) {
      const line = err && err.__tplLine;
      if (line) {
        const lines = tpl.split('\n');
        const L = Math.min(Math.max(1, line), lines.length);
        const from = Math.max(1, L - 2);
        const to = Math.min(lines.length, L + 2);

        console.error(`[Templar] Runtime error in ${url} (line ${L})`, err);
        console.groupCollapsed('[Templar] Context', `${url}:${L}`);
        for (let n = from; n <= to; n++) {
          const mark = n === L ? '>' : ' ';
          const pad = String(n).padStart(String(to).length, ' ');
          console.log(`${mark} ${pad} | ${lines[n - 1]}`);
        }
        console.log('Data received:', data?.data ?? data);
        console.groupEnd();
      } else {
        console.error('[Templar] Error rendering template:', url, err);
      }
      throw err; // re-lanza para que el caller decida qué hacer
    }
  }

  return { configure, compileAsync, renderInto, _tplCache, _fnCache };
})();

if (typeof window !== "undefined") window.Templar = Templar;
export default Templar;
export { Templar };
