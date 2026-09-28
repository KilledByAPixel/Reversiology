// Puzzles: positions where one move is clearly best, found by
// tools/gen-puzzles.js in games between the AI levels and checked by a deep
// read or an exact solve. [board, side to move, answers, theme, difficulty
// (1 easy, 2 medium, 3 hard), how much the answer gains over the next best
// move (discs), exact].
export const PUZZLES = [
  ['--XXXXX-O-OXOX--OOXXXX--OXXXXXX-OOXXX----OOXX-----XX------X-----', 'O', 'f5', 'quiet', 1, 12, 0],
  ['--XXXXX-O-OXOX--OOXOXX--OXXXOXX-OOOOXX---OOXXX----XX------X-----', 'O', 'g5', 'quiet', 1, 18, 0],
  ['-XOOOOO--XXXXXX-OX-XOXXXXXXXXOX--XXXXXX---XXXX-X---X-------X----', 'O', 'a1', 'corner', 1, 25, 0],
  ['--XXXXX-OOOXOX--OOOOXX--OXXXOXXXOOXOOOX-OOOXXX--X-XX------X-----', 'X', 'a1', 'corner', 1, 16, 0],
  ['--OX------XXXO-----XOXXXXXXXXOX--XXXXXX---XXXX-X---X-------X----', 'O', 'e1', 'quiet', 2, 19, 0],
  ['XOOOOOOOXOOXXOOOXOXOOOOOXXXOOOXXXXXOOOX-XXXXXXX-XXXXX-XO--XXX---', 'O', 'h8', 'corner', 2, 10, 1],
  ['XOOOOOOOXOOXXOOOXOXOOOOOXXXOOOXXXXXOOOX-XXXXXOX-XXXXX-XO--XXX-XO', 'O', 'f8', 'pass', 2, 8, 1],
];
