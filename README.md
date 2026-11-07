# NC-Tracker

Notendurchschnitt (NC) berechnen, Stundenplan hochladen, mit Klasse oder Freunden vergleichen.

- **Stundenplan hochladen** (Foto, Screenshot, PDF oder Text): Fächer werden automatisch erkannt. Du hakst ab, welche du übernimmst.
- **Fächer ein- und ausschließen**: pro Fach „zählt zum NC“ an/aus, Leistungskurse zählen doppelt.
- **Noten oder Punkte**: 1–6 (mit 1−, 2+ …) oder 0–15 Punkte. Klausuren zählen doppelt, Tests und mündlich einfach.
- **Gruppen**: Gruppe erstellen, Einladungslink teilen, beitreten per 6-stelligem Code.
- **Rangliste**: Podium, Platz, Gruppenschnitt, Abstand zu Platz 1, Wertung nach Gesamt-NC oder einzelnem Fach.
- **Privatsphäre**: Einzelnoten lassen sich ausblenden, dann sehen andere nur den Gesamt-NC. Rangliste nur für Gruppenmitglieder.
- Kein Login: Jedes Gerät bekommt einen geheimen Schlüssel. Mit dem Geräte-Code (Profil → Kopieren) nimmst du dein Profil aufs Handy mit.

Ohne Datenbank läuft die App im **Demo-Modus** (alles nur im Browser, Beispiel-Rangliste).

## Einrichten (ca. 5 Minuten, kostenlos)

### 1. Datenbank (Supabase)
1. Auf [supabase.com](https://supabase.com) kostenlos anmelden → **New project**.
2. Links **SQL Editor** → **New query** → Inhalt von [`supabase-setup.sql`](supabase-setup.sql) einfügen → **Run**.
3. **Project Settings → API**: `Project URL` und den `anon public` Key kopieren.
4. Beides in [`config.js`](config.js) eintragen und committen.

Der `anon` Key darf öffentlich sein: Die Tabellen sind gesperrt, die App kommt nur über die Funktionen im SQL-Skript an die Daten, und jede Änderung braucht den geheimen Schlüssel des jeweiligen Profils.

### 2. Online stellen (GitHub Pages)
Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch `main`, Ordner `/ (root)` → **Save**.
Nach ca. 1 Minute läuft die App unter `https://<dein-name>.github.io/nc-tracker/`.

## Dateien
| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css` | Oberfläche |
| `app.js` | App-Logik (NC-Berechnung, Gruppen, Rangliste, Stundenplan-Import) |
| `subjects.js` | Fächerliste mit Kürzeln und Erkennung |
| `config.js` | Supabase-Zugangsdaten |
| `supabase-setup.sql` | Datenbank-Tabellen und Funktionen |

## Berechnung
- Fachschnitt = gewichteter Mittelwert der Noten (Klausur ×2, sonst ×1).
- Punkte werden für den NC umgerechnet: Note = (17 − Punkte) / 3.
- NC = Mittelwert der Fachschnitte aller Fächer mit „zählt zum NC“, LK doppelt.
- Niedriger ist besser. Gleicher Schnitt = gleicher Platz.
