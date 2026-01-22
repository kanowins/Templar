// templar-forge.1.0.js
import { Templar } from "./templar-core.1.0.js";

// KISS: atributos planos + atributo especial `data` (JSON).
// Unifica con templar-core: ready/$/$$ vienen de core (no los inyectamos aquí).
export class BaseElement extends HTMLElement {
  static templateUrl = null;

  static get observedAttributes() { return ["data"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._data = {};
    this._disposed = false;
    this._raf = 0;
    this._bindQueue = [];
    this._addedListeners = null;
  }

  // -- upgradeProperty pattern --
  _upgradeProperty(prop) {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const value = this[prop];
      delete this[prop];
      this[prop] = value;
    }
  }

  get data() { return this._data; }
  set data(v) {
    this._data = { ...(this._data || {}), ...(v || {}) };
    this._scheduleRender();
  }

  set(key, val) {
    this._data = { ...(this._data || {}), [key]: val };
    this._scheduleRender();
  }

  attributeChangedCallback(name, _old, val) {
    if (name === "data") {
      const parsed = this._tryParseJSON(val);
      if (parsed !== null) {
        this._data = { ...(this._data || {}), ...parsed };
        this._scheduleRender();
      } else if (val !== null) {
        console.error(
          `[TemplarForge] JSON parse error en atributo data de <${this.tagName.toLowerCase()}>:`,
          val
        );
      }
      return;
    }
    const next = (val === "" || val === null) ? this.hasAttribute(name) : val;
    this._data[name] = next;
    this._scheduleRender();
  }

  connectedCallback() {
    this._disposed = false;
    this._upgradeProperty("data");

    // Seed inicial desde TODOS los atributos actuales
    for (const attr of this.getAttributeNames()) {
      const value = this.getAttribute(attr);
      if (attr === "data") {
        const parsed = this._tryParseJSON(value);
        if (parsed !== null) this._data = { ...(this._data || {}), ...parsed };
        else if (value !== null) {
          console.error(
            `[TemplarForge] JSON parse error en atributo data de <${this.tagName.toLowerCase()}>:`,
            value
          );
        }
      } else {
        const prim = (value === "" || value === null) ? this.hasAttribute(attr) : value;
        this._data[attr] = prim;
      }
    }

    this._setupShadowObserver();
    this._scheduleRender();
  }

  disconnectedCallback() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._addedListeners) {
      for (const { el, type, fn } of this._addedListeners) el.removeEventListener(type, fn);
      this._addedListeners = null;
    }
    if (this._shadowMo) {
      this._shadowMo.disconnect();
      this._shadowMo = null;
    }
  }

  _setupShadowObserver() {
    if (this._shadowMo) return;
    if (!window.TemplarForge) return;

    // Observador local para el ShadowRoot
    this._shadowMo = new MutationObserver((mutations) => {
      if (!window.TemplarForge) return;

      // Acceso a config y ensureDefined a traves del global
      const tagPrefix = window.TemplarForge._config ? window.TemplarForge._config.tagPrefix.toUpperCase() : 'TEMPLAR-';

      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const el = /** @type {Element} */ (node);
          const tag = el.tagName;

          if (tag.startsWith(tagPrefix)) {
            window.TemplarForge.ensureDefined(tag.toLowerCase());
          }

          // Deep scan de lo insertado
          if (window.TemplarForge._scanForTemplarInShadow) {
            window.TemplarForge._scanForTemplarInShadow(el); // Escana sub-arbol
          }
        });
      }
    });

    try {
      this._shadowMo.observe(this.shadowRoot, { childList: true, subtree: true });
    } catch (e) {
      console.warn('[TemplarForge] No se pudo observar shadowRoot (quizas cerrado?):', e);
    }
  }

  _scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  async render() {
    if (this._disposed) return;
    const tplUrl = this.constructor.templateUrl;
    if (!tplUrl) {
      console.error(`${this.tagName.toLowerCase()}: templateUrl no definido`);
      return;
    }

    // Helpers de componente (específicos de Forge):
    const emit = (name, detail = {}, options = {}) => {
      const ev = new CustomEvent(name, { detail, bubbles: true, composed: true, ...options });
      this.dispatchEvent(ev);
    };

    const bind = (type, target, handler) => {
      this._bindQueue.push({ type, target, handler });
    };

    // Scope para la plantilla:
    // NOTA: no inyectamos ready/$/$$; vendrán de templar-core (ligados a this.shadowRoot)
    const scoped = {
      ...this._data,
      data: this._data,
      host: this,
      emit,
      bind
    };

    await Templar.renderInto(tplUrl, scoped, this.shadowRoot);

    // Aplica binds post-render
    this._applyBinds();

    // Auto-scan de subcomponentes <templar-*> dentro del shadow
    try {
      if (window?.TemplarForge?._scanForTemplarInShadow) {
        window.TemplarForge._scanForTemplarInShadow(this.shadowRoot);
      }
    } catch (e) {
      console.error("[TemplarForge] Scan shadowRoot error:", e);
    }
  }

  _applyBinds() {
    // limpiar listeners antiguos…
    if (this._addedListeners) {
      for (const { el, type, fn } of this._addedListeners) el.removeEventListener(type, fn);
    }
    this._addedListeners = [];

    for (const { type, target, handler } of this._bindQueue) {
      if (type === "__ready__") {
        // (legacy) por compat: si alguien lo usa, ejecútalo sin romper
        try { handler.call(this); } catch (e) { console.error(e); }
        continue;
      }
      if (!type || !handler) continue;

      const elements = typeof target === "string"
        ? Array.from(this.shadowRoot.querySelectorAll(target))
        : (target ? [target] : []);
      for (const el of elements) {
        const fn = (e) => handler.call(this, e);
        el.addEventListener(type, fn);
        this._addedListeners.push({ el, type, fn });
      }
    }

    this._bindQueue = [];
  }

  _tryParseJSON(str) {
    if (typeof str !== "string") return null;
    try { return JSON.parse(str); } catch { return null; }
  }
}

export function defineElement(tag, cls) {
  customElements.define(tag, cls);
  return cls;
}

// ================= Auto-registro por convención para <templar-xxx> =================
// Resolución: <templar-user-card> -> {basePath}/user-card{extension}
// Por defecto coherente con appBase: basePath='./components/', extension='.html', tagPrefix='templar-'
export const TemplarForge = (() => {
  const cfg = {
    // IMPORTANTE: ahora por defecto es relativo (no absoluto) para portabilidad.
    basePath: "./components/",
    extension: ".html",
    tagPrefix: "templar-",
    shadowMode: "open",
    nestedDirs: false,          // user-card -> components/user/card.html
    resolver: null,             // (opts) => url  (opcional)
    debug: false,

    // NEW: appBase auto-detectada para subcarpetas (/suma/…)
    appBase: null               // si no se define, se infiere de <base> o del directorio del documento
  };

  // cache de defines en curso
  const definePromises = new Map(); // tagName -> Promise

  // -- Utils de base/URL --
  function _detectAppBase() {
    // 1) <base href> si existe
    const baseEl = document.querySelector('base[href]');
    if (baseEl) {
      try { return new URL(baseEl.getAttribute('href'), location.origin).href; } catch { }
    }
    // 2) directorio del documento actual (e.g. /suma/)
    const p = location.pathname;
    const dir = p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1);
    return new URL(dir, location.origin).href;
  }

  function _toAbsolute(urlLike, base) {
    // new URL() maneja absoluto/relativo
    return new URL(urlLike, base).href;
  }

  function configure(opts = {}) {
    Object.assign(cfg, opts);
  }

  function _normalizeBase(base) {
    return base.endsWith("/") ? base : base + "/";
  }

  function _effectiveAppBase() {
    return cfg.appBase || _detectAppBase();
  }

  function _effectiveBasePath() {
    // basePath puede ser absoluto o relativo; lo normal ahora: relativo como './components/'
    const baseAbs = _toAbsolute(_normalizeBase(cfg.basePath), _effectiveAppBase());
    return baseAbs; // ya es absoluta
  }

  function resolveUrlFromTag(tagName) {
    tagName = tagName.toLowerCase();
    if (!tagName.startsWith(cfg.tagPrefix)) return null;

    const baseAbs = _effectiveBasePath();
    const name = tagName.slice(cfg.tagPrefix.length); // p.ej. 'user-card'

    // Resolver custom (si lo hay)
    if (typeof cfg.resolver === 'function') {
      const url = cfg.resolver({
        tagName, name,
        basePath: baseAbs,
        extension: cfg.extension,
        nestedDirs: cfg.nestedDirs
      });
      return url;
    }

    // nestedDirs=true → 'user-card' => 'user/card'
    const rel = cfg.nestedDirs ? name.replace(/-+/g, '/') : name;

    // new URL para resolver correctamente
    return new URL(rel + cfg.extension, baseAbs).href;
  }

  async function ensureDefined(tagName) {
    tagName = tagName.toLowerCase();
    if (!tagName.startsWith(cfg.tagPrefix)) return;
    if (customElements.get(tagName)) return;

    if (definePromises.has(tagName)) return definePromises.get(tagName);

    const url = resolveUrlFromTag(tagName);
    if (!url) return;

    const p = (async () => {
      if (cfg.debug) console.debug("[TemplarForge] define", tagName, "->", url);
      class AutoTemplarElement extends BaseElement {
        static templateUrl = url;
        constructor() {
          super();
          if (!this.shadowRoot) this.attachShadow({ mode: cfg.shadowMode });
        }
      }
      try {
        customElements.define(tagName, AutoTemplarElement);
      } catch (e) {
        if (!customElements.get(tagName)) {
          console.error(`[TemplarForge] Error definiendo ${tagName}:`, e);
        }
      }
    })();

    definePromises.set(tagName, p);
    return p;
  }

  function scanRoot(root) {
    try {
      const prefix = TemplarForge._config.tagPrefix.toUpperCase(); // 'TEMPLAR-'
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
      let node = walker.currentNode;
      if (node.nodeType === 1) {
        const tag = /** @type {Element} */(node).tagName;
        if (tag.startsWith(prefix)) ensureDefined(tag);
      }
      while ((node = walker.nextNode())) {
        const el = /** @type {Element} */(node);
        const tag = el.tagName;
        if (tag.startsWith(prefix)) ensureDefined(tag);
      }
    } catch (e) {
      if (TemplarForge._config.debug) {
        console.debug("[TemplarForge] scanRoot error:", e?.message);
      }
    }
  }

  let _mo = null;

  function start(opts) {
    // merge opciones primero
    if (opts && typeof opts === 'object') Object.assign(cfg, opts);

    // asegura appBase efectiva para resolver rutas relativas
    if (!cfg.appBase) cfg.appBase = _effectiveAppBase();

    if (_mo) {
      if (cfg.debug) console.debug("[TemplarForge] start() ya estaba activo");
      return { stop };
    }

    // 1) Escaneo inicial
    scanRoot(document);

    // 2) Observar nuevos nodos
    _mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const el = /** @type {Element} */ (node);

          const tag = el.tagName.toLowerCase();
          if (tag.startsWith(cfg.tagPrefix)) ensureDefined(tag);

          scanRoot(el);
        });
      }
    });

    _mo.observe(document.documentElement, { childList: true, subtree: true });
    if (cfg.debug) console.debug("[TemplarForge] Auto-register started", {
      appBase: cfg.appBase,
      basePathAbs: _effectiveBasePath()
    });
    return { stop };
  }

  function stop() {
    if (_mo) {
      _mo.disconnect();
      _mo = null;
      if (cfg.debug) console.debug("[TemplarForge] Auto-register stopped");
    }
  }

  function _scanForTemplarInShadow(shadowRoot) {
    scanRoot(shadowRoot);
  }

  return {
    configure,
    start,
    stop,
    ensureDefined,
    resolveUrlFromTag,   // útil para debug
    _scanForTemplarInShadow,
    _config: cfg,
  };
})();

if (typeof window !== "undefined") window.TemplarForge = TemplarForge;
export default TemplarForge;
