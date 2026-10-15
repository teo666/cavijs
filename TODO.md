# TODO

Stato al 15 ottobre 2026. Branch: `d3-interaction` (cavijs) e `render-interpolation` (`../cavi`).

## Già fatto

- **cavijs:** pannello `<cavi-debug>` ed eventi di dominio, pulizia dei cavi orfani, mouse fantasma,
  fisica a passo fisso, un ciclo di frame per mondo, jack che seguono il layout, jack rimosso che rilascia i
  plug, interpolazione tra i passi fisici, cavo tenuto durante il trascinamento, sospensione dei cavi
  fermi, handle dei nodi stabili, `Cavi.destroy()` e smontaggio dei mondi rimossi, cavi creati trascinando
  che sopravvivono a un reinserimento, colori di default fissati alla creazione, plug che si aprono su un
  jack già aperto, tipo vuoto come jolly.
- **`cavi`:** `step()` separato da `build_render_data(alpha)`, parametri del passo configurabili, cavi che
  partono dritti, cavo tenuto (`pointer_radius`), sospensione, lancio al rilascio, distanza tra i nodi
  separata dal raggio, `intersect` vero, README.

## Ordine consigliato

1. Le verifiche a mano qui sotto, poi il rilascio di `cavi`: sblocca il merge su `main` e la CI.
2. L'ultima correzione di "Correttezza" (`getWasmWorld()` pubblico).
3. La CI, appena la dipendenza torna su una versione pubblicata.
4. "Più mondi nella stessa pagina" e "Packaging", solo se servono (più mondi per pagina, pubblicazione
   di cavijs su npm).
5. Il resto quando capita.

## Da verificare a mano

Cose che i test non possono dire.

- [ ] Su uno schermo a 120 Hz: i cavi si muovono fluidi e alla stessa velocità di prima? Se sembrano
      più lenti, era lo step rate: provare `<cavi-world step-rate="120">`.
- [ ] Il lancio di un cavo rilasciato nel vuoto è naturale, né troppo forte né troppo debole?
- [ ] Trascinando un plug il cavo non si stira più vicino al cursore, e gli altri cavi vengono spostati
      di quanto ti aspetti (`pointer_radius`, default 20)?
- [ ] La sospensione non blocca cavi che si stanno ancora assestando (soglia 0,01 per 30 passi).
- [ ] In un'app vera, rimuovere e reinserire un `<cavi-world>` non lascia niente di rotto.

## Rilascio di `cavi` (bloccante per `main`)

- [ ] Finire le modifiche sul branch `render-interpolation` di `../cavi`, portare la versione a 0.2.0 in
      `Cargo.toml` (oggi dice 0.1.1, ma su npm c'è già 0.1.2), `wasm-pack build --target web` e
      `wasm-pack publish`.
- [ ] In cavijs rimettere la dipendenza `cavi` sulla versione pubblicata al posto di `link:../cavi/pkg`
      (`package.json`, `pnpm-lock.yaml`). Valutare se fissarla a una versione esatta o renderla peer
      dependency, dato che cavijs dipende dal layout di memoria del buffer. L'aggiunta di `../../cavi` a
      `server.fs.allow` in `vite.config.ts` può restare: serve solo in sviluppo.
- [ ] Fare il merge di `render-interpolation` su `main` in `cavi`, e di `d3-interaction` su `main` in
      cavijs.

## Correttezza

- [ ] **`getWasmWorld()` è pubblico**: chi aggiunge o toglie cavi direttamente sul WASM fa divergere la
      lista JS da quella del motore, e i colori finiscono sui cavi sbagliati. Aggiungere un controllo in
      `addWire` e un `Wire.delete()` / `deleteWire(wire)` per non dover passare indici.

## Più mondi nella stessa pagina

- [ ] `Cavi.whenReady` usa `closest('cavi-world')`, che non attraversa lo shadow DOM (`Cavi.for` sì): un
      elemento in uno shadow root può agganciarsi al primo mondo che diventa pronto.
- [ ] `jack="id"` è risolto con `document.getElementById` (`wirewc.ts`): non funziona nello shadow DOM,
      con id duplicati in mondi diversi prende il primo, non riprova se il jack arriva dopo, e ignora
      `max-plugs`.
- [ ] Stato statico globale in `Jack` (posizione del puntatore, contatore dei drag, registro): con più
      mondi ogni `pointermove` ricalcola tutti i jack una volta per mondo, e un drag nel mondo A cambia
      l'aspetto dei jack nel mondo B. Spostare questo stato sul singolo `Cavi`.
- [ ] Un `<cavi-interaction>` messo fuori dal mondo più quello creato automaticamente dentro fanno due
      controller: un clic crea due cavi. Un solo controller per `Cavi`, o un attributo per disattivare
      quello automatico.

## Prestazioni

- [ ] `SvgRenderer` riscrive `d`, `stroke` e `stroke-width` di ogni cavo a ogni frame anche se non
      cambiano, e in debug ricrea tutti i cerchi dei nodi.
- [ ] `World.getWires()` copia l'array, e i renderer lo chiamano a ogni frame.

## Packaging e distribuzione

- [ ] La libreria non è pubblicabile: `private: true` in `package.json`, nessuno script
      `prepublishOnly`/`prepare` che costruisca `dist-lib`.
- [ ] Inizializzazione del WASM non configurabile: non si può passare l'URL del `.wasm` (CDN, CSP,
      bundler diversi da Vite), e se il caricamento fallisce ogni `<cavi-world>` resta bloccato senza
      errori e senza riprovare (`worldwc.ts`, promessa senza `.catch`). Documentare il setup per i bundler.
- [ ] Importare la libreria registra tutti i custom element, compresi `<cavi-debug>` e `<cavi-controls>`.
      Proteggere ogni `customElements.define` con `customElements.get`, aggiungere `sideEffects` in
      `package.json` e separare i punti d'ingresso (`cavijs`, `cavijs/elements`, `cavijs/debug`).

## API e usabilità

- [ ] Gli attributi di `<cavi-wire>` (`color`, `tension`, `size`, `type`) sono letti solo all'avvio: manca
      `attributeChangedCallback`. `renderType` in camelCase non può mai corrispondere (l'HTML lo porta in
      minuscolo): rinominarlo `render-type`. Anche gli attributi di `<cavi-world>` sono letti una volta sola.
- [ ] Documentare gli attributi di `<cavi-world>` (`gravity-x/y`, `step-rate`, `orphan-cleanup`, `sleep`,
      `cable-drop-behavior`, `plug-spread-*`, `debug-nodes`, `wire-shadows`, `surface`, `canvas`): oggi non
      sono descritti da nessuna parte.
- [ ] Accessibilità: jack e plug non sono raggiungibili da tastiera; manca Escape per annullare la modalità
      "carry" (oggi annullare un cavo vuol dire crearne uno orfano).
- [ ] `translateX`/`translateY` della `CoordinateTransform` sono ignorati internamente (conta solo
      `scale` più il rettangolo del container), mentre `screenToWorld`/`worldToScreen` esportati li usano:
      due modelli diversi. Documentare o togliere i campi.
- [ ] Codice morto e duplicato: `lightenColor` e la cache dei colori in `renderer.ts`; Plug, Jack e il
      controller ripetono la conversione delle coordinate, il magnete e la gestione dei gesti.
- [ ] `<cavi-debug>`: il log unisce in "×N" eventi identici anche se riguardano plug diversi, perché un
      plug senza id viene mostrato solo come `<cavi-plug>`. Aggiungere al dettaglio il cavo o l'indice del
      nodo.

## Manutenzione

- [ ] La CI non esegue test, lint, controllo del formato né `build:lib`, e non gira sulle PR. Su questo
      branch fallirebbe comunque finché la dipendenza punta a `../cavi/pkg`.
- [ ] `<cavi-controls>` è codice vecchio: indici dei cavi 0..2 e canvas 1000×600 scritti a mano,
      `alert`/`confirm`, `setCavi` chiamato più volte avvia nuovi timer, non regge uno spostamento nel DOM,
      ignora i mondi multipli. Sostituirlo con `<cavi-debug>` o spostarlo negli esempi.
- [ ] Test mancanti: disegno dei path SVG, `sizeCanvasToHost`, `<cavi-interaction>`, errore di
      caricamento del WASM. I finti oggetti dei test non sono controllati rispetto alle classi vere
      (`satisfies Pick<Cavi, ...>`), e alcuni test accedono a membri privati.
- [ ] Documentazione con percorsi vecchi: `02-architecture`, `03-api`, `04-getting-started` e
      `05-jack-plug` citano `src/main.ts`, `src/cavi.ts`, `src/jack.ts` e altri file che non esistono più
      (18 occorrenze); `03-api` non documenta `SvgRenderer` né `<cavi-debug>`. Il README presenta ancora
      Socket e Jack come "future implementation".
- [ ] File inutili nel repository: 12 screenshot `shot-*.png` (2,1 MB) nella radice, `examples/style2.css`,
      `examples/typescript.svg`, il blocco commentato in `examples/main.ts`.
- [ ] `tsconfig`: attivare `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`; togliere
      `vite/client` dai tipi della build della libreria.
- [ ] `cavi`: la funzione `set_panic_hook` non è usata (warning a ogni build).
