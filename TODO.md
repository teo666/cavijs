- [x] l'esempio fallo a tutto schermo o comunque più grande.
      (fatto: demo-patchbay-zoom e demo-patchbay-zoom-svg sono a tutto schermo, con un pannello informativo
      flottante.)
- [x] se faccio zoom out sembra che ci sia un area di clipping che mi impedisce di veder quando i cavi escono da tale area
      (risolto: `<cavi-world surface="#zoomFrame">` / `new Renderer(container, world, { surface })` mette il canvas
      sull'elemento non trasformato, grande quanto lo schermo, e il renderer applica lo zoom da sé — vedi
      doc/it/06-zoom-multiworld.md. Rimosso il workaround del #panel sovradimensionato.)
