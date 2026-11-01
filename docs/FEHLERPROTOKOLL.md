# Fehlerprotokoll

Regel (Ferdinand, 01.11.2026): Erst herausfinden, **warum** ein Fehler aufgetreten ist, und die Ursache hier festhalten. Danach beheben und die Lösung dazuschreiben.
Ein Eintrag je Fehler, neueste oben. Felder: Datum · Meldung · Ursache (mit Beleg) · Lösung · Commit/Version · Test.

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

**Commit/Version:** _(siehe unten)_ · SW v497 · **Test:** „Busse wie Apple Karten: je Linie ein Strich in Busblau, Plakette mit Name („20 Madison“), ohne Haken und Stückelung (Stadtpaket Chicago)“; „Linienfarben: … Bus kräftiges Busblau …“ angepasst.

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
