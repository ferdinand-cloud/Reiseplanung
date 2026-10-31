# Notizen aus den Loop-Durchläufen
Hier hält jeder Durchlauf fest, was der nächste wissen muss.

## Wo im Code (wird vom Loop gefüllt)
- Stil-Definition: `var OV` in index.html (vor `lnSlots`), Helfer `ovZ([z,w,…])` → interpolate-Ausdruck. `lnWidth(m)`/`lnOffset(s)` bauen aus `OV.w.rail`/`OV.w.off`. Alte Namen bleiben als Verweise: `DCOL = OV.col.mode`, `MZ = OV.z.mode`, `BUSZ`, `BSTZ`, `TLZ`, `TLZB`, `FERRYC`, `CBCOL`.
- ÖPNV-Ebene (Layer-IDs, Funktion):
  - New York (eingebaute MTA-Daten, GeoJSON `GEO.sub`/`GEO.bus`): `sub`, `bus` in `addLayers()`; Fähre NYC aus den Kartenkacheln: `ferry-line`, `ferry-term`, `ferry-lbl` (Funktion um `FERRYC`).
  - Andere Städte (OSM/Stadtpakete, GeoJSON): `vt-rail` (graues Grundgerüst), `dbus`, `dtr`, `dtr-f` (Fähre), `dtr-lbl`, `dbus-lbl` in `dAddLayers()`.
  - Linienkarte (PMTiles): `lk-<id>-ln`, `lk-<id>-lbl` in `lkApply()`.
  - Transitland: `tl-bus`, `tl-rail`, `tl-ferry`, `tl-lbl` in `tlSetup()`.
- Route in der Planansicht (Layer-IDs, Funktion): Quelle `rt`, Layer `rt-case`, `rt-line`, `rt-dot`, `rt-hdot`, `rt-dash` in `rtAddLayers()`; Daten per `rtAdd()` aus der Tagesroute (Stärken `OV.rt`). Haltestellen der Route (Ein-/Ausstieg) noch als SVG-Kreise im Overlay. „Weg von mir“ (`drawMeRoute`) ist komplett SVG.
- Stationen (Layer-IDs, Datenquelle): NYC `subst` (Kreise, `stSet()`, `TRANSIT.stations`), Linien-Kreise/Namen nah im SVG-Overlay; andere Städte `dst` (Punkt bis Z14), `dst-ic` (Symbol ab Z14), `dst-lbl` (Name + Plaketten als Bild, `dstImg`); Transitland `tl-st`, `tl-bst`, `tl-st-lbl`.
- Szenen-Screenshots: Test „ÖPNV-Szenen S1–S5“ in tests/smoke.mjs → `SHOTS=../LOOP/screens/<nr>/vorher node smoke.mjs "ÖPNV-Szenen"`. Vergleichsbild: `python3 LOOP/tools/vergleich.py <nr> S3 s3-fulton-pier11-z16.png "Titel"`.
- Grenzen der Testumgebung: keine Kartenkacheln (Grundkarte leer, NYC-Fähren aus Kacheln fehlen, Fährweg der Route ist Luftlinie). Optik der Grundkarte also nur auf dem iPhone prüfbar.

## Getroffene Stilwerte
- Aufgabe 1: Werte unverändert übernommen (siehe `OV`): Bahn 0,9/1,6/2,6 px bei Z10/13/16 (Tram 0,7/1,2/2, Seilbahn 0,9/1,4/2,4); Bus NYC 1→3 px (Z11→16, 60 %), Bus sonst 0,6→2 px (50 %); Fähre 1,4→3 px gestrichelt 3/2 (85 %); Route: Fußweg 3,5, Fußweg im ÖPNV 3, Fahrt 5,5 (72 %), Auto 4,5, Rad 5, Rand +3,5.

## Ferdinands Feedback
<!-- Format: Aufgabe Nr · Kommentar · was daraufhin geändert wurde -->
- 1 · „Ok Freigabe“ · keine Änderung

## Protokoll
<!-- Format: Aufgabe Nr · Datum · Commit · Vorprüfung · Freigabe · Stolperfallen -->
- 1 · 31.10.2026 · (siehe git log „Loop 1:“) · S1–S5 pixelgleich vorher/nachher (A1, A2 ok) · Freigabe 31.10. (v475) · Szenen-Test neu angelegt; S3-Mitte auf -74.0078/40.7088 gesetzt, sonst kaum Linien im Bild.
