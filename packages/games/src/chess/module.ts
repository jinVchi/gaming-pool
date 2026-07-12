import { Chess } from "chess.js";
import type { Player } from "@gaming-pool/shared";
import type { GameModule, RoomContext } from "../types";

interface ChessPlayerInfo {
  id: string;
  displayName: string;
  ready: boolean;
}

interface ChessModuleState {
  ctx: RoomContext;
  ownerId: string | null;
  players: Map<string, ChessPlayerInfo>;
  started: boolean;
  chess: Chess | null;
  white: string | null;
  black: string | null;
}

function serializeLobby(state: ChessModuleState) {
  return {
    type: "lobby",
    payload: {
      ownerId: state.ownerId,
      started: state.started,
      players: [...state.players.values()].map((p) => ({
        id: p.id,
        displayName: p.displayName,
        ready: p.ready,
      })),
    },
  };
}

function gameResult(chess: Chess): string | null {
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isDraw()) return "draw";
  return null;
}

function serializeMove(chess: Chess, from: string, to: string) {
  return {
    type: "move",
    payload: {
      fen: chess.fen(),
      turn: chess.turn(),
      lastMove: { from, to },
      inCheck: chess.inCheck(),
      gameOver: chess.isGameOver(),
      result: gameResult(chess),
    },
  };
}

export const chessModule: GameModule<ChessModuleState> = {
  createState(_roomId, ctx) {
    return { ctx, ownerId: null, players: new Map(), started: false, chess: null, white: null, black: null };
  },

  onJoin(state, player: Player) {
    if (state.players.size === 0) state.ownerId = player.id;
    state.players.set(player.id, { id: player.id, displayName: player.displayName, ready: false });
    state.ctx.broadcast(serializeLobby(state));
  },

  onLeave(state, playerId) {
    state.players.delete(playerId);

    if (state.started && (playerId === state.white || playerId === state.black)) {
      const winner = playerId === state.white ? state.black : state.white;
      state.ctx.broadcast({ type: "gameover", payload: { reason: "opponent_left", winner } });
      return;
    }

    if (playerId === state.ownerId) {
      state.ownerId = [...state.players.keys()][0] ?? null;
    }
    state.ctx.broadcast(serializeLobby(state));
  },

  onMessage(state, playerId, message) {
    if (typeof message !== "object" || message === null) return;
    const { type, payload } = message as { type?: unknown; payload?: unknown };

    if (type === "ready") {
      if (state.started) return;
      const player = state.players.get(playerId);
      if (!player || playerId === state.ownerId) return;
      player.ready = true;
      state.ctx.broadcast(serializeLobby(state));
      return;
    }

    if (type === "start") {
      if (state.started || playerId !== state.ownerId) {
        state.ctx.send(playerId, { type: "error", payload: { message: "only the room owner can start" } });
        return;
      }
      if (state.players.size !== 2) {
        state.ctx.send(playerId, { type: "error", payload: { message: "need 2 players to start" } });
        return;
      }
      const guest = [...state.players.values()].find((p) => p.id !== state.ownerId);
      if (!guest?.ready) {
        state.ctx.send(playerId, { type: "error", payload: { message: "the other player is not ready" } });
        return;
      }

      state.chess = new Chess();
      state.white = state.ownerId;
      state.black = guest.id;
      state.started = true;

      state.ctx.broadcast({
        type: "started",
        payload: { fen: state.chess.fen(), turn: state.chess.turn(), white: state.white, black: state.black },
      });
      return;
    }

    if (type === "move") {
      if (!state.started || !state.chess) return;

      const expectedPlayer = state.chess.turn() === "w" ? state.white : state.black;
      if (playerId !== expectedPlayer) {
        state.ctx.send(playerId, { type: "error", payload: { message: "not your turn" } });
        return;
      }

      const { from, to, promotion } = (payload ?? {}) as { from?: unknown; to?: unknown; promotion?: unknown };
      if (typeof from !== "string" || typeof to !== "string") return;

      try {
        state.chess.move({ from, to, promotion: typeof promotion === "string" ? promotion : undefined });
      } catch {
        state.ctx.send(playerId, { type: "error", payload: { message: "illegal move" } });
        return;
      }

      state.ctx.broadcast(serializeMove(state.chess, from, to));
    }
  },

  tick() {
    // Chess is turn-based — nothing to simulate per tick.
  },
};
