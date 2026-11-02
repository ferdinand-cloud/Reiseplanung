# Linienfehler Berlin (v503+): Ursachenanalyse (Sonnet, unabhängig)

Stand 02.11.2026, nur Analyse, am Code nichts geändert. Alle Zahlen stammen aus dem echten Berlin-Auszug (`dbg-berlin.osm.pbf` aus dem Zweig `linienkarte`) und aus der ausgelieferten `de.pmtiles`. Der Bau (`tools/linienkarte/graph.mjs`, `build.mjs`) wurde in einer Kopie neu gerechnet; das Ergebnis deckt sich mit den ausgelieferten Kacheln.

## 0. Vorab: Welcher Code zeichnet die Screenshots?

Berlin hat ein Stadtpaket (VBB), aber `lkOn()` (index.html ~12813) schaltet online trotzdem die **Linienkarte** (`graph.mjs`, PMTiles) zum Zeichnen der Linien ein; das Paket liefert nur Menü, Haltestellen und Routen. Die Fußzeile der Screenshots („ÖPNV: VBB · …“) passt dazu.

Folge: Die Arbeit von v503 (`tools/stadtpakete/buendel.mjs`, gemeinsame Grundlinie, Plätze je Bündel) wirkt für Berlin gar nicht. Sie gilt nur für Städte ohne Linienkarte, z. B. Chicago. Alles, was Ferdinand in Berlin sieht, kommt aus `graph.mjs` und dem Versatz per `line-offset` in `lkApply()`.

## 1. Die drei Stellen im Daten-Befund

| Stelle | Ort (aus Kartenmerkmalen abgeleitet) | Befund in den Daten | Bild |
|---|---|---|---|
| Hauptbahnhof/Invalidenstraße: Knick, Zickzack | ca. 13,3678 / 52,5270 | Zwei Stränge derselben Linien (FEX, RB10, ICE 9590 …) laufen ~65 m lang gleichzeitig: einmal im großen Bündel (n=9), einmal in einem eigenen Seitenstück (n=3), das links ausschwenkt und wieder einmündet. Ihre Striche kreuzen dabei das Bündel (Linsenform). | `analyse-sonnet-bilder/hbf-nord-vorher.png` |
| Ostbahnhof: Auffächern, Kreuzen, Haken | ca. 13,4331 / 52,5114 | S3/S5/S7/S9 liegen **zweimal**: im Hauptbündel (n=10, oben, Plätze 1,45–4,45) und in einem eigenen Vierer-Stück (n=4, Plätze −1,5…1,5), das mit **freiem Ende mitten im Hauptbündel** beginnt (Haken) und sich dann auffächert. | `ostbahnhof-vorher.png` |
| Schiffbauerdamm/Friedrichstraße: Lücke | ca. 13,3853 / 52,5207 | Das Zehnerbündel endet (13,38480 / 52,52083, S-Bahn auf Platz −5), 10 m seitlich beginnt das Vierer-Stück (13,38485 / 52,52092, Platz −1,5), 80 m weiter beginnt das Zehnerbündel neu (13,38591 / 52,52046, Platz −3). Im ausgelieferten Paket sind es 88 m Abstand zwischen den freien Enden. Zwischen 41 und 143 m (in diesem Ausschnitt) wird S3 zweimal gezeichnet. Seitensprung ≈ 10 m + 3,5 Plätze ≈ 38 px bei Zoom 18, genau der Versatz im Screenshot. | `friedrichstr-vorher.png` |

Die Orte sind aus den Straßennamen und Beschriftungen der Screenshots geschlossen. Die Lücke bei Friedrichstraße ist sicher: Sie steht in den ausgelieferten Kacheln und im Neubau an derselben Stelle.

## 2. Ursachen (nach Gewicht)

### U1. Jede Linie wird in beiden Fahrtrichtungen gezeichnet, und der Code muss sie über Nähe wieder zusammensuchen
`graph.mjs` Kopf, Schritt 1: „alle Wege aller Relationen, **ohne Richtungswahl**“. In OSM hat jede Linie zwei Relationen (Hin, Rück) mit je eigenem Gleis. Im Berlin-Auszug sind **5132 von 10090 Linien-Wegen (51 %) die Gegenrichtung** einer Linie, die ein anderes Gleis nutzt, meist 4–65 m daneben (Inselbahnsteige, Gleisfächer vor dem Hauptbahnhof, Überwerfungen am Ostbahnhof).

Der Code (`gruppe()`, Zeilen 59–139) legt beide Gleise nur dann zusammen, wenn sie ≤ 28 m auseinander, ≥ 150 m lang parallel (`MINRUN`) und beim Trennen noch nicht aufgerollt (`PEEL`) sind. Wo die zwei Gleise einer Linie weiter auseinanderlaufen oder nur kurz nebeneinander liegen (also an jedem Bahnhof und jedem Gleisfächer), bleibt **ein Gleis im Bündel und das andere wird zu einem eigenen Seitenstück derselben Linie**. Dann hat die Linie zwei Striche gleichzeitig. Daraus entstehen alle drei Symptome:

- Hauptbahnhof: das n=3-Seitenstück ist die Gegenrichtungs-Spur von FEX/RB10/ICE.
- Ostbahnhof: die S-Bahn-Gegenspur ist das Vierer-Stück, die andere Spur steckt im Zehnerbündel.
- Friedrichstraße: dasselbe, nur mit versetzten Enden.

**Gegenprobe (Neubau mit Richtungswahl, nur zum Test):** je Linie die längste Relation behalten, Wege einer weiteren Relation nur, wenn < 60 % davon ≤ 40 m neben schon behaltenen liegen. Ergebnis: Hauptbahnhof-Fork verschwindet vollständig (`hbf-nord-eine-richtung.png`: zwei saubere parallele Bündel statt Linse), Ostbahnhof: Haken und Doppelstrich weg, S-Bahn zweigt glatt ab (`ostbahnhof-eine-richtung.png`). Kreuzungen im Auszug 1224 → 963 (−21 %), Spitzen/Zacken nahe Hauptbahnhof-Nord 1 → 0.

### U2. Neue Parameter-Regeln haben die Lücke selbst erzeugt (MINRUN/PEEL, v501/v502)
Die Regel „Einrasten nur bei Läufen ≥ 150 m, danach aufrollen“ (für Westhafen, A100, Bornholmer Straße) verhindert Einrasten genau dort, wo der Bahnhof nur 60–120 m lang ist (Friedrichstraße, Hauptbahnhof-Nord). Mit `LKMINRUN=40` (sonst unverändert) gibt es in Friedrichstraße **0 freie Enden statt 3**, Spitzen/Zacken im Auszug 86 → 70, Westhafen bleibt bei 0. Ohne MINRUN/PEEL: 79 Spitzen, 1039 Kreuzungen. Der letzte Fix hat also an einer Stelle repariert und an einer anderen kaputtgemacht. Das Muster seit dem 31.10.: ~15 Schwellen (snap 28 m, PEEL 12,6 m, MINRUN 150 m, KB 200 m, LMIN 61 m, Stummel 150 m, Insel 800 m/250 m, Doppel 800 m/2,5·snap, 10 m Verlängerung, 60 m Rampe, 400 m/0,2-Plätze-Stückelung, Hysterese 1,4/0,7 …). Jede Schwelle passt für einen Bahnhof und trifft den nächsten.

### U3. Die Stücke hängen nicht an gemeinsamen Knoten: freie Enden springen seitlich
Rampen, `endO()`, `KN` (gemeinsamer Knoten nach dem Glätten) und das Verlängern um 10 m (`ext()`) greifen nur, wenn zwei Stücke **dieselbe Knoten-Kennung** teilen. Entsteht (U1/U2) ein Seitenstück ohne gemeinsamen Knoten, endet das Zehnerbündel an einer anderen Stelle als das Vierer-Stück beginnt: In Friedrichstraße 10 m seitlich, 3,5 Plätze Versatz und ein Längsspalt. Eine Rampe gibt es nicht, weil kein Nachbar da ist. Das zeigt sich dann als „Bündel bricht ab und geht versetzt weiter“.

### U4. Einheitenmix: Geometrie in Metern, Versatz in Bildschirmpixeln, Rampe in Metern
Der Bau mittelt und rampt in Metern (RAMP 60 m, snap 28 m, Gleisabstand real 4–18 m). Der Versatz (`line-offset`, `OV.w.off`, index.html ~10348) ist in Pixeln und wächst mit dem Zoom nur langsam. Je Platz ca. 9,0 m bei Zoom 14, 3,3 m bei Zoom 16, 2,0 m bei Zoom 17, 1,2 m bei Zoom 18 (Breite Berlin). Ein Bündel hat also bei jedem Zoom eine andere Breite in Metern, die Gleisabstände nicht.

Folge: Wo ein Strang physisch 10–18 m neben dem Hauptbündel liegt (U1), kreuzt er bei Zoom 14 mitten durch das Bündel, bei Zoom 18 liegt er sauber daneben. Das Bild mit 9 m je Platz zerfällt in Haken und Kreuze (siehe Probelauf, gleiche Daten), das mit 3,3 m ist ruhiger. Die Screenshots (≈ Zoom 17–18) zeigen den Fall, in dem die echten Gleisabstände größer sind als die Plätze: dort wirken die ungenauen Übergänge am stärksten. Mit der Rampe von 60 m (in Metern) verteilt sich eine Platzänderung bei Zoom 18 über 330 px, bei Zoom 14 über 20 px (also fast Sprung).

### U5. Platzwechsel als Stückelung mit festen Schritten
Pro Rampe wird in Stücke geteilt (≤ 0,2 Plätze je Stück, jedes Stück bekommt ein festes `o`). `line-offset` ist je Merkmal konstant: Zwischen den Stücken springt der Versatz um 0,2 Plätze (≈ 0,9–1,3 px). Das erzeugt die gezackte Treppe an den Bündelrändern (in den Kacheln sichtbar: `o` = 0,8 · 1,05 · 0,25 · 0,35 · 0,6 · −1 · −0,85 · −0,45 …). Das ist ein Feinschliff-Fehler, aber er macht jede Rampe optisch unruhig.

### U6. Reihenfolge im Bündel wird je Stück neu bestimmt und mit Nachbarn nur gemittelt
`side()`/`CEN`/`OO` (Zeilen 296–347) ordnen jedes Stück für sich. Gleiche Linien im Nachbarstück können andere Plätze haben; `endO()` mittelt dann (Rampe über Mitte), und die Striche kreuzen sich auf den Rampen. Im Hauptbahnhof-Fork haben dieselben Linien im Seitenstück (n=3: FEX ≈ −1,4…−1,9, RB10 ≈ −0,4…−0,9) und im Hauptbündel (n=9: FEX ≈ −2,7, RB10 ≈ −1,65) unterschiedliche Plätze; die Striche wechseln auf der Rampe die Seite (Querung im Bild).

### U7. Die Prüfung misst das Falsche
`pruefen.mjs` zählt nur Spitzen (> 5 m Abweichung von der Sehne auf 50 m). Es misst **keine** doppelten Striche, freien Enden und Kreuzungen innerhalb eines Bündels. Daher galt „besser“, obwohl genau diese Fehler bestehen blieben (Westhafen 0 Spitzen, Friedrichstraße trotzdem Lücke).

## 3. Wichtige Gegenprobe-Zahlen (Berlin-Auszug, nur Neubau in Kopie)

| Variante | Kreuzungen (Schiene, Zoom 16) | Spitzen/Zacken | freie Enden Friedrichstr. |
|---|---|---|---|
| heute (MINRUN 150, PEEL) | 1224 | 86 | 3 |
| MINRUN 40 | 1177 | 70 | 0 |
| ohne MINRUN/PEEL | 1039 | 79 | 0 |
| eine Richtung je Linie (Gegenprobe) | 963 | 90 | S-Bahn-Lücke bleibt (2 freie Enden S3), Hauptbahnhof/Ostbahnhof-Doppelstriche weg |
| eine Richtung + ohne MINRUN/PEEL | 892 | 108 | 0 |

„Kreuzungen“ zählt auch echte Kreuzungen verschiedener Strecken, ist also nur als Vergleich zwischen Varianten zu lesen. Die Spitzenzahl steigt bei „eine Richtung“ leicht: dort fehlen die Nachbar-Gleise als Stütze beim Glätten. Das ist ein Hinweis, dass die Richtungswahl nicht allein reicht, aber U1 trifft die sichtbarsten Fehler.

## 4. Lösungsvorschlag (Reihenfolge)

1. **Pro Linie nur eine Gleisfolge (Richtung) in den Graphen geben** (Vorverarbeitung vor `gruppe()`), und die Gegenrichtung nur für Abschnitte, die die gewählte nicht abdeckt (Varianten, Äste). Das beseitigt U1 an der Wurzel; die Heuristiken für Doppelgleise (MINRUN, PEEL, „lose Doppel“, Inseln, Blasen) werden zum größten Teil überflüssig und können gelöscht statt verschärft werden. Der Probelauf dazu liegt als Skript-Idee vor (Gleisnähe-Raster 40 m, Relationen nach Länge).
2. **Fehlende Knoten schließen**: Wo ein Strich an einem freien Ende endet und im Abstand ≤ ~25 m ein Strich derselben Linie beginnt, beide am Mittelpunkt verbinden (gemeinsamer Knoten) und die Rampe darüber legen (U3).
3. **Rampe und Versatz in derselben Einheit**: den Versatz nicht in 0,2-Plätze-Stücken halten, sondern Versatz in Metern in die Form rechnen (wie in NYC, `subForm`/`subRamp`), oder zumindest die Rampenlänge zoomabhängig machen (U4/U5).
4. **Reihenfolge global festlegen** (z. B. Rang je Linie entlang der Strecke aus einem Durchlauf, nicht je Stück), Rampen nur dort, wo Linien wirklich abzweigen (U6).
5. **Prüfwerkzeug erweitern** (`pruefen.mjs`): zählt (a) Linie zweimal im selben Korridor, (b) freie Enden außerhalb der Netzränder, (c) Kreuzungen innerhalb eines Bündels. Diese drei Zahlen als Abnahme für jede Änderung, vor allem vor Pushes auf die Linienkarte. Sonst bleibt es beim Nachbessern an der falschen Zahl.
6. Kurzfristig, falls es schnell gehen soll: `LKMINRUN` von 150 auf 40 m stellt Friedrichstraße her und senkt die Spitzenzahl im Auszug; Westhafen bleibt 0 (nur am Berlin-Auszug getestet, ganz Deutschland nicht).

## 5. Grenzen dieser Analyse

- Ausgewertet wurde nur der Berlin-Auszug (`dbg-berlin.osm.pbf`) und die ausgelieferte `de.pmtiles` für diese drei Stellen. Aussagen zu Bremen/anderen Städten sind nicht belegt.
- Die Zuordnung Screenshot ↔ Koordinate ist aus Straßennamen geschlossen. Die Lücke bei Friedrichstraße ist in beiden Datenquellen identisch zum Screenshot, bei Ostbahnhof und Hauptbahnhof passen Form und Linien.
- Die Zeichnungen simulieren `line-offset` (Gehrung begrenzt) mit festem Meterwert je Platz; die echte App rechnet in Pixeln. Die Probeläufe ändern nichts am Repository.
- Eine Verbesserung der Spitzenzahl und der Kreuzungen im Probelauf ist ein Hinweis, kein Beweis, dass die App danach fehlerfrei aussieht.
