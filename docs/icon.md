`icon.png` is original artwork: an accent-pink clock face with dark hands,
drawn by `tools/make-icons.mjs` in the app's own palette (`page/theme.js`). The
same script writes `favicon.png` at the root and the play and stop marks. Zeus
resizes it to 124x124 for the Bip Max at build time.

It borrows no third-party brand mark, so it is fine to ship in a store listing.
Run `node tools/make-icons.mjs` after changing it.
