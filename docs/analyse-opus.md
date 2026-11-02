# Ursachenanalyse Linienfehler Berlin (Opus) · 02.11.2026

Gemeldet (Ferdinand, Screenshots 02:36/02:37, App v503+): S-Bahn-Bündel S3/S5/S7/S9
1. **Hauptbahnhof West / Invalidenstraße** (≈ 13.3655, 52.5240): Knick/Zickzack im Bündel
2. **Ostbahnhof** (≈ 13.437, 52.510): Linien fächern auf, kreuzen sich, Haken
3. **Schiffbauerdamm / westlich Friedrichstraße** (≈ 13.3850, 52.5208): Bündel bricht ab und geht versetzt weiter

Nur Analyse, kein App-Code geändert.

## Kurzfassung

Die Fehler entstehen **nicht im Zeichnen der App**, sondern schon in den Daten der Linienkarte (`de.pmtiles`, gebaut von `tools/linienkarte/graph.mjs`).
Die Hauptursache ist eine einzige Designentscheidung: **S-Bahn-Gleise und Fern-/Regionalgleise sind eine Gruppe (`rail`) und rasten aufeinander ein.**
Auf der Stadtbahn liegen beide Gleispaare mal näher, mal weiter als 28 m nebeneinander. Deshalb gehört die S-Bahn abwechselnd zu einem
gemeinsamen Stück mit RE/RB/EC (8–11 Striche) und zu einem eigenen Stück (4 Striche). Jeder Wechsel verschiebt Mittellinie, Bündelmitte,
Platz und Reihenfolge – genau das sind Knick, Fächer und Lücke. Alle Fixes der letzten Tage haben die Übergänge zwischen solchen Stücken
geglättet, aber nicht verhindert, dass diese Übergänge überhaupt entstehen. Deshalb wird es nicht besser.

**Gegenprobe:** S-Bahn als eigene Gruppe (eine Zeile in `grpOf`, lokal mit dem Berlin-Auszug gebaut) → alle drei Stellen glatt (Bild unten).

## Wichtig vorab: Welcher Code zeichnet Berlin überhaupt?

Berlin hat ein Stadtpaket (VBB) **und** liegt in der Linienkarte `de`. Online zeichnet in Berlin die **Linienkarte**, das Paket-Bündel ist ausgeblendet:

- `index.html:12817` `lkOn()` ist wahr, sobald ein Linienkarte-Land im Ausschnitt liegt (auch in Stadtpaket-Städten)
- `index.html:12833` blendet dann `dtr`, `dtr-f`, `dtr-lbl` aus; `index.html:13447` zeigt `dtr`/`ddot` nur bei `!lkOn()`

Folge: Die Bündel-Arbeit in `tools/stadtpakete/buendel.mjs` (v503, `P.O`) und die Stationspunkte `ddot` (v499) **wirken in Berlin online gar nicht**.
Zwei unabhängige Bündel-Verfahren (Stadtpaket und Linienkarte) machen dieselbe Aufgabe; Korrekturen landen oft im falschen.
(Die Zuschreibung „ÖPNV: VBB“ unten im Bild kommt von der Paket-Quelle, die trotzdem geladen ist.)

## Belege aus den Live-Daten (de.pmtiles vom 02.11. 00:03, Zweig `linienkarte`, Zoom 14)

Jede Zeile = ein Objekt der Kachel: Linie, Platz `o`, Zahl der Striche im Stück `n`, Anfang → Ende.

**Schiffbauerdamm** – gemeinsames Stück mit Regional/Fern, dann S-Bahn-eigenes Stück:

```
reg  RB23 -4 / RE7 -3 / RE1 -2 / EC -1 / RB14 0 / RE2 1   n=10  [13.384931,52.520784] → [13.379084,52.521584]
S3 2 · S5 3 · S7 4 · S9 5                                  n=10  [13.384802,52.520833] → [13.379084,52.521584]
S3 -1.5 · S5 -0.5 · S7 0.5 · S9 1.5                        n=4   [13.387318,52.520425] → [13.384851,52.520925]
S5 1.45 · S3 2.45 · S7 3.45 · S9 4.45                      n=10  [13.388268,52.520096] → [13.385907,52.520461]
```

- Das n=4-Stück endet bei 13.384851,52.520925, das n=10-Stück beginnt bei 13.384802,52.520833: **10,7 m auseinander**, kein Verbindungsstück, und der Platz springt von −1,5 auf +2 (**3,5 Plätze**). Das ist die Lücke mit Versatz aus Screenshot 1.
- 13.3859–13.3873: n=4- und n=10-Stück liegen **gleichzeitig nebeneinander** → S-Bahn doppelt gezeichnet (zwei Bündel, eins davon „versetzt“).
- Reihenfolge wechselt: n=4 `S3,S5,S7,S9`, n=10 `S5,S3,S7,S9`.

**Hauptbahnhof West** – S3 o=2 (n=10) gleitet über ~120 m in 0,2er-Stufen auf −1,5 (n=4): `2 → 1.85 → … → 0.25 → −0.05 → … → −1.5`, gleichzeitig wechselt die Mittellinie vom gemeinsamen Gleismittel auf das S-Bahn-Gleis (~10 m seitlich). Rampe (Pixel) und Mittellinien-Sprung (Meter) heben sich nur bei einer Zoomstufe auf → Knick/Zickzack. Außerdem gibt es östlich zwei parallele S-Bahn-Bündel (n=10 und n=4).

**Ostbahnhof** – in 500 m drei verschiedene Reihenfolgen derselben vier Linien:

```
n=8/9  S5 1 · S3 2 · S7 3 · S9 4        (zusammen mit RE7 -3, RE1 -2, EC -1, RE2 0)
n=4    S3 -1.5 · S5 -0.5 · S7 0.5 · S9 1.5     [13.435995,52.510377] → …
n=4    S9 -1.5 · S7 -0.5 · S3 0.5 · S5 1.5     [13.442888,52.507964] → [13.43864,52.509349]
```

Dazwischen Rampen je Strich mit verschiedenen Zielplätzen → Linien fächern auf, kreuzen sich und bilden Haken (Screenshot 3).

Nachgezeichnet aus genau diesen Kacheldaten (line-offset wie in der App): Projektdateien `fehlerprotokoll/bilder/analyse-opus-live.png` – zeigt alle drei Fehlerbilder.

## Zahlen: Wie oft wechselt das Bündel? (lokal nachgebaut, Berlin-Auszug `dbg-berlin.osm.pbf`, Stadtbahn Westkreuz–Ostkreuz)

| | heute (`rail` gemeinsam) | S-Bahn eigene Gruppe |
|---|---|---|
| S3: Stücke | 260 | 86 |
| S3: verschiedene Bündelgrößen n | 10 (n=2 … 11) | 3 (n=4 auf 17,4 von 18,8 km) |
| S3: verschiedene Plätze o | 105 | 27 |
| S5: verschiedene Plätze o | 71 | 7 |

Jede Änderung von n oder o ist eine Stelle, an der das Bündel seitlich gleiten oder springen muss.

## Ursachen im Code

### U1 (Hauptursache): S-Bahn rastet auf Fernbahngleise ein
`graph.mjs:32` `grpOf`: alles außer Tram/Fähre/Seilbahn/U-Bahn ist Gruppe `rail` – also auch `light` (Berliner S-Bahn ist in OSM `route=light_rail`) und `sbahn`.
`graph.mjs:64–81`: ein Punkt rastet auf jeden Knoten eines anderen Wegs ein, der quer ≤ 28 m (`GP.rail.snap`, mit Hysterese 39 m) liegt und parallel läuft.
`graph.mjs:87–115`: Läufe < 150 m (`MINRUN`) lösen sich wieder, an auseinanderlaufenden Enden wird aufgerollt (`PEEL`).

Auf der Stadtbahn liegen S-Bahn- und Ferngleise 12–35 m auseinander; an Bahnhöfen mit Mittelbahnsteig mehr. Ergebnis: Einrasten an/aus im Wechsel,
oft nur **ein** S-Bahn-Gleis (das zur Fernbahn hin) eingerastet, das andere nicht → die S-Bahn steht in zwei Stücken gleichzeitig (Doppel-Bündel),
die Stückgrenzen der beiden Richtungen liegen an verschiedenen Stellen (Lücke + Versatz). `MINRUN`/`PEEL`/Hysterese verschieben nur, *wo* gewechselt wird.

### U2: Plätze für ausgeblendete Linien
Im gemeinsamen Stück bekommt die S-Bahn die Plätze +2 … +5 (RE/RB/EC belegen −4 … +1). Ferdinands Ansicht zeigt nur S-Bahn (Filter je Verkehrsmittel,
`index.html:12828` Filter `["in", m, rail]`) – die Plätze der ausgeblendeten Regionalzüge bleiben trotzdem belegt. Die S-Bahn liegt dort 2–5 Plätze neben der Mittellinie
und springt am nächsten n=4-Stück zurück auf −1,5 … +1,5. Je Stück ist der Platz fest in den Kacheln; die App kann das nicht ausgleichen.

### U3: Versatz in Pixeln, Mittellinie in Metern
`o` × `OV.w.off` ist ein Pixelversatz (Zoom 14: 9 m je Platz, 16: 3,3 m, 18: 1,2 m). Beim Wechsel gemeinsames Stück ↔ eigenes Stück springt die Mittellinie aber um feste
~10 m. Eine Rampe von 3,5 Plätzen gleicht 10 m nur bei etwa Zoom 16 aus; bei 14 schießt sie über, bei 18 reicht sie nicht. Darum sieht dieselbe Stelle je nach Zoom
anders falsch aus und keine Rampenlänge kann das beheben.

### U4: Reihenfolge je Stück lokal berechnet
`graph.mjs:309–330` `side()` bestimmt die Reihenfolge je Stück aus den Abzweigen in Fahrtrichtung. Zerfällt eine Strecke in viele Stücke mit verschiedener
Linienmenge (U1), sieht jedes Stück andere Abzweige → andere Reihenfolge (Ostbahnhof: drei Reihenfolgen). Jede Umordnung = Kreuzung im Bündel.

### U5: Übergänge zwischen Stücken nicht symmetrisch
- `endO` (`graph.mjs:353–355`) nimmt den ersten passenden Nachbarn aus `thru()`. Die Gegenseite kann einen anderen Nachbarn wählen → die beiden Rampen treffen sich nicht in der Mitte.
- Stücke < 20 m werden nicht gezeichnet (`graph.mjs:398`), die Fortsetzung reicht nur 10 m (`EXT`) und entfällt bei > 60° Knick (`graph.mjs:392`) → an kurzen Zwischenstücken
  (z. B. die 10,7 m am Schiffbauerdamm) bleibt eine Lücke.
- Jeder Strich wird für sich in Stücke geteilt (`graph.mjs:410–420`): Nahtstellen verschiedener Linien liegen nicht an derselben Stelle.

Diese Punkte sind echte Schwächen, verursachen aber fast nur dort sichtbare Fehler, wo U1 viele Übergänge erzeugt.

### U6 (Ablauf): Prüfwerkzeug misst das Falsche
`tools/linienkarte/pruefen.mjs` prüft die Rohform je Strich (Abweichung > 5 m auf 50 m). Platzsprünge, doppelte Bündel und wechselnde Reihenfolge sieht es nicht,
weil der Versatz erst beim Zeichnen entsteht. Darum meldete es „0 Knicke“, während die Karte Knicke zeigt.

## Lösungsvorschlag (Reihenfolge nach Wirkung)

1. **S-Bahn eigene Gruppe im Liniengraph** (wie schon die U-Bahn): `grpOf` → `light` und `sbahn` = Gruppe `sbahn` (Parameter wie `rail`).
   Fern- und Regionalverkehr bleiben zusammen. Gegenprobe lokal: alle drei Stellen glatt, S3 nur noch 86 statt 260 Stücke (Bild unten).
   Rest am Ostbahnhof: eine kurze Überkreuzung, wo die S-Bahn-Gleise am Bahnsteig wirklich auseinanderlaufen.
2. **Bündel nur aus gemeinsam sichtbaren Linien**: Gruppen so schneiden, wie das Ebenen-Menü schaltet (S-Bahn / Regional+Fern / Tram / U-Bahn), damit ausgeblendete Linien keine Plätze belegen (U2).
3. **Ein Verfahren statt zwei**: festlegen, ob in Paket-Städten die Linienkarte oder `buendel.mjs` zeichnet, und das andere für die Linienführung nicht mehr pflegen.
4. **Prüfung auf das Ergebnis umstellen**: Prüfwerkzeug rechnet den Versatz wie die App (o × Abstand je Zoom 14/16/18) und zählt Sprünge > 1 m, doppelte Bündel und Reihenfolgewechsel
   je Strecke; feste Prüfpunkte = die drei Koordinaten oben. Ein Vorschlag liegt in `analyse-opus-werkzeuge/sprung.mjs` und `nstat.mjs`.
5. Danach erst Feinarbeit an U4/U5: Reihenfolge je Strecke (Korridor) einmal festlegen statt je Stück; `endO` symmetrisch (beide Seiten benutzen dasselbe Paar);
   Nahtstellen aller Linien eines Stücks an denselben Stellen. Für die Reihenfolge gibt es erprobte Verfahren (z. B. LOOM der Uni Freiburg, Linienreihenfolge mit minimalen Kreuzungen).

Nicht empfohlen: weitere Feinjustierung von `snap`, `MINRUN`, `PEEL`, Rampenlängen – das verschiebt die Wechselstellen nur (Erfahrung aus den letzten Fixes).

## Bilder

- Projektdateien `fehlerprotokoll/bilder/analyse-opus-live.png` – aus den Live-Kacheln nachgezeichnet, Zoom 14/16/17: alle drei gemeldeten Fehler sichtbar
- Projektdateien `fehlerprotokoll/bilder/analyse-opus-vergleich.png` – links heute (lokal nachgebaut, gleiches Fehlerbild), rechts S-Bahn als eigene Gruppe

## Nachvollziehen

Werkzeuge in den Projektdateien `fehlerprotokoll/analyse-opus-werkzeuge/` (nur Analyse, nicht im Repo):
- `tiles.mjs <de.pmtiles> lon lat radius zoom modes` – Linien-Objekte einer Stelle aus den Kacheln (npm: pmtiles, @mapbox/vector-tile, pbf)
- `dump.py <dbg-berlin.osm.pbf> <berlin.json>` (pyosmium) + `run.mjs <berlin.json> <out.json> [graph.mjs]` – Liniengraph ohne osmium-Programm bauen
- `nstat.mjs`, `sprung.mjs` – Bündelgrößen/Plätze je Linie, versetzte Sprünge je Zoom
- `render.mjs` – Bild mit line-offset-Nachbildung
