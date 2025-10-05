(() => {
  // ──────────────────────────────────────────────────────────────
  // Estado y utilidades
  // ──────────────────────────────────────────────────────────────
  const state = {
    basePath: "",
    currentLang: null,
    dict: {},
    cache: new Map(),          // lang -> dict
    formats: new Map(),        // nombre -> handler(text, config, ctx)
    langReqId: 0,              // para evitar condiciones de carrera
  };

  const normalizePath = (p) => (!p ? "" : (p.endsWith("/") ? p : p + "/"));

  const safeParseJSON = (s) => {
    if (typeof s !== "string") return null;
    try { return JSON.parse(s); } catch 
    { 
      console.warn("[loc] JSON inválido:", s);
      return null; 
    }
  };

  const toArray = (x) => Array.isArray(x) ? x : (x != null ? [x] : []);

  function getLangFallbacks(lang) {
    if (!lang) return [];
    const parts = String(lang).split("-");
    if (parts.length > 1) return [lang, parts[0]];
    return [lang];
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.text();
  }

  // ──────────────────────────────────────────────────────────────
  // Parser .properties (UTF-8 recomendado; soporta \uXXXX + backticks multilínea)
  // ──────────────────────────────────────────────────────────────
  function parseProperties(text) {
    const out = {};
    const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const rawLines = clean.split("\n");

    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("!")) continue;

      // 1) Analiza sólo la línea física para detectar si arranca un bloque con `
      const sepInfo = findSeparator(line);
      let key, value;

      if (sepInfo.sep < 0) {
        // Línea sin separador: clave con valor vacío
        key = unescapeProp(t);
        out[key] = "";
        continue;
      }

      const keyRaw = line.slice(0, sepInfo.sep);
      let valPart = sepInfo.spaceSep
        ? line.slice(sepInfo.sep + 1).replace(/^\s+/, "")
        : line.slice(sepInfo.sep + 1);

      // ¿Es bloque con backtick?
      const vTrimStart = valPart.replace(/^\s+/, "");
      if (vTrimStart.startsWith("`")) {
        // Consumir desde el primer backtick
        const idxStart = valPart.indexOf("`");
        let after = valPart.slice(idxStart + 1);
        let block = "";
        let pos = findUnescapedBacktick(after);

        if (pos >= 0) {
          // Cierra en la misma línea
          block = after.slice(0, pos);
        } else {
          // Acumular líneas hasta encontrar el backtick de cierre
          block = after + "\n";
          while (++i < rawLines.length) {
            const l2 = rawLines[i];
            const p2 = findUnescapedBacktick(l2);
            if (p2 >= 0) {
              block += l2.slice(0, p2);
              break;
            } else {
              block += l2 + "\n";
            }
          }
        }

        key = unescapeProp(keyRaw.trim());
        value = unescapeProp(block.trim());
        out[key] = value;
        continue;
      }

      // 2) No es bloque con ` → usa la lógica estándar con continuaciones "\"
      let logical = line;
      while (endsWithSingleBackslash(logical) && i + 1 < rawLines.length) {
        logical = logical.slice(0, -1) + rawLines[++i];
      }

      const trimmed = logical.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;

      const sepInfo2 = findSeparator(trimmed);
      if (sepInfo2.sep >= 0) {
        const k = trimmed.slice(0, sepInfo2.sep);
        let v = sepInfo2.spaceSep
          ? trimmed.slice(sepInfo2.sep + 1).trimStart()
          : trimmed.slice(sepInfo2.sep + 1);
        key = unescapeProp(k.trim());
        value = unescapeProp(v.trim());
      } else {
        key = unescapeProp(trimmed);
        value = "";
      }
      out[key] = value;
    }

    return out;

    // ── Helpers ────────────────────────────────────────────────
    function findSeparator(s) {
      // Devuelve índice del primer =, :, o espacio no escapado; y si el sep fue espacio
      let sep = -1, spaceSep = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "=" || ch === ":") { sep = i; break; }
        if (/\s/.test(ch)) { sep = i; spaceSep = true; break; }
        if (ch === "\\") i++; // saltar el siguiente
      }
      return { sep, spaceSep };
    }

    function endsWithSingleBackslash(s) {
      let count = 0;
      for (let i = s.length - 1; i >= 0 && s[i] === "\\"; i--) count++;
      return count % 2 === 1;
    }

    function findUnescapedBacktick(s) {
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "`") {
          // está escapado si hay un número impar de "\" inmediatamente antes
          let b = 0, j = i - 1;
          while (j >= 0 && s[j] === "\\") { b++; j--; }
          if (b % 2 === 0) return i; // no escapado
        }
      }
      return -1;
    }

    function unescapeProp(s) {
      let r = "";
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c !== "\\") { r += c; continue; }
        if (i + 1 >= s.length) { r += "\\"; break; }
        const n = s[++i];
        switch (n) {
          case "t": r += "\t"; break;
          case "n": r += "\n"; break;
          case "r": r += "\r"; break;
          case "f": r += "\f"; break;
          case "\\": r += "\\"; break;
          case ":": r += ":"; break;
          case "=": r += "="; break;
          case "u": {
            const hex = s.slice(i + 1, i + 5);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) { r += String.fromCharCode(parseInt(hex, 16)); i += 4; }
            else { r += "u"; }
            break;
          }
          default:
            // Por defecto, elimina la barra y deja el carácter tal cual (incluye \`)
            r += n; break;
        }
      }
      return r;
    }
  }


  // ──────────────────────────────────────────────────────────────
  // Formatos (plugins) — API pública y built-ins
  // ──────────────────────────────────────────────────────────────
  function addFormat(name, handler) {
    if (!name || typeof handler !== "function") return;
    state.formats.set(name, handler);
  }

  // Helpers built-ins
  const formatNumber = (value, lang, options = {}) => {
    const num = typeof value === "number" ? value : Number(value);
    if (!isFinite(num)) return String(value);
    return new Intl.NumberFormat(lang || undefined, options).format(num);
  };
  const toDate = (v) => {
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(+d) ? null : d;
  };

  // Built-ins
  addFormat("number", (text, config, ctx) => formatNumber(text, ctx.lang, config || {}));
  addFormat("currency", (text, config, ctx) => {
    const { currency, ...rest } = config || {};
    return formatNumber(text, ctx.lang, { style: "currency", currency, ...rest });
  });
  addFormat("percent", (text, config, ctx) => {
    return formatNumber(text, ctx.lang, { style: "percent", ...(config || {}) });
  });
  addFormat("date", (text, config, ctx) => {
    const d = toDate(text); if (!d) return String(text);
    return new Intl.DateTimeFormat(ctx.lang || undefined, config || { dateStyle: "medium" }).format(d);
  });
  addFormat("time", (text, config, ctx) => {
    const d = toDate(text); if (!d) return String(text);
    return new Intl.DateTimeFormat(ctx.lang || undefined, config || { timeStyle: "short" }).format(d);
  });
  addFormat("datetime", (text, config, ctx) => {
    const d = toDate(text); if (!d) return String(text);
    const def = { dateStyle: "medium", timeStyle: "short" };
    return new Intl.DateTimeFormat(ctx.lang || undefined, { ...def, ...(config || {}) }).format(d);
  });
  addFormat("upper", (text) => String(text).toUpperCase());
  addFormat("lower", (text) => String(text).toLowerCase());
  addFormat("capitalize", (text) => {
    const s = String(text);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
  addFormat("pad", (text, config) => {
    const { length = 2, char = "0", side = "left" } = config || {};
    const s = String(text);
    return side === "right" ? s.padEnd(length, char) : s.padStart(length, char);
  });
  addFormat("trim", (text) => String(text).trim());

  function applyPipeline(value, pipeline, ctx) {
    const steps = toArray(pipeline);
    let out = value;
    for (const step of steps) {
      if (typeof step === "string") {
        const fmt = state.formats.get(step);
        if (fmt) out = fmt(out, {}, ctx);
      } else if (step && typeof step === "object") {
        const { name, ...cfg } = step;
        const fmt = state.formats.get(name);
        if (fmt) out = fmt(out, cfg, ctx);
      }
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────
  // Helpers para pipe inline {param|plugin} y {param|plugin({...})}
  // ──────────────────────────────────────────────────────────────

  // Divide por '|' ignorando los que estén dentro de paréntesis o entre comillas
  function splitTopLevelPipes(s) {
    const parts = [];
    let buf = "";
    let depth = 0;
    let quote = null;
    let escape = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        buf += ch;
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
      if (ch === "(") { depth++; buf += ch; continue; }
      if (ch === ")") { if (depth > 0) depth--; buf += ch; continue; }
      if (ch === "|" && depth === 0) {
        parts.push(buf.trim());
        buf = "";
        continue;
      }
      buf += ch;
    }
    if (buf.length) parts.push(buf.trim());
    return parts;
  }

  // Devuelve { key, pipeline } donde pipeline es Array de pasos para applyPipeline
  function parseInlineSpec(spec) {
    const segments = splitTopLevelPipes(spec.trim());
    if (!segments.length) return { key: spec.trim(), pipeline: null };

    const key = segments[0].trim();
    const steps = [];

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;

      // plugin o plugin({...})
      const open = seg.indexOf("(");
      const close = seg.endsWith(")");
      if (open > 0 && close) {
        const name = seg.slice(0, open).trim();
        const cfgStr = seg.slice(open + 1, -1).trim(); // contenido dentro de (...)
        let cfg = null;
        if (cfgStr) {
          cfg = safeParseJSON(cfgStr);
          if (cfg === null) {
            console.warn(`[loc] Config JSON inválido en pipe: ${seg}`);
            // sigue como si no hubiera config
            steps.push(name);
            continue;
          }
        }
        steps.push({ name, ...cfg });
      } else {
        steps.push(seg.trim());
      }
    }

    return { key, pipeline: steps.length ? steps : null };
  }

  // Reemplaza tokens { ... } respetando } dentro de (...)
  // callback recibe el contenido interno (sin llaves) y devuelve el reemplazo
  function replaceTokens(template, callback) {
    let out = "";
    let i = 0;
    const s = String(template);

    while (i < s.length) {
      const start = s.indexOf("{", i);
      if (start === -1) { out += s.slice(i); break; }
      out += s.slice(i, start);

      // Buscar '}' correspondiente ignorando los que estén dentro de paréntesis o entre comillas
      let j = start + 1;
      let depth = 0;
      let quote = null;
      let escape = false;

      for (; j < s.length; j++) {
        const ch = s[j];
        if (quote) {
          if (escape) { escape = false; continue; }
          if (ch === "\\") { escape = true; continue; }
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (ch === "(") { depth++; continue; }
        if (ch === ")") { if (depth > 0) depth--; continue; }
        if (ch === "}" && depth === 0) break;
      }

      if (j >= s.length) {
        // No se encontró cierre → deja el resto tal cual
        out += s.slice(start);
        break;
      }

      const inner = s.slice(start + 1, j);
      out += callback(inner);
      i = j + 1;
    }

    return out;
  }


  // ──────────────────────────────────────────────────────────────
  // Traducción + interpolación
  // ──────────────────────────────────────────────────────────────
  function gatherParams(el) {
    const params = {};

    // 1) params JSON
    const json = safeParseJSON(el.getAttribute("params"));
    if (json && typeof json === "object") Object.assign(params, json);

    // 2) p-* (más prioridad que data-*)
    for (const attr of el.attributes) {
      if (attr.name.startsWith("p-")) {
        const key = attr.name.slice(2);
        params[key] = coerceType(attr.value);
      }
    }

    // 3) data-*
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-")) {
        const key = attr.name.slice(5);
        if (!(key in params)) params[key] = coerceType(attr.value);
      }
    }

    return params;

    function coerceType(v) {
      if (v === "true") return true;
      if (v === "false") return false;
      if (v !== "" && !isNaN(v)) return Number(v);
      // Intento de JSON (arrays/objetos simples)
      const j = safeParseJSON(v);
      return j !== null ? j : v;
    }
  }

  function gatherFormats(el) {
    const formats = safeParseJSON(el.getAttribute("formats"));
    // Debe ser objeto {"param": pipeline, "*": pipeline}
    return (formats && typeof formats === "object") ? formats : {};
  }

  function interpolate(template, params, formats, ctx) {
    if (template == null) return "";
    const fmtMap = formats || {};

    // Reemplazo token a token con soporte pipe inline
    let result = replaceTokens(template, (content) => {
      // Soporta: {param}, {param|plugin}, {param|plugin({...})} e incluso pipelines múltiples
      const { key: pKey, pipeline: inlinePipe } = parseInlineSpec(content);

      if (!(pKey in params)) {
        // Param ausente → deja el token visible
        return `{${content}}`;
      }

      const raw = params[pKey];

      // Prioridad: atributo formats > pipe inline
      const chosenPipeline = (pKey in fmtMap) ? fmtMap[pKey] : inlinePipe;

      const formatted = chosenPipeline
        ? applyPipeline(raw, chosenPipeline, { ...ctx, param: pKey })
        : raw;

      return String(formatted);
    });

    // Formato del texto completo, si existe ("*")
    if (fmtMap["*"]) {
      result = String(applyPipeline(result, fmtMap["*"], { ...ctx, param: "*" }));
    }

    return result;
  }


  function resolveTextFor(el, key, fallback, params, formats) {
    const ctx = { lang: state.currentLang, key, element: el, params };

    if (key && state.dict && Object.prototype.hasOwnProperty.call(state.dict, key)) {
      const template = state.dict[key];
      return interpolate(template, params, formats, ctx);
    }
    // Fallback parametrizado
    return interpolate(fallback, params, formats, ctx);
  }

  // ──────────────────────────────────────────────────────────────
  // <loc-text> Custom Element
  // ──────────────────────────────────────────────────────────────
  class LocText extends HTMLElement {
    constructor() {
      super();
      this.__fallbackTemplate = null;
      this.__ready = false;            // conectado + fallback capturado
      this.__pendingUpdate = false;
      this.__childObserver = null;
      this.__attrObserver = null;
    }

    static get observedAttributes() { return ['key', 'params', 'formats']; }

    connectedCallback() {
      if (this.__ready) return;

      const tryCapture = () => {
        // 1) intento inmediato
        let t = (this.innerHTML || '').trim();
        // 2) o usa atributo fallback explícito si lo has puesto
        if (!t) {
          const attrFallback = this.getAttribute('fallback');
          if (attrFallback && attrFallback.trim()) t = attrFallback.trim();
        }
        if (t) {
          this.__fallbackTemplate = t;
          this.__ready = true;
          this.#startAttrObserver();
          const run = this.__pendingUpdate; // evita doble update
          this.__pendingUpdate = false;
          this.update();                     // primera render
          return true;
        }
        return false;
      };

      if (!tryCapture()) {
        // El contenido aún no está: espera a que aparezca
        this.__childObserver = new MutationObserver(() => {
          if (tryCapture()) {
            this.__childObserver.disconnect();
            this.__childObserver = null;
          }
        });
        this.__childObserver.observe(this, { childList: true, subtree: true, characterData: true });
      }
    }

    #startAttrObserver() {
      if (this.__attrObserver) return;
      this.__attrObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes') {
            const n = m.attributeName || '';
            if (n === 'key' || n === 'params' || n === 'formats' || n.startsWith('p-') || n.startsWith('data-')) {
              this.update();
              break;
            }
          }
        }
      });
      this.__attrObserver.observe(this, { attributes: true });
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (oldVal === newVal) return;
      // AÚN no listo → marca pendiente y sal
      if (!this.__ready) { this.__pendingUpdate = true; return; }
      this.update();
    }

    update() {
      // Si entra por cualquier camino antes de estar listo, aplaza
      if (!this.__ready) { this.__pendingUpdate = true; return; }

      const key = this.getAttribute('key') || '';
      const params = gatherParams(this);       // tu helper
      const formats = gatherFormats(this);     // tu helper
      const fallback = this.__fallbackTemplate ?? '';
      const text = resolveTextFor(this, key, fallback, params, formats); // tu helper
      this.innerHTML = text;
      this.dispatchEvent(new CustomEvent('loc:updated', { detail: { key, lang: window.loc?.getLanguage?.() } }));
    }

    disconnectedCallback() {
      this.__attrObserver?.disconnect();
      this.__attrObserver = null;
      this.__childObserver?.disconnect();
      this.__childObserver = null;
      // Mantén __fallbackTemplate para si vuelve a conectarse
    }
  }

  if (!customElements.get("loc-text")) {
    customElements.define("loc-text", LocText);
  }

  // ──────────────────────────────────────────────────────────────
  // Carga de diccionarios y API pública
  // ──────────────────────────────────────────────────────────────
  async function loadDictFor(lang) {
    if (state.cache.has(lang)) return state.cache.get(lang);

    const tries = getLangFallbacks(lang).map(l => ({ lang: l, url: `${state.basePath}${l}.properties` }));
    let lastError = null;
    for (const t of tries) {
      try {
        const txt = await fetchText(t.url);
        const dict = parseProperties(txt);
        state.cache.set(lang, dict); // cachea por lang solicitado (no por subtag)
        return dict;
      } catch (err) {
        lastError = err;
      }
    }
    console.warn(`[loc] No se pudo cargar ${tries.map(x => x.url).join("  o  ")}`, lastError);
    state.cache.set(lang, {}); // evita reintentos inmediatos
    return {};
  }

  function refreshAll() {
    document.querySelectorAll("loc-text").forEach(el => {
      if (typeof el.update === "function") el.update();
    });
  }

  const api = {
    setBasePath(path) {
      state.basePath = normalizePath(path);
    },
    async setLanguage(lang) {
      state.currentLang = lang;
      const reqId = ++state.langReqId;
      const dict = await loadDictFor(lang);
      // si durante la espera cambiaron de idioma, ignora
      if (reqId !== state.langReqId) return;
      state.dict = dict || {};
      refreshAll();
    },
    refresh() { refreshAll(); },
    addFormat, // plugins
    getLanguage() { return state.currentLang; },
    // t(key, fallback[, params, formats, element]) — público pero opcional
    t(key, fallback = "", params = null, formats = null, element = null) {
      return resolveTextFor(element || document.body, key, fallback, params || {}, formats || {});
    }
  };

  // Exponer sin machacar si ya existe
  window.loc = window.loc || api;
})();
