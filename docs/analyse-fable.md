# Analyse: Linienfehler Berlin (Knick Hauptbahnhof, Auffächern Ostbahnhof, Lücke Friedrichstraße)

Stand 02.11.2026, unabhängige Ursachenanalyse (Fable). Nur Analyse, kein Code geändert. Bilder: `fehlerprotokoll/bilder/analyse-fable-vergleich.png` (Projektdateien).

## Kurzfassung

1. **Die Berliner S-Bahn auf dem iPhone kommt aus der Linienkarte (`tools/linienkarte/graph.mjs`, PMTiles `de`), nicht aus dem Stadtpaket.** In Städten mit Stadtpaket zeichnet online trotzdem die Linienkarte, die Paket-Linien (`dtr`) sind ausgeblendet (`index.html` `lkOn()` Zeile 12817, `vis(l, … && !lkOn())` Zeile 13447; Klicktest „auch in Städten mit Stadtpaket zeichnet die Linienkarte“, `tests/smoke.mjs` ab Zeile 1584). Die Fixes v503 (`tools/stadtpakete/buendel.mjs`, gemeinsame Grundlinie, Plätze je Bündel) ändern am Berliner Bild deshalb nichts – sie wirken nur offline und in Städten ohne Linienkarte (Chicago). Das erklärt, warum es „nicht besser wird“.
2. **Grundursache in der Linienkarte:** `graph.mjs` legt parallele Gleise rein nach Abstand (bis 28 m, `GP.rail.snap`) zu einer Mittellinie zusammen. Auf der Stadtbahn liegen vier Gleise nebeneinander (zwei S-Bahn-, zwei Fernbahngleise, zusammen ca. 15–20 m breit). Je nach Reihenfolge, Hysterese, Laufmindestlänge (`MINRUN` 150 m) und Bahnsteiglage werden die S-Bahn-Gleise **mal mit der Fernbahn** zu einer Mittellinie zusammengelegt, **mal nicht**. Dadurch entstehen zwei verschiedene Streckenstücke für dieselben vier Linien:
   - laufen beide nebeneinander → **doppeltes Bündel** (Ostbahnhof: 8 statt 4 Linien, Friedrichstraße),
   - endet eins davon → **Lücke, Bündel „springt“ um ein paar Meter** (Schiffbauerdamm),
   - geht das S-Bahn-Stück in das gemischte Stück über → **Knick plus Platzsprung** (Hauptbahnhof: Mittellinie wechselt vom S-Bahn-Gleis auf die Mitte zwischen S-Bahn und Fernbahn, Bündelmitte von 1,5 auf 4,9 Plätze).
   Alle bisherigen Fixes (Rampen, 10-m-Verlängerung, Reihenfolge, Knoten zusammenziehen, Stummel entfernen) arbeiten **nach** dieser Entscheidung und können sie nicht reparieren.
3. **Beleg durch Versuch:** Ändert man nur das Einrastkriterium (Gleise ohne gemeinsame Linie rasten nur bis 7 m ein, Gleise mit gemeinsamer Linie wie bisher bis 28 m), sind alle drei Stellen im Nachbau sauber (Bild, rechte Spalte). Zahlen Berlin-Mitte: S-Bahn-Stücke mit Fernbahn gemischt 42 → 17, doppelt parallel laufende Stücke 1,45 km → 0,42 km.

## Vorgehen

- Berlin-Stadtpaket (`stadtpakete`-Zweig, 02.11. 00:49) geholt und die App-Verarbeitung (`lnClean`, `lnRund`, `line-offset` mit `P.O`) nachgebaut und gezeichnet.
- Linienkarte Berlin-Mitte lokal gebaut: OSM-Prüfauszug `dbg-berlin.osm.pbf` vom `linienkarte`-Zweig, `tools/linienkarte/build.mjs` mit `LKPBF`, Stand `main` (5997477). Streckenstücke (Ketten) mit Linienmenge, Richtung und Bündelmitte ausgegeben (Instrumentierung nur in einer Kopie im Arbeitsverzeichnis).
- Dieselben Stellen aus den veröffentlichten Kacheln `de.pmtiles` (Zoom 14) gelesen – identisch mit dem lokalen Bau.
- Zeichnung wie die App: Versatz = Platz × `OV.w.off` (Zoom 17–18: 5,5–6,4 px je Platz), runde Enden, Anfang/Ende je Stück markiert.

## Belege an den drei Stellen (Linienkarte, Stand main)

Streckenstücke („Ketten“) im Bahngraph, Koordinaten lon,lat:

**Friedrichstraße / Schiffbauerdamm (13.3862, 52.5207)**
- Kette 1: 200 m, **10 Striche** (S3 S5 S7 S9 + RE1 RE2 RE7 RB14 RB23 + Fernverkehr), Bündelmitte 5, von 13.385796,52.520347 nach 13.388245,52.520142.
- Kette 4: 253 m, **4 Striche** (nur S3 S5 S7 S9), Bündelmitte 1,5, von 13.388245,52.520142 nach 13.384853,52.520924 – **dieselben Linien, zwischen denselben Knoten, 5–10 m daneben**.
- Ergebnis: Das S-Bahn-Bündel liegt zweimal da. Eines endet an der Brücke (Kette 2, 94 m, nur Fernbahn, übernimmt dahinter), das andere läuft weiter → Lücke mit seitlichem Versatz, genau wie im Screenshot (IMG_2904).

**Ostbahnhof (13.4365, 52.5112)**
- Ketten 16 und 17: 165 m und 141 m, 10 bzw. 9 Striche (S-Bahn + Fernbahn), Knoten 13.435079,52.510587.
- Ketten 18 und 60: 180 m und 140 m, 4 Striche (nur S-Bahn, 60 zusätzlich S75), Knoten 13.435256,52.510774 / 13.433052,52.511398.
- Ergebnis: Zwei S-Bahn-Bündel laufen auf ca. 300 m parallel und fließen an den Enden zusammen → „auffächern, kreuzen, Haken“ (IMG_2906, 8 Linien statt 4).

**Hauptbahnhof / Humboldthafen (13.3640, 52.5240)**
- Kette 8: 545 m, 4 Striche (nur S-Bahn), Bündelmitte 1,5, endet am Knoten 13.365547,52.523839.
- Kette 12: 5310 m, 10 Striche (S-Bahn + 12 andere), Bündelmitte 4,9, beginnt an demselben Knoten; Kette 23 (453 m, 10 Striche) endet dort ebenfalls.
- Ergebnis: Am Knoten wechselt die Mittellinie vom S-Bahn-Gleis auf die Mitte des Vier-Gleis-Pakets (ca. 6–10 m seitlich) **und** die Bündelmitte um 3,4 Plätze (≈ 18 px bei Zoom 17) → Knick mit Stufe (IMG_2905).

Zählung Berlin-Mitte (Auszug 13.30–13.48 / 52.48–52.56): 69 S-Bahn-Ketten, davon 42 mit Fernbahn gemischt; 6 Paare gleicher Linien laufen ≥ 60 m parallel (1,45 km doppelt); an 25 Knoten geht ein reines S-Bahn-Stück in ein gemischtes über (= 25 Stellen mit Knick/Platzsprung).

## Warum die Logik das erzeugt (`tools/linienkarte/graph.mjs`)

- `GP.rail.snap = 28` m (Zeile 27): jeder Punkt rastet auf den nächsten Knoten eines **beliebigen** anderen Gleises ein, wenn er quer ≤ 28 m liegt und die Richtung passt (`COSMIN` 0,85, ca. 32°). Es gibt kein Kriterium „gehört zur selben Strecke“ – weder Linienmenge noch OSM-Tags (`service`, `usage`, `railway:traffic_mode`) werden beim Einrasten angesehen. S-Bahn-Gleis ↔ Fernbahngleis (8–12 m) ist damit genauso ein Treffer wie Richtungsgleis ↔ Richtungsgleis (4 m).
- Die Entscheidung ist **pfadabhängig**: Reihenfolge der Wege (`ways.sort`: viele Linien zuerst – die Fernbahn-Wege mit ICE/IC/RE sind oft „linienreicher“ als die S-Bahn), Hysterese („bisheriges Gleis bevorzugt“, Faktor 1,4/0,7), Lückenüberbrückung `KB` 200 m, Laufmindestlänge `MINRUN` 150 m mit Aufrollen (`PEEL`). An Bahnsteigen, Weichen und Brücken ändern sich Abstände um wenige Meter, und die Zuordnung kippt. Deshalb wechselt sie entlang der Stadtbahn mehrfach – und jeder Wechsel ist ein Knoten mit zwei verschiedenen Mittellinien.
- `MINRUN` 150 m (Fix vom 01.11. gegen Zickzack Westhafen) verschärft es: Läufe unter 150 m (typisch zwischen zwei Weichen oder im Bahnhof) werden wieder gelöst → genau dort entstehen die separaten S-Bahn-Stücke neben den gemischten (Ostbahnhof, Friedrichstraße).
- Nachgelagert (Rampen `RAMP` 60 m, `ext` 10 m, `aufraeumen` mit Blasen/Stummeln, `CEN`-Weitergabe) wird nur geglättet, was die Topologie vorgibt. Die „Blasen“-Regel fängt Doppelstücke nur, wenn beide **dieselben** Endknoten haben (Friedrichstraße: Kette 1 endet bei 13.385796, Kette 4 bei 13.384853 – kein Paar).
- `grpOf` trennt nur Tram/Metro/Fähre/Seilbahn; S-Bahn (in OSM `light_rail`, in der Karte `m = light`) und Eisenbahn liegen in einer Gruppe `rail`. Das ist für Netze richtig, in denen S-Bahn und Regionalzug dasselbe Gleis befahren (München Außenäste, Rhein-Main), in Berlin aber falsch (eigenes Stromschienennetz, nie ein gemeinsames Gleis).

## Versuch (nur im Arbeitsverzeichnis)

Eine Zeile im Kandidatenfilter von `graph.mjs`: ein Knoten eines Gleises, das **keine gemeinsame Linie** mit dem aktuellen Weg hat, zählt nur bis 7 m quer (Richtungsgleise derselben Strecke sind 4–4,5 m auseinander); Gleise mit gemeinsamer Linie wie bisher bis 28 m. Ergebnis Berlin-Mitte: gemischte S-Bahn-Ketten 42 → 17, doppelte Parallelstücke 1,45 km → 0,42 km, Übergangsknoten 25 → 21; an allen drei Stellen ein sauberes Vier-Linien-Bündel (Bild). Rest: Stellen, an denen Gleise beider Systeme wirklich unter 7 m liegen oder ein Weg in beiden Relationen steckt – dafür braucht es die Regel unten.

## Lösungsvorschlag (grundsätzlich, nicht Stelle für Stelle)

1. **Zusammenlegen nach Zugehörigkeit statt nach Abstand.** Zwei Gleise werden nur dann zu einer Mittellinie, wenn (a) mindestens eine Linie beide befährt (Richtungsgleise, Bahnsteiggleise derselben Linien) – dann bis 28 m, auch über Bahnsteige hinweg – oder (b) sie sehr nah beieinander liegen (≤ 6–7 m) **und** derselben Gleisklasse angehören (OSM `usage`/`service`/`railway:traffic_mode`, bzw. Gruppe S-Bahn vs. Eisenbahn). Gleise verschiedener Systeme ohne gemeinsame Linie bleiben getrennt und werden als zwei Bündel nebeneinander gezeichnet, wie Apple Karten (S-Bahn-Bündel neben Fernbahn-Bündel).
2. **Entscheidung einmal je Strecke, nicht je Punkt.** Die Zuordnung Weg ↔ Nachbargleis über die ganze gemeinsame Länge treffen (Mehrheit/Länge), damit sie nicht an Weichen und Bahnsteigen kippt. Dann sind `MINRUN`/`PEEL`/Hysterese als Reparatur weitgehend überflüssig.
3. **Prüfzahlen in den Bau einbauen** (wie der Knick-Zähler): Zahl der Ketten derselben Linienmenge, die ≥ 60 m parallel laufen (Soll 0), und Zahl der Knoten mit Platzsprung der Bündelmitte > 1 Platz. Beide Zahlen für Berlin-Mitte und Bremen im Klicktest „Linienkarte-Bau“ festhalten.
4. **Eine Bündellogik, nicht zwei.** `tools/stadtpakete/buendel.mjs` (v503) löst dasselbe Problem noch einmal mit anderem Ansatz (punktweises Einrasten auf eine „Grundlinie“, 12 m) und hat die gleichen Fehlerklassen (siehe unten). Vorschlag: Stadtpakete nutzen den Liniengraph aus `graph.mjs` (Eingabe: OSM-Wege je Linie, die der Paketbau ohnehin über `osmFill` hat), oder die Pakete liefern nur Fahrplan/Stationen und die Linienform kommt überall aus der Linienkarte. Sonst landen Fixes weiter im falschen Modul.
5. **App:** Versatz in die Form rechnen (wie NYC `subForm`, v491) statt `line-offset` je Stück. Solange die Linienkarte `line-offset` nutzt, muss jedes Stück seine Zeichenrichtung behalten und Rampen in viele kleine Stücke zerlegen (Hbf-Bild: ein Stück alle 8 m) – mit eingerechnetem Versatz entfällt das, und Kachelränder/Platzwechsel knicken nicht.

## Nebenbefund: Stadtpaket Berlin (`tools/stadtpakete/buendel.mjs`, v503)

Nicht sichtbar, solange die Linienkarte zeichnet – wirkt aber offline und in Chicago. Nachbau mit `berlin.json` (02.11. 00:49) an denselben Stellen zeigt Knick, Haken und Zerfaserung mit denselben Mechanismen:
- `SH.tol = 12` m: Die S-Bahn rastet auf die Grundlinie der Fernbahn ein, sobald der Abstand unter 12 m fällt. Hauptbahnhof: Punkt 13.36405,52.52332 liegt 12,5 m von RE1 (eigener Verlauf), der nächste 0,0 m (auf RE1) → 13-m-Knick. 58 von 839 km S-Bahn liegen auf Fernbahn-Grundlinien, 3027 Grundlinienwechsel (3,6 je km).
- Friedrichstraße: S5 wechselt alle 5–7 m zwischen eigener Linie, S3-Grundlinie und RE1-Grundlinie (Zickzack ±3 m); S9 enthält eine Schleife 13.38688 → 13.38705 → 13.38688.
- Doppelte Gleise bleiben: „eigenes Stück“ wird nur erkannt, wenn die nächste Grundlinie der **eigenen** Linie gehört; bei Gleichstand gewinnt die ältere, fremde. S3 29 %, S85 28 %, S42 26 %, S9 22 % der gezeichneten Kilometer doppelt.
- Ausgabe in Richtungsstücken (S85 447, S1 340 Stücke); Enden derselben Linie auf verschiedenen Punkten (S3 Friedrichstraße: 13.38649 / 13.38688 / 13.38704) → Lücken, Haken; `lnClean(…, keep)` darf nur Ende→Anfang verbinden.
- `plaetze()`: **ein Platz je Linie für die ganze Stadt**; Konflikte summieren sich netzweit. Stadtbahn: S3 3,5 · S7 2,5 · S5 −1,5 · S9 −2,5 → Lücke von drei Plätzen im Bündel, bis 3,5 Plätze (≈ 8 m bei Zoom 18) neben dem Gleis.

Hinweis zur Einordnung der Screenshots: Das Stadtpaket vom 02.11. würde die vier Stadtbahn-Linien mit Lücke zeichnen; auf den Screenshots liegen sie dicht und gleichmäßig – auch das zeigt, dass die Linienkarte das Bild bestimmt.
