using System;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace GamingPool.Chess
{
    public enum ClientState { Browsing, Connecting, Waiting, Playing, GameOver }

    // Orchestrates the whole client flow: browse/create/join rooms via the
    // Global API (HTTP), then connect directly to the game-server over
    // WebSocket for everything after that — matchmaking never proxies game
    // traffic (see AGENTS.md core architecture rules).
    public class GameManager : MonoBehaviour
    {
        [Header("Network")]
        [SerializeField] private NetworkClient networkClient;
        [SerializeField] private ApiClient apiClient;

        [Header("Panels")]
        [SerializeField] private LobbyBrowserUI lobbyBrowser;
        [SerializeField] private WaitingRoomUI waitingRoom;
        [SerializeField] private BoardRenderer board;
        [SerializeField] private GameObject gameOverPanel;
        [SerializeField] private Text gameOverText;
        [SerializeField] private Button backToLobbyButton;
        [SerializeField] private Text statusText;

        private string _playerId;
        private string _displayName;
        private string _localColor = "w";

        public ClientState State { get; private set; } = ClientState.Browsing;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern string GPGetPlayerIdentity();
#endif

        // The web shell owns identity (Better Auth user or persisted guest) and
        // exposes it via window.__gamingPoolPlayer; a random fallback only
        // applies outside the browser (Editor play mode / standalone).
        private void ResolveIdentity()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            try
            {
                var json = GPGetPlayerIdentity();
                if (!string.IsNullOrEmpty(json))
                {
                    var identity = JObject.Parse(json);
                    _playerId = identity["playerId"]?.ToString();
                    _displayName = identity["displayName"]?.ToString();
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"Failed to read player identity from web shell: {e.Message}");
            }
#endif
            if (string.IsNullOrEmpty(_playerId))
            {
                _playerId = Guid.NewGuid().ToString("N");
                _displayName = $"Player-{_playerId.Substring(0, 4)}";
            }
        }

        private void Start()
        {
            ResolveIdentity();

            networkClient.OnOpen += () => SetStatus(null);
            networkClient.OnMessage += HandleMessage;
            networkClient.OnClose += (code) => SetStatus($"Disconnected (code {code}).");
            networkClient.OnError += (message) => SetStatus($"Connection error: {message}");

            lobbyBrowser.OnCreateRoom += HandleCreateRoom;
            lobbyBrowser.OnJoinRoom += HandleJoinRoom;
            waitingRoom.OnReadyClicked += () => networkClient.Send("{\"type\":\"ready\"}");
            waitingRoom.OnStartClicked += () => networkClient.Send("{\"type\":\"start\"}");
            board.OnMoveAttempted += HandleMoveAttempted;
            if (backToLobbyButton != null) backToLobbyButton.onClick.AddListener(BackToLobby);

            ShowBrowsing();
        }

        private void ShowBrowsing()
        {
            State = ClientState.Browsing;
            lobbyBrowser.gameObject.SetActive(true);
            waitingRoom.gameObject.SetActive(false);
            board.gameObject.SetActive(false);
            gameOverPanel.SetActive(false);
            lobbyBrowser.Refresh(apiClient);
        }

        private void HandleCreateRoom()
        {
            SetStatus("Creating room...");
            apiClient.CreateRoom(_playerId, _displayName, ConnectToRoom, (error) => SetStatus($"Failed to create room: {error}"));
        }

        private void HandleJoinRoom(string roomId)
        {
            SetStatus("Joining room...");
            apiClient.JoinRoom(
                roomId,
                _playerId,
                ConnectToRoom,
                (error) =>
                {
                    SetStatus($"Failed to join room: {error}");
                    lobbyBrowser.Refresh(apiClient);
                });
        }

        private void ConnectToRoom(RoomAssignment assignment)
        {
            State = ClientState.Connecting;
            lobbyBrowser.gameObject.SetActive(false);
            var url = $"{assignment.Server}/?roomId={assignment.RoomId}&playerId={_playerId}&displayName={UnityWebRequest.EscapeURL(_displayName)}";
            networkClient.Connect(url);
        }

        private void HandleMessage(string json)
        {
            JObject root;
            try
            {
                root = JObject.Parse(json);
            }
            catch (Exception)
            {
                return;
            }

            var type = root["type"]?.ToString();
            var payload = root["payload"];
            if (payload == null) return;

            switch (type)
            {
                case "lobby":
                    ShowWaitingRoom(payload.ToObject<LobbyPayload>());
                    break;
                case "started":
                    ShowBoard(payload.ToObject<StartedPayload>());
                    break;
                case "move":
                    var move = payload.ToObject<MovePayload>();
                    board.ApplyMove(move);
                    SetStatus(move.GameOver ? null : (move.Turn == _localColor ? "Your turn" : "Opponent's turn"));
                    if (move.GameOver) ShowGameOverFromMove(move);
                    break;
                case "gameover":
                    ShowGameOver(payload.ToObject<GameOverPayload>());
                    break;
                case "error":
                    SetStatus(payload.ToObject<ErrorPayload>().Message);
                    break;
            }
        }

        private void ShowWaitingRoom(LobbyPayload lobby)
        {
            State = ClientState.Waiting;
            waitingRoom.gameObject.SetActive(true);
            board.gameObject.SetActive(false);
            gameOverPanel.SetActive(false);
            waitingRoom.Render(lobby, _playerId);
        }

        private void ShowBoard(StartedPayload started)
        {
            State = ClientState.Playing;
            _localColor = started.White == _playerId ? "w" : "b";
            waitingRoom.gameObject.SetActive(false);
            board.gameObject.SetActive(true);
            gameOverPanel.SetActive(false);
            board.Initialize(started.Fen, _localColor);
            SetStatus(started.Turn == _localColor ? "Your turn" : "Opponent's turn");
        }

        private void HandleMoveAttempted(string from, string to, string promotion)
        {
            var payload = new JObject { ["from"] = from, ["to"] = to };
            if (!string.IsNullOrEmpty(promotion)) payload["promotion"] = promotion;
            var msg = new JObject { ["type"] = "move", ["payload"] = payload };
            networkClient.Send(msg.ToString(Newtonsoft.Json.Formatting.None));
        }

        private void ShowGameOverFromMove(MovePayload move)
        {
            var message = move.Result switch
            {
                "checkmate" => (move.Turn == "w" ? "Black" : "White") + " wins by checkmate",
                "stalemate" => "Draw by stalemate",
                "draw" => "Draw",
                _ => "Game over",
            };
            ShowGameOverMessage(message);
        }

        private void ShowGameOver(GameOverPayload payload)
        {
            var message = payload.Reason == "opponent_left" ? "Opponent disconnected — you win" : "Game over";
            ShowGameOverMessage(message);
        }

        private void ShowGameOverMessage(string message)
        {
            State = ClientState.GameOver;
            board.gameObject.SetActive(true);
            gameOverPanel.SetActive(true);
            if (gameOverText != null) gameOverText.text = message;
        }

        private void BackToLobby()
        {
            networkClient.Close();
            ShowBrowsing();
        }

        private void SetStatus(string message)
        {
            if (statusText == null) return;
            statusText.gameObject.SetActive(!string.IsNullOrEmpty(message));
            statusText.text = message ?? string.Empty;
        }
    }
}
