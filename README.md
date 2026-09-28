# Reversiology

Learn Reversi by playing. Games against an AI that scales from almost random
to superhuman, with a coach that grades every move, explains what happened,
and shows you what it would have played.

## ▶ [Play Reversiology in your browser](https://killedbyapixel.github.io/Reversiology/)

## What you get

- **An opponent at your level.** Nine AI levels from Pebble to Phoenix, all
  played by the same engine, plus handicap corners. After a lopsided game it
  suggests a better match. Play Black, White, or both sides in study mode.
- **A coach that watches every move.** Win bar, expected result in discs,
  and a grade for each move with a plain-language reason: corners given away,
  risky squares, how many moves you left your opponent, frontier and stable
  discs, parity near the end. Set **Coach explains for** to match your
  experience. **Show** puts the coach's move and its expected continuation on
  the board; **Try it instead** plays it for you.
- **Exact endgames.** In the last 14 to 18 moves (depending on the coach
  depth) the coach plays the game out perfectly: it tells you who wins with
  best play, and by how many discs each move wins or loses.
- **Puzzles.** Positions from real games where one move is clearly best,
  checked by a deep read or an exact solve: take the corner, force a pass,
  find the quiet move, win the endgame on parity. Easy, medium and hard, with
  a hint for each and an explanation of the answer.
- **Openings.** The coach names the opening you're in (Tiger, Rose, Buffalo,
  and 70 more) and can mark the book moves that continue a named line.
- **See the board like a stronger player.** Overlays for legal moves, a flip
  preview, danger squares next to empty corners, stable discs, frontier discs,
  best moves and move numbers. Press **Their idea** to see what your opponent
  would play if it were their move.
- **Play by keyboard or by ear.** Tab to the board and play with the arrow
  keys and Enter. Screen readers hear every move and the coach's comments,
  or turn on **Speak announcements** to have them read aloud.
- **Take back freely.** Undo any move, try something else, and switch between
  the variations you've created.
- **Review your games.** A game graph with mistakes marked. Click to jump to
  any move. Save and load games as move lists (`f5d6c3d3c4…`), variations
  included. Your current game is saved automatically.

Keyboard shortcuts and a short guide to the rules and strategy are in the game
itself.

## How strong is it?

The engine is written from scratch in JavaScript for this project: bitboard
move generation, a principal variation search with a transposition table and
ProbCut, and an exact endgame solver. It evaluates positions with the pattern
weights of [Edax](https://github.com/abulmo/edax-reversi), one of the
strongest Reversi programs, converted to Reversiology's format. Searching to
the same depth, it scores even against Edax (10 wins and 10 losses at depth 6).

The levels below Dragon are held back on purpose: they read fewer moves ahead,
choose among their options more loosely, and now and then make a typical
beginner's move (grabbing the most discs). In self-play each level beat the
one below it in 7 to 9 games out of 10, from Pebble, which plays almost at
random, up to Dragon. Phoenix won every game against Dragon.

Against Edax as an outside yardstick: Mountain beat Edax at level 2 in 18
games of 20, and Dragon beat Edax at level 6 in 12 of 20. Dragon reads 6 moves
ahead and plays the last 14 perfectly; Phoenix reads 16 ahead, plays the last
20 perfectly, and is far beyond any human player.

## Development

No build step: open `index.html` through any static web server
(`python3 -m http.server`). Everything is plain ES modules.

- `npm test` runs the tests (node 20+).
- Every push to `main` publishes the game to GitHub Pages
  (`.github/workflows/pages.yml`): it runs the tests, then `tools/build.js`
  bundles the code and stamps every file with a hash of its contents, so
  visitors never mix cached old files with new ones; the page reloads once if
  a newer version is out.
- `node tools/build.js` builds the same site in `dist/`, with a zip ready to
  upload to hosts such as itch.io.
- `tools/levels.js` plays levels against each other, `tools/edax-match.js`
  plays against Edax, `tools/ffo.js` solves the FFO endgame test positions,
  `tools/bench.js` measures search speed, `tools/winrate.js` fits the win
  chance shown by the coach, `tools/explain-demo.js` prints everything the
  coach says about a game, and `tools/gen-puzzles.js` finds and checks puzzles.
- `tools/convert-edax.js` converts Edax's `eval.dat` into `weights/eval.bin.gz`,
  and `tools/gen-openings.js` builds `src/openings.js` from Egaroucid's list.

© 2026 Frank Force. Free and open source under the [GPL-3.0 license](LICENSE).
The evaluation weights come from [Edax](https://github.com/abulmo/edax-reversi)
by Richard Delorme (GPL-3.0). The opening names come from
[Egaroucid](https://github.com/Nyanyan/Egaroucid)'s list (GPL-3.0), which
credits the Othello opening list by Robert Gatliff and others.
