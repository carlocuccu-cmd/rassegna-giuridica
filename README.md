# Rassegna — sistema funzionante

🌐 **App online:** https://carlocuccu-cmd.github.io/rassegna-giuridica/rassegna.html
📦 **Repository:** https://github.com/carlocuccu-cmd/rassegna-giuridica

Web app personale per seguire gli aggiornamenti giuridici (Cassazione, TAR, Consiglio di Stato,
Gazzetta Ufficiale, EUR-Lex) con feed leggibile e lettura vocale, pensata per essere ascoltata in auto.

## Cosa c'è in questa cartella
- `rassegna.html` — interfaccia (feed + lettura vocale). Carica i dati da `feed.json`.
- `feed.json` — aggiornamenti reali, generati dall'ultima esecuzione di `fetch-feeds.js`.
- `fetch-feeds.js` — scraper funzionante per le fonti reali (vedi sotto). Genera `feed.json`.
- `server.js` — server statico minimale per servire l'app in locale (`node server.js`).
- `package.json` — dipendenza `cheerio` per il parsing HTML.

## Stato delle fonti
| Fonte | Stato | Selettore/endpoint |
|---|---|---|
| Corte di Cassazione (civile + tributaria) | ✅ funzionante | `cortedicassazione.it/it/giurisprudenza_civile.page`, classe `.card-news` |
| TAR + Consiglio di Stato | ✅ funzionante | homepage `giustizia-amministrativa.it`, box `.box-ufficio-massimario` |
| Gazzetta Ufficiale | ✅ funzionante | homepage `gazzettaufficiale.it`, lista `#cn_list .home_notizia` (esclusi i bandi di concorso) |
| EUR-Lex (Gazzetta UE serie L) | ⚠️ non funzionante | il sito è protetto da un sistema anti-bot (Akamai) che risponde 202 senza contenuto a richieste non-browser; servirebbe un browser headless (Playwright/Puppeteer) per superarlo. Lo scraper è presente e degrada correttamente a 0 risultati senza bloccare le altre fonti. |

## Uso
```
npm install
node fetch-feeds.js      # aggiorna feed.json con dati reali
node server.js            # serve l'app su http://localhost:8080
```

## Esecuzione periodica e pubblicazione
È attiva un'attività di Task Scheduler di Windows chiamata **RassegnaGiuridica-FetchFeeds**:
ogni 3 ore esegue `update-and-publish.ps1`, che genera `feed.json` con dati reali e, se è
cambiato qualcosa rispetto all'ultima pubblicazione, fa commit + push su GitHub — questo
aggiorna automaticamente anche la versione online (GitHub Pages). L'esito di ogni run è in
`fetch-log.txt`. Il task gira solo quando l'utente è loggato (nessuna password salvata; il push
usa le credenziali configurate da `gh auth login` / `gh auth setup-git`). Per gestirlo:
```
Get-ScheduledTask -TaskName "RassegnaGiuridica-FetchFeeds" | Get-ScheduledTaskInfo   # stato/ultimo esito
Start-ScheduledTask -TaskName "RassegnaGiuridica-FetchFeeds"                          # esegui subito
Disable-ScheduledTask -TaskName "RassegnaGiuridica-FetchFeeds"                        # sospendi
Unregister-ScheduledTask -TaskName "RassegnaGiuridica-FetchFeeds"                     # rimuovi
```
Nota: gira solo mentre il PC è acceso e l'utente ha fatto login (non a schermo spento/spento).
Se serve aggiornamenti anche a computer spento, va spostato su un servizio esterno come GitHub Actions
(il sito online resterebbe comunque raggiungibile nel frattempo, solo con dati non aggiornati).

## Passi successivi (facoltativi)
1. **EUR-Lex**: se serve davvero, va riscritto con Playwright per superare l'anti-bot.
2. **Aggiornamenti a computer spento**: spostare `fetch-feeds.js` su GitHub Actions con uno
   schedule cron, così il sito resta aggiornato anche senza questo PC acceso.

## Criterio di validazione (da tenere a mente)
Prima di espandere fonti o raffinare il tagging: usalo per due settimane reali, in auto, con la
modalità vocale. Se lo consulti davvero più spesso di quanto facessi con le newsletter, vale la
pena investire nella versione completa (più fonti, classificazione automatica, persistenza, note
personali).
