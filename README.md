# Cavijs
cavijs is a wrapper written in typescript that allow to use cavi inside browser without handle directly with cavi.

The main purpose of cavi is to handle cable and mouse interaction, generating as a result spline point to be passed in js, js receive the point and renders wires.

The purpose is to avoid to store render information in the wasm project and let js to handle renderer and keep information about that, this because in that manner is possible to easly extend rendere behavior.

The TS project contain followind classes:
Node
Wire
World
Socket
Jack

# Node
Node is the corresponding TS class of Node in cavi.

# Wire
Wire is the correspondig TS class of Wire in cavi.

Wire is logically connected to Wire in wasm but it contains method to change props, like radius and tension.
It also contains a meta dict that allow the user to extend with information usefull to render, for example adding the color.

the minimal implementation should have following method
- add a node
- remove a node
- change and set meta data. for example render color
- change radius

# World

class world contain the main container for cavi simulation.
the class expose all method to interact with cables and global parameter confiuration.

It allow to:
- add a new Wire
- delete a Wire
- set acceleration
- get acceleration
- set renderer class
- get wires by their index

it has prop that allow to specify the render behavior. During rendere the renderer class receive the wire instance with its context that allow to render the wire with specific color passed in early initialization.