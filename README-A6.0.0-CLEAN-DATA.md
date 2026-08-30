# FantaAsta2.0 A6.0.0 — Clean Data

Questa è una nuova base priva di database sportivi preinstallati.

## Avvio

1. Pubblicare il contenuto del pacchetto in un repository nuovo e vuoto.
2. Aprire `Giocatori`.
3. Scaricare `Modello CSV`.
4. Compilare almeno `nome`, `club` e `ruolo` usando dati che si è autorizzati
   a utilizzare.
5. Importare il CSV o un JSON equivalente e confermare la dichiarazione.

## Perché un nuovo repository

Cancellare un file dall'ultima versione non lo elimina automaticamente dalla
cronologia Git. Un repository nuovo evita che i vecchi dataset restino
consultabili nella cronologia pubblica.

## Campi supportati

Obbligatori: `nome`, `club`, `ruolo`.

Facoltativi: `classic`, `quotazione`, `fvm`, `anno_nascita`, `attivo`.

I ruoli Mantra ammessi sono: `Por`, `Dd`, `Ds`, `Dc`, `B`, `E`, `M`, `C`,
`W`, `T`, `A`, `Pc`, anche combinati con `/`.

## Garanzie tecniche della versione

- nessun listone o dato statistico incluso;
- nessun aggiornamento automatico;
- nessuno scraping;
- nessun identificativo esterno conservato;
- nessuna data di nascita completa conservata;
- nessun URL, immagine o testo editoriale importato;
- archivio nel solo `localStorage` del browser;
- esportazione locale controllata dall'utente.

Questa impostazione riduce il rischio, ma la liceità del file scelto resta
legata alla sua licenza e alle condizioni della fonte.

## Riferimenti normativi

- Direttiva 96/9/CE sulla tutela giuridica delle banche dati:
  https://eur-lex.europa.eu/eli/dir/1996/9/oj/eng
- Regolamento (UE) 2016/679, compreso il principio di minimizzazione:
  https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
