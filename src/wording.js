// What the coach says about a move, for the player's level: turns grades
// (coach.js) and move facts (explain.js) into sentences. Levels: 'beginner'
// (corners, safe discs, no numbers), 'improving' (mobility, frontier, parity)
// and 'strong' (everything, tersely, with disc counts).
import { BLACK, PASS, CORNERS, sqName } from './board.js';
import { GRADES } from './coach.js';

export const COACH_FOR = [
  { key: 'auto', label: 'Match AI strength' },
  { key: 'beginner', label: 'Beginners' },
  { key: 'improving', label: 'Improving players' },
  { key: 'strong', label: 'Strong players' },
];

// 'auto' follows the AI level (index into LEVELS): Pebble to Sprout are for
// beginners, Reed and Stream for improving players, River and up for strong ones.
export function resolveLevel(coachFor, aiLevel) {
  if (coachFor !== 'auto') return coachFor;
  return aiLevel <= 2 ? 'beginner' : aiLevel <= 4 ? 'improving' : 'strong';
}

// The grade each level shows for each underlying grade.
const SHOWN = {
  beginner: { best: 'good', good: 'good', inaccuracy: 'good', mistake: 'mistake', blunder: 'blunder' },
  improving: { best: 'best', good: 'good', inaccuracy: 'good', mistake: 'mistake', blunder: 'blunder' },
  strong: { best: 'best', good: 'good', inaccuracy: 'inaccuracy', mistake: 'mistake', blunder: 'blunder' },
};
const BEGINNER_LABELS = { good: 'Good move', mistake: 'Mistake', blunder: 'Big mistake' };

export const gradeLabel = (key, level) => level === 'beginner' ? BEGINNER_LABELS[key] : GRADES[key].label;

// The grade as a level shows it. Flagged moves are the ones marked on the
// board, the graph and in the review.
export function levelGrade(g, level, facts = []) {
  let key = SHOWN[level][g.grade];
  // Beginners learn most from corners: giving one away is always worth a word.
  if (level === 'beginner' && key === 'good' && g.grade !== 'best' && g.ptLoss >= 3 && facts.some(f => f.type === 'givesCorner')) key = 'mistake';
  return { key, label: gradeLabel(key, level), color: GRADES[key].color, flagged: key !== 'best' && key !== 'good' };
}

const discs = n => `${n} ${Math.abs(n) === 1 ? 'disc' : 'discs'}`;
// "wins by 4", "loses by 2", "draws".
const outcome = m => m > 0 ? `wins by ${m}` : m < 0 ? `loses by ${-m}` : 'draws';

// The sentence after the grade: how the move compares with the coach's choice.
export function verdict(g, level, shown) {
  if (g.grade === 'best') {
    if (!g.exact) return 'Exactly the coach\'s choice.';
    if (g.result < 0) return level === 'beginner' ? 'The best move here, even if the game can\'t be saved.' : `The best move here: with perfect play it still ${outcome(g.result)}, the least possible.`;
    return level === 'beginner' ? (g.result > 0 ? 'Exactly right: this move wins.' : 'Exactly right.') : `Exactly right: with perfect play this ${outcome(g.result)}.`;
  }
  const best = `<b>${sqName(g.bestMove)}</b>`;
  if (!shown.flagged) {
    return g.ptLoss <= 1 ? `About as good as the coach's choice, ${best}.` : `A fine move. The coach slightly preferred ${best}.`;
  }
  if (g.exact && level !== 'beginner') return `With perfect play, ${best} ${outcome(g.bestResult)}; this move ${outcome(g.result)}.`;
  if (level === 'beginner') return g.exact && g.bestResult > 0 && g.result <= 0 ? `The coach would have played ${best}, which wins.` : `The coach would have played ${best}.`;
  const pts = `About <b>${discs(Math.round(g.ptLoss))}</b> worse than ${best}`;
  return level === 'strong' && g.wrLoss >= 0.01 ? `${pts} (win chance −${Math.round(g.wrLoss * 100)}%).` : `${pts}.`;
}

const colorName = c => c === BLACK ? 'Black' : 'White';
const cap = s => s[0].toUpperCase() + s.slice(1);
const cornerName = p => sqName(p);

// Words for the players. ctx.you is the human's colour (0 in study mode, when
// both sides are named by colour).
function words(ctx) {
  const subj = c => c === ctx.you ? 'you' : colorName(c);
  const poss = c => c === ctx.you ? 'your' : `${colorName(c)}'s`;
  const verb = (c, plain, third) => c === ctx.you ? plain : third;
  return { subj, poss, verb };
}

// The coach's explanation of a graded move: one sentence per fact worth
// saying, worded for ctx.level. ctx.shown is the grade as shown, once known.
export function describe(facts, ctx) {
  const { level, mover } = ctx, opp = 3 - mover, w = words(ctx);
  const B = level === 'beginner', S = level === 'strong';
  const find = t => facts.find(f => f.type === t);
  const flagged = !!(ctx.shown && ctx.shown.flagged);
  const good = !!(ctx.shown && !ctx.shown.flagged);
  const out = [];
  const gives = find('givesCorner'), threat = find('threat');
  for (const f of facts) {
    switch (f.type) {
      case 'pass': out.push(`${cap(w.subj(mover))} had no legal move, so ${w.verb(mover, 'you', 'it')} passed.`); break;
      case 'opening': out.push(B ? `This position is a known opening called the <b>${f.name}</b>.` : `The <b>${f.name}</b>.`); break;
      case 'corner':
        out.push(B ? `Takes the ${cornerName(f.corner)} corner. Corner discs can never be flipped, and they make the discs next to them safe too.`
          : S ? `Takes the ${cornerName(f.corner)} corner.` : `Takes the ${cornerName(f.corner)} corner, a disc that can never be flipped.`);
        break;
      case 'xsquare':
        if (gives && gives.corners.includes(f.corner)) break; // the givesCorner line says it
        if (good) out.push(S ? `X-square, but safe here.` : `A move next to the empty ${cornerName(f.corner)} corner (an X-square), but here it doesn't give the corner away.`);
        else if (ctx.shown) out.push(B ? `Careful: a disc diagonally next to an empty corner often lets your opponent take the corner later.`
          : `An X-square next to the empty ${cornerName(f.corner)} corner: it often hands the corner to ${w.subj(opp)} later.`);
        break;
      case 'csquare':
        if (gives && gives.corners.includes(f.corner)) break;
        if (flagged && !B) out.push(`A C-square next to the empty ${cornerName(f.corner)} corner, which can give ${w.subj(opp)} a way into the corner.`);
        break;
      case 'givesCorner': {
        const c = f.corners.map(cornerName).join(' and ');
        const n = f.corners.length > 1 ? 'corners' : 'corner';
        if (!ctx.shown || flagged) out.push(B ? `This lets ${w.subj(opp)} take the ${c} ${n}! Corners are the best squares on the board.`
          : `Gives ${w.subj(opp)} access to the ${c} ${n}.`);
        else if (!S) out.push(`${cap(w.subj(opp))} can now take the ${c} ${n}, but the coach thinks that's fine here.`);
        break;
      }
      case 'blocksCorner': {
        const c = f.corners.map(cornerName).join(' and ');
        out.push(B ? `${cap(w.subj(opp))} could have taken the ${c} corner, and now can't.` : `Takes away ${w.poss(opp)} move to the ${c} corner.`);
        break;
      }
      case 'forcesPass':
        out.push(B ? `${cap(w.subj(opp))} ${w.verb(opp, 'have', 'has')} no move left and must pass, so ${w.subj(mover)} ${w.verb(mover, 'move', 'moves')} again!`
          : `${cap(w.subj(opp))} must pass: ${w.subj(mover)} ${w.verb(mover, 'get', 'gets')} another move.`);
        break;
      case 'mobility': {
        if (facts.some(x => x.type === 'flips' && x.empties <= 10)) break; // near the end, counting moves isn't the point
        if (B) { if (f.theirs <= 2 && good) out.push(`${cap(w.subj(opp))} ${w.verb(opp, 'have', 'has')} only ${f.theirs} ${f.theirs === 1 ? 'move' : 'moves'} left to choose from.`); break; }
        if (f.theirs <= 3 && f.theirs < f.theirsBefore && !flagged) out.push(S ? `Leaves ${colorName(opp)} ${f.theirs} ${f.theirs === 1 ? 'move' : 'moves'}.` : `Leaves ${w.subj(opp)} only ${f.theirs} ${f.theirs === 1 ? 'move' : 'moves'}: fewer choices means ${w.subj(opp)} may soon have to play a bad one.`);
        else if (f.theirs >= f.theirsBefore + 4 && flagged) out.push(S ? `Mobility: ${colorName(opp)} ${f.theirsBefore} → ${f.theirs} moves.` : `Gives ${w.subj(opp)} more choices: ${f.theirs} moves instead of ${f.theirsBefore}.`);
        break;
      }
      case 'flips': {
        if (f.n >= 6 && f.empties > 20 && flagged) {
          out.push(B ? `Flips ${f.n} discs. Having more discs early isn't an advantage: every disc next to an empty square gives your opponent something to flip.`
            : `Flips ${f.n} discs, ${f.exposed} of them on the frontier: more targets and more moves for ${w.subj(opp)}.`);
        } else if (f.n <= 2 && f.exposed === 0 && good && f.empties > 12 && !S) {
          out.push(B ? 'A quiet move: it flips only discs in the middle of your group.' : `A quiet move: it flips only inside discs and opens nothing new for ${w.subj(opp)}.`);
        }
        break;
      }
      case 'stable':
        out.push(B ? `Makes ${f.gain} discs safe for good: they can never be flipped.` : S ? `+${f.gain} stable discs (${f.total}).` : `Gains ${f.gain} stable discs, which can never be flipped.`);
        break;
      case 'parity':
        if (B) break;
        if (f.odd && good && f.size <= 5) out.push(S ? `Parity: odd region (${f.size}).` : `Plays into a region with an odd number of empty squares (${f.size}), so ${w.subj(mover)} can expect the last move there.`);
        else if (!f.odd && flagged) out.push(S ? `Parity: even region (${f.size}).` : `Plays into an even region (${f.size} empties): ${w.subj(opp)} is likely to get the last move there.`);
        break;
      case 'wipeout': out.push(`Wipeout: ${w.subj(opp)} ${w.verb(opp, 'have', 'has')} no discs left!`); break;
      case 'threat':
        if (!gives || !gives.corners.includes(f.move)) out.push(`${cap(w.subj(opp))} can now take the ${cornerName(f.move)} corner.`);
        break;
      case 'reply':
        if (S) out.push(`Best reply: ${sqName(f.move)}.`);
        break;
      case 'vsBest': {
        if (!flagged) break; // only a mistake needs the comparison
        const b = `<b>${sqName(f.best)}</b>`;
        if (f.why === 'corner') out.push(B ? `${b} would have taken the ${cornerName(f.corner)} corner.` : `${b} takes the ${cornerName(f.corner)} corner.`);
        else if (f.why === 'keepsCorner') { if (!gives) out.push(`After ${b}, ${w.subj(opp)} couldn't reach the ${f.corners.map(cornerName).join(' or ')} corner.`); }
        else if (f.why === 'pass') out.push(B ? `${b} would have left ${w.subj(opp)} with no move at all, so ${w.subj(opp)} would have had to pass.` : `${b} leaves ${w.subj(opp)} no move: a pass.`);
        else if (f.why === 'mobility') out.push(B ? `After ${b}, ${w.subj(opp)} would have had fewer moves to choose from (${f.theirs} instead of ${f.mine}). Fewer choices often forces bad moves later.`
          : S ? `${b}: ${colorName(opp)} mobility ${f.theirs} vs ${f.mine}.` : `${b} leaves ${w.subj(opp)} ${f.theirs} moves instead of ${f.mine}: keeping ${w.poss(opp)} choices low is the key idea in the midgame.`);
        else if (f.why === 'frontier') { if (!B) out.push(S ? `${b}: frontier ${f.theirs} vs ${f.mine}.` : `${b} keeps ${w.poss(mover)} discs more tucked in: ${f.theirs} frontier discs instead of ${f.mine}.`); }
        else if (f.why === 'ownMobility') { if (!B) out.push(S ? `${b}: own mobility ${f.theirs} vs ${f.mine}.` : `${b} keeps more options for ${w.subj(mover)}: ${f.theirs} possible moves next time instead of ${f.mine}.`); }
        else if (f.why === 'stable') out.push(B ? `${b} would have made ${f.gain} more discs safe for good.` : `${b} gains ${f.gain} more stable discs.`);
        else if (f.why === 'parity') { if (!B) out.push(S ? `${b}: odd region (${f.size}).` : `${b} plays into an odd region (${f.size} empties), keeping the last move there for ${w.subj(mover)}.`); }
        else if (f.why === 'cornerLine') out.push(B ? `With ${b}, ${w.subj(mover)} could have won the ${cornerName(f.corner)} corner a few moves later.` : `${b} leads to ${w.subj(mover)} taking the ${cornerName(f.corner)} corner.`);
        break;
      }
      case 'cornerSoon':
        if (!flagged) break;
        out.push(B ? `This gives ${w.subj(opp)} a way to take the ${cornerName(f.corner)} corner a few moves from now.` : `${cap(w.subj(opp))} can now work towards the ${cornerName(f.corner)} corner (the coach sees it ${f.plies} moves ahead).`);
        break;
      case 'exact': {
        const [m, o] = f.discs;
        if (B) out.push(f.score > 0 ? `From here ${w.subj(mover)} can win for sure with perfect play.` : f.score < 0 ? `From here ${w.subj(opp)} can win with perfect play.` : 'With perfect play this ends in a draw.');
        else if (!f.score) out.push('With perfect play from here, it\'s a draw.');
        else {
          const winner = f.score > 0 ? mover : opp, by = Math.abs(f.score);
          out.push(`With perfect play from here, ${w.subj(winner)} ${w.verb(winner, 'win', 'wins')} by ${by} (${Math.max(m, o)}–${Math.min(m, o)}).`);
        }
        break;
      }
    }
  }
  if (flagged && !out.length && !ctx.intent) out.push('The reason is deeper than a single move: press <b>Show</b> to see how the coach expects play to go.');
  return out;
}

// A short note on an ungraded (AI) move: only what the player must react to.
export function describeNote(facts, ctx) {
  const opp = 3 - ctx.mover, w = words(ctx), out = [];
  for (const f of facts) {
    if (f.type === 'corner') out.push(`Takes the ${cornerName(f.corner)} corner.`);
    else if (f.type === 'forcesPass') out.push(`${cap(w.subj(opp))} ${w.verb(opp, 'have', 'has')} no move and must pass.`);
    else if (f.type === 'givesCorner') out.push(`${cap(w.subj(opp))} can take the ${f.corners.map(cornerName).join(' or ')} corner!`);
    else if (f.type === 'opening') out.push(`The ${f.name}.`);
    else if (f.type === 'wipeout') out.push('Wipeout!');
  }
  return out;
}

// Live notes about the position for the side to move: corners on offer,
// or no move at all.
export function positionNotes(board, names) {
  const me = board.toPlay, moves = board.legalMoves(me), out = [];
  if (board.isOver) return out;
  if (!moves.length) { out.push({ kind: 'warn', text: `${names.who(me)} ${names.who(me) === 'You' ? 'have' : 'has'} no legal move and must pass.` }); return out; }
  const corners = moves.filter(p => CORNERS.includes(p));
  if (corners.length) out.push({ kind: 'chance', text: `${names.who(me)} can take the ${corners.map(sqName).join(' or ')} corner.` });
  // Corners the opponent could take if it were their move: a threat to answer.
  const theirs = board.legalMoves(3 - me).filter(p => CORNERS.includes(p) && !corners.includes(p));
  if (theirs.length) {
    const them = names.who(3 - me), you = names.who(me) === 'You';
    out.push({ kind: 'warn', text: `${them} ${them === 'You' ? 'threaten' : 'threatens'} to take the ${theirs.map(sqName).join(' and ')} corner${theirs.length > 1 ? 's' : ''}${you ? '. Can you stop it, or make it cost them?' : '.'}` });
  }
  if (moves.length === 1) out.push({ kind: 'warn', text: `Only one legal move: ${sqName(moves[0])}.` });
  return out;
}

export { PASS };
