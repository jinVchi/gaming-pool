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
            using var request = new UnityWebRequest($"{apiBaseUrl}/rooms/{gameSlug}", "POST");
            request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes("{}"));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(request.error);
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
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                var message = request.downloadHandler != null && !string.IsNullOrEmpty(request.downloadHandler.text)
                    ? request.downloadHandler.text
                    : request.error;
                onError?.Invoke(message);
                yield break;
            }

            onSuccess?.Invoke(JsonConvert.DeserializeObject<RoomAssignment>(request.downloadHandler.text));
        }
    }
}
