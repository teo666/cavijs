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

# Wire

wire is the class that model wires. It contain the structure to add context, usefull when rendering wires.

it must have the methods to
- add a node
- remove a node
- change and set meta data. for example render color
- change radius