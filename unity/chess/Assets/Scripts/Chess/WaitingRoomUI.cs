using System;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace GamingPool.Chess
{
    public class WaitingRoomUI : MonoBehaviour
    {
        [SerializeField] private Text infoText;
        [SerializeField] private Button readyButton;
        [SerializeField] private Button startButton;

        public event Action OnReadyClicked;
        public event Action OnStartClicked;

        private void Awake()
        {
            readyButton.onClick.AddListener(() => OnReadyClicked?.Invoke());
            startButton.onClick.AddListener(() => OnStartClicked?.Invoke());
        }

        public void Render(LobbyPayload lobby, string localPlayerId)
        {
            var owner = lobby.Players.FirstOrDefault(p => p.Id == lobby.OwnerId);
            var guest = lobby.Players.FirstOrDefault(p => p.Id != lobby.OwnerId);
            var isOwner = lobby.OwnerId == localPlayerId;

            var ownerName = owner != null ? owner.DisplayName : "?";
            var guestLine = guest != null ? $"{guest.DisplayName} ({(guest.Ready ? "ready" : "not ready")})" : "waiting for a player...";

            infoText.text = $"Host: {ownerName}\nGuest: {guestLine}";

            readyButton.gameObject.SetActive(!isOwner && guest != null && guest.Id == localPlayerId && !guest.Ready);
            startButton.gameObject.SetActive(isOwner);
            startButton.interactable = guest != null && guest.Ready;
        }
    }
}
