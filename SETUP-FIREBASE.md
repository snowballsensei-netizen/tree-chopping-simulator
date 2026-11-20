# Cloud accounts setup (Firebase, free Spark plan)

Without this the game uses local accounts, which only work in one browser. With it, the same account and saves work on every device.

1. Go to https://console.firebase.google.com and click **Add project** (Google Analytics is not needed).
2. In the project, click the **Web** icon (`</>`) to add a Web app. You don't need Hosting. Copy the `firebaseConfig` object it shows.
3. Go to **Build > Authentication > Get started > Sign-in method**, turn on **Email/Password** and click Save.
4. Go to **Build > Firestore Database > Create database**, pick a location and choose **production mode**.
5. In Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules` and click **Publish**.
6. Go to **Authentication > Settings > Authorized domains** and add `snowballsensei-netizen.github.io`. `localhost` is already on the list.
7. Open `js/firebase-config.js` and replace `null` with the config you copied, for example:
   ```js
   TCS.FIREBASE_CONFIG = { apiKey: "...", authDomain: "your-project.firebaseapp.com", projectId: "your-project",
     storageBucket: "your-project.appspot.com", messagingSenderId: "...", appId: "..." };
   ```
   The web config is meant to be public, so committing it is fine. The rules are what protect the data.
8. Commit and push. Then **create the `Shiv` account straight away**. The admin is whoever owns the username `shiv`.

Notes
- Usernames become `<name>@players.treechopping.game` logins. There is no real email, so a forgotten password can only be reset by the owner (Authentication > Users).
- Cloud sign-in needs `http(s)`. When the game is opened from `file://`, Firebase sign-in may be blocked, but a session that was already signed in still plays from the local cache.
- Players who had local accounts on a device get moved to the cloud automatically the first time they log in on that device.
- Testing on your own machine: `npx firebase-tools emulators:start --only auth,firestore --project demo-tcs` (needs Java 11+), then `node tests/cloud.js`.
- Friends + duels (added later): no console setup besides the rules. **Re-publish `firestore.rules`** (step 5) after updating the game, or friend requests and duels fail with permission errors. They use the collections `friendReqs`, `friends`, `presence` and `duels`. Firestore may log a link to create an index the first time; the game only uses single-field queries, so none should be needed.
- Emulator tests need Java 21+ for current firebase-tools (e.g. PrismLauncher's Java 25 under `%APPDATA%\PrismLauncher\java\java-runtime-epsilon`; put its `bin` first on PATH).
