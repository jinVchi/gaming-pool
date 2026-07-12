using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace GamingPool.Chess
{
    public class LobbyBrowserUI : MonoBehaviour
    {
        [SerializeField] private Button createRoomButton;
        [SerializeField] private Button refreshButton;
        [SerializeField] private Transform listContainer;
        [SerializeField] private GameObject rowPrefab; // children named "InfoText" and "JoinButton"

        public event Action OnCreateRoom;
        public event Action<string> OnJoinRoom;

        private readonly List<GameObject> _rows = new List<GameObject>();
        private ApiClient _apiClient;

        private void Awake()
        {
            createRoomButton.onClick.AddListener(() => OnCreateRoom?.Invoke());
            if (refreshButton != null)
            {
                refreshButton.onClick.AddListener(() =>
                {
                    if (_apiClient != null) Refresh(_apiClient);
                });
            }
        }

        public void Refresh(ApiClient apiClient)
        {
            _apiClient = apiClient;
            apiClient.ListRooms(Render, (error) => Debug.LogWarning($"Failed to list chess rooms: {error}"));
        }

        private const float RowHeight = 44f;

        private void Render(List<OpenRoom> rooms)
        {
            foreach (var row in _rows) Destroy(row);
            _rows.Clear();

            for (var i = 0; i < rooms.Count; i++)
            {
                var room = rooms[i];
                var row = Instantiate(rowPrefab, listContainer);
                row.SetActive(true);

                var rowRect = row.GetComponent<RectTransform>();
                if (rowRect != null) rowRect.anchoredPosition = new Vector2(0f, -i * RowHeight);

                var infoText = row.transform.Find("InfoText")?.GetComponent<Text>();
                if (infoText != null) infoText.text = $"{room.HostName}  ({room.PlayerCount}/{room.MaxPlayers})";

                var joinButton = row.transform.Find("JoinButton")?.GetComponent<Button>();
                if (joinButton != null)
                {
                    var roomId = room.RoomId;
                    joinButton.onClick.AddListener(() => OnJoinRoom?.Invoke(roomId));
                }

                _rows.Add(row);
            }
        }
    }
}
