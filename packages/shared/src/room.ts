export type RoomPolicy = "auto" | "created";

export interface GameConfig {
  policy: RoomPolicy;
  maxPlayers: number;
  joinCode?: boolean;
  fillStrategy?: "fullest";
}

export interface RoomAssignment {
  server: string;
  roomId: string;
}

export interface Player {
  id: string;
  displayName: string;
  isGuest: boolean;
}
