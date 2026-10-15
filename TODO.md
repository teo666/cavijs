# TODO

Stato al 15 ottobre 2026. Branch: `d3-interaction` (cavijs) e `render-interpolation` (`../cavi`).

## Già fatto

- **cavijs:** pannello `<cavi-debug>` ed eventi di dominio, pulizia dei cavi orfani, mouse fantasma,
  fisica a passo fisso, un ciclo di frame per mondo, jack che seguono il layout, jack rimosso che rilascia i
  plug, interpolazione tra i passi fisici, cavo tenuto durante il trascinamento, sospensione dei cavi
  fermi, handle dei nodi stabili, `Cavi.destroy()` e smontaggio dei mondi rimossi, cavi creati trascinando
  che sopravvivono a un reinserimento, colori di default fissati alla creazione, plug che si aprono su un
  jack già aperto, tipo vuoto come jolly, `World` che rifiuta modifiche fatte direttamente sul WASM,
  `Wire.delete()`, mondi multipli isolati (anche negli shadow root), suite end-to-end Playwright,
  `SvgRenderer` che scrive nel DOM solo ciò che cambia (da 420–620 modifiche al secondo a zero con i cavi
  fermi), `World.getWiresView()` senza copia per i renderer, attributi live di `<cavi-wire>` e
  `<cavi-world>` (documentati in `03-api`), tastiera ed Escape, codice duplicato e morto rimosso, modello
  della trasformazione di coordinate documentato, log del debug che distingue i plug.
- **`cavi`:** `step()` separato da `build_render_data(alpha)`, parametri del passo configurabili, cavi che
  partono dritti, cavo tenuto (`pointer_radius`), sospensione, lancio al rilascio, distanza tra i nodi
  separata dal raggio, `intersect` vero, README.

## Ordine consigliato

1. Le due verifiche a occhio qui sotto, poi il rilascio di `cavi`: sblocca il merge su `main` e la CI.
2. La CI, appena la dipendenza torna su una versione pubblicata.
3. "Packaging", solo se vuoi pubblicare cavijs su npm.
4. Il resto quando capita.

## Da verificare a mano

Quasi tutto è ora coperto dai test end-to-end (`pnpm test:e2e`): 60 passi al secondo e un disegno nuovo a
ogni frame su un display a 120 Hz emulato, cavo tenuto non stirato (23 contro 34 con riposo 20), lancio pari
all'ultimo movimento, cavi addormentati nella forma finale (scarto massimo 0,016 px), mondo rimosso e
reinserito. Restano i giudizi a occhio:

- [ ] Su uno schermo a 120 Hz vero il movimento sembra fluido? (I numeri tornano, la percezione no.) Se i
      cavi sembrano più lenti di prima, era lo step rate: provare `<cavi-world step-rate="120">`.
- [ ] La forza del lancio di un cavo rilasciato nel vuoto, e quanto `pointer_radius` (20) sposta gli altri
      cavi durante un trascinamento, ti sembrano giusti?

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

Tutto fatto.

## Più mondi nella stessa pagina

Tutto fatto.

## Prestazioni

Tutto fatto.

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

- [ ] Il controller d3 dell'esempio (`examples/d3-interaction.ts`) non ha ancora Escape né la tastiera, che
      ora ha `StandardInteractionController`.
- [ ] Da tastiera si creano cavi nuovi, ma non si sposta un capo già collegato: servirebbe un modo per
      scegliere un plug di un jack (per esempio con le frecce) e trascinarlo.

## Manutenzione

- [ ] Test end-to-end "a cable dropped in empty space falls away and is deleted": fallito una volta (timeout
      a 30 s) su molte esecuzioni, non riprodotto. Ipotesi: con il carico di molti test in parallelo Chrome
      scende sotto i 10 frame al secondo, il passo fisico perde tempo (`MAX_ELAPSED_MS`) e il cavo cade
      troppo piano. Se ricapita, guardare il trace (`npx playwright test --trace on`).
- [ ] La CI non esegue test (unitari ed end-to-end), lint, controllo del formato né `build:lib`, e non gira
      sulle PR. Su questo branch fallirebbe comunque finché la dipendenza punta a `../cavi/pkg`. Per gli
      end-to-end in CI: Chrome è già presente sui runner Ubuntu di GitHub (`channel: 'chrome'`).
- [ ] `<cavi-controls>` è codice vecchio: indici dei cavi 0..2 e canvas 1000×600 scritti a mano,
      `alert`/`confirm`, `setCavi` chiamato più volte avvia nuovi timer, non regge uno spostamento nel DOM,
      ignora i mondi multipli. Sostituirlo con `<cavi-debug>` o spostarlo negli esempi.
- [ ] Test mancanti: disegno dei path SVG (unitario; negli end-to-end è coperto solo "disegna qualcosa"),
      `sizeCanvasToHost`, errore di caricamento del WASM, interazione touch. I finti oggetti dei test non sono controllati rispetto alle classi vere
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
