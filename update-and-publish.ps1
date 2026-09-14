# Aggiorna feed.json con dati reali e pubblica su GitHub Pages se cambia qualcosa.
Set-Location $PSScriptRoot
Start-Transcript -Path (Join-Path $PSScriptRoot "fetch-log.txt") -Append | Out-Null

try {
  & "C:\Program Files\nodejs\node.exe" fetch-feeds.js

  $git = "C:\Program Files\Git\cmd\git.exe"
  & $git add feed.json
  & $git diff --cached --quiet feed.json
  if ($LASTEXITCODE -ne 0) {
    & $git commit -m "Aggiornamento automatico feed.json"
    & $git push origin master
    Write-Output "Pubblicato su GitHub Pages."
  } else {
    Write-Output "Nessuna modifica a feed.json, salto il push."
  }
} catch {
  Write-Output "ERRORE: $_"
} finally {
  Stop-Transcript | Out-Null
}
