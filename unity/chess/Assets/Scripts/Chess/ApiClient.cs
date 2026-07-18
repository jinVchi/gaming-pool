using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace GamingPool.Chess
{
    // Thin wrapper over the Global API's room-listing endpoints. Matchmaking
    // never proxies game traffic — this only ever returns { server, roomId };
    // NetworkClient connects directly to the game-server after that.
    public class ApiClient : MonoBehaviour
    {
        [SerializeField] private string apiBaseUrl = "http://localhost:4000";
        [SerializeField] private string gameSlug = "chess";
        private string _playerToken;

#if UNITY_WEBGL && !UNITY_EDITOR
        [System.Runtime.InteropServices.DllImport("__Internal")] private static extern string GPGetApiBaseUrl();
#endif

        public string ApiBaseUrl => apiBaseUrl;

        private void Awake()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            var configuredUrl = GPGetApiBaseUrl();
            if (!string.IsNullOrEmpty(configuredUrl)) apiBaseUrl = configuredUrl.TrimEnd('/');
#endif
        }

        public void ConfigurePlayerToken(string playerToken)
        {
            _playerToken = playerToken;
        }

        public void ListRooms(Action<List<OpenRoom>> onSuccess, Action<string> onError)
        {
            StartCoroutine(ListRoomsRoutine(onSuccess, onError));
        }

        public void CreateRoom(Action<RoomAssignment> onSuccess, Action<string> onError)
        {
            StartCoroutine(CreateRoomRoutine(onSuccess, onError));
        }

        public void JoinRoom(string roomId, Action<RoomAssignment> onSuccess, Action<string> onError)
        {
            StartCoroutine(JoinRoomRoutine(roomId, onSuccess, onError));
        }

        private IEnumerator ListRoomsRoutine(Action<List<OpenRoom>> onSuccess, Action<string> onError)
        {
            using var request = UnityWebRequest.Get($"{apiBaseUrl}/rooms/{gameSlug}");
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(request.error);
                yield break;
            }

            var rooms = JsonConvert.DeserializeObject<List<OpenRoom>>(request.downloadHandler.text) ?? new List<OpenRoom>();
            onSuccess?.Invoke(rooms);
        }

        private IEnumerator CreateRoomRoutine(Action<RoomAssignment> onSuccess, Action<string> onError)
        {
            const string body = "{}";
            using var request = new UnityWebRequest($"{apiBaseUrl}/rooms/{gameSlug}", "POST");
            request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Authorization", $"Bearer {_playerToken}");
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(ErrorMessage(request));
                yield break;
            }

            onSuccess?.Invoke(JsonConvert.DeserializeObject<RoomAssignment>(request.downloadHandler.text));
        }

        private IEnumerator JoinRoomRoutine(string roomId, Action<RoomAssignment> onSuccess, Action<string> onError)
        {
            var body = new JObject { ["roomId"] = roomId }.ToString(Formatting.None);
            using var request = new UnityWebRequest($"{apiBaseUrl}/rooms/{gameSlug}/join", "POST");
            request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Authorization", $"Bearer {_playerToken}");
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(ErrorMessage(request));
                yield break;
            }

            onSuccess?.Invoke(JsonConvert.DeserializeObject<RoomAssignment>(request.downloadHandler.text));
        }

        // The API reports failures as { "error": "..." } — surface that message
        // instead of Unity's generic transport error where possible.
        private static string ErrorMessage(UnityWebRequest request)
        {
            var text = request.downloadHandler?.text;
            if (string.IsNullOrEmpty(text)) return request.error;
            try
            {
                var message = JObject.Parse(text)["error"]?.ToString();
                if (!string.IsNullOrEmpty(message)) return message;
            }
            catch (Exception)
            {
                // not JSON — fall through to the raw body
            }
            return text;
        }
    }
}
