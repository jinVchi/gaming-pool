import type { Player } from "@gaming-pool/shared";

export interface RoomContext {
  broadcast(message: unknown): void;
  send(playerId: string, message: unknown): void;
}

export interface GameModule<TState = unknown> {
  createState(roomId: string, ctx: RoomContext): TState;
  onJoin(state: TState, player: Player): void;
  onLeave(state: TState, playerId: string): void;
  onMessage(state: TState, playerId: string, message: unknown): void;
  tick(state: TState, dtMs: number): void;
}
