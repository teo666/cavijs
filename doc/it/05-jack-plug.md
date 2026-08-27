# Cavijs — Componenti Jack & Plug

`Jack` (`<cavi-jack>`) e `Plug` (`<cavi-plug>`) modellano punti di connessione e terminali di cavo — ad esempio per diagrammi dove i cavi ("wires", vedi `<cavi-wire>`) si collegano a prese fisse, con una regola di compatibilità basata su un singolo tipo stringa (es. `"audio"`, `"midi"`, `"scsi"`).

> Questa funzionalità è più recente rispetto all'API principale `Cavi`/`World`/`Wire` ed è in evoluzione — considerare i dettagli qui come un'istantanea di `src/jack.ts` / `src/plug.ts` / `src/wirewc.ts` così come attualmente implementati.

## Concetto

- **`Plug`** modella il nodo terminale di un cavo (l'estremità trascinabile di un `<cavi-wire>`). Per ora un plug rappresenta sempre uno dei **due nodi terminali** del cavo (indice `0` o `nodeCount - 1`); i nodi intermedi non sono ancora supportati.
- **`Jack`** modella una presa fissa a cui un plug può collegarsi, con un proprio `type` stringa.
- **`<cavi-wire>`** (il "Cable") possiede il proprio `type`, che viene propagato automaticamente a tutti i suoi `<cavi-plug>` figli — un plug non ha un tipo indipendente impostabile via markup.
- Una connessione plug→jack è permessa se e solo se `plug.type === jack.type` (uguaglianza semplice; un jack senza `type` configurato non accetta nessuna connessione).
- Trascinare un `Plug` sopra un `Jack` compatibile lo aggancia in posizione (effetto "calamita"); durante l'avvicinamento, sia il jack candidato sia il plug ricevono una classe CSS configurabile per l'anteprima visiva (es. blur/glow), non solo al momento del rilascio. Rilasciare altrove lascia il nodo del cavo sottostante non fissato di default: il cavo rimane penzoloni liberamente e può essere riagganciato successivamente — a meno che il plug non abbia l'attributo `freeze-on-drop`, nel qual caso resta fissato esattamente dove è stato rilasciato, sempre riafferrabile con un click/tap normale invece di dover inseguire un bersaglio in movimento.
- Entrambi sono Web Component che accettano contenuto template opzionale fornito dall'utente (con struttura/classi attese).
- Ordine Z: `Plug` deve sempre essere renderizzato sopra `Jack`, che a sua volta è sopra il canvas — così il plug non è mai occluso durante il trascinamento.
- Il drag-and-drop funziona sia con mouse sia con touch/penna tramite Pointer Events unificati.

## Modalità di interazione: `hold` vs `click-to-carry` (`Cavi.setDragMode()`)

Sia il trascinamento di un `Plug` esistente sia il trascinamento di creazione cavo da un `Jack` supportano due modalità di interazione, scelte con un'unica opzione **globale a livello di mondo** — non per singolo elemento:

- **`Cavi.setDragMode('hold')`** (default, invariato): premi-trascina-rilascia classico. Il `pointerdown` avvia il drag e chiama `setPointerCapture`, così tutti gli eventi pointer successivi per quel puntatore restano instradati all'elemento anche se il cursore esce dai suoi confini; il `pointerup` (o `pointercancel`) lo conclude. **Mentre il pulsante resta premuto, lo scroll nativo del browser — in particolare il gesto a due dita del touchpad — smette tipicamente di essere riconosciuto** (limitazione comune di molti driver, non specifica di questa libreria): se il jack di destinazione è fuori dalla porzione visibile di un container scrollabile, non c'è modo di raggiungerlo durante il drag.
- **`Cavi.setDragMode('click')`**: un click (senza tenerlo premuto) avvia il trascinamento — sgancia dal jack corrente (o crea il nuovo cavo, per `Jack`) e il nodo comincia a seguire il cursore tramite un listener `pointermove` a livello di `document`, **senza che nessun pulsante resti premuto**. Questo significa che lo scroll nativo del browser (rotellina, touchpad, gesture) funziona per tutta la durata del trascinamento esattamente come quando non si sta trascinando nulla — non serve alcun meccanismo di auto-scroll lato applicazione. Un secondo click (qualsiasi pulsante primario, ovunque avvenga — in pratica cade sempre sul nodo trascinato, dato che lo sta seguendo) conclude il trascinamento: aggancia al jack compatibile più vicino se ce n'è uno in prossimità, altrimenti lo lascia cadere lì (stessa semantica di `freeze-on-drop`/caduta libera di `hold`, solo innescata da un click anziché da un rilascio). Un click con pulsante non primario (es. tasto destro) durante il trasporto viene ignorato, non lo conclude. Non esiste un gesto di annullamento esplicito: cliccare comunque da qualche parte senza un jack sotto fa cadere il nodo lì, esattamente come un rilascio a vuoto in modalità `hold` — può essere riafferrato e riposizionato con un altro click.

**Eccezione touch**: `click-to-carry` si applica solo a mouse e pen (`e.pointerType !== 'touch'`) — il touch usa sempre `hold` a prescindere dalla modalità globale impostata, perché il trascinamento naturale col dito non ha il conflitto con lo scroll descritto sopra (lo swipe è un gesto diverso, già disabilitato durante il drag da `touch-action: none`) ed è già l'esperienza migliore su quel tipo di dispositivo.

`Jack.setDragActive()` (vedi sotto, anteprima "jack pieno" durante il drag) resta attivo per l'intera durata del trascinamento in entrambe le modalità, non solo mentre un pulsante è premuto.

## `Jack` (`src/jack.ts`)

Un custom element (`cavi-jack`) con Shadow DOM.

**Attributi osservati**
| Attributo | Effetto |
|---|---|
| `color` | Colore di riempimento del punto visivo del jack |
| `x`, `y` | Posizione assoluta (`style.left`/`style.top`, traslata -50%/-50% per centrare sulla coordinata) |
| `type` | Stringa di tipo (es. `"audio"`) — un plug può agganciarsi solo se il proprio `type` è identico |
| `max-plugs` | Numero massimo di plug agganciabili contemporaneamente (default illimitato) |
| `magnet-class` | Nome della classe CSS applicata all'host quando un plug compatibile è in prossimità durante il trascinamento (default `cavi-magnet-target`) |
| `full-class` | Nome della classe CSS applicata all'host quando il jack ha raggiunto `max-plugs` **e** il cursore è vicino **e** (Shift è premuto **oppure** è in corso un drag che potrebbe tentare di collegarcisi) (default `cavi-jack-full`) — vedi sotto |
| `at-capacity-class` | Nome della classe CSS applicata all'host in modo incondizionato per tutto il tempo in cui il jack ha raggiunto `max-plugs` (default `cavi-jack-at-capacity`) — a differenza di `full-class`, non dipende da hover o Shift; vedi sotto |
| `cable-tension`, `cable-size`, `cable-color` | Valori opzionali di tensione/raggio/colore applicati al cavo creato trascinando da questo jack (vedi sotto); se omessi, il cavo usa i default fissi di `<cavi-wire>` |
| `cable-node-spawn` | `"interpolate"` (default) o `"stack"` — dove compaiono i nodi via via inseriti mentre il cavo si allunga durante il trascinamento (vedi sotto) |

**API**
| Metodo | Descrizione |
|---|---|
| `canAccept(type: string) -> boolean` | Ritorna true se `type` è uguale al `type` del jack (e il jack ne ha uno configurato) |
| `canAcceptMore() -> boolean` | Ritorna true se il jack non ha raggiunto `max-plugs` |
| `attach(plug: Plug)` / `detach(plug: Plug)` | Registra/rimuove un plug collegato (aggiorna `plugCount`) |
| `plugCount` | Numero di plug attualmente collegati |
| `getCenter() -> { x, y }` | Punto centrale in coordinate viewport (`getBoundingClientRect`) |
| `type` (getter) | Il `type` corrente del jack |
| `setMagnetActive(active: boolean)` | Attiva/disattiva la classe `magnet-class` sull'host, usata per l'anteprima calamita durante il drag |

Di default renderizza un piccolo cerchio scuro (`.inner`); se l'elemento ha contenuto figlio, renderizza quello al suo posto (tramite `<slot>`), permettendo di personalizzare l'aspetto mantenendo la stessa semantica di drop-target.

L'host ha una dimensione esplicita `24×24px` e riceve eventi pointer nativi (`pointer-events: auto`) — è ciò che gli permette di comportarsi come sorgente di drag per la creazione di un cavo (vedi sotto). L'hit-testing per l'aggancio di un `Plug` **esistente** su un jack resta invece interamente basato sulla distanza (`Plug._findSnapTarget()` tramite `Jack.registry`), non su eventi nativi del jack; gli eventi pointer propri del jack servono solo ad avviare un cavo **nuovo**.

## Creare un cavo trascinando da un Jack (`src/jack.ts`)

Oltre ad essere un drop target, `Jack` è anche una sorgente di drag: click destro, oppure click sinistro + <kbd>Shift</kbd>, su un jack con capacità residua (`canAcceptMore()`) crea immediatamente un nuovo `<cavi-wire>` — un `<cavi-plug>` viene subito agganciato a quel jack, l'altro segue il cursore.

- **Trigger**: `pointerdown` con `button === 2` (tasto destro) oppure `button === 0 && shiftKey`. Il menu contestuale nativo del jack viene sempre soppresso (`contextmenu` → `preventDefault()`), dato che il jack è sempre una possibile sorgente di drag col tasto destro. Un jack già a `max-plugs` ignora il gesto.
- **Costruzione del cavo**: crea un `<cavi-wire type="{jack.type}" length="4">` con due `<cavi-plug>` figli (`node="0"` / `node="3"`), inserito come sibling del jack (così condivide lo stesso `offsetParent`/spazio di coordinate già usato da Plug). Il nodo `0` viene subito posizionato al centro del jack, fissato e agganciato (`plugged`); il nodo `3` viene posizionato alla posizione iniziale del cursore. Tensione (`tension`), raggio (`size`) e colore (`color`) del nuovo `<cavi-wire>` vengono copiati dagli attributi `cable-tension`/`cable-size`/`cable-color` del jack di origine, se presenti; per ogni attributo omesso resta il default fisso a cui `<cavi-wire>` ricade normalmente (tipo di render escluso: sempre bezier di default, salvo `renderType="segments"` sul cavo — non c'è un equivalente `cable-render-type`).
- **Crescita durante il drag**: ad ogni `pointermove`, la posizione del nodo libero segue il cursore e il numero di nodi cresce con la distanza dal jack di origine — `4 + floor(distanza / 30)`, con un tetto di `60`. **Il cavo cresce soltanto durante il drag, non si accorcia mai** quando il cursore si riavvicina — come tirare un cavo fuori dallo schermo: una volta uscito, resta fuori fino al rilascio. Un passo di crescita inserisce solo i nodi mancanti uno alla volta con `Wire.addNodeAt()` (vedi [`Wire` nel riferimento API](./03-api.md#wire)) — a differenza di un vecchio approccio basato su `Wire.setNodeCount()`, che ricostruiva l'intero cavo, questo lascia intatto lo stato fisico (posizione, velocità) di ogni nodo già esistente e assestato dalla simulazione. Ogni nodo appena inserito viene posizionato in base a `cable-node-spawn`: `"interpolate"` (default) lo piazza subito in linea retta tra l'ultimo nodo assestato e il cursore; `"stack"` lo fa nascere impilato sull'ultimo nodo assestato, lasciando alla fisica di vincolo il compito di separarlo nei frame successivi. In entrambi i casi il `Plug` libero viene ri-agganciato al nuovo ultimo nodo, dato che la crescita sposta l'indice del terminale. Come in `Plug.handlePointerMove`, ogni `pointermove` chiama anche `node.setMousePosition(x, y)` sul nodo libero: senza questa chiamata, il `preventDefault()` in `handlePointerDown` (necessario per sopprimere la selezione testo durante Shift+trascinamento) fa sì che il browser smetta di emettere `mousemove` nativi per la durata dell'interazione, congelando fino al rilascio l'interazione "mouse del mondo" (repulsione fisica delle altre reti) che `Renderer` alimenta normalmente da quell'evento.
- **Anteprima calamita**: stessa identica meccanica del drag di `Plug` — stessa soglia di aggancio di `20`px, stesso toggling continuo dell'evidenziazione (`setMagnetActive`) sia sul jack candidato sia sul plug libero mentre è in prossimità, calcolato con la stessa scansione di `Jack.registry` (escludendo il jack di origine stesso, così un cavo non può riagganciarsi alla propria sorgente).
- **Al rilascio**: se un jack compatibile è in prossimità, il plug libero si aggancia esattamente come un normale rilascio di `Plug` (`fixed = true`, `attach()`, `plugged`). Altrimenti il cavo resta agganciato all'origine con il capo libero lasciato pendente — `node.fixed = false`, identico a un `Plug` normale rilasciato lontano da ogni jack oggi (libero di muoversi sotto la fisica, e già completamente ri-trascinabile da solo dato che è un vero `<cavi-plug>`). Un `pointercancel` viene trattato come un rilascio a vuoto.
- **Un jack pieno mostra un cursore "vietato"**: se il cursore si trova entro `20`px dal centro di un jack che ha raggiunto `max-plugs` (`!canAcceptMore()`) **mentre Shift è premuto oppure è in corso un drag che potrebbe tentare di collegarcisi**, l'host riceve `cursor: not-allowed` (stile inline, vince sempre sulla regola `:host { cursor: crosshair }`) e la classe `full-class`. Vale già al semplice hover con Shift, anche prima di iniziare un drag da questo jack. Il rilevamento hover è basato sulla distanza dall'ultima posizione nota del puntatore (un unico listener `pointermove` su `document`, condiviso da tutti i jack), **non** su `pointerenter`/`pointerleave` nativi sul jack: un jack con almeno un plug agganciato ha quel `<cavi-plug>` posizionato esattamente al suo centro con `z-index` più alto, quindi lo occlude e impedirebbe agli eventi di hover nativi di raggiungerlo mai — lo stesso listener `pointermove` condiviso capta anche il movimento di un drag in corso (i suoi eventi risalgono comunque fino a `document` anche sotto `setPointerCapture`), quindi non serve alcun cablaggio aggiuntivo per tracciarne la posizione.

  La condizione "Shift premuto" e la condizione "un drag è in corso" sono **tenute separate apposta**: `Jack._shiftHeld` è il semplice stato del tasto Shift, sempre valido anche prima che qualunque drag inizi (l'anteprima hover pre-drag); `Jack._dragActive` (un contatore interno, non un booleano, così due drag sovrapposti — es. multi-touch — non si azzerano a vicenda) è invece attivo per l'intera durata di **due** gesti distinti, tramite il metodo pubblico `Jack.setDragActive(active)`:
  1. `Plug` che trascina un plug esistente da un jack a un altro (`handlePointerDown`/`_endDrag`).
  2. Il drag di creazione cavo dello stesso `Jack` (`handlePointerDown`/`_endCableDrag`, vedi sopra) — **necessario perché Shift/right-click servono solo ad *avviare* questo drag, non a mantenerlo**: una volta partito, il cavo continua a seguire il cursore anche rilasciando Shift (comportamento voluto, per non dover tenere premuto un tasto per tutta la durata del trascinamento). Senza `_dragActive`, l'anteprima "vietato" sparirebbe non appena si rilascia Shift a metà drag, anche continuando a trascinare il capo libero verso un jack pieno.

  Lo stato si aggiorna anche senza muovere il cursore quando il jack si riempie/libera (`attach`/`detach`) o quando uno dei due drag inizia/termina, mentre il jack è già sotto osservazione.
- **Un jack pieno ha sempre `at-capacity-class`**: a differenza di `full-class`, questa classe è incondizionata — riflette semplicemente `!canAcceptMore()`, indipendentemente da hover o Shift, quindi resta utilizzabile per uno stile "pieno" persistente (es. un bordo o un'icona) visibile anche senza interagire col jack. Aggiornata dagli stessi punti di ricalcolo di `full-class` (`attach`/`detach`/cambio di `max-plugs`), tramite lo stesso metodo interno `_refreshFullState()`.
- **Mentre Shift è premuto, i plug dei cavi già esistenti non si spostano**: `Plug.handlePointerDown` ignora ogni `pointerdown` con `shiftKey` attivo, dato che Shift è riservato all'avvio di un nuovo cavo — vedi la sezione `Plug` sotto.

## `Plug` (`src/plug.ts`)

Un custom element (`cavi-plug`) con Shadow DOM, trascinabile tramite **Pointer Events** (mouse, touch e penna con lo stesso codice).

**Attributi osservati**
| Attributo | Effetto |
|---|---|
| `plugged` | Attiva/disattiva lo stile visivo "connesso" (impostato/rimosso all'aggancio/sgancio) |
| `magnet-class` | Nome della classe CSS applicata all'host quando il plug è in prossimità di un jack compatibile durante il trascinamento (default `cavi-magnet-active`) |
| `freeze-on-drop` | Attributo booleano basato su presenza (come `plugged`). Se presente, un rilascio lontano da ogni jack compatibile lascia il nodo fisico **fissato** (`node.fixed = true`) invece che libero — il plug resta fermo sul punto di rilascio anziché oscillare sotto gravità/tensione, restando sempre riafferrabile con un click/tap. Default assente (comportamento invariato: nodo libero). Si applica sia al rilascio normale sia a un `pointercancel` |

`type` **non** è un attributo del plug: viene ricevuto esclusivamente tramite `setType(type)`, chiamato dal `<cavi-wire>` genitore in base al proprio attributo `type`.

**API**
| Metodo | Descrizione |
|---|---|
| `setNode(node: Node)` | Collega visivamente il plug a un nodo fisico del cavo |
| `setType(type: string)` | Imposta il tipo di connessione del plug (propagato dal Cable, non impostabile da markup) |
| `attach(jack: Jack)` / `detach()` | Collega/scollega il plug da un jack, passando dallo stesso registro `attach`/`detach` del jack (usato sia dal drag sia dal binding dichiarativo di `<cavi-wire>`) |
| `setMagnetActive(active: boolean)` | Attiva/disattiva la classe `magnet-class` sull'host |

**Comportamento**
1. `setNode(node: Node)` collega visivamente il plug a un'istanza `Node` (proveniente da un `Wire`); `updatePosition()` lo mantiene sincronizzato con `x`/`y` del nodo a meno che non sia in corso un trascinamento.
2. Al `pointerdown`: se è un right-click o uno Shift+click sinistro (i due gesti di creazione cavo da `Jack`, vedi sopra) **e** il plug è attualmente agganciato a un jack, l'evento viene inoltrato pari pari a `jack.handlePointerDown(e)` invece di essere gestito qui — vedi la nota sull'occlusione jack↔plug più sotto. Altrimenti, per un `pointerdown` col tasto primario e senza Shift: avvia il trascinamento, sgancia subito il plug da un eventuale jack corrente, fissa il nodo sottostante (`node.fixed = true`), tenta `setPointerCapture` (con feature-detection: non tutti gli ambienti la supportano — vedi nota jsdom sotto), registra i listener `pointermove`/`pointerup`/`pointercancel` su se stesso, aumenta lo `z-index`. Un plug **non** agganciato a nessun jack ignora right-click e Shift+click (nessun cambiamento rispetto a prima).
3. Ad ogni `pointermove` durante il trascinamento: calcola la posizione relativa a `offsetParent`, chiama `node.setPosition(x, y)` **e** `node.setMousePosition(x, y)` (quest'ultimo inoltra a `WasmWorld.set_mouse`, mantenendo la repulsione fisica sincronizzata col plug trascinato), aggiorna la propria posizione a schermo, e ricalcola il jack calamita candidato (`_findSnapTarget()`), attivando/disattivando le classi `magnet-class` su jack e plug di conseguenza — in modo continuo, non solo al rilascio.
4. Al `pointerup`: ricalcola il jack più vicino compatibile (tipo uguale e capacità disponibile) entro `_snapDistance` (default `20`px); se trovato, aggancia il nodo al centro del jack, chiama `attach(jack)` e imposta `plugged`; altrimenti chiama `detach()` e imposta `node.fixed` in base a `freeze-on-drop` (`true` se presente, altrimenti `false`), rimuovendo `plugged`.
5. Al `pointercancel` (es. gesto interrotto dal sistema, tipico su touch): stesso comportamento del rilascio "a vuoto" del punto 4, senza tentare alcuno snap.

**Note implementative**
- La ricerca dei jack avviene tramite il registro statico `Jack.registry`, non tramite query DOM.
- `z-index`: plug usa `20`, jack usa `10`, coerentemente col requisito "jack sotto plug" della spec.
- `touch-action: none` è impostato nello shadow DOM del plug per evitare che il browser intercetti lo scroll durante il trascinamento touch.
- **jsdom**: `setPointerCapture`/`releasePointerCapture` non sono implementati in jsdom (verificato con jsdom 30.x) — il codice fa feature-detection e degrada senza capture nativa; nei test si simula il drag dispatchando `PointerEvent` direttamente sul plug.
- **Occlusione jack↔plug per l'avvio di un nuovo cavo**: un plug agganciato a un jack è fissato esattamente al centro del jack con `z-index` più alto (`20` contro `10`, vedi sotto) — e sono elementi sibling nel DOM, mai antenato/discendente. In un browser reale un click su quel punto risolve sempre sul plug, e il `pointerdown` registrato direttamente su `<cavi-jack>` non lo riceverebbe mai (l'evento non può risalire lateralmente al jack). Risolto facendo sì che `Plug.handlePointerDown` riconosca i due gesti di creazione cavo (right-click o Shift+click) quando è agganciato, e li inoltri direttamente a `this._jack.handlePointerDown(e)` — che funziona correttamente anche se non è stato lui il target originale dell'evento (`setPointerCapture` non richiede che l'elemento sia il target originale). Per lo stesso motivo `Plug` sopprime anche il proprio `contextmenu` nativo quando è agganciato (`handleContextMenu`), altrimenti un right-click che atterra sul plug farebbe comunque comparire il menu contestuale del browser durante quello che dovrebbe essere un drag di creazione cavo.

## `<cavi-wire>` — propagazione del `type` e nodi terminali (`src/wirewc.ts`)

- L'attributo `type` su `<cavi-wire>` viene letto una volta in fase di setup e propagato a ogni `<cavi-plug>` figlio tramite `plug.setType(type)`.
- Solo i `<cavi-plug node="...">` con indice `0` o `nodeCount - 1` (i due nodi terminali) vengono collegati; un indice intermedio produce un `console.warn` e il plug viene ignorato — i nodi intermedi non sono ancora supportati.
- Se un `<cavi-plug>` ha un attributo `jack="id"`, viene collegato dichiarativamente al jack corrispondente in fase di setup, passando dallo stesso `plug.attach(jack)` usato dal drag (così `jack.plugCount`/`max-plugs` restano corretti anche per le connessioni dichiarative). Se il `type` del jack non coincide con quello del cavo, viene emesso un `console.warn` ma la connessione viene comunque stabilita (il markup ha precedenza).
- L'attributo `node="N"` di ogni `<cavi-plug>` è la fonte di verità sull'indice a cui è legato, riletta ogni volta che serve (non solo una volta al setup): se il numero di nodi del cavo cambia dopo la connessione iniziale (unico caso oggi: la crescita durante il drag di creazione da un Jack, vedi sopra), chi sposta il plug libero su un nuovo indice **deve** aggiornare anche questo attributo, altrimenti un successivo `_rebindAfterIndexShift` (quando l'indice WASM di questo cavo si sposta per l'eliminazione di un cavo "fratello" — vedi sotto) rileggerebbe l'indice ormai stantio e riaggancerebbe il plug a un nodo intermedio invece che al vero terminale.

### Eliminazione automatica quando il cavo esce dal container (`auto-cleanup`)

Attributo booleano basato su presenza (come `plugged`/`freeze-on-drop`), **assente di default** — comportamento invariato finché non lo si imposta esplicitamente, dato che è un'azione irreversibile (libera anche la memoria WASM del cavo).

Quando presente, ad ogni frame del loop `requestAnimationFrame` già usato da `CaviWireElement` per sincronizzare i plug, viene eseguito un controllo sincrono (`_cleanupIfOutsideContainer()`, facilmente rintracciabile via grep) che verifica, tramite `getBoundingClientRect()`, se **tutti** i plug del cavo non si sovrappongono più al container passato a `new Renderer(container, world)` (esposto come `Cavi.getContainer()`/`Renderer.getContainer()` — vedi [riferimento API](./03-api.md#renderer)). Se sì, il cavo viene distrutto (`_destroy()`): il suo `Wire` viene cancellato (`cavi.deleteWire(index)`, liberando la memoria WASM) e l'elemento viene rimosso dal DOM — la rimozione fa scattare automaticamente `disconnectedCallback` su ogni `<cavi-plug>` figlio, che a sua volta chiama `detach()` (sganciandolo dal proprio Jack, se presente) e rimuove i propri listener di trascinamento.

Deliberatamente basato su un controllo sincrono per-frame anziché su `IntersectionObserver`: dato che il loop RAF esiste già per sincronizzare la posizione dei plug, un controllo bounding-box nello stesso tick è preciso al frame esatto e non rischia il ritardo/coalescing tipico di `IntersectionObserver` (specialmente con tab in background).

**Nota importante**: cancellare un cavo che non è l'ultimo creato sposta gli indici WASM di tutti i cavi successivi (`World.deleteWire`, vedi [riferimento API](./03-api.md#world)). `CaviWireElement` mantiene un proprio registro statico di tutti i `<cavi-wire>` connessi e, subito dopo ogni cancellazione, ri-aggancia (`_rebindAfterIndexShift`) ogni cavo sopravvissuto il cui indice si è spostato al `Wire` fresco corretto — senza questo passaggio, gli altri cavi continuerebbero silenziosamente a leggere/scrivere il cavo sbagliato. Non copre invece un `Jack` che sta attivamente creando un nuovo cavo nello stesso istante in cui un *altro* cavo esce ed è auto-cleanup: un caso limite molto raro, non ancora gestito.

## Relazione col motore fisico

Né `Jack` né `Plug` comunicano direttamente con `WasmWorld` — passano sempre attraverso un'istanza `Node`, che inoltra i cambiamenti di posizione/stato-fisso al nodo WASM sottostante (vedi [`Node` nel riferimento API](./03-api.md#node)). Questo mantiene la UI dei connettori coerente col resto dell'architettura di `cavijs` (la fisica resta in WASM, il DOM/interazione resta in TS).
