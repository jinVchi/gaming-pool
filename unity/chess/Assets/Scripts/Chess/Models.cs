using System.Collections.Generic;
using Newtonsoft.Json;

namespace GamingPool.Chess
{
    // Field names mirror the wire protocol exactly (see
    // packages/games/src/chess/module.ts and apps/api/src/matchmaking.ts).

    public class OpenRoom
    {
        [JsonProperty("roomId")] public string RoomId;
        [JsonProperty("hostName")] public string HostName;
        [JsonProperty("playerCount")] public int PlayerCount;
        [JsonProperty("maxPlayers")] public int MaxPlayers;
    }

    public class RoomAssignment
    {
        [JsonProperty("server")] public string Server;
        [JsonProperty("roomId")] public string RoomId;
    }

    public class LobbyPlayer
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("displayName")] public string DisplayName;
        [JsonProperty("ready")] public bool Ready;
    }

    public class LobbyPayload
    {
        [JsonProperty("ownerId")] public string OwnerId;
        [JsonProperty("started")] public bool Started;
        [JsonProperty("players")] public List<LobbyPlayer> Players;
    }

    public class StartedPayload
    {
        [JsonProperty("fen")] public string Fen;
        [JsonProperty("turn")] public string Turn;
        [JsonProperty("white")] public string White;
        [JsonProperty("black")] public string Black;
    }

    public class LastMove
    {
        [JsonProperty("from")] public string From;
        [JsonProperty("to")] public string To;
    }

    public class MovePayload
    {
        [JsonProperty("fen")] public string Fen;
        [JsonProperty("turn")] public string Turn;
        [JsonProperty("lastMove")] public LastMove LastMove;
        [JsonProperty("inCheck")] public bool InCheck;
        [JsonProperty("gameOver")] public bool GameOver;
        [JsonProperty("result")] public string Result;
    }

    public class GameOverPayload
    {
        [JsonProperty("reason")] public string Reason;
        [JsonProperty("winner")] public string Winner;
    }

    public class ErrorPayload
    {
        [JsonProperty("message")] public string Message;
    }
}
