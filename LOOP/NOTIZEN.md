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

## Ursachen Linien-Unterbrechungen (Aufgabe 2, 31.10.2026)
- New York U-Bahn + Bus (eingebaute Daten `TRANSIT` in index.html): Verläufe waren auf einen Kasten um Manhattan/Nord-Brooklyn zugeschnitten (Ostrand -73,90, Südrand 40,635) und je Linie meist nur EIN Fahrweg. Folgen: L mit 1,3 km Lücke bei Canarsie (verlässt den Kasten und kommt wieder), 2/5 ohne Flatbush-Ast (falscher Fahrweg Richtung New Lots), N/Q/R/W, A/E/F u. a. am Rand abgeschnitten, Bus B9 mit 89 m Lücke.
  Behoben an der Ursache: Werkzeug `tools/nyc-subway/build.mjs` baut die Verläufe aus dem MTA-GTFS (rrgtfsfeeds.s3.amazonaws.com) neu: alle Fahrwege je Linie, weitere Zweige setzen exakt (< 1 m) auf der Linie an, Endstation hinter dem Fahrwegende wird angehängt. Bus: nur eine Fahrtrichtung (sonst doppelte Linien auf Einbahnstraßen). Linien- und Stationsauswahl unverändert.
- Linienkarte (PMTiles, andere Städte): Risse an Weggrenzen behebt der parallele Thread „Karte so schnell wie Apple Karten“ (Commit 3b6a736) – hier nicht angefasst.
- Route der Planansicht: Abschnitte schließen bereits lückenlos an (0 m), keine Änderung nötig.
- Fähren: Strichlinie ist gewollter Stil (dasharray 3/2), keine Datenlücke. Offen für Ferdinand, ob Fähren durchgezogen sein sollen.
- Transitland: grob vereinfachte Kacheln des Anbieters, nicht im Einfluss der App.

## Getroffene Stilwerte
- Aufgabe 1: Werte unverändert übernommen (siehe `OV`): Bahn 0,9/1,6/2,6 px bei Z10/13/16 (Tram 0,7/1,2/2, Seilbahn 0,9/1,4/2,4); Bus NYC 1→3 px (Z11→16, 60 %), Bus sonst 0,6→2 px (50 %); Fähre 1,4→3 px gestrichelt 3/2 (85 %); Route: Fußweg 3,5, Fußweg im ÖPNV 3, Fahrt 5,5 (72 %), Auto 4,5, Rad 5, Rand +3,5.

- Aufgabe 3: `OV.lay` = line-cap/line-join round, Helfer `ovLay(vis, extra)` für alle ÖPNV-Linienebenen; Route nutzt `OV.lay`. Vorher fehlte line-join nur bei Fähren (`dtr-f`, `tl-ferry`, `ferry-line`), alle anderen waren schon rund.

## Ferdinands Feedback
<!-- Format: Aufgabe Nr · Kommentar · was daraufhin geändert wurde -->
- 1 · „Ok Freigabe“ · keine Änderung
- 2 · „Ok“ · keine Änderung

## Protokoll
<!-- Format: Aufgabe Nr · Datum · Commit · Vorprüfung · Freigabe · Stolperfallen -->
- 1 · 31.10.2026 · (siehe git log „Loop 1:“) · S1–S5 pixelgleich vorher/nachher (A1, A2 ok) · Freigabe 31.10. (v475) · Szenen-Test neu angelegt; S3-Mitte auf -74.0078/40.7088 gesetzt, sonst kaum Linien im Bild.
- 2 · 31.10.2026 · (git log „Loop 2:“) · Ursache NYC-Daten (abgeschnitten, ein Fahrweg je Linie), neu aus MTA-GTFS; Test „Durchgehende Linien“ (Anschlüsse < 1 m, alle Stationen auf ihrer Linie, Route lückenlos) · Freigabe 31.10. · Stationen wie 96 St/2 Av liegen ~100 m hinter dem GTFS-Fahrwegende → Linie bis zur Station verlängert. Volle ÖPNV-Tests unter Last wackelig (Lissabon/Offline/Navigation), einzeln grün.
- 3 · 31.10.2026 · (git log „Loop 3:“) · L1 bestanden; S1–S5 pixelgleich (nur Fähren betroffen, die in der Testumgebung fehlen) → Zusatzbild Fähre mit Knick (Berlin-Testdaten) · Freigabe offen
