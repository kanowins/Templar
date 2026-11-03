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
  **Do not** feed untrusted data into parameters or translations. Use the `text` boolean attribute for strict text-only rendering through `textContent`.
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


## Declarative attributes and Shadow DOM

Native HTML attributes are the original fallback; matching loc-* attributes hold translation keys:

```html
<input placeholder="Search systems" loc-placeholder="game.search"
       aria-label="Search systems" loc-aria-label="game.search">
<button title="Locate home system" loc-title="game.home">⌂</button>
<loc-text text key="game.turn" p-turn="1">Turn {turn}</loc-text>
```

The library captures each original fallback once, before translating it. Changing languages or keys never replaces that fallback with a previous translation. Missing keys use the captured original; attributes without loc-* remain unchanged. Removing a loc-* binding restores the original attribute, including its original absence. Supported targets are title, placeholder, alt, label, value, aria-label, aria-description, aria-valuetext and data-* attributes. Event handlers, URLs, styles and arbitrary HTML are not translation targets.

Attributes and loc-text share params/loc-params JSON, p-* values, data-* values and formats/loc-formats pipelines. A loc-p-NAME attribute optionally supplies the translation key for a named parameter; its message can use the same raw parameters and formats. A blank message key interpolates only the original fallback, which is useful for locale-formatted numeric values. Text-only loc-text elements use the text boolean attribute: translated strings and parameters are assigned through textContent. Existing loc-text elements retain their HTML behavior for backward compatibility.

```html
<button title="Storage: {used} / {capacity}" loc-title="game.storage"
        loc-params='{"used":1000,"capacity":5000}'
        loc-formats='{"used":"number","capacity":"number"}'>Storage</button>
<span data-tooltip="{resource}: {amount}" loc-data-tooltip=""
      loc-params='{"resource":"Metal","amount":1500}'
      loc-p-resource="game.metal" loc-formats='{"amount":"number"}'>Metal</span>
```

Document content, inserted elements and open Shadow DOM roots are discovered automatically. Connected loc-text elements register themselves, including inside nested or closed roots. Templar Forge registers and unregisters each component root as part of its lifecycle. For a closed root containing only native attribute bindings, or a root attached after its host is already connected without any loc-text elements, call loc.observe(root) once when connecting and loc.unobserve(root) when disconnecting. These register lifecycle ownership; callers never need a language-refresh loop.

loc.setLanguage(language) loads and commits the dictionary, updates document.lang and all connected text/attribute bindings, then dispatches loc:languagechange on window with detail.language. The latest requested language wins if requests complete out of order. loc.refresh() refreshes all registered roots. Language changes do not replace forms, inputs or component DOM, so focus, selections and drafts survive. Reconnected components resume updates. Detached roots and elements are released from the observer/element registries.

Parameter coercion treats non-JSON brace/bracket-prefixed strings as ordinary text without warnings (for example `{star} system` or `{value0}`). Valid JSON objects/arrays still coerce normally; malformed explicit params/loc-params and formats/loc-formats keep their diagnostics. Translated data-* output attributes are not read back as source parameters.
