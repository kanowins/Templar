# 🚦 TemplarRoute — File‑based Router for Templar/TemplarForge

TemplarRoute is a tiny, file-based router that renders **HTML templates** into a chosen root (any element or a ShadowRoot) using `Templar.renderInto`. It’s **subpath-aware** (e.g., your app lives under base path `/app/`), supports **merged params** (path + query), **per-route roots**, **transitions**, **history control**, and a **404 wildcard**. It also exposes **progressive enhancement** via an optional native fallback.

> Works great alongside **TemplarForge** components and **Templar** templates. Templates automatically have `ready()`, `$`, and `$$` available from Templar Core.

---

## Quick start

```html
<script type="module">
  import TemplarRoute from './js/templar-route.1.0.js';

  // Start: set where to render, and where your view files live
  TemplarRoute.start({
    root: () => document.querySelector('#view'),
    basePath: './views/',      // relative to your app base (portable!)
    extension: '.html',
    transition: 'fade',
    transitions: {
      fade: {
        out: async ({ root }) => { root.classList.add('route-fade-out'); await new Promise(r=>setTimeout(r,120)); root.classList.remove('route-fade-out'); },
        in:  async ({ root }) => { root.classList.add('route-fade-in');  await new Promise(r=>setTimeout(r,150)); root.classList.remove('route-fade-in'); }
      }
    },
    // Optional: try native navigation if no SPA view is found
    fallbackToNativeOnMiss: false,
    debug: true
  });

  // Add routes incrementally (optional; convention works without routes)
  TemplarRoute.use([
    {
      path: '/user/:id',
      view: './views/user.html', // can also be: (ctx) => './views/user.html'
      resolve: async (params) => {
        const user = await fetch(`/api/user/${params.id}`).then(r=>r.json());
        return { data: { user }, title: `User · ${user.name}` };
      }
    },
    {
      path: '/settings',
      view: './views/settings.html',
      // Mount inside a Web Component’s shadow outlet:
      root: () => document.querySelector('templar-shell')?.shadowRoot?.querySelector('#outlet')
    },
    // Explicit wildcard (optional; there is a global default)
    { path: '*', view: './views/404.html' }
  ]);

  // Imperative navigation
  // TemplarRoute.go('/user/42?tab=posts', { history: 'replace' });
</script>
```

**Convention mapping (no routes needed):**

- `/`           → `basePath/index.html`
- `about`      → `basePath/about.html`
- `shop/cart`  → `basePath/shop/cart.html`

---

## Subpath support (📍 appBase)

Your app might live under a subpath (e.g., `/app/`). TemplarRoute auto-detects an **app base** from:
1) `<base href="...">` if present; otherwise  
2) the **directory of the current document**.

All relative paths and history updates are resolved against this `appBase`, so you can move the whole folder anywhere and everything keeps working.

```html
<!-- Optional but explicit -->
<base href="/suma/">
```

---

## Link interception rules (progressive-enhancement friendly)

TemplarRoute intercepts clicks on `<a>` to keep navigation in-app while being predictable and portable.

**It WILL intercept** when:
1) **Relative links** (no `/` prefix and no protocol): `href="about"`, `href="users/42?tab=posts"`  
   → Always intercepted, resolved against `appBase` (keeps subpath).  
2) **Absolute path** (`/…`) within your `appBase` (e.g., `/app/…`)  
   → Intercepted; outside of `appBase` → native navigation.  
3) **Absolute URL** with protocol: intercepted **only** if same origin **and** inside `appBase`

**It WILL NOT intercept** if:
- `target` is not `_self` (e.g., `_blank`) or `download` present
- `href` starts with '/' or 'http(s)://' or `#` (pure anchor) or uses special schemes (`mailto:`, `tel:`, etc.)
- `rel="external"` or `data-router="ignore"`


**Fallback:** If a view is not found and `fallbackToNativeOnMiss: true`, it will try a **native navigation** to the same URL (full reload) before falling back to SPA `404.html`.

---

## Params model (path + query merged)

For a matched route, **path params** and **query params** are merged into a single `params` object (query wins on conflicts):

```
/user/:id    +   ?tab=posts
params = { id: '42', tab: 'posts' }
```

Every rendered view receives:
- `params` — merged object
- `route` — `{ path, pathname, hash, pathParams, queryParams }`
- plus any `data` returned by `resolve`

---

## Route definition

A route is a plain JS object. Below are the shapes as comments to keep everything JavaScript-only.

```js
// HistoryMode: 'push' | 'replace' | 'none'

// Transition object (optional)
/*
{
  out?: async ({ root, ctx, wait }) => { ... },
  in?:  async ({ root, ctx, wait }) => { ... }
}
*/

// Route object:

{
  path: '/user/:id' | '/settings' | '*',
  view?: string | (ctx) => string,  // file path (relative/absolute) or function
  root?: string | Element | () => (Element | ShadowRoot), // mount point override
  transition?: string | Transition, // name from transitions or custom object
  title?: string | (ctx) => string,
  render?: async (ctx) => void,     // custom render instead of renderInto
  resolve?: async (params, ctx) => ({
    data?: Object, // data to send to template
    view?: string, // view to render
    title?: string | (ctx)=>string, // changes title of the web page
    history?: 'push'|'replace'|'none', // changes history default mode
    url?: string,   // rewrite URL shown in the bar
    state?: any // object to send to history state
  })
}

```

**Global config** (`start(options)`):
```js
// All fields are optional unless noted.

{
  root: string | Element | () => (Element|ShadowRoot), // REQUIRED
  basePath: './views/',
  extension: '.html',
  index: 'index',
  wildcard: string | (ctx)=>string,  // default: basePath + '404.html'
  appBase: string,                   // auto-detected if not provided
  linkSelector: 'a[href]:not([download])',
  historyDefault: 'push',
  transition: string | Transition,
  transitions: { [name: string]: Transition },
  onError: (err, ctx) => void,
  debug: false,
  fallbackToNativeOnMiss: false
}

```

**Public API:**
```js
TemplarRoute.start(options)          // start router
TemplarRoute.stop()                  // remove listeners
TemplarRoute.use(routesArray)        // register routes incrementally
TemplarRoute.go(path, { history, data }) // navigate programmatically
TemplarRoute.back();                 // history back
TemplarRoute.forward();              // history forward
TemplarRoute.current();              // -> { path, pathname, hash, query }
```

---

## Transitions

You can define **global** transitions and/or **per-route** transitions. A transition is a pair of async hooks: `out()` (before render) and `in()` (after render). You get the `root` element and a `wait(el)` helper that resolves after CSS transitions/animations end on `el`.

```js
TemplarRoute.start({
  root: '#view',
  basePath: './views/',
  transition: 'fade',
  transitions: {
    fade: {
      out: async ({ root, wait }) => {
        root.classList.add('route-fade-out');
        await wait(root);
        root.classList.remove('route-fade-out');
      },
      in: async ({ root, wait }) => {
        root.classList.add('route-fade-in');
        await wait(root);
        root.classList.remove('route-fade-in');
      }
    }
  }
});
```

Per-route:
```js
TemplarRoute.use([
  { path: '/settings', transition: { in: async ({ root }) => root.classList.add('flash') } }
]);
```

---

## ⚙️ resolve — Data Loading & Navigation Control

Every route can define an **optional `resolve(params, ctx)`** function.  
It runs **before rendering** the view and lets you:

- Load remote data (via `fetch` or any async code).
- Dynamically modify the view to render.
- Set the document title.
- Control history behavior (`push`, `replace`, or none).
- Store custom data in `history.state` for future navigation.

```javascript
TemplarRoute.use([
  {
    path: "/items/:id",
    resolve: async (params, ctx) => {
      // params: merged object with path + query parameters
      // ctx: context object with navigation details

      const item = await fetch(`/api/items/${params.id}`).then(r => r.json());

      return {
        // --- Data passed into the template ---
        data: { item },

        // --- Custom document title ---
        title: `Item: ${item.name}`,

        // --- Custom view file instead of convention ---
        view: "/views/item-details.html",

        // --- How to update browser history ---
        // 'push'   → default: adds a new entry
        // 'replace'→ updates current entry
        // 'none'   → does not touch history
        history: "replace",

        // --- Persist custom data in history.state ---
        state: {
          loadedAt: Date.now(),
          fromCache: false
        },

        // --- (optional) Change the URL shown in the browser ---
        url: `/items/${params.id}?from=resolve`
      };
    }
  }
]);
```

### 🔑 Parameters

#### `params`
A single object with all parameters merged:
- **Path params** from dynamic segments: `/:id → { id: "42" }`
- **Query params** from `?key=value` (query keys overwrite path keys if duplicated).

#### `ctx` (context)
Contains useful info for the resolver:
- `ctx.path` → full route path relative to the app (e.g. `/items/42?view=compact`)
- `ctx.pathname` → path without query or hash (e.g. `/items/42`)
- `ctx.hash` → hash part (e.g. `#details`)
- `ctx.state` → previously saved `history.state` (on back/forward navigation)
- `ctx.dataFromGo` → optional data passed when calling `TemplarRoute.go(path, { data })`
- `ctx.route` → the current route definition object
- `ctx.navigate(to, opts)` → programmatic navigation helper

---

### 🔙 Returned Object
All fields are **optional**. The router will merge them into the navigation flow.

| Key          | Type       | Description |
|--------------|------------|-------------|
| `data`       | `object`   | Injected into the view template under `data`. |
| `title`      | `string` or `function(ctx)` | Sets the document title. |
| `view`       | `string`   | Overrides the default template path. |
| `history`    | `"push"` \| `"replace"` \| `"none"` | Controls how browser history is updated. |
| `state`      | `object`   | Custom data stored in `history.state` (retrievable via `ctx.state`). |
| `url`        | `string`   | Changes the URL displayed in the browser’s address bar (without reloading). |

---

### 💡 Tips
- Always return a **plain serializable object** for `state`.
- Use `history: "replace"` when you don’t want to add extra entries (like tab switches).
- You can omit all properties if you just want to pre-load data and let defaults handle the rest.

---

## History modes

- **`push`** (default): pushes a new entry into history.
- **`replace`**: replaces the current entry (useful for redirects or non-critical param changes).
- **`none`**: updates the view without touching the address bar (e.g., modal states).

Route `resolve()` can override the history mode by returning `{ history: 'replace', state: {customStateValue: 'value'} }` etc.

```js
TemplarRoute.use([
  {
    path: "/profile/:id",
    // Optional dynamic title for the document:
    title: ctx => `Profile #${ctx.route.pathParams.id}`,

    // Resolve runs before rendering the view
    async resolve(params, ctx) {
      // params merges path and query → e.g. { id: "42", tab: "friends" }
      console.log("Resolve params:", params);

      // Simulate remote data fetching
      const profileData = await fetch(`/api/profiles/${params.id}`)
        .then(r => r.json())
        .catch(() => ({ name: "Unknown", id: params.id }));

      // Custom state object to store in history.state
      const customState = {
        lastVisitedTab: params.tab || "overview",
        loadedAt: Date.now(),           // timestamp of data load
      };

      return {
        // Data passed to the template for rendering
        data: {
          profile: profileData,
          activeTab: params.tab || "overview"
        },
        // Change history behavior: replace instead of push
        history: "replace",             // "push" | "replace" | "none"
        // Store custom data into history.state
        state: customState              // will be available in ctx.state
      };
    }
  }
]);
```

---

## Wildcard & native fallback

If no route matches or a view fails to load:
- By default, TemplarRoute renders **`404.html`** from `basePath` (or your custom `wildcard`).
- If `fallbackToNativeOnMiss: true`, it first tries a **native page load** to the same URL (useful when some links intentionally leave the SPA). If that fails, it falls back to the SPA 404 view.

---

## Examples

### A) Convention only
```js
TemplarRoute.start({
  root: '#view',
});
// '/' -> ./views/index.html
// 'about' -> ./views/about.html
```

### B) Route with resolve and merged params
```js
TemplarRoute.use([{
  path: '/user/:id',
  view: './views/user.html',
  resolve: async (params) => {
    const data = await fetch(`/api/user/${params.id}?tab=${params.tab??''}`).then(r=>r.json());
    return { data: { user: data }, title: `User · ${data.name}` };
  }
}]);
```

### C) Mount inside a component’s ShadowRoot
```js
TemplarRoute.use([{
  path: '/settings',
  view: './views/settings.html',
  root: () => document.querySelector('templar-shell')?.shadowRoot?.querySelector('#outlet')
}]);
```

### D) Custom render (no `renderInto`)
```js
TemplarRoute.use([{
  path: '/login',
  render: async ({ root }) => {
    root.innerHTML = '<templar-login id="login"></templar-login>';
    await customElements.whenDefined('templar-login');
    root.querySelector('#login').data = { mode: 'password' };
  },
  title: 'Login'
}]);
```

---

## Tips

- Prefer **relative links** in your HTML (`href="about"`, `href="users/42"`) to keep your app portable across subpaths.
- Use `data-router="ignore"` on `<a>` to opt out from SPA interception.
- Views can run post-render logic with `ready(() => { /* ... */ })`; use `$()` / `$$()` to query inside the view root.
- If a route frequently changes only minor query params, consider returning `{ history: 'replace' }` from `resolve()`.

---

**Have fun routing!**  
_© 2025 Sumalab — Templar & TemplarForge ecosystem_