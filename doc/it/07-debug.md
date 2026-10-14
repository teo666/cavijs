# Cavijs — Debug ed eventi

## `<cavi-debug>`

Overlay per sviluppatori agganciato a un mondo Cavi: statistiche live, una tabella dei cavi, qualche impostazione modificabile a runtime e il log degli eventi emessi dal mondo.

```html
<!-- Finestra flottante, trascinabile e ridimensionabile, legata per id -->
<cavi-debug for="panel" open></cavi-debug>

<!-- Pannello agganciato al bordo destro che entra ed esce -->
<cavi-world id="panel">
  …
  <cavi-debug mode="panel"></cavi-debug>
</cavi-world>
```

```ts
import 'cavijs'; // registra anche <cavi-debug>
// oppure, solo nelle demo/sorgenti:
import './src/debug/debugwc';
```

### Quale mondo ispeziona

In quest'ordine:

1. `for="<id>"` — il `<cavi-world>` (o il container del renderer) con quell'id; se non esiste ancora, si aggancia al suo primo `caviready`.
2. il `<cavi-world>` più vicino che lo contiene;
3. quello che risolve `Cavi.whenReady` (cioè `Cavi.shared`);
4. a mano: `debug.attach(cavi)` o `debug.attach(worldElement)` — utile per un setup manuale senza `<cavi-world>`.

### Attributi

| Attributo     | Default       | Descrizione                                                                     |
| ------------- | ------------- | ------------------------------------------------------------------------------- |
| `mode`        | `floating`    | `floating` (finestra trascinabile) o `panel` (agganciato a destra).             |
| `open`        | —             | Visibile. Riflette la proprietà `.open`.                                        |
| `hotkey`      | `alt+shift+d` | Scorciatoia che lo apre/chiude; `none` la disattiva. Ignorata mentre si scrive. |
| `events`      | —             | Nomi di eventi aggiuntivi da loggare, separati da spazi.                        |
| `no-launcher` | —             | Niente pulsante per riaprirlo quando è chiuso.                                  |
| `interval`    | `250`         | Periodo di aggiornamento delle statistiche, in ms.                              |
| `max-events`  | `200`         | Lunghezza massima del log.                                                      |

### API

`show()`, `hide()`, `toggle()`, `open`, `mode`, `attach(target)`, `detach()`, `cavi`, `log(name, detail?)` (aggiunge a mano una voce, ad es. per eventi dell'app), `clearLog()`.

### Cosa mostra

- **FPS** (con sparkline), **cavi** e capi liberi, **nodi** (totale e min–max per cavo), **plug collegati/totali**, jack e jack pieni (`max-plugs` raggiunto).
- **Physics**: gravità, attrito, raggi mouse/pointer, coefficiente di risposta, dimensione del buffer di rendering condiviso con WASM.
- **View**: posizione del puntatore in coordinate mondo, zoom e pan registrati (`setCoordinateTransformProvider`), dimensione del container.
- **Settings**: disegno dei nodi, ombre dei cavi, `cable-drop-behavior`, `plug-spread-mode`.
- **Wires**: per ogni cavo indice, colore, nodi, raggio, lunghezza della polilinea, capi fissi (●) o liberi (○).
- **Events**: log con orario e dettaglio riassunto. Eventi identici ravvicinati (e i burst di `cavi-resize`/`cavi-transform-change`) vengono uniti in una voce `×N`. Cliccando un contatore si nasconde/mostra quel tipo di evento; _Pause_ sospende la registrazione.

Le statistiche si leggono solo mentre è aperto. Posizione, dimensione e sezioni chiuse vengono ricordate in `localStorage` (chiave `cavi-debug:<id>`).

La finestra vive nel _top layer_ del browser (API `popover`): una trasformazione di zoom/pan o uno `z-index` su un antenato non la tagliano né la coprono, anche se è annidata in un `<cavi-world>` zoomato. Ferma inoltre la propagazione di pointer e rotella, così trascinarla o scorrerla non fa partire il pan/zoom della pagina.

Tema: variabili CSS su `cavi-debug` (`--cavi-debug-bg`, `--cavi-debug-surface`, `--cavi-debug-border`, `--cavi-debug-text`, `--cavi-debug-muted`, `--cavi-debug-accent`, `--cavi-debug-warn`, `--cavi-debug-font`, `--cavi-debug-mono`) e le parti `::part(window)`, `::part(header)`, `::part(launcher)`.

### `collectStats(cavi)`

La stessa istantanea usata dal pannello, esportata per usarla altrove (test, telemetria, un overlay personalizzato): restituisce un `CaviStats`.

## Eventi

Tutti sono `CustomEvent` con `bubbles: true`, inviati sul container del renderer (l'elemento `<cavi-world>`), quindi si possono ascoltare sul mondo o su `document`. I tipi dei `detail` sono in `CaviEventDetailMap`; l'elenco completo è `CAVI_EVENT_NAMES`.

| Evento                  | Quando                                      | `detail`                         |
| ----------------------- | ------------------------------------------- | -------------------------------- |
| `caviready`             | il `<cavi-world>` ha creato il suo `Cavi`   | `{ cavi }`                       |
| `cavi-resize`           | il container ha cambiato dimensione         | `{ width, height }`              |
| `cavi-transform-change` | `notifyCoordinateTransformChanged()`        | —                                |
| `cavi-wire-add`         | un `<cavi-wire>` ha creato il suo cavo WASM | `{ wire, element }`              |
| `cavi-wire-remove`      | un `<cavi-wire>` ha cancellato il suo cavo  | `{ wire, element, index }`       |
| `cavi-plug-attach`      | un plug si collega a un jack                | `{ plug, jack }`                 |
| `cavi-plug-detach`      | un plug si stacca da un jack                | `{ plug, jack }`                 |
| `cavi-cable-start`      | inizia la creazione di un cavo da un jack   | `{ jack, wire }`                 |
| `cavi-cable-end`        | finisce la creazione di un cavo             | `{ jack, wire, result, target }` |

`result` di `cavi-cable-end`: `connected` (collegato a `target`), `dangle`, `detach`, `cancel` (secondo `cable-drop-behavior`) o `abort` (`cancelCableSession`).

Senza un `Cavi` (ad es. un jack fuori da qualunque mondo) gli eventi di plug/cavo vengono inviati sul jack stesso, e risalgono comunque fino a `document`.

I cavi creati da codice con `cavi.addWire()` non passano da `<cavi-wire>` e quindi non emettono `cavi-wire-add`/`-remove`; il pannello li conta comunque, perché le statistiche vengono lette dal mondo.
