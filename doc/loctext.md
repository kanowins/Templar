# `<loc-text>` — Lightweight HTML i18n with `.properties`

Translate inline HTML using keys, parameters, and pluggable formatters. Supports external `.properties` files, parameterized fallbacks, and inline **pipes** like `{price|currency({"currency":"EUR"})}`.

---

## Table of Contents

- [Features](#features)
- [Install & Boot](#install--boot)
- [Directory Layout](#directory-layout)
- [.properties Basics](#properties-basics)
- [Basic Usage](#basic-usage)
- [Parameters](#parameters)
- [Formatting](#formatting)
  - [The `formats` attribute (JSON)](#the-formats-attribute-json)
  - [Inline pipes in templates](#inline-pipes-in-templates)
  - [Formats vs. pipes precedence](#formats-vs-pipes-precedence)
  - [Built-in formatters](#built-in-formatters)
  - [Custom formatters (plugins)](#custom-formatters-plugins)
- [Fallback Behavior](#fallback-behavior)
- [Global API (`window.loc`)](#global-api-windowloc)
- [DOM Updates & Events](#dom-updates--events)
- [Security Notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)

---

## Features

- Custom element: **`<loc-text key="…">fallback</loc-text>`**
- Loads language bundles from `*.properties` via `loc.setLanguage('es-ES')`
  - Locale fallback out of the box: `es-ES → es`
- **Parameters** from:
  - `params='{"name":"Iria","count":5}'` (JSON)
  - `p-*` attributes (e.g. `p-name="Iria"`)
  - `data-*` attributes (lowest priority)
- **Formatting** via:
  - `formats` attribute (JSON pipelines)
  - **Inline pipes** in templates: `{count|number({"notation":"compact"})}`
- **Plugin system**: `loc.addFormat("name", handler)` to register custom formatters
- **Parameterized fallback**: the element’s inner content is templated with the same params/format rules if no key is found
- Auto-refresh when attributes change; manual `loc.refresh()` available

---

## Install & Boot

Load **after** your HTML or as a **module** (recommended):

```html
<!-- Module = deferred by default -->
<script type="module" src="/js/loc-text.js"></script>

<script type="module">
  loc.setBasePath("/i18n/");   // Where .properties live
  await loc.setLanguage("es-ES");
</script>
```

> `setBasePath("/i18n")` and `setBasePath("/i18n/")` are equivalent.

---

## Directory Layout

```text
/i18n/
  es.properties
  es-ES.properties
  en.properties
  en-US.properties
/js/
  loc-text.js
index.html
```

---

## .properties Basics

- **Key/value**: `greeting=¡Hola!`
- **Comments**: lines starting with `#` or `!`
- **Escapes**: `\t \n \r \f \\ \: \= \uXXXX`
- **Line continuation**: end a line with a single `\` to continue on the next
- **Optional multiline with backticks**:
  ```properties
  hero.text=`Line 1
  Line 2 with {name}
  Line 3`
  ```
  Use `\`` to escape a backtick inside the block.

---

## Basic Usage

```html
<loc-text key="greeting">Hello (fallback)</loc-text>

<script type="module">
  loc.setBasePath("/i18n/");
  loc.setLanguage("es");  // loads /i18n/es.properties
</script>
```

**es.properties**
```properties
greeting=¡Hola!
```

---

## Parameters

Three ways to pass params (merged with this priority):

1. `params` (JSON) — highest  
2. `p-*` attributes  
3. `data-*` attributes — lowest

```html
<!-- JSON params -->
<loc-text key="welcome" params='{"name":"Iria","count":5}'>
  Hello {name}, you have {count} messages.
</loc-text>

<!-- p-* -->
<loc-text key="welcome" p-name="Iria" p-count="5">
  Hello {name}, you have {count} messages.
</loc-text>

<!-- data-* -->
<loc-text key="welcome" data-name="Iria" data-count="5">
  Hello {name}, you have {count} messages.
</loc-text>
```

> If a parameter is missing, the placeholder remains visible (`{param}`) to help catch mistakes.

---

## Formatting

### The `formats` attribute (JSON)

Declare **pipelines** per parameter and optionally for the **whole final text** via `"*"`.

```html
<loc-text
  key="inbox"
  params='{"name":"Diego","count":15300}'
  formats='{
    "count": [{"name":"number","notation":"compact"}],
    "*": "trim"
  }'
>
  Hola {name}, tienes {count} mensajes.
</loc-text>
```

- `count` → `number` with `notation:"compact"` → e.g., `15.3K` (locale-aware)  
- `"*": "trim"` runs after interpolation on the final string

A pipeline step can be:
- `"upper"` (string)
- `{ "name": "currency", "currency": "EUR" }` (object)
- A **list** of the above to chain them

### Inline pipes in templates

You can also specify formatters **inside** the template (in `.properties` or fallback):

```properties
welcome=Hola {name|upper}, tienes {count|number({"notation":"compact"})} mensajes.
```

Chain multiple pipes:

```properties
total=Total: {amount|number({"minimumFractionDigits":2})|currency({"currency":"EUR"})}
```

- Pipe configs use **JSON**.  
- Unknown formatter or bad JSON → the step is skipped and a warning is logged.

### Formats vs. pipes precedence

If both are present, the **`formats` attribute takes precedence** for that parameter (useful for per-view overrides without touching translations).

---

## Built-in formatters

All built-ins respect the current language (`loc.getLanguage()`):

- `number` → `Intl.NumberFormat` (e.g. `{ "minimumFractionDigits": 2, "notation": "compact" }`)
- `currency` → `Intl.NumberFormat` with `{ style:"currency", currency:"EUR" }`
- `percent` → `Intl.NumberFormat` with `{ style:"percent" }`
- `date` → `Intl.DateTimeFormat` (e.g. `{ "dateStyle":"medium" }`)
- `time` → `Intl.DateTimeFormat` (e.g. `{ "timeStyle":"short" }`)
- `datetime` → `Intl.DateTimeFormat` (e.g. `{ "dateStyle":"medium", "timeStyle":"short" }`)
- `upper` → uppercase
- `lower` → lowercase
- `capitalize` → first letter uppercase
- `pad` → `{ "length": 2, "char":"0", "side":"left" }`
- `trim` → trims the final string (often used as `"*": "trim"`)

---

## Custom formatters (plugins)

Register your own formatters:

```js
// name: string, handler: (value, config, context) => string
loc.addFormat("brackets", (value, cfg, ctx) => `[${value}]`);
```

Use it via `formats`:

```html
<loc-text key="hello" params='{"name":"Iria"}'
          formats='{"name":"brackets"}'>
  Hello {name}
</loc-text>
```

Or inline:

```properties
hello=Hello {name|brackets}
```

**`handler` context**: `{ lang, key, element, params, param }`

---

## Fallback Behavior

If the key is missing or the bundle fails to load, `<loc-text>` renders its **inner content** as a template using the **same parameters and formatting rules**.

```html
<loc-text key="missing.key" params='{"user":"Iria"}'>
  Welcome, {user}
</loc-text>
```

If your HTML engine doesn’t inject inner text, you can also provide an explicit attribute:

```html
<loc-text key="missing.key" fallback="Welcome, {user}" p-user="Iria"></loc-text>
```

---

## Global API (`window.loc`)

```ts
loc.setBasePath(path: string): void
// Sets where to fetch "<lang>.properties"

loc.setLanguage(lang: string): Promise<void>
// Loads the dictionary; built-in fallback: "es-ES" → "es"

loc.refresh(): void
// Forces all <loc-text> to re-render

loc.addFormat(name: string, handler: (value, config, ctx) => string): void
// Registers a custom formatter plugin

loc.getLanguage(): string | null
// Returns the current language code

loc.t(key: string, fallback?: string, params?: object, formats?: object, element?: Element): string
// Resolve a key programmatically
```

---

## DOM Updates & Events

- `<loc-text>` re-renders when `key`, `params`, `formats`, any `p-*`, or any `data-*` attribute changes.
- Changing the language calls `loc.refresh()` internally.
- Each render dispatches a `CustomEvent`:
  ```js
  element.addEventListener("loc:updated", (ev) => {
    // ev.detail = { key, lang }
  });
  ```

---

## Security Notes

- The component renders the resolved string **as HTML** (`innerHTML`) so templates may contain markup.  
  **Do not** feed untrusted data into parameters or translations. If you need strict text-only rendering, adapt the implementation to use `textContent`.
- To display **literal braces** `{` or `}` in templates, use HTML entities: `&#123;` and `&#125;`.

---

## Troubleshooting

- **Empty fallback on first render**  
  Load the script **as a module** or **after** the markup. The element also watches for child insertion and will capture fallback content once it appears.
- **Pipes not applied**  
  Validate the JSON inside `plugin({...})`. Remember: if both inline pipes and `formats` exist for the same param, `formats` wins.
- **Numbers/dates not localized**  
  Ensure `loc.setLanguage(...)` receives the correct BCP‑47 tag (`es-ES`, `en-US`, …).

---

## Examples

### Basic + params
```html
<loc-text key="welcome" params='{"name":"Iria"}'>
  Hello {name}!
</loc-text>
```

**en.properties**
```properties
welcome=Welcome, {name}!
```

### Number formatting via `formats`
```html
<loc-text
  key="inbox"
  params='{"name":"Diego","count":15300}'
  formats='{"count":[{"name":"number","notation":"compact"}]}'
>
  Hello {name}, you have {count} messages.
</loc-text>
```

### Inline pipes (in the translation)
```properties
bill.total=Total: {amount|number({"minimumFractionDigits":2})|currency({"currency":"USD"})}
```

### Override a pipe with `formats` (attribute wins)
```html
<loc-text
  key="bill.total"
  params='{"amount":1234.5}'
  formats='{"amount":{"name":"currency","currency":"EUR"}}'
>
  Total: {amount}
</loc-text>
```

### Date & time with locale
```html
<loc-text
  key="event.starts"
  params='{"when":"2025-09-16T10:00:00Z"}'
  formats='{"when":{"name":"datetime","dateStyle":"medium","timeStyle":"short"}}'
>
  Starts: {when}
</loc-text>
```

### Format the entire final string
```html
<loc-text
  key="shout"
  params='{"msg":"hello world"}'
  formats='{"msg":"upper","*":"trim"}'
>
  {msg}
</loc-text>
```
