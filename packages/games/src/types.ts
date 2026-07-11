import type { Player } from "@gaming-pool/shared";

export interface GameModule<TState = unknown> {
  createState(roomId: string): TState;
  onJoin(state: TState, player: Player): void;
  onLeave(state: TState, playerId: string): void;
  onMessage(state: TState, playerId: string, message: unknown): void;
  tick(state: TState, dtMs: number): void;
}
