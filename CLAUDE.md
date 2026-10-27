# Arbeitsregeln für dieses Repository

- Die App ist `index.html` (ein Skript in einer IIFE, `"use strict"`). Nach jeder Änderung an der App `sw.js` → `VERSION` hochzählen.
- **Klicktests blockieren die Arbeit nicht – erst live, dann Volltest:**
  1. Vor dem Push nur die betroffenen Tests (Sekunden): `cd tests && npm install && node smoke.mjs "Stichwort"` (Teil des Testnamens, z. B. `"Rückblick"`, `"Ziele"`). Bei Fehlern dort: erst beheben.
  2. Sofort auf `main` pushen (vorher mit Serverstand mergen).
  3. Der Volllauf startet danach automatisch als GitHub Action „Klicktests“ (`.github/workflows/klicktests.yml`). Ergebnis prüfen (GitHub-Tools `actions_list`/`get_job_logs`) oder den Volllauf parallel im Hintergrund laufen lassen (`node smoke.mjs`, ca. 3–4 min). Fehler mit einem Folge-Commit beheben, bevor die Aufgabe als fertig gemeldet wird.
  - Der Volllauf verteilt die Tests auf mehrere Prozesse (`JOBS=n`, Standard: je CPU-Kern, höchstens 4; `JOBS=1` = nacheinander). Ein fehlgeschlagener Test läuft einmal neu; „erst im 2. Versuch bestanden“ heißt wackeliger Test → bei Gelegenheit stabilisieren (gezielt auf Zustände warten statt feste Wartezeiten).
  - Screenshots: `SHOTS=shots node smoke.mjs`. Fortschritt: `VERBOSE=1`.
- Für jede neue Funktion oder jeden behobenen Fehler einen passenden Test in `tests/smoke.mjs` ergänzen.
- Testzugang: Mit `?rptest` in der Adresse stellt die App `window.__rp(code)` bereit (Code läuft im App-Scope). Nur für Tests verwenden.
- Die Tests laufen in einem Chromium im iPhone-Format. iOS-Safari-Eigenheiten (Gesten, Speichergrenzen) bilden sie nicht vollständig ab – solche Änderungen besonders sparsam halten (z. B. wenige große Bilder gleichzeitig im DOM).
