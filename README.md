# Tree Chopping Simulator

A 3D idle clicker that runs in the browser. Chop an endless tree, hire a crew, build machines, max out every upgrade, then replant and move to a whole new place.

**[▶ Play it in your browser](https://snowballsensei-netizen.github.io/tree-chopping-simulator/)** (works on PC and phone)

To run it locally, open `index.html` in a browser. No install or build step needed.

## Features

- Toon-shaded 3D world built entirely from code (Three.js r160)
- 25 upgrades, each with its own animated model in the scene
- 8 stages: Oak Meadow, Birch Lake, Pine Mountains, Redwood Valley, Cherry Blossom Garden, Ice Spruce Tundra, Crystal Caverns, Golden Temple
- Max out the upgrades to replant and earn Golden Acorns for permanent perks
- Timber Frenzy, Coffee Break boosts and the golden squirrel
- 85 achievements and unlockable hats, beards and boots
- Music and sound effects for every stage
- Accounts with 3 save profiles each, plus offline earnings. Accounts are local by default and become cloud accounts that work across devices once Firebase is set up (see `SETUP-FIREBASE.md`)

## Controls

- Click the tree or press **Space** to chop
- **Esc** opens the settings menu

## Tests

```
node tests/e2e.js   # full headless playthrough (needs Playwright)
node tests/sim.js   # simulated pacing per stage
node tests/cloud.js # cloud accounts (needs the Firebase emulators, see SETUP-FIREBASE.md)
```
