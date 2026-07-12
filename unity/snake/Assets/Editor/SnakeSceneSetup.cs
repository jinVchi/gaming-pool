using GamingPool.Snake;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace GamingPool.Snake.Editor
{
    // Builds the Snake scene programmatically instead of shipping a hand-authored
    // .unity file, which is fragile to write correctly without a real Editor to
    // verify it in. Run once via Gaming Pool > Setup Snake Scene, then save the
    // scene (Ctrl+S) as Assets/Scenes/Snake.unity.
    public static class SnakeSceneSetup
    {
        private const float GridWorldSize = 60f;
        private const string PrefabFolder = "Assets/Prefabs";

        [MenuItem("Gaming Pool/Setup Snake Scene")]
        public static void SetupScene()
        {
            var segmentPrefab = CreateOrLoadPrefab("SnakeSegment", PrimitiveType.Cube, new Vector3(0.9f, 0.9f, 0.9f));
            var foodPrefab = CreateOrLoadPrefab("Food", PrimitiveType.Sphere, new Vector3(0.5f, 0.5f, 0.5f));

            SetupCamera();
            var canvas = SetupCanvas(out var statusText, out var scoreText, out var gameOverPanel);
            SetupGameManager(segmentPrefab, foodPrefab, statusText, scoreText, gameOverPanel);

            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            Debug.Log("Snake scene set up. Save the scene as Assets/Scenes/Snake.unity (Ctrl+S).");
        }

        private static GameObject CreateOrLoadPrefab(string name, PrimitiveType primitive, Vector3 scale)
        {
            var path = $"{PrefabFolder}/{name}.prefab";
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (existing != null) return existing;

            if (!AssetDatabase.IsValidFolder(PrefabFolder))
            {
                AssetDatabase.CreateFolder("Assets", "Prefabs");
            }

            var instance = GameObject.CreatePrimitive(primitive);
            instance.name = name;
            instance.transform.localScale = scale;

            var prefab = PrefabUtility.SaveAsPrefabAsset(instance, path);
            Object.DestroyImmediate(instance);
            return prefab;
        }

        private static void SetupCamera()
        {
            var cameraObj = GameObject.Find("Main Camera") ?? new GameObject("Main Camera");
            if (cameraObj.GetComponent<Camera>() == null) cameraObj.AddComponent<Camera>();
            var camera = cameraObj.GetComponent<Camera>();

            camera.orthographic = true;
            camera.orthographicSize = GridWorldSize / 2f + 5f;
            camera.transform.position = new Vector3(GridWorldSize / 2f, 50f, -GridWorldSize / 2f);
            camera.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            camera.tag = "MainCamera";
        }

        private static Canvas SetupCanvas(out Text statusText, out Text scoreText, out GameObject gameOverPanel)
        {
            var canvasObj = GameObject.Find("Canvas") ?? new GameObject("Canvas");
            var canvas = canvasObj.GetComponent<Canvas>() ?? canvasObj.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            if (canvasObj.GetComponent<CanvasScaler>() == null) canvasObj.AddComponent<CanvasScaler>();
            if (canvasObj.GetComponent<GraphicRaycaster>() == null) canvasObj.AddComponent<GraphicRaycaster>();

            if (GameObject.Find("EventSystem") == null)
            {
                var eventSystemObj = new GameObject("EventSystem");
                eventSystemObj.AddComponent<UnityEngine.EventSystems.EventSystem>();
                eventSystemObj.AddComponent<UnityEngine.EventSystems.StandaloneInputModule>();
            }

            statusText = CreateText(canvasObj.transform, "StatusText", new Vector2(0f, 100f), 28);
            scoreText = CreateText(canvasObj.transform, "ScoreText", new Vector2(0f, -300f), 24);
            scoreText.alignment = TextAnchor.UpperLeft;
            scoreText.rectTransform.anchorMin = new Vector2(0f, 1f);
            scoreText.rectTransform.anchorMax = new Vector2(0f, 1f);
            scoreText.rectTransform.anchoredPosition = new Vector2(20f, -20f);

            gameOverPanel = GameObject.Find("GameOverPanel");
            if (gameOverPanel == null)
            {
                gameOverPanel = new GameObject("GameOverPanel", typeof(RectTransform));
                gameOverPanel.transform.SetParent(canvasObj.transform, false);
                var image = gameOverPanel.AddComponent<Image>();
                image.color = new Color(0f, 0f, 0f, 0.6f);
                var rect = gameOverPanel.GetComponent<RectTransform>();
                rect.anchorMin = Vector2.zero;
                rect.anchorMax = Vector2.one;
                rect.offsetMin = Vector2.zero;
                rect.offsetMax = Vector2.zero;
            }
            gameOverPanel.SetActive(false);

            return canvas;
        }

        private static Text CreateText(Transform parent, string name, Vector2 anchoredPosition, int fontSize)
        {
            var existing = parent.Find(name);
            GameObject textObj = existing != null ? existing.gameObject : new GameObject(name, typeof(RectTransform));
            textObj.transform.SetParent(parent, false);

            var text = textObj.GetComponent<Text>() ?? textObj.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = fontSize;
            text.alignment = TextAnchor.MiddleCenter;
            text.color = Color.white;
            text.text = string.Empty;

            var rect = text.rectTransform;
            rect.anchorMin = new Vector2(0.5f, 1f);
            rect.anchorMax = new Vector2(0.5f, 1f);
            rect.sizeDelta = new Vector2(600f, 50f);
            rect.anchoredPosition = anchoredPosition;

            return text;
        }

        private static void SetupGameManager(
            GameObject segmentPrefab,
            GameObject foodPrefab,
            Text statusText,
            Text scoreText,
            GameObject gameOverPanel)
        {
            var gmObj = GameObject.Find("GameManager") ?? new GameObject("GameManager");

            var networkClient = gmObj.GetComponent<NetworkClient>() ?? gmObj.AddComponent<NetworkClient>();

            var rendererObj = GameObject.Find("SnakeRenderer") ?? new GameObject("SnakeRenderer");
            var snakeRenderer = rendererObj.GetComponent<SnakeRenderer>() ?? rendererObj.AddComponent<SnakeRenderer>();
            SetPrivateField(snakeRenderer, "segmentPrefab", segmentPrefab);

            var foodRendererObj = GameObject.Find("FoodRenderer") ?? new GameObject("FoodRenderer");
            var foodRenderer = foodRendererObj.GetComponent<FoodRenderer>() ?? foodRendererObj.AddComponent<FoodRenderer>();
            SetPrivateField(foodRenderer, "foodPrefab", foodPrefab);

            var gameManager = gmObj.GetComponent<GameManager>() ?? gmObj.AddComponent<GameManager>();
            SetPrivateField(gameManager, "networkClient", networkClient);
            SetPrivateField(gameManager, "snakeRenderer", snakeRenderer);
            SetPrivateField(gameManager, "foodRenderer", foodRenderer);
            SetPrivateField(gameManager, "statusText", statusText);
            SetPrivateField(gameManager, "scoreText", scoreText);
            SetPrivateField(gameManager, "gameOverPanel", gameOverPanel);
        }

        private static void SetPrivateField(Object target, string fieldName, Object value)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(fieldName);
            if (prop == null)
            {
                Debug.LogWarning($"SnakeSceneSetup: could not find serialized field '{fieldName}' on {target.GetType().Name}");
                return;
            }
            prop.objectReferenceValue = value;
            so.ApplyModifiedProperties();
        }
    }
}
