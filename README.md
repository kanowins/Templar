# Sumalab Web Components Stack

This repository gathers our core lightweight libraries to build modern web apps with **templating**, **routing**, and **i18n**.

## 📚 Quick Docs

- [**Templar & TemplarForge**](doc/templar.md)  
  JSP‑style template engine using plain `.html` files with async/await support, automatic Web Component registration, and simple helpers for events and reactivity.

- [**TemplarRoute**](doc/templar_route.md)  
  File‑based router to render HTML views inside an SPA, supporting transitions, sub‑routes, async `resolve()` for data loading, and history control.

- [**<loc-text> i18n**](doc/loctext.md)  
  Custom element for inline translations using `.properties` files, with parameter support, formatting pipes, and graceful fallbacks.

## 🚀 Getting Started

1. Include the required JavaScript modules from the `js/` folder.
2. Follow each linked guide above for setup and usage examples.
3. Combine all three for a full stack:
   - **Templar/Forge** for views and components.  
   - **TemplarRoute** for SPA navigation.  
   - **<loc-text>** for internationalization.

---

© Sumalab — 2025
