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

- Aufgabe 4: `OV.smooth` = {cut:12, it:3} – Chaikin mit Höchstschnitt (Ecke höchstens 12/6/3 m abgeschnitten), `ovSmooth(L)` behält Anfang/Ende, `ovSmoothAll(Ls)` setzt Abzweig-Enden danach wieder exakt auf die geglättete Linie. Geglättet: NYC U-Bahn/Bus einmal beim Laden in `GEO` (~25 ms am Rechner), ÖPNV-Fahrten der Route in `rtAdd` (Zwischenspeicher `RTSM`, WeakMap auf das ridePath-Ergebnis). Linienkarte glättet schon im Build (paralleler Thread), Transitland/Overpass-Linien nicht angefasst. Messung: größte Abweichung 8,5 m, spitze Ecken (> 30°) 1047 → 29.

- Aufgabe 5: Bahn 0,8/1,2/2/3/4,5 px bei Z10/12/14/16/18 (Tram/Seilbahn etwas dünner), Versatz bis Z18 4,8; Bus 0,5–0,6 → 2,4–2,6 px bis Z18 (immer dünner als Bahn, vorher bei Z16 dicker); Fähre 1 → 3,2 px. Route: Stärke × Zoomfaktor `OV.rt.zf` (0,7 bei Z11 … 1,4 bei Z18), Helfer `ovRtW()`; Fahrt immer > 1,5 × Bahn.

- Aufgabe 6: U-Bahn NYC = offizielle MTA-Farben aus dem GTFS (waren schon so, Test sichert ab); andere Städte OSM-Farbe. Bus gedämpft `#5f7fa3` (dunkel `#87a3c4`), auch CSS `--bus` (Menü-Farbfeld, Plaketten). Fähre `#1BA1E2` (vorher `#0b84b5`, zu nah am A/C/E-Blau). Rand: `ovCase(id)` legt „<id>-cs“ direkt unter die Linie (weiß, dunkel `#0f1720`, 90 %, Breite + 2 × `OV.w.case`); gilt für sub, dtr, dtr-f, lk-*-ln, tl-rail, tl-ferry, ferry-line. Sichtbarkeit/Filter/Versatz/Breite folgen über umhüllte map.setLayoutProperty/setFilter/setPaintProperty. Bus ohne Rand (soll zurücktreten).

- Aufgabe 7: Reihenfolge unten → oben: Grundkarte (Flächen, Straßen, 3D-Gebäude `b3d` vor der ersten Beschriftung) · ÖPNV-Ränder/-Linien · eigene Route (`rt-*`, jetzt vor `LBLB` statt ganz oben) · Straßen-/Ortsnamen · Stationen/Marker. `ovBelow()` = „rt-case“ falls da, sonst `LBLB`; alle ÖPNV-Linien (auch später nachgeladene Linienkarte) nutzen es. Linien liegen über den 3D-Gebäuden → nicht zerschnitten.

- Aufgabe 8: Stationspunkt einheitlich `STPAINT(me)`: weiß, Rand in der Farbe des Verkehrsmittels `OV.col.sm` (metro #1D5FBF, tram #C8102E, light #2A9D8F, funi #8A5A2B, ferry, bus, x = Zug/übrige #3B4A5A); dieselben Farben für die Stationssymbole (`TPMCOL = OV.col.sm`). Radius 1,8/3/4,2/5,5 bei Z11/13/15/17, Rand 1/1,6/2,2. Gilt für dst, subst (NYC = metro), tl-st (x), tl-bst (bus).

- Aufgabe 9: Symbol ab `OV.z.stopIcon` (Z14) statt Punkt: andere Städte schon vorher (`dst-ic`), New York neu (`subst-ic`, „ts|metro“, `subst` endet bei Z14). Fähre hat ein eigenes Bild (Boot mit Welle) in `tpMode`, vorher Zug-Bild. Transitland-Haltestellen bleiben Punkte (Kacheln ohne Verkehrsmittel je Haltestelle).

- Aufgabe 10: New York zeigt Name + Linien-Plaketten jetzt wie die anderen Städte als Kartenebene `subst-lbl` (Bild „tn|Name|Linien|l“, `dstImg`, Plaketten ab Z14,5) statt im SVG-Overlay (`drawOverlay`, Kreise r 6,5 entfernt). Kollisionsprüfung durch MapLibre. Umstiegsknoten: `stCx()` (Union-Find über MTA-Umstiege `NET.t` bei gleichem Namen) → ein Name mit allen Linien an der mittleren Station, übrige `h:1` ohne Namen. Wall St 2/3 und 4/5, Penn 1/2/3 und A/C/E bleiben getrennt (kein Umstieg). NYC-Namen je Rang eine Stufe später als andere Städte (Z13/14/15), damit S1 ruhig bleibt. Busse: Plaketten an Haltestellen erst ab `OV.z.busStop` (15,5), unverändert.

- Aufgabe 11: Umstiegsstation = Eigenschaft `x` (NYC: Knoten aus `stCx()` mit mehreren Linienfarben; andere Städte: `stXOf(lb)` ≥ 2 Farben bzw. Bahnhofsklassen). `STX`-Ausdruck, `ovZx(reihe, f)`: Punkt × `OV.w.stopX` (1,4) mit dunklem Rand `OV.col.sm.x` wie Apple Karten, Symbol ab Z14 × `OV.w.stopIconX` (1,25). Gilt über `STPAINT` für subst/dst/tl.

- Aufgabe 12: Kollision über MapLibre (`icon-allow-overlap:false` an `subst-lbl`/`dst-lbl`, `symbol-sort-key` nach Rang). Reihenfolge: Linien-Plaketten (`dtr-lbl`, `dbus-lbl`, `lk-*-lbl`) unter `dst-lbl` → Namen werden zuerst gesetzt; Namen unter den Symbolen (`…-ic`), Symbole sperren nichts (`icon-ignore-placement:true`). Versuch „Symbole sperren Namen“ verworfen: Times Sq-42 St und Penn verschwanden ganz. Abstand Name ↔ Symbol ab Z14 13 px (vorher 10, überlappte das eigene Symbol).

- Aufgabe 13 (Gesamtprüfung, Bilder LOOP/screens/12/nachher): L0 ✓ (durchgehend, S1/S3), L1 ✓ (geglättet), L2 ✓, L3 ✓ (S1 fein, S3 kräftig), L4 ✓ (S4/S5 Route am stärksten), L5 ✓ (MTA-Farben, Bus gedämpft, Fähre eigene Farbe – in der Testumgebung keine NYC-Fähren sichtbar), L6 ✓ (weißer Rand), L7 ✓ (Namen über Linien), L8 nicht prüfbar (Testumgebung ohne Kartenkacheln/3D-Gebäude), T1 ✓, T2 ✓ (S1 Punkte, ab Z14 Symbol), T3 ✓ (Knoten mit allen Linien), T4 ✓ (S1 dunkler Rand), T5 ✓ (Namen überlappen sich nicht; Plakettenreihe kann Nachbarsymbol berühren → Aufgabe 17), T6 ✓ (S1 ohne Namen), A1/A2 ✓. Offen als Aufgaben: 14–17.

## Ferdinands Feedback
<!-- Format: Aufgabe Nr · Kommentar · was daraufhin geändert wurde -->
- 1 · „Ok Freigabe“ · keine Änderung
- 2 · „Ok“ · keine Änderung
- 3 · „Ok“ · keine Änderung
- 4 · „Ok“ · keine Änderung
- 5 · „Ok“ · keine Änderung
- ab 6 · 01.11. „Mach alles Freigabe automatisch im Loop“ · Freigabe ab jetzt selbst nach Vorprüfung, direkt nach main

## Protokoll
<!-- Format: Aufgabe Nr · Datum · Commit · Vorprüfung · Freigabe · Stolperfallen -->
- 1 · 31.10.2026 · (siehe git log „Loop 1:“) · S1–S5 pixelgleich vorher/nachher (A1, A2 ok) · Freigabe 31.10. (v475) · Szenen-Test neu angelegt; S3-Mitte auf -74.0078/40.7088 gesetzt, sonst kaum Linien im Bild.
- 2 · 31.10.2026 · (git log „Loop 2:“) · Ursache NYC-Daten (abgeschnitten, ein Fahrweg je Linie), neu aus MTA-GTFS; Test „Durchgehende Linien“ (Anschlüsse < 1 m, alle Stationen auf ihrer Linie, Route lückenlos) · Freigabe 31.10. · Stationen wie 96 St/2 Av liegen ~100 m hinter dem GTFS-Fahrwegende → Linie bis zur Station verlängert. Volle ÖPNV-Tests unter Last wackelig (Lissabon/Offline/Navigation), einzeln grün.
- 3 · 31.10.2026 · (git log „Loop 3:“) · L1 bestanden; S1–S5 pixelgleich (nur Fähren betroffen, die in der Testumgebung fehlen) → Zusatzbild Fähre mit Knick (Berlin-Testdaten) · Freigabe 31.10.
- 4 · 31.10.2026 · (git log „Loop 4:“) · L0 (Test „Durchgehende Linien“ weiter grün), L1, L2 (≤ 8,5 m Abweichung) bestanden · Freigabe 31.10. · Mit 2 Durchgängen blieben 322 spitze Ecken, daher 3.
- 5 · 31.10.2026 · (git log „Loop 5:“) · L3, L4 bestanden (Test wertet die Ausdrücke je Zoom 11–19 aus) · Freigabe 31.10.
- 6 · 31.10.2026 · (git log „Loop 6:“) · L5, L6 bestanden (Rand auf leerem Testhintergrund kaum sichtbar, auf dem iPhone über Straßen/Parks prüfen) · Freigabe 01.11. (automatisch) · Transitland-Test prüfte noch die alte Stärke 2.6 (Folge von Aufgabe 5) → eigener Commit auf main.
- 7 · 01.11.2026 · (git log „Loop 7:“) · L7, L8 bestanden (Test prüft die Reihenfolge; S1–S5 pixelgleich, da Testkarte ohne Straßen/Gebäude) · Freigabe automatisch · Klicktests main rot seit v479: Berlin-Takt abends/Wochenende 10 Min. → Test korrigiert (eigener Commit).
- 8 · 01.11.2026 · (git log „Loop 8:“) · T1 bestanden (erst zu klein/dünn → Radius und Rand vergrößert) · Freigabe automatisch
- 9 · 01.11.2026 · (git log „Loop 9:“) · T2 bestanden (S1 ohne Symbole, ab Z14 Symbol) · Freigabe automatisch
- 10 · 01.11.2026 · (git log „Loop 10:“) · T3/T5/T6 bestanden (S2 Times Sq ein Name mit 1 2 3 7 S N Q R W, S1 ohne Namen) · Freigabe automatisch
- 11 · 01.11.2026 · (git log „Loop 11:“) · T4 bestanden (S1 Umstiege als größere Punkte mit dunklem Rand, 50 St 1/2 kein Umstieg) · Freigabe automatisch
- 12 · 01.11.2026 · (git log „Loop 12:“) · T5 bestanden (Namen überlappen sich nicht, Times Sq bleibt) · Freigabe automatisch
- 13 · 01.11.2026 · nur Doku (keine App-Änderung) · alle prüfbaren Kriterien erfüllt, Restpunkte als 14–17 · Freigabe automatisch
