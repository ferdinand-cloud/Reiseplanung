# Fehlerprotokoll

Regel (Ferdinand, 01.11.2026): Erst herausfinden, **warum** ein Fehler aufgetreten ist, und die Ursache hier festhalten. Danach beheben und die Lösung dazuschreiben.
Ein Eintrag je Fehler, neueste oben. Felder: Datum · Meldung · Ursache (mit Beleg) · Lösung · Commit/Version · Test.

---

## 2026-11-02 · Fähren dick gestrichelt statt fein (alle Städte)

**Meldung:** Ferdinand 01:23: Fähren sollen nicht dick gestrichelt sein, sondern fein in einem Blauton, der sich vom Wasser abhebt.

**Ursache:** Gestaltungsvorgabe aus der Anfangszeit (NYC-Fähren): `OV.dash.ferry` [3,2], Breite bis 3,2 px plus weißer Rand (`ovCase`) und Himmelblau #1BA1E2, das dem hellen Wasser (#A9D3F2) ähnelt. Paket-Fähren nahmen zudem die Datenfarbe, die Linienkarte zeichnete Fähren so dick wie Bahnen.

**Lösung (v503):** Eine Fährfarbe überall (`OV.col.ferry` = Petrolblau #08809A; auch Stationen und Linienkarte), durchgezogen (Strichelung entfernt), fein (`OV.w.ferry` 0,5–1,7 px, auch in `lnWidth` für die Linienkarte), ohne weißen Rand. Abstand zur Wasserfarbe hell/dunkel deutlich.

**Test:** „Fähren fein in Petrolblau statt dick gestrichelt …“; „Linienfarben …“ angepasst (Rand nur noch unter Bahnen).

---

## 2026-11-02 · Bündel in Kurven: Abstände schwanken, Linien kreuzen, graue Geisterlinie (Chicago Loop, Vergleich Apple)

**Meldung:** Ferdinand 01:22 (3 Screenshots): Bei Apple bleiben die Abstände in der Kurve gleich (konzentrische Bögen). Bei uns kreuzt Grün in der Kurve Lake/Wabash die anderen Linien, Abstände schwanken, an Wells/Van Buren eine graue Linie.

**Ursache (an den echten Chicago-Paketdaten geprüft):**
1. **Jede Linie hat ihren eigenen Verlauf.** Die Stadtpakete übernehmen je Linie den Fahrplan-Verlauf (GTFS-Shape). Auf derselben Strecke liegen diese einige Meter auseinander und schneiden Ecken verschieden ab (Lake/Wabash: 4 verschiedene Eckpunkte für 5 Linien). `line-offset` versetzt aber den eigenen Verlauf jeder Linie → Abstände schwanken, in der Kurve kreuzen sich Linien; der weiße Rand eines abweichenden Verlaufs scheint als graue „Geisterlinie“ durch.
2. **Plätze doppelt vergeben.** `lnSlots` verteilte Plätze stadtweit nach Reihenfolge (bei > 5 Linien `i % 5 − 2`): Brown und Purple hatten beide −1 und lagen im Loop übereinander.
3. **Zeichenrichtung.** `line-offset` wirkt nach rechts der Zeichenrichtung; im Loop fahren Linien gegenläufig → gleicher Platz landet auf verschiedenen Seiten (gefunden beim Gegenprüfen: Brown verschwand unter Orange).

**Lösung (Stadtpaket-Bau `tools/stadtpakete/buendel.mjs`, App v503):**
- Gemeinsame Grundlinie: Linien nacheinander (längste zuerst); läuft eine Linie ≥ 40 m neben schon gelegten (≤ 12 m, ähnliche Richtung), übernimmt sie deren Punkte samt Ecke. Stärker abgeschnittene Ecken werden überbrückt, wenn dieselbe Grundlinie danach passend weitergeht. Kurze Berührungen (flache Kreuzungen) bleiben – Lehre aus Berlin 01.11. Übernahme nur zusammenhängend (kein Sprung auf die Gegenrichtung einer Schleife).
- Einheitliche Richtung: übernommene Abschnitte laufen in Richtung der Grundlinie (gegenläufige werden umgedreht); die App verbindet solche Stücke nur noch Ende an Anfang (`lnClean(…, keep)`), ohne sie umzudrehen.
- Doppelte Stücke derselben Linie (Hin-/Rückrichtung mit verschiedenen Ecken) fallen weg.
- Plätze je Bündel: Linien, die ≥ 100 m teilen, bekommen verschiedene Plätze (0, −1, +1 …), je zusammenhängendem Bündel mittig (2 Linien ±0,5). Im Paket als `O` je Linie; ältere Pakete wie bisher.
- Geprüft: Chicago Loop 5 Linien = 5 Plätze, Lake/Wabash und Wells/Van Buren konzentrisch ohne Kreuzung und ohne Geisterlinie (Bilder `vorher-nachher-chicago-lake-wabash-buendel.png`, `vorher-nachher-chicago-wells-vanburen-buendel.png`, links vorher, rechts nachher). Paris/London/Berlin/Bremen: keine Linie länger als vorher (keine Umwege).

**Wirksam:** sobald die Stadtpakete neu gebaut sind (GitHub Action „Stadtpakete“ nach diesem Push). Linienkarte (Deutschland, PMTiles) hat einen eigenen Bündel-Bau und ist nicht betroffen.

**Test:** „Bündel in Kurven wie Apple Karten: gemeinsame Grundlinie, gleiche Abstände, feste Reihenfolge, keine Geisterlinie (Chicago Loop)“.

---

## 2026-11-01 · Volltests v500/v501: „Tastatur im Chat … Zweites Antippen“ und „Linienkarte Bremen … Ausgeblendete Linie“ (wackelig)

**Meldung:** Klicktests 41362688170 (v501): „Zweites Antippen: Eingabe springt statt zu gleiten: 844,844,844,731,466,…“. Klicktests 41360681163: „Ausgeblendete Linie bleibt in der Linienkarte“ (Bremen); im selben Lauf der Chat-Test erst im 2. Versuch. Beide lokal und in anderen Läufen grün; die App-Änderungen dieser Runde (Karte/Busse) berühren beide Stellen nicht.

**Ursache:** Testaufbau, nicht die App.
- Chat: Die Eingabe gleitet zeitgesteuert (`chSetH`, Ease-out). Zwischen den Bildern 731 (30 %) und 466 (Ziel) lag ein einzelnes langes Bild des CI-Rechners – die Zwischenlagen fallen dann zwangsläufig weg. Der Last-Schutz des Tests zählte nur, ob **mehr als 2** der ersten 12 Bilder > 60 ms dauerten; ein einzelnes langes Bild mitten in der Bewegung blieb unerkannt.
- Bremen: Nach dem Ausblenden wartete der Test fest 300 ms und fragte dann die gezeichneten Linien ab. Unter Last ist das neue Bild dann noch nicht gezeichnet.

**Lösung:** Chat-Test misst die Dauer jedes Bilds; liegt während der Bewegung (vom ersten bewegten Bild bis zum Ziel) ein Bild über 60 ms, wird das Gleiten nicht beurteilt (Endlage wird weiter geprüft). Bremen-Test wartet gezielt, bis die Linie aus dem gezeichneten Bild verschwunden ist (höchstens 4 s), statt fester Wartezeit.

**Commit/Version:** siehe nächster Commit (nur Tests). **Test:** beide Tests lokal grün.

---

## 2026-11-01 · Bushaltestellen beim Rauszoomen unsichtbar (Chicago, Vergleich Apple)

**Meldung:** Ferdinand 00:34 (4 Screenshots): Bushaltestellen erscheinen erst mit dem Symbol; etwas weiter draußen sieht man nicht, wo Busse halten. Apple zeigt davor kleine Punkte.

**Ursache:** Bushaltestellen hängen an `dst-ic` (Symbol) und sind dort erst ab `OV.z.busStop` (15,5) im Filter. Der Kreis `dst` zeigt nur Bahnstationen (`inS` ohne Bus) und endet bei Zoom 14. Zwischen Busliniensichtbarkeit (13,5) und 15,5 gab es also keine Darstellung der Haltestelle.

**Lösung:** Neue Ebene `dbst` (Kreis in Busblau, weißer Rand) für Bushaltestellen von Zoom 14 bis 15,5, danach übernimmt das Symbol. Antippbar (in `DSTL`). Stärken in `OV.w.busDot`/`busDotRim`.

**Commit/Version:** 89c0618 · SW v502 · **Test:** „Busse auf der Straße …“ (Teil Haltestellen: Punkt bei 14,6, Symbol bei 16,2) – schlägt mit dem alten Stand fehl.

---

## 2026-11-01 · Buslinien neben der Straße, durch Häuser, am Fluss, mehrere Striche (Chicago)

**Meldung:** Ferdinand 00:29–00:31 (4 Screenshots): 36 Broadway neben der Wells Dr, Busse an der LaSalle-Brücke über dem Fluss, mehrere Striche nebeneinander. Gewünscht (Antwort „B“): je Fahrtrichtung eine Linie in der Mitte ihrer Fahrbahnseite wie bei Apple am Columbus Dr.

**Ursache:** Die Busverläufe im Stadtpaket kommen aus den GTFS-`shapes` des Betreibers (CTA). Diese sind ungenau (oft 10–30 m neben der Straßenachse, Ecken abgekürzt) und je Richtung ein eigener, leicht versetzter Verlauf → mehrere Striche. OpenStreetMap-Verläufe wurden bisher nur für Linien ohne Verlauf (Luftlinien, `_st`) eingesetzt (`osmFill`). Eine Fahrtrichtung kannte das Paket gar nicht, deshalb konnte die App nicht je Richtung zeichnen.

**Lösung:**
- Paketbau (`tools/stadtpakete/bus.mjs`, `osmBus` in build.mjs): Für jede Buslinie mit OSM-Relation (gleiche Nummer) kommen die Straßenachsen aus OSM. Die Fahrtrichtung je Weg ergibt sich aus der Reihenfolge der Relation (Anschluss an den Vorgänger). Wege, die in beide Richtungen befahren werden, gehen hin und zurück als zwei gerichtete Striche hinaus (`GD = 1`), Einbahnstraßen/getrennte Fahrbahnen (eigener OSM-Weg) mittig (`GD = 0`). Aufeinanderfolgende Stücke werden verkettet. Übernommen wird nur, wenn OSM den GTFS-Verlauf abdeckt (≥ 85 % der Punkte ≤ 40 m), sonst bleibt GTFS.
- App: gerichtete Stücke als eigenes Objekt (`sd = 1`), `line-offset` = 3,5 m rechts der Achse (Rechtsverkehr), in Pixel je Zoom und Breitengrad umgerechnet (exponentiell). Gilt für alle Stadtpakete außer London (dort eigener Bau, Linksverkehr).
- Geprüft mit Testdaten (Wells Dr); echte Pakete baut die Action „Stadtpakete“ neu, Ergebnis im Log „Busse auf der Straße (OpenStreetMap)“.

**Commit/Version:** 89c0618 · SW v502 · **Test:** „Busse auf der Straße wie Apple Karten …“.

---

## 2026-11-01 · Linienkarte Berlin: Spitzen, Zacken, Zickzack und Knick am Abzweig (A100, Freiheit, Westhafen, Bornholmer Straße, Gesundbrunnen)

**Meldung:** Ferdinand 00:17 (6 Screenshots): S41 mit Spitze an der A100, S9 mit Zacke an der Freiheit, S41/S42 laufen bei Westhafen als zwei Striche mit Zickzack, Abzweige an Bornholmer Straße und Gesundbrunnen mit spitzem Knick.

**Ursache (geprüft im Code und im Berlin-Auszug):** In Berlin zeichnet die Linienkarte (`tools/linienkarte/graph.mjs`), nicht das Stadtpaket. Sie legt parallele Gleise zu einer Mittellinie zusammen: Jeder Punkt eines Gleises rastet auf den Knoten eines fremden Gleises ein, wenn der ≤ 28 m quer und ≤ 32° schräg liegt; mit Hysterese hält er bis ~40 m. Eingerastete Läufe wurden erst unter 40 m wieder gelöst.
- Flach kreuzendes fremdes Gleis (A100, Freiheit): die Linie rastet 50–130 m darauf ein → Spitze.
- S-Bahn-Gleise neben Fern-/Regionalgleisen in 25–40 m Abstand (Westhafen): abwechselnd ein- und ausgerastet → Zickzack, zwei Striche.
- Abzweig (Bornholmer Straße): die Hysterese hält die abzweigende Linie im Bündel, bis die Gleise ~40 m auseinander sind, dann springt sie mit Knick hinüber.
Der bisherige Knick-Zähler (nur Knicke > 60°) meldete 0, weil diese Spitzen bei 30–45° liegen. Map-Matching (Vorschlag) hätte nicht geholfen: die Linien liegen schon auf echten OSM-Gleisen.

**Lösung (nur Linienkarten-Bau, bisherige Fixes 941a295/e10e506 unverändert):**
- Zusammengelegt wird nur, was mindestens 150 m nebeneinander läuft (`MINRUN`); kürzere Läufe lösen sich.
- Wo sich die Gleise wirklich trennen (danach ≥ 150 m frei), rollt der Lauf am Ende auf, solange der Abstand schon > 12,6 m ist: der Abzweig verlässt das Bündel früh und im Bogen statt bei 40 m mit Knick.
- Kurze Lücken im Bündel bis 200 m (Bahnhöfe, wo die Gleise kurz auseinanderlaufen) werden überbrückt, wenn beide Seiten am selben Gleis hängen.
- Neue Prüfung `tools/linienkarte/pruefen.mjs`: je Linie (über Stückgrenzen) Abweichung von der Sehne > 5 m auf 50 m = Spitze/Zacke. Berlin-Auszug: Westhafen 3 → 0, Gesundbrunnen/Bornholmer 13 → 10, gesamt 79 → 86 (Rest meist echte Weichenfelder Ostkreuz/Friedrichstraße, dort neu 2 Bündel statt 1). A100 und Freiheit liegen außerhalb des Prüfausschnitts, dort greift dieselbe Regel (Test mit flacher Kreuzung).
- Bilder: `fehlerprotokoll/bilder/vorher-/nachher-berlin-westhafen-linienkarte.png`.

**Offen:** Ostkreuz und Friedrichstraße zeigen weiter Knoten, wo sich Bündel kreuzen bzw. teilen; nach Ferdinands Prüfung auf dem iPhone gezielt weiter.

**Commit/Version:** 9c5877b (nur Linienkarten-Bau, App unverändert) · Linienkarte neu gebaut (GitHub Action „Linienkarte“) · **Test:** „Linienkarte-Bau: keine Spitzen an flach kreuzenden Gleisen …“ – schlägt mit dem alten Stand fehl (2 Spitzen).

---

## 2026-11-01 · Bündel ohne Lücken: Linien liegen direkt aneinander (Chicago Loop, Vergleich Apple)

**Meldung:** Ferdinand 00:25 (Screenshots Apple vs. App): Bei Apple sind zwischen nebeneinanderliegenden Linien kleine weiße Lücken, bei uns nicht.

**Ursache:** Abstand je Platz im Bündel (`OV.w.off`) war kaum größer als die Linienbreite: Zoom 16 Bahn 3 px breit, Abstand 3,3 px → 0,3 px Lücke; Zoom 14: 2 px breit bei ~2,6 px Abstand. Der weiße Rand (`ovCase`, eigene Ebene unter den Linien) lag dadurch vollständig unter der Nachbarlinie.

**Lösung:** `OV.w.off` = Linienbreite + Lücke je Zoom (12: +0,7 · 14: +1,1 · 16: +1,5 · 18: +1,9 px). Die Lücke ist schmaler als der doppelte weiße Rand, also durchgehend weiß. Alles, was mit `OV.w.off` rechnet, wandert mit: New Yorker Versatz in der Form (v491), Linienkarte, Stadtpakete, Transitland, Stationspunkte (v500; Bezug Zoom 16 jetzt `ovAt(OV.w.off, 16)` statt fest 3,3). Bündel werden etwas breiter (5 Linien bei Zoom 16 ≈ 18 statt 13 px).

**Commit/Version:** afad588 · SW v501 · **Test:** „Lücken im Bündel wie Apple Karten …“ – schlägt mit dem alten Stand fehl (Lücke 0,3 px).

---

## 2026-11-01 · Volltest v500: „Grafikkarte … Stationen bleiben nach Ausschalten“ (wackelig)

**Meldung:** Klicktests-Lauf 41356154270 (main 7514d3c, v500): ein Test rot, beide Versuche, Lauf mit 704 s deutlich langsamer als sonst.

**Ursache:** Nicht durch v500 verursacht: Der Commit ändert nur Stadtpaket-Stationspunkte (ddot, dst), nicht die New-Yorker Stationsquelle `subst`, die der Test prüft. Einzeln lokal 4× grün (auch mit dem Vortest „Routenoptionen“), Wiederholung desselben Commits in der Action grün. Genaue Zeitursache unter Last nicht reproduzierbar; Verdacht: Kartenstil wird unter Last nachgeladen, während `stSet(false)` läuft (`mapReady`/alte Quelle).

**Lösung:** Keine Code-Änderung. Wiederholung des Laufs bestanden. Bei erneutem Auftreten: Test auf `mapReady` und frische Quelle warten lassen.

**Commit/Version:** v500 (7514d3c), Lauf 41356154270 Versuch 2 grün.

---

## 2026-11-01 · Chicago Loop anders als Apple: Bündel fehlt, Busnetz zu dicht und dunkel, Nummern scheinbar auf falscher Linie, keine Stationen

**Meldung:** Screenshots 20:10 (App vs. Apple Karten, Loop): Apple zeigt den Hochbahn-Ring als Bündel aus fünf Farben, Bahn kräftig, Busse dünn/hell und in der Übersicht nur wenige, Beschriftung „8 Halsted“; die App einen einzelnen orangen Ring, ein dichtes dunkles Busnetz, lose Nummern in verschiedenen Farben („146/148“ an der roten, „851“ an der blauen Linie), keine Stationen.

**Ursache:**
- Der Screenshot zeigt noch Transitland (Hinweis „ÖPNV: Transitland“ unten): das Chicago-Paket (v497, 19:21 live, Paket 19:31 veröffentlicht) war auf dem iPhone noch nicht geladen (alte App-Version im Speicher). Transitland zeichnet ohne Versatz (`TLO = 0`, Absicht seit 30.10.), deshalb liegen die fünf Loop-Linien deckungsgleich übereinander und nur die oberste ist sichtbar. Mit dem Paket liegen sie nebeneinander (geprüft: Bild nachher-chicago-loop-z14).
- „Falsche Nummern“: die Beschriftung `tl-lbl` war Text in der Datenfarbe der jeweiligen Linie. CTA färbt Expressbusse rot (#B71234), 146/148 fahren auf derselben Straße wie eine Bahnlinie → rote Nummern an einer roten Linie wirken wie deren Name. Die Nummer gehörte zum dünnen Bus daneben.
- Busnetz: alle Buslinien ab Zoom 13,5 gleichzeitig, mit v497 zudem kräftiger und breiter gemacht (Aufgabe 24) – in der Übersicht zu viel.
- Stationen: in Transitland-Städten liefert `tlStopsOf()` Stationen erst ab Zoom 12 und nur aus den gezeichneten Linien; im Paket sind sie da (Name ab Zoom 12, Symbol ab 14).

**Lösung (v498):**
- Busse dünner als jede Bahn (Breite 0,8 px bei Zoom 14 statt 1,3) und etwas durchsichtiger (80 %); Farbe bleibt Busblau (helleres Blau war von der Fähre nicht mehr zu unterscheiden, Test „Linienfarben“).
- Zoomstufen wie Apple: unter Zoom 15 nur Hauptbusse (das Drittel mit dem dichtesten Takt werktags, aus den Wartezeiten `W` des Pakets), ab Zoom 15 alle (`BUSALL`, Filter auf `dbus`/`dbus-lbl`).
- Transitland-Beschriftung als Plakette in der Farbe der eigenen Linie (Busse in Busblau, `TLLBL`), wie bei den Paketen; als Bild statt Kartenschrift, dadurch auch ohne Schriftdatei.
- Bündel für Transitland bleibt aus (Begründung oben); dafür Städte als Paket aufnehmen.

**Nachtrag Stationen (17, Ferdinand 21:47 „Ja, jetzt umsetzen“, v499):** Ursache, warum es bisher keinen Punkt je Linie gab: die Station war ein einzelner Kreis bzw. ein Symbol am Stationsort; die Linien liegen aber per `line-offset` (Platz × `OV.w.off`, wächst mit dem Zoom) neben der Mittellinie, also neben diesem Punkt. Lösung: `lnDots()` sucht je Station und Linie den nächsten Punkt der Linie (≤ 80 m) und die Richtung des Abschnitts; Ebene `ddot` zeichnet dort einen Punkt in Linienfarbe mit weißem Rand. Der Versatz steckt im Bild (`pd|Farbe|Platz`, Bezug Zoom 16), gedreht auf die Seite der Linie (`icon-rotate`, an der Karte ausgerichtet) und mit `icon-size` im selben Verhältnis wie `line-offset` skaliert – der Punkt sitzt so bei jedem Zoom auf seinem Strich. Stationen mit Punkten zeichnen keinen Kreis und kein Symbol mehr darüber (Merkmal `dd`), der Name bleibt. Gilt für Stadtpakete und OpenStreetMap-Linien; die Linienkarte (eigene Versätze im Bau) bleibt wie bisher.
Folgefehler im Volltest (v499, „Stadtpakete: Berlin“): Ursache – die Punkte ersetzten Kreis und Symbol, folgten aber nicht der Zoom-Rangfolge der Stationen (weit weg nur Umstiegsknoten) und waren nicht antippbar (Tipp-Suche `dstAt` kannte nur `dst`/`dst-ic`). Lösung v500: Punkte mit Stationsname und Bedeutung, gleicher Zoomfilter `stZ` wie der Kreis, Ebene `ddot` in `DSTL` (antippbar); Test prüft Antippen.
Nebenbei behoben (beim Prüfen gefunden): ein Zeilenkommentar `//` mitten in der Filterzeile hätte die Filter für Symbol und Name abgeschaltet – vor dem Push korrigiert.
Commit 77a2e68 · SW v499 · Test: „Stationen wie Apple Karten: auf jeder Linie des Bündels ein Punkt in Linienfarbe …“.

**Commit/Version:** c0e5d80 · SW v498 · **Test:** „Busse wie Apple Karten …“ erweitert (Übersicht nur Hauptbus, nah alle; Bus dünner als Bahn; Paket hat Vorrang vor Transitland; Transitland-Plakette).

---

## 2026-11-01 · Buslinien roh gezeichnet: lose Enden, schräge Abkürzungen, neben der Straße, Richtungen übereinander (Chicago, Vergleich Apple Karten)

**Meldung:** Screenshots Chicago N Columbus Dr / E Randolph: Buslinien laufen neben der Straße und über Gehwege, kürzen an Kreuzungen schräg ab, haben lose Enden und Haken; beide Richtungen liegen übereinander; Liniennummern als gedrehter Text auf der Linie. Apple: je Linie ein Strich, jede Richtung auf ihrer Seite, Plakette mit Nummer + Name in Linienfarbe („20 Madison“).

**Ursache:** Busse werden ohne jede Aufbereitung direkt aus den Quellen gezeichnet:
- Transitland (`tl-bus`): die Linie kommt so, wie sie in den Vektorkacheln steht. Die Kacheln enden bei Zoom 14 und sind dafür vereinfacht (Douglas-Peucker); bei Zoom 16–17 werden sie nur vergrößert. Vereinfachte Ecken = schräge Abkürzungen über Kreuzungen und Abweichungen von bis zu einigen Metern neben die Straße. Je Linie liegen Hin- und Rückweg als ein Objekt übereinander; Abweichungen einzelner Fahrten (Umleitungen, Depotfahrten) bleiben als Haken und lose Enden stehen.
- Stadtpakete/OpenStreetMap (`dbus`): je Linie ein Objekt mit allen Verläufen (beide Richtungen) ohne Versatz → übereinander; ebenfalls keine Bereinigung von Stummeln.
- Alle Busebenen (`bus`, `dbus`, `tl-bus`) zeichnen in einer einheitlichen, halb durchsichtigen Busfarbe (`OV.op.bus` 0,5), nicht in der Linienfarbe; Beschriftung über `TPLINE`/`tl-lbl` als gedrehter Text.
- Für Chicago gibt es kein Stadtpaket, nur Transitland – die genauen Verläufe des Fahrplans (CTA-GTFS-Shapes, je Richtung) werden nicht genutzt.

**Beleg:** `index.html`: `tl-bus` = `type:"line"` direkt auf `source:"tl-r"` (maxzoom 14) mit fester Farbe `token("--bus")`; `cpGeo()` baut je Linie ein `MultiLineString` aller Verläufe ohne `o`; `OV.op.bus = .5`. CTA-GTFS (Mobility Database) hat getrennte Verläufe je Richtung (`trips.txt` direction_id, `shapes.txt`, 1,33 Mio. Punkte).

**Lösung (Teil 1, v497):**
- Chicago bekommt ein Stadtpaket aus dem CTA-Fahrplan (8 L-Linien, 125 Buslinien; Bauwerkzeug `tools/stadtpakete/build.mjs`, Eintrag `chicago`). Damit kommen die Busse nicht mehr aus den vereinfachten Transitland-Kacheln, sondern wie in Berlin/Paris/Bremen aus OpenStreetMap-Linienverläufen (Straßenachse, je Einbahnstraße die eigene Fahrbahn) bzw. aus den genauen Fahrplanverläufen.
- Busverläufe in allen Stadtpaketen doppelt so genau (Toleranz 4 m statt 9 m): die gröbere Vereinfachung war die Ursache der schrägen Abkürzungen an Kreuzungen.
- Neue Aufbereitung je Linie in der App (`lnClean`): Spitzen im Verlauf (hin und sofort zurück, z. B. Abstecher in Haltebuchten oder Wenden) werden geglättet, kurze Stücke mit losem Ende (Haken, Stummel bis 60 m) entfallen, aneinanderstoßende Stücke werden zu einem durchgehenden Strich verbunden (runde Ecken statt Kappen an jeder Kreuzung). Gilt für Bus (60 m) und Bahn (25 m).
- Beschriftung wie Apple Karten: Plakette mit der Nummer, daneben der Name in der Linienfarbe („20 Madison“, `tpBus`, Bild `tb|…`), wiederholt entlang der Linie, weicht anderen Beschriftungen aus.
- Farbe: alle Busse in einem kräftigen Busblau (#2F6BC8, dunkel #6FA0EA) mit 90 % Deckkraft statt gedämpft und halb durchsichtig; Linien etwas breiter. Die Datenfarben taugen nicht (CTA: Grau, Schwarz, Expressbusse rot wie die Red Line).

**Lösung (Teil 2, Prüfung mit echten Paketen nach dem Bau am 01.11., 19:31):**
- Chicago-Paket gebaut und veröffentlicht (124 Buslinien). Die CTA-Verläufe sind bereits auf die Straßenachse gelegt und je Richtung getrennt; bei Einbahnstraßen-Paaren (z. B. Madison/Washington) liegt jede Richtung auf ihrer Straße, auf Straßen mit beiden Richtungen ein Strich wie bei Apple (Aufgaben 20–22). OpenStreetMap-Verläufe braucht es dafür nicht (Bau-Log: „OSM-Verläufe Bus 0 ersetzt“ – alle Linien haben eigene Verläufe).
- Bahnbündel (25): dieselbe Aufräum-Funktion `lnClean` (Spitzen, Stummel bis 25 m, durchgehende Striche) gilt auch für Bahnlinien; Farben und Nebeneinander (`lnSlots`) bleiben.
- Haltestellen (27–29): jede Haltestelle trägt ihre eigenen Linien (gegenüberliegende Haltestellen getrennt, also je Straßenseite), sie wird auf ihre Linie gesetzt (`stSnap`, bis 80 m); Busplaketten an der Linie weichen einander und den Stationsnamen aus (MapLibre-Kollision, Abstand 420 px), Bushaltestellen erst ab Zoom 15,5.
- Bilder „nachher“: `/mnt/project-files/fehlerprotokoll/bilder/` (Chicago Loop, Bremen Hbf, Berlin Gesundbrunnen). „Vorher“ = Ferdinands Screenshots; hier nicht nachstellbar, weil Grundkarte und Transitland aus der Testumgebung nicht erreichbar sind (Bilder ohne Straßen).
- Offen: Städte ohne Stadtpaket zeigen Busse weiter aus den vereinfachten Transitland-Kacheln (Zoom 14). Abhilfe dort: Stadt als Paket aufnehmen.
- Nebenbei: Bau-Log der Stadtpakete meldete „Fahrt nicht zusammenhängend“ 600 000-mal (2,5 MB Log) → je Fahrt einmal, höchstens 20.

**Commit/Version:** 1cfbca6 · SW v497 · **Test:** „Busse wie Apple Karten: je Linie ein Strich in Busblau, Plakette mit Name („20 Madison“), ohne Haken und Stückelung (Stadtpaket Chicago)“; „Linienfarben: … Bus kräftiges Busblau …“ angepasst.

---

## 2026-11-01 · Haltestellen nur als Kreis statt Symbol mit Linien (Chicago, Vergleich Apple Karten)

**Meldung:** Screenshots Chicago (Stöbern): Bushaltestellen am N Columbus Dr sind nur Kreise. Gewünscht wie Apple Karten: Symbol des Verkehrsmittels und daneben die Linien als Plaketten, für sämtliche Verkehrsmittel.

**Ursache:** Die Apple-Darstellung (Symbol ab Zoom 14, Name, Linien-Plaketten; v471) hängt an der gemeinsamen Haltestellen-Quelle `dst` (OpenStreetMap/Overpass, Stadtpakete, Linienkarte) und an den New Yorker Stationen (`subst`). Überall, wo Transitland die Linien liefert (Chicago und alle Städte ohne Stadtpaket mit Transitland-Schlüssel), kamen die Haltestellen aber aus eigenen Ebenen `tl-st`/`tl-bst`, die nur Kreise zeichnen. Grund: Transitland-Haltestellen tragen keine Linien; `tlList()` gab deshalb eine leere Haltestellen-Liste an `dst` weiter (`st:[]`), und die Kreise blieben als Ersatz. Zusätzlich kannte das Haltestellen-Symbol (`tpMode`) nur drei Bilder: Bus, Fähre und ein gemeinsames für alle Bahnen (Tram, U-Bahn, S-Bahn, Zug, Seilbahn sahen gleich aus).

**Beleg:** `index.html`: `tl-st`/`tl-bst` sind `type:"circle"`; `tlList()` setzt `VV = {tr:{… st:[] …}}`; `tpMode()` hat nur die Zweige `ferry`, `bus` und „sonst“.

**Lösung:** Alle Haltestellen laufen jetzt über dieselbe Darstellung (`dst`): Symbol des Verkehrsmittels, daneben die Linien als farbige Plaketten, bei Bahnhöfen zusätzlich der Name.
- Transitland: neue Funktion `tlStopsOf()` ordnet jeder Haltestelle die Linien zu, deren Verlauf an ihr vorbeiführt (Bus bis 30 m, Bahnhof bis 120 m, über ein Raster der Linienabschnitte im Ausschnitt), nur eingeschaltete Verkehrsmittel und Linien. `tlList()` gibt sie an `dst` weiter; die Kreis-Ebenen `tl-st`/`tl-bst` bleiben aus. Steht an einer Bahnhaltestelle auch ein Bus, kommen die Buslinien als zweite Reihe dazu (wie bisher bei den Stadtpaketen).
- Bushaltestellen wie bei Apple nur Symbol + Linien, ohne Namen (`dstImg`): sonst verdrängten sich die Namen gegenüberliegender Haltestellen und eine Seite fehlte.
- Eigene Symbole je Verkehrsmittel (`tpMode`): U-Bahn (zwei Frontfenster), Tram/Stadtbahn (Stromabnehmer), Zug/S-Bahn/Regional-/Fernverkehr (runde Front, Schienen), Seilbahn (Kabine am Seil), Bus, Fähre; Farben je Art in `OV.col.sm` (S-Bahn grün, Züge grau).
Gilt für alle Städte und Quellen: Transitland, OpenStreetMap/Overpass, Stadtpakete, Linienkarte. New York nutzt dieselben Symbole.

**Commit/Version:** 1b65e00 · SW v496 · **Test:** „Haltestellen wie Apple Karten: Symbol je Verkehrsmittel und Linien-Plaketten statt Kreis, auch bei Transitland (Chicago)“.

---

## 2026-11-01 · Ort-Detail: „@Hannah_zim Outstanding“ unter Bewertungen · Freunde, mit Ferdinands Fotos, Fotos nicht antippbar

**Meldung:** Ferdinand (Screenshot): Bei einem Ort der gemeinsamen New-York-Reise steht unter „Bewertungen · Freunde · 1“ eine Bewertung von @Hannah_zim. Die Fotos sind seine eigenen, und sie lassen sich nicht antippen.

**Ursache 1 (Bewertung kommt aus der eigenen Reise):** „Freunde“-Bewertungen sind Einträge in `recs/{uid}/items` der Freunde, gefunden nur über die Lage (`friendRecs()`: < 40 m bzw. < 150 m mit gleichem Namensanfang). Hannah ist Freundin **und** Mitreisende. Ihr Eintrag wurde von ihrem Gerät aus der **gemeinsamen** Reise gebaut (`recCollect()` – Schlüssel `{Reise}_{Ort}`). Bewertung (`t.rating`) und Fotos einer Reise gibt es nur einmal für alle Mitreisenden; ihr Eintrag enthält also die Reise-Bewertung und die für Freunde freigegebenen Reise-Fotos (Ferdinands), keine eigene Meinung von Hannah. `friendRecs()` und `dcLoad()` filterten Einträge aus Reisen, die man selbst hat, nicht heraus → die eigene Reise erschien als Empfehlung von Hannah (auch in Entdecken und „… empfiehlt das“).
Warum Hannahs Gerät den Eintrag überhaupt geschrieben hat: Bis v395 gab **jedes** Mitreisenden-Gerät alle veröffentlichten Orte der gemeinsamen Reise weiter (Fehler vom 28.10., Katz's). Seit v396 nur noch das Gerät dessen, der veröffentlicht hat (`pubP[Ort] = uid`); alte Einträge löscht Hannahs Gerät erst beim nächsten Start mit neuer Version. Der Eintrag zeigt „Okt. 2026“, wurde also im Oktober geschrieben – passt zu einem alten, noch nicht aufgeräumten Eintrag. Alternativ hat Hannah die Sichtbarkeit selbst auf „Freunde“ gestellt. Welche der beiden Möglichkeiten zutrifft, ist ohne Zugriff auf die Daten nicht belegbar; die App zeigt es jetzt an (Lösung 3). Daten wurden nicht verändert.

**Ursache 2 (Fotos nicht antippbar):** `rvSection()` gab die Fotos als reine `<img>` ohne Aktion aus; die vorhandene Vollansicht für Empfehlungen (`dcFull`) wurde dort nicht verwendet.

**Lösung:**
1. Neue Funktion `recFromMyTrip(r)`: Empfehlung, deren Schlüssel mit einer eigenen Reise beginnt (`{uid}/{Reise}_…`), ist keine Freundes-Bewertung. Gefiltert in `dcLoad()`, `pubLoad()` und `friendRecs()` – damit überall gleich (Ort-Detail, „empfiehlt das“, Entdecken, Öffentlich).
2. Fotos der Bewertungen sind Knöpfe → Vollansicht `dcFull` (Wischen, ×), Schließen führt zurück zum Ort.
3. Sichtbarkeits-Menü des Orts nennt, wer veröffentlicht hat („Von dir veröffentlicht“ / „Veröffentlicht von @…“).

**Commit/Version:** e987fa0 · SW v494 · **Test:** „Bewertungen Freunde: Empfehlung aus der eigenen gemeinsamen Reise erscheint nicht als Freundes-Bewertung, Fotos antippbar, Veröffentlicher sichtbar“.

---

## 2026-11-01 · ÖPNV im Ebenen-Menü aus, Linien trotzdem auf der Karte (Stöbern, Bremen Hbf)

**Meldung:** Screenshot Stöbern-Modus, Bremen Hbf: Schalter „ÖPNV“ ist aus, RS4/RS30 und weitere Linien werden trotzdem gezeigt. Einschalten/Ausschalten ändert nichts.

**Ursache:** Schalter und Karte schauen auf verschiedene Listen. Außerhalb New Yorks zeichnet die Linienkarte (`lkApply`) jede Verkehrsart, die in den gespeicherten Einstellungen `DL` an ist (z. B. Regionalverkehr, Tram). Der ÖPNV-Schalter (`trSync`, Änderung in `$("lTr")`) zählt aber nur die Verkehrsarten, die gerade im Menü stehen (`trIds()` → `dModes()`), und die kommen aus den Overpass-/Stadtpaket-Daten des Ausschnitts. Sind die noch nicht geladen oder leer (die Linienkarte braucht sie nicht), ist die Liste leer: Der Schalter zeigt „aus“, und Ausschalten schaltet nichts aus, weil er nur Einträge der leeren Liste abhakt.

**Beleg:** Nachgestellt im Klicktest mit der Bremer Test-Linienkarte und leerer Overpass-Antwort: `DL = {tram:1, reg:1}`, `trIds() = []`, Schalter `checked=false`, Ebene `lk-de-ln` sichtbar mit 16 Linienstücken; nach Ein- und Ausschalten unverändert sichtbar.

**Lösung:** Der Schalter richtet sich nach dem, was die Karte zeichnet, nicht nur nach den Menüeinträgen (`index.html`):
- Anzeige (`trSync`): außerhalb New Yorks gilt ÖPNV als an, sobald irgendeine Verkehrsart in `DL` an ist (neue Hilfsfunktion `trDynOn()`), auch wenn das Menü sie noch nicht listet.
- Ausschalten: schaltet **alle** Verkehrsarten in `DL` aus (und Leihräder), merkt sich vorher die Auswahl.
- Einschalten bei noch leerem Menü: stellt die gemerkte Auswahl wieder her; nur ohne gemerkte Auswahl wird wie bisher nach dem Laden die erste Verkehrsart eingeschaltet.
Gilt für Stöbern und Reiseziele außerhalb New Yorks, für Linienkarte, Overpass- und Stadtpaket-Linien (alle hängen an `DL`). New York war nicht betroffen (dort steuern die Schalter die Ebenen direkt).

**Commit/Version:** be87845 · SW v495 · **Test:** „ÖPNV-Schalter zeigt und steuert, was die Karte zeigt – auch wenn das Menü die Verkehrsarten noch nicht listet (Stöbern, Linienkarte Bremen)“ – schlägt mit dem alten Stand fehl.

---

## 2026-11-01 · Berlin Gesundbrunnen/Humboldthain: Ring-Bündel S41/S42 zerfasert, Linien liegen doppelt übereinander

**Meldung:** Screenshot Humboldthain, westlich Gesundbrunnen. Wo S1/S2 nach Südwesten abzweigen, liegt das Ring-Bündel (S41/S42, Fernbahn) auf rund 80 m doppelt und leicht versetzt übereinander.

**Ursache 1 (Überlappung):** Jeder Strich wird am Knoten mit einer kurzen Fortsetzung über das Nachbarstück verlängert (`ext()` in `tools/linienkarte/graph.mjs`, gedacht: 10 m, damit die Ecke am Knoten rund ist). Die Schleife nahm aber immer den **ganzen nächsten Abschnitt** des Nachbarstücks, solange die bisherige Länge unter 10 m lag. Weil die Stücke vorher vereinfacht werden (Douglas-Peucker), sind die Abschnitte auf geraden Strecken oft 50–200 m lang. Die „10 m“ wurden so zu bis zu 200 m. Am Knoten Gesundbrunnen-West treffen das Stück mit 8 Strichen (Ring ohne S1/S2) und das mit 9 Strichen (mit S1/S2) zusammen; beide haben eine andere Bündelmitte. Jedes reichte 37 bzw. 50 m in das andere hinein → S41/S42 zweimal mit leicht unterschiedlichem Versatz übereinander.

**Ursache 2 (S1 quer übers Bündel):** Beim Prüfen der Stelle zeigte sich ein zweiter Fehler: S1 und S15 haben dieselbe Farbe und bilden im Stamm einen Strich. Am Knoten teilt sich der Strich – S15 fährt auf dem Ring weiter, S1 biegt ab. Den Platz am Anfang des Abzweigs nahm `endO()` vom **ersten** Nachbarstück mit derselben Farbe. Das war hier nicht der Stamm (Durchfahrt), sondern das Geschwisterstück (Ring weiter westlich), das am selben Knoten in dieselbe Richtung abgeht. Dessen Platz wurde wie bei einer Gegenrichtung gespiegelt (−3 → +3) → S1 setzte oben am Bündel an und lief schräg über alle Linien. Gleiches galt für die Wahl des Nachbarn beim Glätten und bei der Verlängerung.

**Beleg:** Berlin-Auszug, Bau mit Stand e10e506: Stück n=8 beginnt bei 13.38474,52.54841, Stück n=9 endet bei 13.38348,52.54832, gemeinsamer Knoten bei 13.38402,52.54816 – Überlappung ~85 m. Zählung aller Fortsetzungen im Berliner Bahnnetz: 792 länger als 10 m, davon 457 länger als 30 m, längste 199 m. Systematisch, nicht nur an dieser Stelle.

Zu Ursache 2: S1-Abzweig begann mit Platz +1,7 (oberer Rand), obwohl S1·S15 im Stamm bei −3 liegt.

**Lösung:**
1. `ext()` verlängert genau 10 m: der letzte Abschnitt wird bei 10 m geteilt statt ganz übernommen. Berlin danach: 0 Verlängerungen über 10 m (vorher 792).
2. Neue Hilfsfunktion `thru(i, head)`: Nachbarn am Knoten, Durchfahrt zuerst (Stück endet dort, wo das eigene beginnt, bzw. umgekehrt), Geschwister erst danach. `endO()`, `ext()` und die Nachbarwahl beim Glätten (`bestNb`) nutzen sie. S1 beginnt jetzt bei −1,25 und gleitet auf seinen Platz, unten am Bündel.
Geprüft im Berlin-Auszug: Bündel an der Stelle durchgehend, Knick-Zähler 0, Friedrichstraße/Hackescher Markt unverändert sauber.

**Commit/Version:** 941a295 (nur Linienkarten-Bau, App unverändert) · Linienkarte neu gebaut (GitHub Action „Linienkarte“) · **Test:** „Linienkarte-Bau: Striche reichen nur 10 m über den Knoten, Abzweig setzt auf seiner Seite des Bündels an (Gesundbrunnen S1/S15)“ – schlägt mit dem alten Stand fehl (Strich reichte 1,1 km über den Knoten). Ursache 2 hängt von der Reihenfolge der Nachbarn ab und ließ sich im kleinen Testnetz nicht erzwingen; der Test prüft aber, dass S1 am Abzweig höchstens einen Platz neben seiner Lage im Stamm ansetzt.

---

## 2026-11-01 · Dunkler Stil: Gebäude verdecken ÖPNV-Linien abschnittsweise

**Meldung:** „Die Strecken liegen teilweise unterhalb von Gebäuden oder Straßen und damit sind die Farben nicht durchgängig.“

**Ursache:** Die 3D-Gebäude-Ebene `b3d` wurde vor die erste Beschriftungsebene des Kartenstils gelegt. Der dunkle Stil hat keine frühe Beschriftung, die erste liegt erst nach den eigenen ÖPNV-Ebenen → `b3d` landete über den Linien.

**Lösung:** `apply3d` legt `b3d` vor die erste Beschriftung **oder** die erste eigene Ebene (andere Quelle als die Grundkarte), je nachdem, was zuerst kommt.

**Commit/Version:** 51a9520 · SW v492 · **Test:** „Ebenen-Reihenfolge“ erweitert (b3d unter sub/dtr/lk/rt-case, auch ohne frühe Beschriftung).

---

## 2026-11-01 · Linienkarte (Berlin u. a.): Stufen, Querstreifen, lose Enden, falsche Reihenfolge im Bündel

**Meldung:** Markierte Screenshots: S1 grüne Gabel, Hackescher Markt Querstreifen, U8 schräg im S-Bahn-Bündel. Hinweis Ferdinand: kein Einzelfall, systematisches Problem.

**Ursache:**
- Platzwechsel im Bündel sprangen an Knoten hart (Versatz je Stück fest) → Stufen.
- Stücke wurden einzeln geglättet, Enden trafen sich nicht an derselben Stelle → Versatzsprung zwischen Hauptstrecke und Abzweig.
- Winzige Stücke an Weichen und Fortsetzungen, die am Knoten umkehrten, wurden mit Versatz gezeichnet → Querstriche übers Bündel.
- Nicht eingerastete Parallelgleise, Bahnhofsebenen und Wendeschleifen blieben als lose Stummel/Inseln stehen.
- Reihenfolge im Bündel war fest (Linienliste), nicht nach Abzweigrichtung → unnötige Kreuzungen.
- U-Bahn lag in derselben Gruppe wie die Eisenbahn und rastete an parallelen S-Bahn-Gleisen ein (U8 Alexanderplatz).
- tippecanoe schnitt Linien an Kachelrändern ab; abgeschnittene Enden mit Versatz knickten quer.

**Lösung:** Platzwechsel als Rampe über 60 m, Ausgabe in Stücken ≤ 400 m / ≤ 0,2 Plätze; Glätten über Knoten, danach Knoten auf gemeinsame Stelle; keine eigenen Striche für Stücke < 20 m, keine Fortsetzung bei > 60° Knick; Stummel, Inseln, lose Doppel, kurze Schleifen entfernt; Reihenfolge aus der Geometrie (wer rechts abbiegt, liegt rechts); Seitenzweige mittig; U-Bahn eigene Gruppe; `--no-clipping`. Prüfung mit Knick-Zähler im Berlin-Auszug: 306 → 0.

**Commit/Version:** 001f338, e10e506 (Linienkarte neu gebaut 01.11. 15:45) · **Test:** „Linienkarte-Bau …“ und „Linienkarte-Bau: Reihenfolge im Bündel folgt den Abzweigen …“.

---

## 2026-11-01 · New York U-Bahn: Knicke und Stufen bei nebeneinanderliegenden Linien

**Meldung:** Screenshots NYC: Linien knicken an manchen Stellen, Zweige setzen versetzt an.

**Ursache:** Der Versatz nebeneinanderliegender Linien kam aus MapLibre `line-offset`. Das wird je Kachel berechnet: an Kachelrändern knickt die Linie, und bei jedem Platzwechsel springt der Versatz.

**Lösung:** Versatz in die Linienform selbst gerechnet (`subShare`, `subRamp` gleitet über ±40 m, `subForm` je Viertel-Zoom), kein `line-offset` mehr für die U-Bahn.

**Commit/Version:** 24adb8c · SW v491 · **Test:** NYC-Versatz-Test in `tests/smoke.mjs`.

---

## 2026-11-01 · Klicktests „Ziele“/„Neue Reise“ schlagen im Volllauf gelegentlich fehl

**Meldung:** GitHub Action „Klicktests“ rot bei Ziele-Tests, lokal einzeln grün.

**Ursache:** Unter paralleler Last kam die Anmelde-Rückmeldung erst nach Testbeginn; die Anmeldesperre legte sich dann nachträglich über die Seite. `noTripUser()` wartete – anders als `seed()` – nicht auf `acct.ready`.

**Lösung:** `noTripUser()` wartet wie `seed()` auf `acct.ready || acct.state==="unconf"`.

**Commit/Version:** 0cd3165 · **Test:** Volllauf danach grün (nur der bekannte wackelige Test „Tastatur im Chat“ offen).

---

## 2026-11-01 · Foto aus Mitteilungen schließen landet auf der Karte statt bei den Mitteilungen

**Meldung:** Mitteilungen → „Gefällt mir“ antippen → Foto öffnet sich → nach unten wischen (oder ×) → man landet auf der Karte (Ort-Pop-up über der Karte), nicht wieder bei den Mitteilungen.

**Ursache:** `ntOpen()` (Antippen einer Mitteilung, auch über die eingeblendete Meldung) schloss als Erstes die Mitteilungen-Seite (`closeNtPage()`) und öffnete Foto bzw. Ort-Pop-up dann über der Karte. Außerdem fehlte die Rücksprung-Markierung `jp.ret`: Ohne sie schließt Wischen/× nur das Foto und zeigt das Ort-Pop-up – erst dessen × führte weiter, und zwar zur Karte. Bei Listen (`ret:"list"`), Ortskarte (`"card"`) und Rückblick (`"recap"`) war das schon gelöst, die Mitteilungen waren der einzige Weg, der seine Seite vor dem Öffnen schloss. Gleiches galt für Follower-Anfragen und Einladungen aus den Mitteilungen (Fenster öffnete über der Karte).

**Lösung:** Allgemeine Regel umgesetzt: Wer Foto, Ort-Pop-up oder ein Fenster aus einer Seite heraus öffnet, legt es darüber und lässt die Seite offen. `ntOpen()` schließt die Mitteilungen nicht mehr (nur noch bei echtem Wechsel zur Karte: Mitreisende, Reise), und ein direkt geöffnetes Foto bekommt `jp.ret = "nt"`, damit Wischen nach unten und × ganz zurückführen. Gilt auch für die eingeblendete Meldung über anderen Seiten (Liste, Profil, Chats). Alle übrigen Aufrufe von `openJPop` geprüft: Liste, Ortskarte und Rückblick setzten den Rücksprung schon; die anderen Seiten-Wege („Auf Karte zeigen“ aus Chat, Suche, Liste, Ziele) sind bewusste Wechsel zur Karte.

**Commit/Version:** 56247be · SW v493 · **Test:** „Mitteilungen: Foto/Ort aus einer Mitteilung schließen (Wischen, ×) führt zurück zu den Mitteilungen“ (schlägt mit altem Stand fehl).
