// templar-route.1.0.js
// Router minimalista para Templar + TemplarForge
// © 2025 Sumalab

import { Templar } from './templar-core.1.0.js';

const TemplarRoute = (() => {
  // ================== Config & Estado ==================
  const cfg = {
    root: null,                 // selector | Element | () => Element|ShadowRoot
    basePath: './views/',       // ← coherente con Forge (relativo a appBase)
    extension: '.html',
    index: 'index',
    wildcard: null,             // string | (ctx)=>string  (si null, -> basePath + '404' + extension)
    appBase: null,              // auto: <base href> o directorio del documento
    linkSelector: 'a[href]:not([download])', // interceptar enlaces internos
    historyDefault: 'push',     // 'push'|'replace'|'none'
    debug: false,
    onError: null,              // (err, ctx) => void

    // Transiciones
    transition: null,           // clave transitions o { out, in }
    transitions: {},            // { name: { out(ctx), in(ctx) } }

    // NEW: si no existe la vista, intentar navegación nativa (full page load)
    fallbackToNativeOnMiss: false
  };

  let started = false;
  let navToken = 0;
  let routes = [];              // { raw, regex, keys, wildcard, ...route }
  let clickHandler = null;
  let popHandler = null;

  // ================== Utils de URL/base ==================
  function _detectAppBase() {
    const baseEl = document.querySelector('base[href]');
    if (baseEl) {
      try { return new URL(baseEl.getAttribute('href'), location.origin).href; } catch {}
    }
    const p = location.pathname;
    const dir = p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1);
    return new URL(dir, location.origin).href;
  }
  function _effAppBase() {
    return cfg.appBase || _detectAppBase();
  }
  function _toAbs(urlLike, base) {
    return new URL(urlLike, base).href;
  }
  function _effBasePathAbs() {
    return _toAbs(_normalizeSlash(cfg.basePath), _effAppBase());
  }
  function _normalizeSlash(s) {
    return s.endsWith('/') ? s : (s + '/');
  }
  const _stripTrailingSlash = (s) => (s === '/' ? s : s.replace(/\/+$/, ''));

  // 🔧 Helpers app-relativos
  function _toAppURL(p) {
    try {
      // absoluta con esquema → respétala
      if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(p)) return new URL(p);
      // tratamos "/foo" como relativo a appBase
      const rel = p.startsWith('/') ? p.slice(1) : p;
      return new URL(rel, _effAppBase());
    } catch {
      return new URL('.', _effAppBase());
    }
  }
  function _appHref(p) {
    const u = _toAppURL(p);
    return u.pathname + u.search + u.hash;
  }
  function _appRelativePathname(absPathname) {
    const basePN = new URL(_effAppBase()).pathname; // p.ej. "/suma/"
    if (absPathname.startsWith(basePN)) {
      const rest = absPathname.slice(basePN.length); // "about", "users/42"
      return '/' + rest;
    }
    return absPathname;
  }

  // ================== Path matching ==================
  function _compilePath(path) {
    if (path === '*' || path === '/*') {
      return { regex: /^.*$/i, keys: [], wildcard: true };
    }
    const keys = [];
    const rx = path
      .split('/')
      .map(seg => {
        if (!seg) return '';
        if (seg.startsWith(':')) {
          const name = seg.slice(1).replace(/\W/g, '');
          keys.push(name);
          return '([^/]+)';
        }
        return seg.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');
      })
      .join('/');
    return { regex: new RegExp('^' + rx + '/?$', 'i'), keys, wildcard: false };
  }

  function _matchRoute(pathname) {
    for (const r of routes) {
      const m = pathname.match(r.regex);
      if (m) {
        const pathParams = {};
        r.keys.forEach((k, i) => pathParams[k] = decodeURIComponent(m[i + 1] || ''));
        return { route: r, pathParams };
      }
    }
    return null;
  }

  // ================== Query/Params ==================
  function _parseQuery(search) {
    const out = {};
    if (!search) return out;
    const q = search.startsWith('?') ? search.slice(1) : search;
    if (!q) return out;
    for (const part of q.split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      const key = decodeURIComponent(k || '').trim();
      const val = decodeURIComponent(v || '');
      if (!key) continue;
      out[key] = val;
    }
    return out;
  }
  const _mergeParams = (pathParams, queryParams) => Object.assign({}, pathParams || {}, queryParams || {}); // query pisa

  // ================== View resolution ==================
  function _resolveViewByConvention(pathname) {
    const baseAbs = _effBasePathAbs(); // .../suma/views/
    if (pathname === '/' || pathname === '') {
      return new URL(cfg.index + cfg.extension, baseAbs).href;
    }
    const clean = pathname.replace(/^\/+/, ''); // "about", "users/42"
    return new URL(clean + cfg.extension, baseAbs).href;
  }

  function _resolveRoot(routeRoot) {
    const rootOpt = routeRoot || cfg.root;
    try {
      if (!rootOpt) throw new Error('[TemplarRoute] No root configured');
      if (typeof rootOpt === 'function') return rootOpt() || null;
      if (typeof rootOpt === 'string') return document.querySelector(rootOpt);
      return rootOpt; // Element/ShadowRoot
    } catch {
      return null;
    }
  }

  const _pickTransition = (routeTransition) => {
    const pick = routeTransition ?? cfg.transition;
    if (!pick) return null;
    if (typeof pick === 'string') return cfg.transitions[pick] || null;
    if (typeof pick === 'object' && (pick.out || pick.in)) return pick;
    return null;
  };

  const _onceTransitionEnd = (el) => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; cleanup(); resolve(); } };
    const to = setTimeout(finish, 1000);
    const onEnd = () => finish();
    const cleanup = () => {
      clearTimeout(to);
      el.removeEventListener('transitionend', onEnd);
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('transitionend', onEnd, { once: true });
    el.addEventListener('animationend', onEnd, { once: true });
    requestAnimationFrame(() => {
      const cs = getComputedStyle(el);
      const dur = parseFloat(cs.transitionDuration) || 0;
      const adur = parseFloat(cs.animationDuration) || 0;
      if (dur === 0 && adur === 0) finish();
    });
  });
  const _nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

  // ================== Contexto ==================
  function _buildCtx(urlLike, state) {
    const uAbs = _toAppURL(urlLike);                   // absoluto bajo appBase
    const appPN = _appRelativePathname(uAbs.pathname); // "/about" (no "/suma/about")
    const path = appPN + uAbs.search + uAbs.hash;      // app-relativo
    const pathname = _stripTrailingSlash(appPN) || '/';
    const hash = uAbs.hash || '';
    const queryParams = _parseQuery(uAbs.search);
    return { url: path, path, pathname, hash, queryParams, state };
  }

  // ================== Historial ==================
  function _doHistory(mode, urlLike, state) {
    if (mode === 'none') return;
    const href = _appHref(urlLike); // aplica appBase
    if (mode === 'replace') history.replaceState(state ?? {}, '', href);
    else history.pushState(state ?? {}, '', href);
  }

  // ================== Errores ==================
  function _safeOnError(err, ctx) {
    if (cfg.debug) console.error('[TemplarRoute] Error:', err, ctx);
    if (typeof cfg.onError === 'function') {
      try { cfg.onError(err, ctx); } catch (e) { console.error(e); }
    }
  }

  // ================== Render core ==================
  async function _renderSequence(token, { root, view, data, transition, ctx }) {
    if (transition?.out) {
      if (token.canceled) return;
      try { await transition.out({ root, ctx, wait: _onceTransitionEnd }); } catch (e) { if (cfg.debug) console.warn(e); }
    }
    if (token.canceled) return;

    await Templar.renderInto(view, data, root);

    if (transition?.in) {
      if (token.canceled) return;
      await _nextFrame();
      try { await transition.in({ root, ctx, wait: _onceTransitionEnd }); } catch (e) { if (cfg.debug) console.warn(e); }
    }
  }

  async function _renderWildcard(token, ctx0, historyPref) {
    // Si se pidió fallback nativo, intenta navegación real (progresive enhancement)
    if (cfg.fallbackToNativeOnMiss) {
      try {
        location.assign(_appHref(ctx0.path));
        return;
      } catch (e) {
        if (cfg.debug) console.warn('[TemplarRoute] Native fallback failed, rendering 404 instead');
      }
    }

    const root = _resolveRoot(null);
    if (!root) return _safeOnError(new Error('Wildcard: root not found'), { stage: 'wildcard-root' });

    const transition = _pickTransition(null);
    const url = (typeof cfg.wildcard === 'function')
      ? cfg.wildcard(ctx0)
      : (cfg.wildcard || new URL('404' + cfg.extension, _effBasePathAbs()).href);

    try {
      await _renderSequence(token, {
        root,
        view: url,
        data: { params: {}, route: ctx0 },
        transition,
        ctx: { ...ctx0, route: null }
      });
      if (historyPref && historyPref !== 'none') _doHistory(historyPref, ctx0.path, {});
    } catch (e) {
      _safeOnError(e, { stage: 'wildcard-render', url });
    }
  }

  // ================== Navegación ==================
  async function _navigate(to, opts = {}, fromPop = false) {
    const token = { id: ++navToken, canceled: false };
    const currentId = token.id;

    const historyPref = opts.history;
    const dataFromGo = opts.data || null;

    const ctx0 = _buildCtx(to, fromPop ? history.state : null);
    const { pathname, queryParams } = ctx0;

    // 1) match explícito por rutas
    let match = _matchRoute(pathname);
    let view = null, route = null, pathParams = {};

    if (match) {
      route = match.route;
      pathParams = match.pathParams;
      if (typeof route.view === 'function') {
        view = route.view({ ...ctx0, pathParams });
      } else if (typeof route.view === 'string') {
        view = route.view;
      } else {
        view = _resolveViewByConvention(pathname);
      }
    } else {
      // 2) convención directa por archivo
      view = _resolveViewByConvention(pathname);
    }

    // 3) params fusionados
    const params = _mergeParams(pathParams, queryParams);

    // 4) root resuelto
    const root = _resolveRoot(route?.root);
    if (!root) {
      _safeOnError(new Error('Root not found'), { stage: 'resolve-root', route, to });
      return _renderWildcard(token, ctx0, historyPref);
    }

    // 5) ctx para resolve/render
    const routeCtx = {
      path: ctx0.path,
      pathname: ctx0.pathname,
      hash: ctx0.hash,
      state: ctx0.state,
      dataFromGo,
      route,
      navigate: (path, o) => _navigate(path, o)
    };

    // 6) resolver (si existe)
    let res = null;
    if (route?.resolve) {
      try {
        res = await route.resolve(params, routeCtx);
      } catch (err) {
        _safeOnError(err, { stage: 'resolve', route, ctx: routeCtx });
        return _renderWildcard(token, ctx0, historyPref);
      }
    }
    if (token.id !== currentId) { token.canceled = true; return; }

    // 7) data final (siempre inyectamos params y route)
    const baseData = {
      params,
      route: {
        path: ctx0.path,
        pathname: ctx0.pathname,
        hash: ctx0.hash,
        pathParams,
        queryParams
      }
    };
    const extraData = (res && res.data) ? res.data : {};
    const finalData = Object.assign({}, baseData, extraData, dataFromGo || {});

    // 8) view final (resolver puede cambiarla) → absolutizamos contra appBase
    let finalView = (res && res.view) ? res.view : view;
    finalView = _toAppURL(finalView).href;

    // 9) transición
    const transition = _pickTransition(route?.transition);

    // 10) título
    if (res && res.title) {
      try { document.title = typeof res.title === 'function' ? res.title(routeCtx) : res.title; }
      catch (e) { if (cfg.debug) console.warn(e); }
    } else if (route?.title) {
      try { document.title = typeof route.title === 'function' ? route.title(routeCtx) : route.title; }
      catch (e) { if (cfg.debug) console.warn(e); }
    }

    // 11) render: por ruta (render custom) o renderInto por defecto
    try {
      if (route?.render) {
        // OUT → CUSTOM → IN
        await _renderSequence(token, {
          root,
          view: finalView,              // por si el custom lo usa
          data: finalData,
          transition,
          ctx: routeCtx,
        });
      } else {
        await _renderSequence(token, { root, view: finalView, data: finalData, transition, ctx: routeCtx });
      }
    } catch (err) {
      _safeOnError(err, { stage: 'render', route, view: finalView, data: finalData });
      return _renderWildcard(token, ctx0, historyPref);
    }
    if (token.id !== currentId) { token.canceled = true; return; }

    // Render custom: ejecutar la parte CUSTOM entre OUT e IN
    if (route?.render) {
      const transition2 = transition;
      try {
        await route.render({
          path: ctx0.path,
          pathname: ctx0.pathname,
          hash: ctx0.hash,
          state: ctx0.state,
          data: finalData,
          view: finalView,
          root,
          navigate: (path, o) => _navigate(path, o)
        });
      } catch (err) {
        _safeOnError(err, { stage: 'render-custom', route, view: finalView });
        return _renderWildcard(token, ctx0, historyPref);
      }
      if (transition2?.in) {
        if (token.id !== currentId) { token.canceled = true; return; }
        await _nextFrame();
        try { await transition2.in({ root, ctx: routeCtx, wait: _onceTransitionEnd }); } catch (e) { if (cfg.debug) console.warn(e); }
      }
    }

    // 12) history (si no viene de popstate)
    const desiredUrl = (res && res.url) ? res.url : to;
    const historyMode = (res && res.history) || historyPref || cfg.historyDefault;
    if (!fromPop) {
      try {
        _doHistory(historyMode, desiredUrl, (res && res.state) ? res.state : {});
      } catch (err) {
        _safeOnError(err, { stage: 'history', route, mode: historyMode, url: desiredUrl });
      }
    }
  }

  // ================== Intercept enlaces / popstate ==================
  function _installLinkInterceptor() {
    if (clickHandler) return;
    clickHandler = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      const a = e.target && /** @type {Element} */(e.target).closest?.('a');
      if (!a) return;
      if (a.hasAttribute('download') || (a.getAttribute('target') && a.getAttribute('target') !== '_self')) return;
      if (a.getAttribute('rel') === 'external' || a.dataset.router === 'ignore') return;
      if (cfg.linkSelector && !a.matches(cfg.linkSelector)) return;

      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) return; // ancla pura → nativo

      // --- Reglas de interceptación ---
      const isAbsoluteScheme = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(href);
      const isRootAbs       = href.startsWith('/');
      const isRelative      = !isAbsoluteScheme && !isRootAbs;

      // 1) Enlaces RELATIVOS → siempre interceptamos (se resuelven bajo appBase)
      if (isRelative) {
        e.preventDefault();
        const abs = _toAppURL(href);
        const appRel = _appRelativePathname(abs.pathname) + abs.search + abs.hash;
        _navigate(appRel);
        return;
      }

      // 2) Enlaces ABSOLUTOS con esquema:
      if (isAbsoluteScheme) {
        const abs = new URL(href);
        // Solo interceptamos si mismo origen y está dentro de appBase
        const inSameOrigin = abs.origin === location.origin;
        const inAppBase = _appRelativePathname(abs.pathname) !== abs.pathname; // si cambia, está dentro
        if (a.dataset.router === 'force' || (inSameOrigin && inAppBase)) {
          e.preventDefault();
          const appRel = _appRelativePathname(abs.pathname) + abs.search + abs.hash;
          _navigate(appRel);
        }
        return; // si no, nativo
      }

      // 3) Enlaces ABSOLUTOS de raíz ("/..."):
      if (isRootAbs) {
        const abs = _toAppURL(href); // resolver contra appBase para ver si cae dentro
        const inAppBase = _appRelativePathname(abs.pathname) !== abs.pathname;
        if (a.dataset.router === 'force' || inAppBase) {
          e.preventDefault();
          const appRel = _appRelativePathname(abs.pathname) + abs.search + abs.hash;
          _navigate(appRel);
        }
        // si no está en appBase → nativo (no interceptar)
      }
    };
    document.addEventListener('click', clickHandler);
  }

  function _installPopState() {
    if (popHandler) return;
    popHandler = () => {
      const appRel = _appRelativePathname(location.pathname) + location.search + location.hash;
      _navigate(appRel, {}, true);
    };
    window.addEventListener('popstate', popHandler);
  }
  function _removeGlobalHandlers() {
    if (clickHandler) { document.removeEventListener('click', clickHandler); clickHandler = null; }
    if (popHandler)   { window.removeEventListener('popstate', popHandler);  popHandler = null; }
  }

  // ================== API pública ==================
  function start(options = {}) {
    Object.assign(cfg, options);
    if (!cfg.appBase) cfg.appBase = _effAppBase();
    if (!cfg.wildcard) cfg.wildcard = new URL('404' + cfg.extension, _effBasePathAbs()).href;

    if (started) {
      if (cfg.debug) console.debug('[TemplarRoute] start(): already started');
      return api;
    }
    started = true;

    _installLinkInterceptor();
    _installPopState();

    if (cfg.debug) console.debug('[TemplarRoute] started', {
      appBase: cfg.appBase,
      basePathAbs: _effBasePathAbs(),
      routes: routes.map(r => r.raw)
    });
    return api;
  }

  function stop() {
    started = false;
    _removeGlobalHandlers();
    if (cfg.debug) console.debug('[TemplarRoute] stopped');
  }

  function use(defs = []) {
    for (const r of defs) {
      const raw = { ...r };
      const { regex, keys, wildcard } = _compilePath(r.path);
      routes.push({ ...r, raw, regex, keys, wildcard });
    }
    if (cfg.debug) console.debug('[TemplarRoute] routes added:', defs);
    return api;
  }

  function go(to, opts = {}) {
    return _navigate(to, opts, false);
  }

  function back() { history.back(); }
  function forward() { history.forward(); }

  function current() {
    const u = new URL(location.href);
    return {
      path: u.pathname + u.search + u.hash,
      pathname: u.pathname,
      hash: u.hash,
      query: _parseQuery(u.search)
    };
  }

  const api = { start, stop, use, go, back, forward, current, _config: cfg, _routes: routes };
  if (typeof window !== 'undefined') window.TemplarRoute = api;
  return api;
})();

export default TemplarRoute;
export { TemplarRoute };
