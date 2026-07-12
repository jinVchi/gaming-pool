using System;
using UnityEngine;

#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#else
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
#endif

namespace GamingPool.Snake
{
    // WebGL builds cannot use System.Net.WebSockets (browser sandbox) and bridge
    // to the native browser WebSocket via WebSocketBridge.jslib instead. The
    // Editor/standalone path uses ClientWebSocket so Play Mode can connect
    // directly to a local game-server without needing a build.
    public class NetworkClient : MonoBehaviour
    {
        public event Action OnOpen;
        public event Action<string> OnMessage;
        public event Action<int> OnClose;
        public event Action<string> OnError;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern void WSConnect(string url, string gameObjectName);
        [DllImport("__Internal")] private static extern void WSSend(string gameObjectName, string data);
        [DllImport("__Internal")] private static extern void WSClose(string gameObjectName);

        public void Connect(string url)
        {
            WSConnect(url, gameObject.name);
        }

        public void Send(string data)
        {
            WSSend(gameObject.name, data);
        }

        public void Close()
        {
            WSClose(gameObject.name);
        }

        // Invoked by WebSocketBridge.jslib via SendMessage(gameObject.name, ...).
        public void HandleSocketOpen() => OnOpen?.Invoke();
        public void HandleSocketMessage(string data) => OnMessage?.Invoke(data);
        public void HandleSocketClose(string code) => OnClose?.Invoke(int.TryParse(code, out var c) ? c : 0);
        public void HandleSocketError(string message) => OnError?.Invoke(message);
#else
        private ClientWebSocket _socket;
        private CancellationTokenSource _cts;
        private readonly ConcurrentQueue<Action> _mainThreadQueue = new ConcurrentQueue<Action>();

        public async void Connect(string url)
        {
            _socket = new ClientWebSocket();
            _cts = new CancellationTokenSource();
            try
            {
                await _socket.ConnectAsync(new Uri(url), _cts.Token);
                _mainThreadQueue.Enqueue(() => OnOpen?.Invoke());
                _ = ReceiveLoop();
            }
            catch (Exception e)
            {
                _mainThreadQueue.Enqueue(() => OnError?.Invoke(e.Message));
            }
        }

        private async Task ReceiveLoop()
        {
            var buffer = new byte[8192];
            var messageBuffer = new StringBuilder();
            try
            {
                while (_socket.State == WebSocketState.Open)
                {
                    var result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), _cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        var code = (int)(result.CloseStatus ?? WebSocketCloseStatus.NormalClosure);
                        _mainThreadQueue.Enqueue(() => OnClose?.Invoke(code));
                        break;
                    }

                    messageBuffer.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    if (result.EndOfMessage)
                    {
                        var msg = messageBuffer.ToString();
                        messageBuffer.Clear();
                        _mainThreadQueue.Enqueue(() => OnMessage?.Invoke(msg));
                    }
                }
            }
            catch (Exception e)
            {
                _mainThreadQueue.Enqueue(() => OnError?.Invoke(e.Message));
            }
        }

        public async void Send(string data)
        {
            if (_socket == null || _socket.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(data);
            await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts?.Token ?? CancellationToken.None);
        }

        public void Close()
        {
            _cts?.Cancel();
            _socket?.Abort();
        }

        private void Update()
        {
            while (_mainThreadQueue.TryDequeue(out var action)) action();
        }

        private void OnDestroy()
        {
            Close();
        }
#endif
    }
}
