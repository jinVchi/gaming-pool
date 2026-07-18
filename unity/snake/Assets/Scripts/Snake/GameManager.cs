using System;
using System.Collections;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace GamingPool.Snake
{
    // Orchestrates the whole client flow: hit the Global API's matchmaking
    // endpoint to get { server, roomId }, connect directly to that game-server
    // over WebSocket (client never proxies game traffic through the API), then
    // relay state updates to the renderers and input to the server.
    public class GameManager : MonoBehaviour
    {
        [Header("Global API")]
        [SerializeField] private string apiBaseUrl = "http://localhost:4000";
        [SerializeField] private string gameSlug = "snake";

        [Header("Scene references")]
        [SerializeField] private NetworkClient networkClient;
        [SerializeField] private SnakeRenderer snakeRenderer;
        [SerializeField] private FoodRenderer foodRenderer;
        [SerializeField] private Text statusText;
        [SerializeField] private Text scoreText;
        [SerializeField] private GameObject gameOverPanel;

        private string _playerId;
        private string _displayName;
        private string _playerToken;
        private string _localPlayerId;
        private Direction _lastSentDirection = Direction.None;
        private bool _isDead;

        private enum Direction { None, Up, Down, Left, Right }

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern string GPGetPlayerIdentity();
        [DllImport("__Internal")] private static extern string GPGetApiBaseUrl();
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
                    _playerToken = identity["token"]?.ToString();
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

        private void ResolveApiBaseUrl()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            var configuredUrl = GPGetApiBaseUrl();
            if (!string.IsNullOrEmpty(configuredUrl)) apiBaseUrl = configuredUrl.TrimEnd('/');
#endif
        }

        private void Start()
        {
            ResolveApiBaseUrl();
            ResolveIdentity();
            networkClient.OnOpen += HandleOpen;
            networkClient.OnMessage += HandleMessage;
            networkClient.OnClose += HandleClose;
            networkClient.OnError += HandleError;

            if (gameOverPanel != null) gameOverPanel.SetActive(false);
            SetStatus("Finding a match...");
            StartCoroutine(PreparePlayerAndMatchmake());
        }

        // Editor play mode has no web-shell token, so mint a guest credential
        // through the same API exchange before entering matchmaking.
        private IEnumerator PreparePlayerAndMatchmake()
        {
            if (string.IsNullOrEmpty(_playerToken))
            {
                var credentialBody = new JObject
                {
                    ["guestCredential"] = Guid.NewGuid().ToString("N"),
                    ["displayName"] = _displayName,
                }.ToString(Newtonsoft.Json.Formatting.None);
                using var credentialRequest = new UnityWebRequest($"{apiBaseUrl}/player-token", "POST");
                credentialRequest.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(credentialBody));
                credentialRequest.downloadHandler = new DownloadHandlerBuffer();
                credentialRequest.SetRequestHeader("Content-Type", "application/json");
                yield return credentialRequest.SendWebRequest();

                if (credentialRequest.result != UnityWebRequest.Result.Success)
                {
                    SetStatus($"Player authentication failed: {credentialRequest.error}");
                    yield break;
                }

                var credential = JObject.Parse(credentialRequest.downloadHandler.text);
                _playerId = credential["playerId"]?.ToString();
                _displayName = credential["displayName"]?.ToString();
                _playerToken = credential["token"]?.ToString();
                if (string.IsNullOrEmpty(_playerId) || string.IsNullOrEmpty(_playerToken))
                {
                    SetStatus("Player authentication returned an unexpected response.");
                    yield break;
                }
            }

            yield return Matchmake();
        }

        private IEnumerator Matchmake()
        {
            var url = $"{apiBaseUrl}/matchmake/{gameSlug}";
            using var request = new UnityWebRequest(url, "POST");
            var body = Encoding.UTF8.GetBytes("{}");
            request.uploadHandler = new UploadHandlerRaw(body);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Authorization", $"Bearer {_playerToken}");

            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                SetStatus($"Matchmaking failed: {request.error}");
                yield break;
            }

            var json = JObject.Parse(request.downloadHandler.text);
            var server = json["server"]?.ToString();
            var roomId = json["roomId"]?.ToString();
            if (string.IsNullOrEmpty(server) || string.IsNullOrEmpty(roomId))
            {
                SetStatus("Matchmaking returned an unexpected response.");
                yield break;
            }

            var wsUrl = $"{server}/?roomId={roomId}";
            SetStatus("Connecting...");
            networkClient.Connect(wsUrl, _playerToken);
        }

        private void HandleOpen()
        {
            SetStatus(null);
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
                case "welcome":
                    var welcome = payload.ToObject<WelcomePayload>();
                    _localPlayerId = welcome.PlayerId;
                    break;
                case "state":
                    var state = payload.ToObject<StatePayload>();
                    snakeRenderer.Render(state.Snakes);
                    foodRenderer.Render(state.Food);
                    UpdateScore(state);
                    break;
                case "died":
                    var died = payload.ToObject<DiedPayload>();
                    ShowGameOver(died.Score);
                    break;
            }
        }

        private void HandleClose(int code)
        {
            if (_isDead) return;
            SetStatus($"Disconnected (code {code}).");
        }

        private void HandleError(string message)
        {
            SetStatus($"Connection error: {message}");
        }

        private void Update()
        {
            if (_isDead || string.IsNullOrEmpty(_localPlayerId)) return;

            Direction? direction = null;
            if (Input.GetKeyDown(KeyCode.UpArrow) || Input.GetKeyDown(KeyCode.W)) direction = Direction.Up;
            else if (Input.GetKeyDown(KeyCode.DownArrow) || Input.GetKeyDown(KeyCode.S)) direction = Direction.Down;
            else if (Input.GetKeyDown(KeyCode.LeftArrow) || Input.GetKeyDown(KeyCode.A)) direction = Direction.Left;
            else if (Input.GetKeyDown(KeyCode.RightArrow) || Input.GetKeyDown(KeyCode.D)) direction = Direction.Right;

            if (direction.HasValue && direction.Value != _lastSentDirection)
            {
                _lastSentDirection = direction.Value;
                SendDirection(direction.Value);
            }
        }

        private void SendDirection(Direction direction)
        {
            var name = direction switch
            {
                Direction.Up => "up",
                Direction.Down => "down",
                Direction.Left => "left",
                Direction.Right => "right",
                _ => null,
            };
            if (name == null) return;

            var msg = new JObject
            {
                ["type"] = "input",
                ["payload"] = new JObject { ["direction"] = name },
            };
            networkClient.Send(msg.ToString(Newtonsoft.Json.Formatting.None));
        }

        private void UpdateScore(StatePayload state)
        {
            if (scoreText == null || string.IsNullOrEmpty(_localPlayerId)) return;
            foreach (var snake in state.Snakes)
            {
                if (snake.Id == _localPlayerId)
                {
                    scoreText.text = $"Score: {snake.Score}";
                    return;
                }
            }
        }

        private void ShowGameOver(int score)
        {
            _isDead = true;
            if (gameOverPanel != null) gameOverPanel.SetActive(true);
            SetStatus($"You died — final score {score}. Refresh to play again.");
        }

        private void SetStatus(string message)
        {
            if (statusText == null) return;
            statusText.gameObject.SetActive(!string.IsNullOrEmpty(message));
            statusText.text = message ?? string.Empty;
        }

        private void OnDestroy()
        {
            networkClient.OnOpen -= HandleOpen;
            networkClient.OnMessage -= HandleMessage;
            networkClient.OnClose -= HandleClose;
            networkClient.OnError -= HandleError;
        }
    }
}
