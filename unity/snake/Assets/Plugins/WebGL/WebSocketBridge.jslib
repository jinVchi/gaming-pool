// Bridges the browser's native WebSocket API to C#. Unity WebGL builds run in
// the browser sandbox and cannot use System.Net.WebSockets directly, so
// NetworkClient.cs P/Invokes into these functions on WEBGL builds only; the
// Editor/standalone code path in NetworkClient.cs uses ClientWebSocket instead.
mergeInto(LibraryManager.library, {
  // Identity is resolved by the web shell (Better Auth user or persisted
  // guest) and exposed on window.__gamingPoolPlayer by UnityLoader.tsx before
  // the build boots. Returns a JSON string, or "" when unset (e.g. the build
  // is opened outside the web shell).
  GPGetPlayerIdentity: function () {
    var identity = window.__gamingPoolPlayer;
    var json = identity ? JSON.stringify(identity) : "";
    var size = lengthBytesUTF8(json) + 1;
    var buffer = _malloc(size);
    stringToUTF8(json, buffer, size);
    return buffer;
  },

  GPGetApiBaseUrl: function () {
    var apiBaseUrl = (window.__gamingPoolConfig && window.__gamingPoolConfig.apiBaseUrl) || "";
    var size = lengthBytesUTF8(apiBaseUrl) + 1;
    var buffer = _malloc(size);
    stringToUTF8(apiBaseUrl, buffer, size);
    return buffer;
  },

  WSConnect: function (urlPtr, gameObjectNamePtr) {
    var url = UTF8ToString(urlPtr);
    var gameObjectName = UTF8ToString(gameObjectNamePtr);

    if (!window.__gamingPoolSockets) window.__gamingPoolSockets = {};

    var socket = new WebSocket(url);
    window.__gamingPoolSockets[gameObjectName] = socket;

    socket.onopen = function () {
      SendMessage(gameObjectName, "HandleSocketOpen");
    };
    socket.onmessage = function (event) {
      SendMessage(gameObjectName, "HandleSocketMessage", event.data);
    };
    socket.onclose = function (event) {
      SendMessage(gameObjectName, "HandleSocketClose", String(event.code));
      delete window.__gamingPoolSockets[gameObjectName];
    };
    socket.onerror = function () {
      SendMessage(gameObjectName, "HandleSocketError", "WebSocket error");
    };
  },

  WSSend: function (gameObjectNamePtr, dataPtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var data = UTF8ToString(dataPtr);
    var socket = window.__gamingPoolSockets && window.__gamingPoolSockets[gameObjectName];
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  },

  WSClose: function (gameObjectNamePtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    var socket = window.__gamingPoolSockets && window.__gamingPoolSockets[gameObjectName];
    if (socket) {
      socket.close();
      delete window.__gamingPoolSockets[gameObjectName];
    }
  },
});
