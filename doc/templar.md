
# Templar & TemplarForge

A minimalist stack by **Sumalab** to build JSP‑style templates in the browser with modern JavaScript.

- **Templar (templar-core)** — string template engine.
- **TemplarForge** — tiny framework to auto‑register Web Components that render Templar templates.

---

## Table of contents
- [✨ Highlights](#-highlights)
- [📦 Install](#-install)
- [🧩 Templar (templar-core)](#-templar-templar-core)
- [⚙️ Templar API](#️templar-api)
- [🏗️ TemplarForge](#️-templarforge)
- [🔌 Components & Templates](#-components--templates)
- [🧰 Template Helpers](#-template-helpers-scoped-to-the-component)
- [🔗 Nested components](#-nested-components)
- [🐞 Debugging](#-debugging)
- [✅ Summary](#-summary)

---

## ✨ Highlights

- Familiar syntax: `<% %>`, `<%= %>`, and `${ ... }` inside HTML literals.
- Templates live in plain **`.html` files**.
- **Async/await inside templates** (the compiled function is `async`).
- **Auto‑register `<templar-*>` elements**: just place the tag in your DOM.
- Template helpers: `emit`, `bind`, `ready`, `query`, `queryAll`, `queryById`.
- Pass props via HTML attributes and a special `data` (JSON) attribute.
- **Simple reactivity**: updating `this.data` or attributes re‑renders.
- **Great debugging**: runtime errors show template URL + real line + context.

---

## 📦 Install

Include both scripts:

```html
<script type="module" src="./js/templar-core.1.0.js"></script>
<script type="module" src="./js/templar-forge.1.0.js"></script>
```

---

## 🧩 Templar (templar-core)

### Basic syntax

```html
<div>
  Hello <%= name %>!
</div>
```

### Control flow

```html
<ul>
<% for (const item of items) { %>
  <li><%= item %></li>
<% } %>
</ul>
```

### Interpolation inside literals

`${ ... }` in HTML text is equivalent to `<%= ... %>` and is **HTML‑escaped**:

```html
<div>Total: ${ price.toFixed(2) } €</div>
```

### Dynamic imports (ESM) from templates

Templates are compiled to **async functions**, so you can `await import()` directly:

```html
<%
  // Only load when needed
  if (!formatMoney) {
    const mod = await import('../utils/money.js');
    var formatMoney = mod.formatMoney;
  }
%>
<div>Salary: <%= formatMoney(salary, 'EUR') %></div>
```

> Tip: paths are resolved relative to the **HTML page** that loads the bundle (standard ESM rules), not relative to the template file itself.

---

## ⚙️ Templar API

Templar can be used as just a template library

### `Templar.configure(options)`

- `globals: object` — values available to all templates (merged in the template scope).
- `debug: boolean` — when a **compile** error occurs, logs the generated JS.
- `onError: (err, url) => void` — optional global runtime error hook.

```js
Templar.configure({
  globals: { appName: "Demo" },
});
```

### `Templar.renderInto(url, data, root) => Promise<string>`

Render a template **file** into a DOM root.

**Parameters**

- `url: string` — template URL, e.g. `"/components/user-card.html"`.
- `data: object` — data scope passed to the template.  
  When used from TemplarForge, this includes your props, **plus** helpers (`emit`, `bind`, `ready`, `query*`) and `host`. Your original data is also available as `data` (e.g., `data.user.name`).
- `root: Element | ShadowRoot` — container where resulting HTML is injected via `innerHTML`.

**Returns**

- The rendered HTML string.

**Errors**

- If a runtime error occurs, the engine logs **template URL**, **real line** and a **5‑line context** snippet.

```js
const root = document.getElementById("root");
await Templar.renderInto("/components/user-card.html", { name: "Iria" }, root);
```

---

## 🧰 Template Helpers



- **`ready(cb)`** — run `cb` right after HTML is injected into the `shadowRoot` for that render cycle.

  ```html
  <% ready(() => { document.querySelector("#go").focus(); }); %>
  ```

- **`$(selector)`** — `document.querySelector`  
- **`$$(selector)`** — `document.querySelectorAll` (returned as array)  

> Use `$ or $$` inside `bind`/`ready`/event handlers — not at top‑level — because template code runs **before** HTML is injected.

---

## 🏗️ TemplarForge

TemplarForge lets you define HTML components using only a template file.  
Start the auto-registrar once and forget about writing `customElements.define` by hand.

```js
import TemplarForge from "./js/templar-forge.1.0.js";

TemplarForge.start({
  basePath: "/components/", 
  extension: ".html", 
  tagPrefix: "templar-",
  nestedDirs: true,     
  shadowMode: "open",   
  // resolver: ({ tagName, name, basePath, extension }) => customUrl
});
```

### Configuration options

- `basePath: string` — base folder for component templates (default `"/components/"`).
- `extension: string` — file extension (default `".html"`).
- `tagPrefix: string` — prefix for auto‑registered tags (default `"templar-"`).
- `nestedDirs: boolean` — if `true`, hyphens become subfolders:  
  `<templar-order-item>` → `/components/order/item.html`.
- `shadowMode: "open" | "closed"` — Shadow DOM mode (default `"open"`).
- `debug: boolean` — extra console logging.
- `resolver: function` — custom path resolver; receives `{ tagName, name, basePath, extension }` and must return a URL string.

### How it resolves a template URL

- Default (flat): `<templar-user-card>` → `/components/user-card.html`  
- With `nestedDirs: true`: `<templar-user-card>` → `/components/user/card.html`

---

## 🔌 Components & Templates

Create a template file matching your tag name and just use the tag.

**`/components/test.html`**

```html
<div id="status">Status: <%= status || "N/A" %></div>
<button id="btn">Click</button>

<%
  ready(() => { queryById("status").style.color = "green"; });

  bind("click", "#btn", () => {
    emit("templar-test:clicked", { value: 123 });
  });
%>
```

**Usage**

```html
<templar-test data='{"status":"Ready"}'></templar-test>
<script>
  document.querySelector("templar-test")
    .addEventListener("templar-test:clicked", e => {
      console.log("received:", e.detail);
    });
</script>
```

### Passing data

Use attributes for primitives and `data='{"...":...}'` for objects:

```html
<templar-user-card
  name="Iria"
  role="Lead"
  data='{"badge":{"text":"VIEW","tone":"info"}}'>
</templar-user-card>
```

Inside the template, both `<%= name %>` and `<%= data.badge.text %>` work.

### Reactivity from JS

```html
<templar-counter id="ctr"></templar-counter>
<script type="module">
  const ctr = document.getElementById("ctr");
  ctr.data = { count: 10 }; // triggers render
</script>
```

---

## 🧰 Template Helpers (scoped to the component)


- **`host`** — a direct reference to the **Web Component instance itself** (the `<templar-*>` element).  
  Use it to access or modify the component’s own properties, or to expose **public methods / fields** that external scripts can call later.

  ```html
  <%
    // Example: expose a public method
    host.reset = () => { host.data = { count: 0 }; };

    // Or set an internal flag
    host.isHighlighted = true;
  %>
  ```

- **`bind(type, target, handler)`** — attach listeners **after render**. `target` can be a selector or an element.

  ```html
  <button id="go">Go</button>
  <% bind("click", "#go", () => console.log("clicked")); %>
  ```


- **`emit(name, detail?, options?)`** — dispatches a `CustomEvent` from the **host element** (default options: `{ bubbles: true, composed: true }`).  
  Useful for letting parent components or the main page react to user actions.

  ```html
  <button id="pick">Select</button>

  <%
    bind('click', '#pick', () => {
      // Notify outside world that this card was selected
      emit('user-card:select', { name, role });
    });
  %>
  ```

  Outside of the component you can listen for it:

  ```html
  document
    .querySelector('templar-user-card')
    .addEventListener('user-card:select', (e) => {
      console.log('Selected user →', e.detail.name, e.detail.role);
  });
  ```

- **`ready(cb)`** — run `cb` right after HTML is injected into the `shadowRoot` for that render cycle.

  ```html
  <% ready(() => { $("#go").focus(); }); %>
  ```

- **`$(selector)`** — `shadowRoot.querySelector`  
- **`$$(selector)`** — `shadowRoot.querySelectorAll` (returned as array)  

> Use `$ or $$` inside `bind`/`ready`/event handlers — not at top‑level — because template code runs **before** HTML is injected.

---

## 🔗 Nested components

TemplarForge supports **component composition**: you can use `<templar-*>` tags inside another component’s template.  
Child components are automatically detected and registered inside the parent’s shadow DOM.

---

**Example**

**`/components/user-card.html`** (parent):

```html
<div class="card">
  <div class="name"><%= name %></div>
  <templar-user-badge data='<%= JSON.stringify(badge) %>'></templar-user-badge>
</div>

<%
  // Listen to child event and re-emit
  bind("badge:clicked", "templar-user-badge", (e) => {
    emit("user-card:badgeClicked", { name, badge: e.detail });
  });
%>
```

**`/components/user-badge.html`** (child):

```html
<span id="badge" class="badge tone-<%= tone %>"><%= text %></span>

<%
  bind("click", "#badge", () => {
    emit("badge:clicked", { text, tone });
  });
%>
```

**Usage in page**

```html
<templar-user-card
  data='{
    "name":"Iria",
    "badge":{"text":"ADMIN","tone":"info"}
  }'>
</templar-user-card>

<script type="module">
  document.querySelector("templar-user-card")
    .addEventListener("user-card:badgeClicked", e => {
      console.log("Badge clicked in card:", e.detail);
    });
</script>
```

Here the parent `<templar-user-card>` passes a nested `badge` object down to `<templar-user-badge>` via the `data` attribute.  
The child template receives `text` and `tone`, and emits `badge:clicked` when clicked.  
The parent listens for this event and re‑emits a higher‑level event (`user-card:badgeClicked`) with both the `name` and badge details.

---

### Passing data to child components

TemplarForge supports several ways to feed data from a parent component (or page) into a child `<templar-*>` component. Pick the style that best matches your use case and rendering timing.



#### 1) Declarative via `data` (JSON stringified)
Best for stable initial props; the child receives the object at first render.

**Parent template**
```html
<templar-user-card data='<%= JSON.stringify(user) %>'></templar-user-card>
```

**Child template (`/components/user-card.html`)**
```html
<div class="card">
  <div class="name"><%= name %></div>
  <div class="role"><%= role || "unknown" %></div>
</div>
```

> The JSON is parsed and merged into the child's `data` before rendering.



#### 2) Declarative via individual attributes (parameters)
Good for primitives or when you want HTML to remain readable and diff‑friendly.

**Parent template**
```html
<templar-user-card
  name="<%= user.name %>"
  role="<%= user.role %>">
</templar-user-card>
```

**Child template**
```html
<div class="card">
  <div class="name"><%= name %></div>
  <div class="role"><%= role %></div>
</div>
```

> Attributes are read and mapped into `data` automatically.



#### 3) Imperative in `ready()` (post-render assignment)
Ideal when the data object is **too large to embed as a JSON string** in the HTML  
(e.g. large arrays, complex objects, pre-fetched API responses).  

You render the child component first with minimal markup, then pass the data programmatically after the parent finishes rendering.  
Thanks to TemplarForge’s architecture, the child **renders only once** — when it finally receives the data.


**Parent template**
```html
<templar-user-card></templar-user-card>

<%
  ready(() => {    
    const child = query('templar-user-card');
    if (child) child.data = user; // triggers re-render in the child
  });
%>
```

**Child guard (optional)**
```html
<% if (!data || !data.name) { return ""; } %>
```

> `ready()` runs after the parent HTML is injected.

---

## 🐞 Debugging

- Each compiled template tracks the **real template line** with `__line` and sets a `//# sourceURL` so DevTools show the template path.
- On runtime errors, the engine logs:
  - template **URL**,
  - **line number**,
  - a **5‑line context** (2 above, the line, 2 below).

Enable compile‑time debug to print generated JS on syntax errors:

```js
Templar.configure({ debug: true });
```

---

## ✅ Summary

**Templar + TemplarForge** give you:
- JSP‑style templates in `.html` files with async/await.
- Auto‑registered Web Components with a tiny BaseElement.
- A small set of pragmatic helpers to wire events and post‑render tweaks.

No heavy deps. Just **modern JavaScript**.

