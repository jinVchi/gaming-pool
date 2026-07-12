using System.Collections.Generic;
using Newtonsoft.Json;

namespace GamingPool.Snake
{
    // Field names mirror the wire protocol exactly (see
    // packages/games/src/snake/module.ts serializeState / onJoin / tick).
    public class Cell
    {
        [JsonProperty("x")] public int X;
        [JsonProperty("y")] public int Y;
    }

    public class SnakeView
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("displayName")] public string DisplayName;
        [JsonProperty("color")] public string Color;
        [JsonProperty("segments")] public List<Cell> Segments;
        [JsonProperty("alive")] public bool Alive;
        [JsonProperty("score")] public int Score;
    }

    public class WelcomePayload
    {
        [JsonProperty("playerId")] public string PlayerId;
        [JsonProperty("gridSize")] public int GridSize;
    }

    public class StatePayload
    {
        [JsonProperty("gridSize")] public int GridSize;
        [JsonProperty("food")] public List<Cell> Food;
        [JsonProperty("snakes")] public List<SnakeView> Snakes;
    }

    public class DiedPayload
    {
        [JsonProperty("score")] public int Score;
    }
}
