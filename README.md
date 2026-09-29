# Reversiology

Learn Reversi by playing. Take on an AI from beginner to superhuman while a
coach grades every move, explains why, and shows you what it would have played.

## ▶ [Play Reversiology in your browser](https://killedbyapixel.github.io/Reversiology/)

![Reversiology: a game in progress with the coach panel and game graph](screenshot.png)

## What you get

- **Play at your level.** Nine AI levels, from nearly random to as strong as
  the best Reversi programs.
- **A coach for every move.** A grade and a plain reason: a corner given
  away, a risky square, too many moves left for your opponent. It talks to
  beginners about corners and safe discs, and to stronger players about
  mobility, frontier and parity. Or have it keep its move to itself after a
  mistake, so you can find the better one yourself.
- **Review and experiment.** Take back any move, try other lines, and see
  your mistakes marked on a graph of the game.
- **Puzzles.** 156 positions from real games where one move is clearly best,
  from easy to hard, each with a hint and an explanation.
- **Perfect endgames.** In the last moves the coach works the game out exactly
  and tells you who wins, and by how much.
- **Openings.** The coach names the opening you're in: Tiger, Rose, Buffalo
  and 70 more.
- **See what strong players see.** Legal moves, a flip preview, danger
  squares next to empty corners, stable discs and more, right on the board.
- **Your way.** Play Black, White or both sides, with or without handicap
  corners, and play by keyboard, with a screen reader or with spoken
  announcements.

The rules and a short guide to strategy are in the game itself.

## How strong is it?

Pebble plays almost at random, and each level is a clear step up from the one
below it. Phoenix, the strongest, reads 22 moves ahead, plays the last 22
perfectly, and plays at the level of the best Reversi programs, in about a
second a move.

Against [Edax](https://github.com/abulmo/edax-reversi), one of the strongest:

| Edax level | Phoenix |
|---|---|
| 21 (reads 21 ahead, last 24 perfect) | 6 wins, 5 losses, 1 draw |
| 18 | 6 wins, 6 losses |
| 16 | 11 wins, 9 losses |
| 12 | 14 wins, 5 losses, 1 draw |

© 2026 Frank Force. Free and open source under the [GPL-3.0 license](LICENSE).
The AI uses evaluation weights from [Edax](https://github.com/abulmo/edax-reversi)
by Richard Delorme. Opening names come from
[Egaroucid](https://github.com/Nyanyan/Egaroucid)'s list, after the Othello
opening list by Robert Gatliff and others.
