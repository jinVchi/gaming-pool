using GamingPool.Chess;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace GamingPool.Chess.Editor
{
    // Builds the Chess scene programmatically instead of shipping a hand-authored
    // .unity file — see unity/snake's SnakeSceneSetup.cs for why. Run once via
    // Gaming Pool > Setup Chess Scene, then save the scene (Ctrl+S) as
    // Assets/Scenes/Chess.unity.
    //
    // Avoids `GetComponent<T>() ?? AddComponent<T>()` throughout (see the note
    // in SnakeSceneSetup.cs) — every lookup uses an explicit `== null` check.
    public static class ChessSceneSetup
    {
        private const float CellSize = 1f;
        private const string PrefabFolder = "Assets/Prefabs";

        private class CanvasRefs
        {
            public LobbyBrowserUI LobbyBrowser;
            public WaitingRoomUI WaitingRoom;
            public GameObject GameOverPanel;
            public Text GameOverText;
            public Button BackToLobbyButton;
            public Text StatusText;
        }

        [MenuItem("Gaming Pool/Setup Chess Scene")]
        public static void SetupScene()
        {
            SetupCamera();
            var board = SetupBoard();
            var rowPrefab = CreateOrLoadRoomRowPrefab();
            var canvasRefs = SetupCanvas(rowPrefab);
            SetupGameManager(board, canvasRefs);

            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            Debug.Log("Chess scene set up. Save the scene as Assets/Scenes/Chess.unity (Ctrl+S).");
        }

        private static GameObject FindOrCreate(string name)
        {
            var existing = GameObject.Find(name);
            return existing != null ? existing : new GameObject(name);
        }

        private static T GetOrAddComponent<T>(GameObject obj) where T : Component
        {
            var component = obj.GetComponent<T>();
            if (component == null) component = obj.AddComponent<T>();
            return component;
        }

        private static void SetPrivateField(Object target, string fieldName, Object value)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(fieldName);
            if (prop == null)
            {
                Debug.LogWarning($"ChessSceneSetup: could not find serialized field '{fieldName}' on {target.GetType().Name}");
                return;
            }
            prop.objectReferenceValue = value;
            so.ApplyModifiedProperties();
        }

        private static void SetupCamera()
        {
            var cameraObj = FindOrCreate("Main Camera");
            var camera = GetOrAddComponent<Camera>(cameraObj);

            camera.orthographic = true;
            camera.orthographicSize = 6f;
            camera.transform.position = new Vector3(3.5f * CellSize, 20f, 3.5f * CellSize);
            camera.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            camera.tag = "MainCamera";
        }

        private static GameObject SetupBoard()
        {
            var boardObj = FindOrCreate("Board");
            for (var i = boardObj.transform.childCount - 1; i >= 0; i--)
            {
                Object.DestroyImmediate(boardObj.transform.GetChild(i).gameObject);
            }

            // Two shared materials, reused across all 64 squares. Calling
            // renderer.material (not sharedMaterial) in edit mode instantiates a
            // unique clone per call and leaks it into the scene — sharedMaterial
            // avoids that entirely since these squares never need independent
            // colors at setup time (BoardRenderer's runtime highlight logic is
            // the one place a per-square instance is actually wanted).
            Material lightMaterial = null;
            Material darkMaterial = null;

            for (var fileIdx = 0; fileIdx < 8; fileIdx++)
            {
                for (var rankIdx = 0; rankIdx < 8; rankIdx++)
                {
                    var square = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    square.name = $"{(char)('a' + fileIdx)}{rankIdx + 1}";
                    square.transform.SetParent(boardObj.transform, false);
                    square.transform.localPosition = new Vector3(fileIdx * CellSize, 0f, rankIdx * CellSize);
                    square.transform.localScale = new Vector3(CellSize * 0.95f, 0.1f, CellSize * 0.95f);

                    var light = (fileIdx + rankIdx) % 2 == 0;
                    var squareRenderer = square.GetComponent<Renderer>();
                    if (squareRenderer == null) continue;

                    if (light)
                    {
                        if (lightMaterial == null)
                        {
                            lightMaterial = new Material(squareRenderer.sharedMaterial) { color = new Color(0.9f, 0.9f, 0.8f) };
                        }
                        squareRenderer.sharedMaterial = lightMaterial;
                    }
                    else
                    {
                        if (darkMaterial == null)
                        {
                            darkMaterial = new Material(squareRenderer.sharedMaterial) { color = new Color(0.35f, 0.25f, 0.2f) };
                        }
                        squareRenderer.sharedMaterial = darkMaterial;
                    }
                }
            }

            GetOrAddComponent<BoardRenderer>(boardObj);
            return boardObj;
        }

        private static GameObject CreateOrLoadRoomRowPrefab()
        {
            const string path = PrefabFolder + "/RoomListRow.prefab";
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (existing != null) return existing;

            if (!AssetDatabase.IsValidFolder(PrefabFolder))
            {
                AssetDatabase.CreateFolder("Assets", "Prefabs");
            }

            var row = new GameObject("RoomListRow", typeof(RectTransform));
            var rowRect = row.GetComponent<RectTransform>();
            rowRect.sizeDelta = new Vector2(420f, 36f);
            rowRect.anchorMin = new Vector2(0f, 1f);
            rowRect.anchorMax = new Vector2(0f, 1f);
            rowRect.pivot = new Vector2(0f, 1f);

            var background = row.AddComponent<Image>();
            background.color = new Color(1f, 1f, 1f, 0.06f);

            var infoText = CreateUIText(row.transform, "InfoText", 16);
            infoText.alignment = TextAnchor.MiddleLeft;
            var infoRect = infoText.rectTransform;
            infoRect.anchorMin = new Vector2(0f, 0f);
            infoRect.anchorMax = new Vector2(0.7f, 1f);
            infoRect.offsetMin = new Vector2(10f, 0f);
            infoRect.offsetMax = Vector2.zero;

            var joinButtonObj = new GameObject("JoinButton", typeof(RectTransform));
            joinButtonObj.transform.SetParent(row.transform, false);
            var joinRect = joinButtonObj.GetComponent<RectTransform>();
            joinRect.anchorMin = new Vector2(0.72f, 0.12f);
            joinRect.anchorMax = new Vector2(0.97f, 0.88f);
            joinRect.offsetMin = Vector2.zero;
            joinRect.offsetMax = Vector2.zero;
            var joinImage = joinButtonObj.AddComponent<Image>();
            joinImage.color = new Color(0.3f, 0.5f, 0.9f);
            joinButtonObj.AddComponent<Button>();

            var joinLabel = CreateUIText(joinButtonObj.transform, "Label", 14);
            joinLabel.text = "Join";
            joinLabel.alignment = TextAnchor.MiddleCenter;
            var joinLabelRect = joinLabel.rectTransform;
            joinLabelRect.anchorMin = Vector2.zero;
            joinLabelRect.anchorMax = Vector2.one;
            joinLabelRect.offsetMin = Vector2.zero;
            joinLabelRect.offsetMax = Vector2.zero;

            var prefab = PrefabUtility.SaveAsPrefabAsset(row, path);
            Object.DestroyImmediate(row);
            return prefab;
        }

        private static Text CreateUIText(Transform parent, string name, int fontSize)
        {
            var existing = parent.Find(name);
            var textObj = existing != null ? existing.gameObject : new GameObject(name, typeof(RectTransform));
            textObj.transform.SetParent(parent, false);

            var text = GetOrAddComponent<Text>(textObj);
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = fontSize;
            text.color = Color.white;
            text.text = string.Empty;
            return text;
        }

        private static Button CreateUIButton(Transform parent, string name, string label, Vector2 anchoredPosition, Vector2 size)
        {
            var existing = parent.Find(name);
            var buttonObj = existing != null ? existing.gameObject : new GameObject(name, typeof(RectTransform));
            buttonObj.transform.SetParent(parent, false);

            var rect = buttonObj.GetComponent<RectTransform>();
            rect.anchorMin = new Vector2(0.5f, 1f);
            rect.anchorMax = new Vector2(0.5f, 1f);
            rect.sizeDelta = size;
            rect.anchoredPosition = anchoredPosition;

            var image = GetOrAddComponent<Image>(buttonObj);
            image.color = new Color(0.3f, 0.5f, 0.9f);
            var button = GetOrAddComponent<Button>(buttonObj);

            var labelText = CreateUIText(buttonObj.transform, "Label", 16);
            labelText.text = label;
            labelText.alignment = TextAnchor.MiddleCenter;
            var labelRect = labelText.rectTransform;
            labelRect.anchorMin = Vector2.zero;
            labelRect.anchorMax = Vector2.one;
            labelRect.offsetMin = Vector2.zero;
            labelRect.offsetMax = Vector2.zero;

            return button;
        }

        private static CanvasRefs SetupCanvas(GameObject rowPrefab)
        {
            var canvasObj = FindOrCreate("Canvas");
            var canvas = GetOrAddComponent<Canvas>(canvasObj);
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            GetOrAddComponent<CanvasScaler>(canvasObj);
            GetOrAddComponent<GraphicRaycaster>(canvasObj);

            var eventSystemObj = GameObject.Find("EventSystem");
            if (eventSystemObj == null) eventSystemObj = new GameObject("EventSystem");
            GetOrAddComponent<UnityEngine.EventSystems.EventSystem>(eventSystemObj);
            GetOrAddComponent<UnityEngine.EventSystems.StandaloneInputModule>(eventSystemObj);

            var statusText = CreateUIText(canvasObj.transform, "StatusText", 24);
            statusText.alignment = TextAnchor.MiddleCenter;
            var statusRect = statusText.rectTransform;
            statusRect.anchorMin = new Vector2(0.5f, 1f);
            statusRect.anchorMax = new Vector2(0.5f, 1f);
            statusRect.sizeDelta = new Vector2(700f, 40f);
            statusRect.anchoredPosition = new Vector2(0f, -20f);

            var lobbyBrowser = SetupLobbyBrowserPanel(canvasObj.transform, rowPrefab);
            var waitingRoom = SetupWaitingRoomPanel(canvasObj.transform);
            SetupGameOverPanel(canvasObj.transform, out var gameOverPanel, out var gameOverText, out var backToLobbyButton);

            return new CanvasRefs
            {
                LobbyBrowser = lobbyBrowser,
                WaitingRoom = waitingRoom,
                GameOverPanel = gameOverPanel,
                GameOverText = gameOverText,
                BackToLobbyButton = backToLobbyButton,
                StatusText = statusText,
            };
        }

        private static LobbyBrowserUI SetupLobbyBrowserPanel(Transform canvasTransform, GameObject rowPrefab)
        {
            var panelObj = FindOrCreate("LobbyBrowserPanel");
            panelObj.transform.SetParent(canvasTransform, false);
            var panelRect = GetOrAddComponent<RectTransform>(panelObj);
            panelRect.anchorMin = Vector2.zero;
            panelRect.anchorMax = Vector2.one;
            panelRect.offsetMin = Vector2.zero;
            panelRect.offsetMax = Vector2.zero;

            var createButton = CreateUIButton(panelObj.transform, "CreateRoomButton", "Create Room", new Vector2(0f, -80f), new Vector2(220f, 44f));
            var refreshButton = CreateUIButton(panelObj.transform, "RefreshButton", "Refresh", new Vector2(0f, -140f), new Vector2(220f, 36f));

            var listContainerObj = panelObj.transform.Find("ListContainer");
            GameObject listContainer = listContainerObj != null ? listContainerObj.gameObject : new GameObject("ListContainer", typeof(RectTransform));
            listContainer.transform.SetParent(panelObj.transform, false);
            var listRect = listContainer.GetComponent<RectTransform>();
            listRect.anchorMin = new Vector2(0.5f, 1f);
            listRect.anchorMax = new Vector2(0.5f, 1f);
            listRect.pivot = new Vector2(0.5f, 1f);
            listRect.sizeDelta = new Vector2(420f, 400f);
            listRect.anchoredPosition = new Vector2(0f, -200f);

            var lobbyBrowser = GetOrAddComponent<LobbyBrowserUI>(panelObj);
            SetPrivateField(lobbyBrowser, "createRoomButton", createButton);
            SetPrivateField(lobbyBrowser, "refreshButton", refreshButton);
            SetPrivateField(lobbyBrowser, "listContainer", listContainer.transform);
            SetPrivateField(lobbyBrowser, "rowPrefab", rowPrefab);

            return lobbyBrowser;
        }

        private static WaitingRoomUI SetupWaitingRoomPanel(Transform canvasTransform)
        {
            var panelObj = FindOrCreate("WaitingRoomPanel");
            panelObj.transform.SetParent(canvasTransform, false);
            var panelRect = GetOrAddComponent<RectTransform>(panelObj);
            panelRect.anchorMin = Vector2.zero;
            panelRect.anchorMax = Vector2.one;
            panelRect.offsetMin = Vector2.zero;
            panelRect.offsetMax = Vector2.zero;

            var infoText = CreateUIText(panelObj.transform, "InfoText", 20);
            infoText.alignment = TextAnchor.MiddleCenter;
            var infoRect = infoText.rectTransform;
            infoRect.anchorMin = new Vector2(0.5f, 1f);
            infoRect.anchorMax = new Vector2(0.5f, 1f);
            infoRect.sizeDelta = new Vector2(500f, 100f);
            infoRect.anchoredPosition = new Vector2(0f, -120f);

            var readyButton = CreateUIButton(panelObj.transform, "ReadyButton", "Ready", new Vector2(0f, -220f), new Vector2(220f, 44f));
            var startButton = CreateUIButton(panelObj.transform, "StartButton", "Start Game", new Vector2(0f, -280f), new Vector2(220f, 44f));

            var waitingRoom = GetOrAddComponent<WaitingRoomUI>(panelObj);
            SetPrivateField(waitingRoom, "infoText", infoText);
            SetPrivateField(waitingRoom, "readyButton", readyButton);
            SetPrivateField(waitingRoom, "startButton", startButton);

            return waitingRoom;
        }

        private static void SetupGameOverPanel(Transform canvasTransform, out GameObject panel, out Text gameOverText, out Button backToLobbyButton)
        {
            var panelObj = FindOrCreate("GameOverPanel");
            panelObj.transform.SetParent(canvasTransform, false);
            var panelRect = GetOrAddComponent<RectTransform>(panelObj);
            panelRect.anchorMin = Vector2.zero;
            panelRect.anchorMax = Vector2.one;
            panelRect.offsetMin = Vector2.zero;
            panelRect.offsetMax = Vector2.zero;

            var background = GetOrAddComponent<Image>(panelObj);
            background.color = new Color(0f, 0f, 0f, 0.7f);

            var text = CreateUIText(panelObj.transform, "GameOverText", 28);
            text.alignment = TextAnchor.MiddleCenter;
            var textRect = text.rectTransform;
            textRect.anchorMin = new Vector2(0.5f, 0.5f);
            textRect.anchorMax = new Vector2(0.5f, 0.5f);
            textRect.sizeDelta = new Vector2(600f, 80f);
            textRect.anchoredPosition = new Vector2(0f, 40f);

            var button = CreateUIButton(panelObj.transform, "BackToLobbyButton", "Back to Lobby", new Vector2(0f, -60f), new Vector2(220f, 44f));
            var buttonRect = button.GetComponent<RectTransform>();
            buttonRect.anchorMin = new Vector2(0.5f, 0.5f);
            buttonRect.anchorMax = new Vector2(0.5f, 0.5f);
            buttonRect.anchoredPosition = new Vector2(0f, -40f);

            panelObj.SetActive(false);

            panel = panelObj;
            gameOverText = text;
            backToLobbyButton = button;
        }

        private static void SetupGameManager(GameObject board, CanvasRefs canvasRefs)
        {
            var gmObj = FindOrCreate("GameManager");
            var networkClient = GetOrAddComponent<NetworkClient>(gmObj);
            var apiClient = GetOrAddComponent<ApiClient>(gmObj);
            var gameManager = GetOrAddComponent<GameManager>(gmObj);

            SetPrivateField(gameManager, "networkClient", networkClient);
            SetPrivateField(gameManager, "apiClient", apiClient);
            SetPrivateField(gameManager, "lobbyBrowser", canvasRefs.LobbyBrowser);
            SetPrivateField(gameManager, "waitingRoom", canvasRefs.WaitingRoom);
            SetPrivateField(gameManager, "board", board.GetComponent<BoardRenderer>());
            SetPrivateField(gameManager, "gameOverPanel", canvasRefs.GameOverPanel);
            SetPrivateField(gameManager, "gameOverText", canvasRefs.GameOverText);
            SetPrivateField(gameManager, "backToLobbyButton", canvasRefs.BackToLobbyButton);
            SetPrivateField(gameManager, "statusText", canvasRefs.StatusText);

            // BoardRenderer raycasts through this camera to pick clicked squares.
            var camera = GameObject.Find("Main Camera")?.GetComponent<Camera>();
            SetPrivateField(board.GetComponent<BoardRenderer>(), "boardCamera", camera);
        }
    }
}
