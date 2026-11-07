MERIDIAN RESIDENCES
A playable Three.js apartment environment.

RUN LOCALLY
Install Node.js 22.12 or newer. In this folder, run npm install, then npm run dev.
Open the local address shown in your terminal.
Run npm run build to build production files. Serve dist with any static web server.

CONTROLS
WASD / arrow keys: move. Mouse: look. Click the scene to capture the pointer.
Drag to look when pointer capture is unavailable. Shift: walk faster.
E: discover a nearby detail or use fireplace/elevators. Escape: pause.
Touch: left joystick moves, right side drag looks; E interacts.
The toolbar changes golden/blue hour, toggles ambient audio, and shows controls.

EXPLORE
Find five details: residents' lounge, reception, art, fireside, and elevators.
The fireplace and elevator doors are interactive. Exploration stays in the lobby.
Surrounding apartment buildings and skyline are scenery.

SOURCE
src/engine.js: reusable renderer, lighting, lifecycle, first-person camera and collision.
src/lobby.js: procedural lobby, materials, decorations, collisions and interactions.
src/city.js: instanced city geometry and procedural sky shader.
src/main.js: game state, discoveries, HUD, touch input and synthesized ambient audio.
src/style.css: responsive interface.

All geometry, art, textures, and sound are generated in the application.
Optional Google Fonts fall back to local system fonts. WebGL 2 is required.

VALIDATION
Production build passed. Ten controller checks passed: movement, walk/sprint speed,
diagonal normalization, thin-wall collision, wall sliding, bounds, reset, pause,
and analog input. Browser checks covered rendering, walking, discoveries, pause,
and changing time of day. The preview rendered at about 60 FPS on this device.
