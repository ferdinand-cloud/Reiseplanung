# Prüfkriterien
Vorbild: Apple Maps. Claude nutzt sie für die Vorprüfung, bevor Ferdinand die
Screenshots bekommt. Die Entscheidung trifft Ferdinand per Freigabe oder
Kommentar.

## Szenen (Screenshots, iPhone-Viewport 390×844, Hell-Modus)
Testreise im localStorage anlegen, Login-Sperre wie in den bestehenden Tests
umgehen, dann:
- S1 Stadtübersicht Manhattan, Zoom 12, ÖPNV-Ebene: U-Bahn + Bus + Fähre an
- S2 Midtown um Times Sq–42 St, Zoom 15, ÖPNV-Ebene an (Umstiegsknoten)
- S3 Downtown um Fulton St / Pier 11, Zoom 16, ÖPNV-Ebene an (U-Bahn, Bus, Fähre)
- S4 Planansicht eines Tages mit Fußweg + U-Bahn + Fähre, Zoom so, dass die
  ganze Route sichtbar ist
- S5 wie S4, aber Zoom 16 auf einen Umstieg

## Linien
- L0 Jede Linie ist durchgehend, ohne Lücken oder Unterbrechungen, von Endstation zu Endstation und bei jeder Zoomstufe; auch an Stationen, Kurven und beim Verschieben der Karte. (S1–S5)
- L1 Keine sichtbaren Ecken oder Zacken in Kurven; Verläufe wirken flüssig. (S2, S3, S5)
- L2 Linien folgen weiterhin erkennbar der realen Strecke. (S1–S5)
- L3 Stärke passt zur Zoomstufe: bei S1 fein und ruhig, bei S3/S5 gut lesbar, nie klobig. (S1, S3, S5)
- L4 Eigene Route (S4/S5) ist klar die dominanteste Linie auf der Karte.
- L5 U-Bahn-Linien in Originalfarbe erkennbar; Bus tritt zurück; Fähre klar unterscheidbar. (S1, S3)
- L6 Linien haben auf hellen und dunklen Flächen genug Kontrast (Casing sichtbar). (S1–S3)
- L7 Straßen- und Ortsnamen liegen über den Linien und bleiben lesbar. (S2, S3)
- L8 Keine Darstellungsfehler mit 3D-Gebäuden (Linien wirken nicht zerschnitten). (S2, S3)

## Stationen
- T1 Stationsmarker sind je Verkehrsmittel einheitlich und klar erkennbar. (S2, S3)
- T2 Verkehrsmittel-Icon ist erkennbar, bei S1 aber noch nicht überladen. (S1, S3)
- T3 Linien-Badges zeigen korrekte Kürzel und Farben der haltenden Linien. (S2, S3, S5)
- T4 Umstiegsstationen sind auf einen Blick von einfachen Stationen zu unterscheiden. (S2, S5)
- T5 Stationsnamen überlappen sich nicht und nicht mit Badges. (S2, S3)
- T6 Bei S1 ist die Karte ruhig: keine Flut von Namen, Badges oder Icons.

## Allgemein
- A1 Nichts außerhalb der Aufgabe hat sich sichtbar verändert (Vorher/Nachher-Vergleich).
- A2 Grundkarte und Navigation sind unverändert.
