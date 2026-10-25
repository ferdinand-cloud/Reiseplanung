# Arbeitsregeln für dieses Repository

- Die App ist `index.html` (ein Skript in einer IIFE, `"use strict"`). Nach jeder Änderung `sw.js` → `VERSION` hochzählen.
- **Vor jedem Push die Klicktests laufen lassen und nur bei 0 Fehlern pushen:**
  ```
  cd tests && npm install && node smoke.mjs
  ```
  Einzelne Tests: `node smoke.mjs "Rückblick"`. Screenshots: `SHOTS=shots node smoke.mjs`.
- Für jede neue Funktion oder jeden behobenen Fehler einen passenden Test in `tests/smoke.mjs` ergänzen.
- Testzugang: Mit `?rptest` in der Adresse stellt die App `window.__rp(code)` bereit (Code läuft im App-Scope). Nur für Tests verwenden.
- Die Tests laufen in einem Chromium im iPhone-Format. iOS-Safari-Eigenheiten (Gesten, Speichergrenzen) bilden sie nicht vollständig ab – solche Änderungen besonders sparsam halten (z. B. wenige große Bilder gleichzeitig im DOM).
